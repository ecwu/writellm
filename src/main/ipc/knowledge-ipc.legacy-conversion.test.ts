import type { IpcMainInvokeEvent } from 'electron'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  legacyCitationConversionApplyResultSchema,
  type LegacyCitationConversionPlan
} from '../../shared/contracts/references'
import { initializeProjectDatabase } from '../project/project-database'
import { ProjectOperationRegistry } from '../project/project-operations'
import { ManuscriptService } from '../manuscript/manuscript-service'
import {
  EditorPersistenceService,
  sectionMaterializationPath,
  type EditorPersistenceFaults
} from '../manuscript/editor-persistence-service'
import { registerKnowledgeIpc, type KnowledgeIpcMain } from './knowledge-ipc'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

async function fixture(faults: EditorPersistenceFaults = {}) {
  const projectRoot = await mkdtemp(join(tmpdir(), 'writellm-legacy-conversion-'))
  await mkdir(join(projectRoot, '.writellm'), { recursive: true })
  const log = Object.assign(pino({ level: 'silent' }), {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })
  const manifest = {
    format: 'writellm-project' as const,
    formatVersion: 1 as const,
    projectId: crypto.randomUUID(),
    createdAt: '2026-10-14T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    log
  })
  cleanups.push(async () => {
    database.close()
    await rm(projectRoot, { recursive: true, force: true })
  })
  const manuscript = new ManuscriptService({ database, projectId: manifest.projectId, log })
  const editorPersistence = new EditorPersistenceService({
    projectRoot,
    projectId: manifest.projectId,
    database,
    manuscript,
    log,
    faults
  })
  const projectSessionId = crypto.randomUUID()
  const context = {
    manuscript,
    editorPersistence,
    operations: new ProjectOperationRegistry(),
    references: { list: () => [{ title: 'Fixture', citationKey: 'fixture2026' }] }
  }
  let active = true
  const assertSession = (sessionId: string) => {
    if (!active || sessionId !== projectSessionId) throw new Error('stale project session')
    return context
  }
  const manager = {
    assertActiveSession: assertSession,
    assertMutationSession: (sessionId: string) => {
      const current = assertSession(sessionId)
      current.operations.assertMutationsAllowed()
      return current
    }
  }
  const handlers = new Map<string, (event: IpcMainInvokeEvent, input: unknown) => unknown>()
  const ipc: KnowledgeIpcMain = {
    handle: (channel, handler) => handlers.set(channel, handler),
    removeHandler: vi.fn()
  }
  registerKnowledgeIpc({
    manager: manager as never,
    logger: log,
    getWindow: () => null,
    developmentUrl: 'http://localhost:5173',
    ipc
  })
  const event = { senderFrame: { url: 'http://localhost:5173/' } } as IpcMainInvokeEvent
  const invoke = (channel: string, input: object) => {
    const handler = handlers.get(channel)
    if (!handler) throw new Error('Handler missing')
    return handler(event, { projectSessionId, ...input })
  }
  const seed = async (sectionId = manuscript.listSections()[0]?.sectionId) => {
    if (sectionId === undefined) throw new Error('Section missing')
    const current = editorPersistence.loadSection(sectionId).revision
    return (
      await editorPersistence.save({
        projectSessionId,
        sectionId,
        baseRevisionId: current.sectionRevisionId,
        baseContentHash: current.contentHash,
        document: [
          {
            id: crypto.randomUUID(),
            type: 'paragraph',
            props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
            content: [{ type: 'text', text: '[Source: Fixture, p. 2]', styles: {} }],
            children: []
          }
        ]
      })
    ).revision
  }
  const plan = () =>
    invoke(IPC_CHANNELS.referencePlanLegacyConversion, {}) as LegacyCitationConversionPlan
  const apply = async (planId: string) =>
    legacyCitationConversionApplyResultSchema.parse(
      await invoke(IPC_CHANNELS.referenceApplyLegacyConversion, { planId })
    )
  const mirror = async (sectionId: string) =>
    JSON.parse(await readFile(join(projectRoot, sectionMaterializationPath(sectionId)), 'utf8'))
  return {
    manuscript,
    editorPersistence,
    database,
    context,
    log,
    seed,
    plan,
    apply,
    mirror,
    revoke: () => {
      active = false
    },
    invoke,
    projectSessionId
  }
}

describe('legacy citation conversion IPC persistence', () => {
  it('publishes converted revisions immediately and retains their checkpoint parents', async () => {
    const f = await fixture()
    const prior = await f.seed()
    const result = await f.apply(f.plan().planId)
    const current = f.editorPersistence.loadSection(prior.sectionId).revision
    expect(result).toMatchObject({ sectionsChanged: 1 })
    expect(current).toMatchObject({
      sourceClass: 'manual_checkpoint',
      priorRevisionId: prior.sectionRevisionId
    })
    expect(JSON.stringify(current.content)).toContain('[@fixture2026, p. 2]')
    expect(await f.mirror(prior.sectionId)).toMatchObject({
      sectionRevisionId: current.sectionRevisionId,
      document: current.content
    })
    expect(f.manuscript.getRevision(prior.sectionRevisionId).content).toEqual(prior.content)
  })

  it('rejects expired, consumed, missing and outline-stale plans without writes', async () => {
    const f = await fixture()
    const prior = await f.seed()
    const expired = f.plan()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 11 * 60_000)
    expect(await f.apply(expired.planId)).toEqual({
      status: 'stale_plan',
      sectionsChanged: 0,
      pendingRepairSectionIds: []
    })
    clock.mockRestore()
    expect((await f.apply(expired.planId)).status).toBe('stale_plan')
    expect((await f.apply(crypto.randomUUID())).status).toBe('stale_plan')
    const stale = f.plan()
    f.manuscript.createSection({
      baseOutlineVersion: f.manuscript.getWorkspace().outlineVersion,
      parentSectionId: null,
      position: 1,
      title: 'Second',
      objective: null,
      status: 'drafting'
    })
    expect((await f.apply(stale.planId)).status).toBe('stale_plan')
    expect(f.editorPersistence.loadSection(prior.sectionId).revision.sectionRevisionId).toBe(
      prior.sectionRevisionId
    )
    expect(f.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reference.legacy_conversion.stale_plan',
        err: expect.any(Error)
      }),
      expect.any(String)
    )
  })

  it('records a rejected session and exposes only a safe error with its cause', async () => {
    const f = await fixture()
    await f.seed()
    const plan = f.plan()
    f.revoke()
    await expect(f.apply(plan.planId)).rejects.toMatchObject({
      message: 'Legacy citations could not be converted',
      cause: expect.any(Error)
    })
    expect(f.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reference.legacy_conversion.failed',
        err: expect.any(Error)
      }),
      expect.any(String)
    )
  })

  it('records handler failures without calling them stale plans', async () => {
    const f = await fixture()
    await f.seed()
    const plan = f.plan()
    const err = new Error('assembly unavailable', { cause: new Error('underlying failure') })
    vi.spyOn(f.manuscript, 'assemble').mockImplementation(() => {
      throw err
    })
    expect(await f.apply(plan.planId)).toEqual({
      status: 'failed',
      sectionsChanged: 0,
      pendingRepairSectionIds: []
    })
    expect(f.log.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'reference.legacy_conversion.failed', err }),
      expect.any(String)
    )
  })

  it('retains a committed conversion on publication failure and repairs it through repairAll', async () => {
    let failure: Error | undefined
    const f = await fixture({
      beforeMaterializationRename: () => {
        if (failure) throw failure
      }
    })
    const prior = await f.seed()
    failure = new Error('publication failed', { cause: new Error('disk unavailable') })
    expect(await f.apply(f.plan().planId)).toEqual({
      status: 'converted',
      sectionsChanged: 1,
      pendingRepairSectionIds: [prior.sectionId]
    })
    const current = f.editorPersistence.loadSection(prior.sectionId).revision
    expect((await f.mirror(prior.sectionId)).sectionRevisionId).toBe(prior.sectionRevisionId)
    expect(f.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reference.legacy_conversion.materialization_pending',
        err: failure,
        sectionId: prior.sectionId,
        sectionRevisionId: current.sectionRevisionId
      }),
      expect.any(String)
    )
    failure = undefined
    await f.editorPersistence.repairAll()
    expect((await f.mirror(prior.sectionId)).sectionRevisionId).toBe(current.sectionRevisionId)
  })

  it('commits all sections before the first asynchronous publication', async () => {
    const f = await fixture()
    const first = await f.seed()
    const secondSection = f.manuscript.createSection({
      baseOutlineVersion: f.manuscript.getWorkspace().outlineVersion,
      parentSectionId: null,
      position: 1,
      title: 'Second',
      objective: null,
      status: 'drafting'
    })
    const second = await f.seed(secondSection.sectionId)
    const materialize = f.editorPersistence.materialize.bind(f.editorPersistence)
    const observed: string[][] = []
    vi.spyOn(f.editorPersistence, 'materialize').mockImplementation(async (...args) => {
      observed.push(
        f.manuscript.assemble().sections.map((entry) => entry.revision.sourceClass ?? 'missing')
      )
      await materialize(...args)
    })
    expect((await f.apply(f.plan().planId)).sectionsChanged).toBe(2)
    expect(observed).toEqual([
      ['manual_checkpoint', 'manual_checkpoint'],
      ['manual_checkpoint', 'manual_checkpoint']
    ])
    for (const prior of [first, second])
      expect((await f.mirror(prior.sectionId)).document).toEqual(
        f.editorPersistence.loadSection(prior.sectionId).revision.content
      )
  })

  it.each([false, true])(
    'reports partial commits and publishes or records pending repair (failure=%s)',
    async (failPublication) => {
      let failure = false
      const err = new Error('mirror unavailable')
      const f = await fixture({
        beforeMaterializationRename: () => {
          if (failure) throw err
        }
      })
      const first = await f.seed()
      const secondSection = f.manuscript.createSection({
        baseOutlineVersion: f.manuscript.getWorkspace().outlineVersion,
        parentSectionId: null,
        position: 1,
        title: 'Second',
        objective: null,
        status: 'drafting'
      })
      const second = await f.seed(secondSection.sectionId)
      f.database.immediate((native) =>
        native.exec(`CREATE TRIGGER reject_conversion BEFORE INSERT ON section_revisions
      WHEN NEW.section_id = '${second.sectionId}' BEGIN SELECT RAISE(FAIL, 'fixture append rejected'); END`)
      )
      f.log.error.mockClear()
      failure = failPublication
      const result = await f.apply(f.plan().planId)
      expect(result).toEqual({
        status: 'failed',
        sectionsChanged: 1,
        pendingRepairSectionIds: failPublication ? [first.sectionId] : []
      })
      const current = f.editorPersistence.loadSection(first.sectionId).revision
      expect(current.sectionRevisionId).not.toBe(first.sectionRevisionId)
      expect(f.editorPersistence.loadSection(second.sectionId).revision.sectionRevisionId).toBe(
        second.sectionRevisionId
      )
      expect((await f.mirror(first.sectionId)).sectionRevisionId).toBe(
        failPublication ? first.sectionRevisionId : current.sectionRevisionId
      )
      expect(
        f.log.error.mock.calls.filter(
          ([entry]) => entry.event === 'manuscript.revision.append_failed'
        )
      ).toHaveLength(1)
      expect(
        f.log.error.mock.calls.filter(
          ([entry]) => entry.event === 'reference.legacy_conversion.failed'
        )
      ).toHaveLength(0)
    }
  )

  it('stops publication when the session ends before rename', async () => {
    let beforeRename = () => {}
    const f = await fixture({ beforeMaterializationRename: () => beforeRename() })
    const prior = await f.seed()
    beforeRename = f.revoke
    expect((await f.apply(f.plan().planId)).pendingRepairSectionIds).toEqual([prior.sectionId])
    expect((await f.mirror(prior.sectionId)).sectionRevisionId).toBe(prior.sectionRevisionId)
    expect(f.log.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'reference.legacy_conversion.materialization_pending',
        err: expect.any(Error)
      }),
      expect.any(String)
    )
  })

  it('does not publish an obsolete conversion over a newer revision', async () => {
    let beforeRename = () => {}
    const f = await fixture({ beforeMaterializationRename: () => beforeRename() })
    const prior = await f.seed()
    beforeRename = () => {
      beforeRename = () => {}
      const current = f.editorPersistence.loadSection(prior.sectionId).revision
      f.manuscript.appendRevision({
        sectionId: prior.sectionId,
        baseRevisionId: current.sectionRevisionId,
        baseContentHash: current.contentHash,
        content: prior.content,
        source: 'manual'
      })
    }
    await f.apply(f.plan().planId)
    expect((await f.mirror(prior.sectionId)).sectionRevisionId).toBe(prior.sectionRevisionId)
    const latest = f.editorPersistence.loadSection(prior.sectionId).revision
    await f.editorPersistence.materialize(latest)
    expect((await f.mirror(prior.sectionId)).sectionRevisionId).toBe(latest.sectionRevisionId)
  })

  it('skips unchanged sections and prunes old autosaves while retaining the conversion parent', async () => {
    const f = await fixture()
    const first = await f.seed()
    let prior = first
    for (let index = 0; index < 25; index++) {
      prior = f.manuscript.appendRevision({
        sectionId: prior.sectionId,
        baseRevisionId: prior.sectionRevisionId,
        baseContentHash: prior.contentHash,
        source: 'manual',
        content: prior.content.map((block) => ({ ...block, id: crypto.randomUUID() }))
      })
    }
    await f.apply(f.plan().planId)
    const retained = (id: string) =>
      f.database.immediate((native) =>
        native
          .prepare(
            'SELECT content_body_retained FROM section_revisions WHERE section_revision_id = ?'
          )
          .pluck()
          .get(id)
      )
    expect(retained(first.sectionRevisionId)).toBe(0)
    expect(retained(prior.sectionRevisionId)).toBe(1)
    const publish = vi.spyOn(f.editorPersistence, 'materialize')
    expect(await f.apply(f.plan().planId)).toEqual({
      status: 'converted',
      sectionsChanged: 0,
      pendingRepairSectionIds: []
    })
    expect(publish).not.toHaveBeenCalled()
  })
})
