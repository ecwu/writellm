import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { resolveProjectPath } from '../project/project-paths'
import { EditorPersistenceService, sectionMaterializationPath } from './editor-persistence-service'
import { ManuscriptService } from './manuscript-service'

const roots: string[] = []
const log = pino({ level: 'silent' })
const paragraph = (id: string, text: string) => ({
  id,
  type: 'paragraph' as const,
  props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
  content: [{ type: 'text' as const, text, styles: { bold: true } }],
  children: []
})

async function fixture(
  faults: ConstructorParameters<typeof EditorPersistenceService>[0]['faults'] = {},
  now?: () => Date
) {
  const root = await mkdtemp(join(tmpdir(), 'writellm-editor-'))
  roots.push(root)
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: crypto.randomUUID(),
    createdAt: '2026-07-15T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    log
  })
  const manuscript = new ManuscriptService({ database, projectId: manifest.projectId, log, now })
  const persistence = new EditorPersistenceService({
    projectRoot,
    projectId: manifest.projectId,
    database,
    manuscript,
    log,
    faults
  })
  return { projectRoot, database, manuscript, persistence, manifest }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('EditorPersistenceService', () => {
  it('commits canonical JSON, atomically materializes it, and treats a lost-response retry as success', async () => {
    const { projectRoot, database, persistence } = await fixture()
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const document = [paragraph('stable-id', '你好 café')]
    const first = await persistence.save({
      projectSessionId: 'session',
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document
    })
    expect(first.disposition).toBe('saved')
    const retry = await persistence.save({
      projectSessionId: 'session',
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document
    })
    expect(retry).toMatchObject({ disposition: 'unchanged', revision: first.revision })
    const bytes = await readFile(
      resolveProjectPath(projectRoot, sectionMaterializationPath(opened.section.sectionId)),
      'utf8'
    )
    expect(JSON.parse(bytes)).toEqual({
      format: 'writellm-blocknote-section',
      formatVersion: 1,
      contentSchemaVersion: 2,
      sectionId: opened.section.sectionId,
      sectionRevisionId: first.revision.sectionRevisionId,
      contentHash: first.revision.contentHash,
      document
    })
    expect(
      database.immediate((native) =>
        native.prepare('SELECT COUNT(*) FROM section_revisions').pluck().get()
      )
    ).toBe(2)
    database.close()
  })

  it('rejects a stale different save and preserves the current revision', async () => {
    const { database, persistence } = await fixture()
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const first = await persistence.save({
      projectSessionId: 'session',
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('first', 'first')]
    })
    await expect(
      persistence.save({
        projectSessionId: 'session',
        sectionId: opened.section.sectionId,
        baseRevisionId: opened.revision.sectionRevisionId,
        baseContentHash: opened.revision.contentHash,
        document: [paragraph('stale', 'stale')]
      })
    ).rejects.toMatchObject({ code: 'section_revision_conflict' })
    expect(persistence.openEditor().activeSection?.revision.sectionRevisionId).toBe(
      first.revision.sectionRevisionId
    )
    database.close()
  })

  it('serializes concurrent saves through revision CAS', async () => {
    const { database, persistence } = await fixture()
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const input = {
      projectSessionId: 'session',
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash
    }
    const results = await Promise.allSettled([
      persistence.save({ ...input, document: [paragraph('concurrent-a', 'A')] }),
      persistence.save({ ...input, document: [paragraph('concurrent-b', 'B')] })
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(
      database.immediate((native) =>
        native.prepare('SELECT COUNT(*) FROM section_revisions').pluck().get()
      )
    ).toBe(2)
    database.close()
  })

  it('does not let an older in-flight materialization overwrite the current revision', async () => {
    let releaseFirstRename: (() => void) | undefined
    const firstRenameStarted = new Promise<void>((resolve) => {
      releaseFirstRename = resolve
    })
    let renameAttempt = 0
    let signalFirstRenameStarted: (() => void) | undefined
    const firstRenameReached = new Promise<void>((resolve) => {
      signalFirstRenameStarted = resolve
    })
    const { projectRoot, database, manuscript, persistence } = await fixture({
      beforeMaterializationRename: async () => {
        renameAttempt += 1
        if (renameAttempt === 1) {
          signalFirstRenameStarted?.()
          await firstRenameStarted
        }
      }
    })
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const older = manuscript.appendRevision({
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      content: [paragraph('older', 'older')],
      source: 'manual'
    })
    const olderPublication = persistence.materialize(older)
    await firstRenameReached
    const newer = manuscript.appendRevision({
      sectionId: opened.section.sectionId,
      baseRevisionId: older.sectionRevisionId,
      baseContentHash: older.contentHash,
      content: [paragraph('newer', 'newer')],
      source: 'manual'
    })
    const newerPublication = persistence.materialize(newer)
    releaseFirstRename?.()
    await Promise.all([olderPublication, newerPublication])

    const envelope = JSON.parse(
      await readFile(
        resolveProjectPath(projectRoot, sectionMaterializationPath(opened.section.sectionId)),
        'utf8'
      )
    )
    expect(envelope.sectionRevisionId).toBe(newer.sectionRevisionId)
    expect(envelope.document[0].id).toBe('newer')
    database.close()
  })

  it('reports a pending mirror after rename failure and repairs missing, corrupt, and stale metadata from DB', async () => {
    const beforeRename = vi.fn(async () => {
      throw new Error('injected rename failure')
    })
    const { projectRoot, database, manuscript, persistence, manifest } = await fixture({
      beforeMaterializationRename: beforeRename
    })
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const result = await persistence.save({
      projectSessionId: 'session',
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('durable', 'DB is authoritative')]
    })
    expect(result.disposition).toBe('saved_materialization_pending')
    expect(manuscript.getRevision(result.revision.sectionRevisionId).content[0]?.id).toBe('durable')

    const repaired = new EditorPersistenceService({
      projectRoot,
      projectId: manifest.projectId,
      database,
      manuscript,
      log
    })
    await repaired.repairAll()
    const path = resolveProjectPath(
      projectRoot,
      sectionMaterializationPath(opened.section.sectionId)
    )
    await writeFile(path, '{corrupt')
    await repaired.repairAll()
    expect(JSON.parse(await readFile(path, 'utf8')).sectionRevisionId).toBe(
      result.revision.sectionRevisionId
    )
    database.immediate((native) =>
      native.prepare("UPDATE section_materializations SET content_hash = printf('%064d', 0)").run()
    )
    await repaired.repairAll()
    expect(
      database.immediate((native) =>
        native.prepare('SELECT content_hash FROM section_materializations').pluck().get()
      )
    ).toBe(result.revision.contentHash)
    database.close()
  })

  it('reports a pending mirror when failure occurs immediately after the authoritative commit', async () => {
    const { database, persistence } = await fixture({
      afterDatabaseCommit: async () => {
        throw new Error('injected post-commit failure')
      }
    })
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const result = await persistence.save({
      projectSessionId: 'session',
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('post-commit', 'still durable')]
    })
    expect(result.disposition).toBe('saved_materialization_pending')
    expect(persistence.openEditor().activeSection?.revision.content[0]?.id).toBe('post-commit')
    database.close()
  })

  it('repairs a file published before its materialization metadata commit', async () => {
    const afterRename = vi.fn(async () => {
      throw new Error('injected post-rename failure')
    })
    const { projectRoot, database, manuscript, persistence, manifest } = await fixture({
      afterMaterializationRename: afterRename
    })
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const result = await persistence.save({
      projectSessionId: 'session',
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('published', 'published before metadata')]
    })
    expect(result.disposition).toBe('saved_materialization_pending')
    expect(
      database.immediate((native) =>
        native.prepare('SELECT COUNT(*) FROM section_materializations').pluck().get()
      )
    ).toBe(0)
    const repaired = new EditorPersistenceService({
      projectRoot,
      projectId: manifest.projectId,
      database,
      manuscript,
      log
    })
    await repaired.repairAll()
    expect(
      database.immediate((native) =>
        native.prepare('SELECT section_revision_id FROM section_materializations').pluck().get()
      )
    ).toBe(result.revision.sectionRevisionId)
    database.close()
  })

  it('bounds retained revision bodies while preserving current content and lineage metadata', async () => {
    const { database, persistence } = await fixture()
    let opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    for (let revision = 0; revision < 97; revision += 1) {
      const result = await persistence.save({
        projectSessionId: 'session',
        sectionId: opened.section.sectionId,
        baseRevisionId: opened.revision.sectionRevisionId,
        baseContentHash: opened.revision.contentHash,
        document: [paragraph(`retained-${revision}`, `revision ${revision}`)]
      })
      opened = {
        section: { ...opened.section, currentRevisionId: result.revision.sectionRevisionId },
        revision: result.revision
      }
    }
    const rows = database.immediate(
      (native) =>
        native
          .prepare(
            'SELECT section_revision_id, prior_revision_id, content_body_retained FROM section_revisions ORDER BY revision_number'
          )
          .all() as Array<{
          section_revision_id: string
          prior_revision_id: string | null
          content_body_retained: number
        }>
    )
    expect(rows.filter((row) => row.content_body_retained === 1).length).toBeLessThanOrEqual(128)
    expect(rows[1]?.content_body_retained).toBe(0)
    expect(rows.at(-1)).toMatchObject({
      section_revision_id: opened.revision.sectionRevisionId,
      content_body_retained: 1
    })
    expect(
      rows.every(
        (row, index) =>
          index === 0 || row.prior_revision_id === rows[index - 1]?.section_revision_id
      )
    ).toBe(true)
    database.close()
  })

  it('preserves a manual autosave that is the direct parent of an accepted agent revision', async () => {
    const { database, persistence } = await fixture()
    let opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const protectedSave = await persistence.save({
      projectSessionId: 'session',
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('protected', 'protected autosave')]
    })
    opened = {
      section: { ...opened.section, currentRevisionId: protectedSave.revision.sectionRevisionId },
      revision: protectedSave.revision
    }

    database.immediate((native) => {
      native
        .prepare(
          `INSERT INTO section_revisions (
             section_revision_id, section_id, revision_number, source, source_class,
             content_json, content_schema_version, content_hash, prior_revision_id,
             word_count, character_count, count_algorithm_version,
             agent_run_id, agent_tool_call_id, agent_proposal_id, created_at
           ) VALUES (?, ?, ?, 'agent', 'agent_accepted', '[]', 1, ?, ?, 0, 0, 1, ?, ?, ?, ?)`
        )
        .run(
          'agent-accepted-protected',
          opened?.section.sectionId,
          10_000,
          '0'.repeat(64),
          protectedSave.revision.sectionRevisionId,
          'agent-run-protected',
          'agent-tool-protected',
          'agent-proposal-protected',
          '2026-07-15T00:00:00.000Z'
        )
    })

    for (let revision = 0; revision < 130; revision += 1) {
      const result = await persistence.save({
        projectSessionId: 'session',
        sectionId: opened.section.sectionId,
        baseRevisionId: opened.revision.sectionRevisionId,
        baseContentHash: opened.revision.contentHash,
        document: [paragraph(`after-${revision}`, `revision ${revision}`)]
      })
      opened = {
        section: { ...opened.section, currentRevisionId: result.revision.sectionRevisionId },
        revision: result.revision
      }
    }

    expect(
      database.immediate((native) =>
        native
          .prepare(
            'SELECT content_body_retained FROM section_revisions WHERE section_revision_id = ?'
          )
          .pluck()
          .get(protectedSave.revision.sectionRevisionId)
      )
    ).toBe(1)
    database.close()
  })

  it('rejects renderer-supplied source classes that do not match the save channel', async () => {
    const { projectRoot, database, manuscript, persistence, manifest } = await fixture()
    const capturingLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const guarded = new EditorPersistenceService({
      projectRoot,
      projectId: manifest.projectId,
      database,
      manuscript,
      log: capturingLog
    })
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const baseInput = {
      projectSessionId: 'session',
      sectionId: opened.section.sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash
    }
    const revisionCount = () =>
      database.immediate((native) =>
        native.prepare('SELECT COUNT(*) FROM section_revisions').pluck().get()
      )
    const before = revisionCount()

    // The manual channel must never mint `agent_accepted` or `import` revisions.
    for (const revisionSource of ['agent_accepted', 'import'] as const) {
      await expect(
        guarded.save({
          ...baseInput,
          document: [paragraph('forged', 'forged')],
          revisionSource
        })
      ).rejects.toThrow(TypeError)
    }
    // The import channel accepts only the `import` class.
    for (const revisionSource of ['agent_accepted', 'manual_autosave'] as const) {
      await expect(
        guarded.save(
          { ...baseInput, document: [paragraph('forged', 'forged')], revisionSource },
          'import'
        )
      ).rejects.toThrow(TypeError)
    }

    expect(revisionCount()).toBe(before)
    expect(capturingLog.warn).toHaveBeenCalledTimes(4)
    for (const call of capturingLog.warn.mock.calls) {
      expect((call[0] as { event?: string }).event).toBe(
        'editor.persistence.revision_source_rejected'
      )
    }

    // Legitimate per-channel classes still save.
    const manual = await guarded.save({
      ...baseInput,
      document: [paragraph('legit-manual', 'legitimate checkpoint')],
      revisionSource: 'manual_checkpoint'
    })
    expect(manual.revision.sourceClass).toBe('manual_checkpoint')
    const imported = await guarded.save(
      {
        ...baseInput,
        baseRevisionId: manual.revision.sectionRevisionId,
        baseContentHash: manual.revision.contentHash,
        document: [paragraph('legit-import', 'legitimate import')],
        revisionSource: 'import'
      },
      'import'
    )
    expect(imported.revision.sourceClass).toBe('import')
    database.close()
  })

  it('compacts sub-24-hour manual checkpoints to the newest per hour bucket', async () => {
    let now = new Date()
    const { database, persistence } = await fixture({}, () => now)
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const sectionId = opened.section.sectionId
    const hourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000
    const saveCheckpointAt = async (
      offsetMs: number,
      id: string,
      base: { sectionRevisionId: string; contentHash: string }
    ) => {
      now = new Date(offsetMs)
      return persistence.save({
        projectSessionId: 'session',
        sectionId,
        baseRevisionId: base.sectionRevisionId,
        baseContentHash: base.contentHash,
        document: [paragraph(id, id)],
        revisionSource: 'manual_checkpoint'
      })
    }

    // Two checkpoints inside one sub-24-hour bucket compact to the newest.
    const olderSameHour = await saveCheckpointAt(
      hourStart - 2 * 3_600_000 + 5 * 60_000,
      'hour-a-older',
      opened.revision
    )
    const newerSameHour = await saveCheckpointAt(
      hourStart - 2 * 3_600_000 + 10 * 60_000,
      'hour-a-newer',
      olderSameHour.revision
    )
    // One minute earlier but in the previous hour bucket: survives the compaction.
    const boundaryEarlier = await saveCheckpointAt(
      hourStart - 2 * 3_600_000 - 60_000,
      'hour-boundary',
      newerSameHour.revision
    )

    expect(retainedBodyFlag(database, olderSameHour.revision.sectionRevisionId)).toBe(0)
    expect(retainedBodyFlag(database, newerSameHour.revision.sectionRevisionId)).toBe(1)
    expect(retainedBodyFlag(database, boundaryEarlier.revision.sectionRevisionId)).toBe(1)
    database.close()
  })

  it('preserves a sub-24-hour checkpoint that is the direct parent of an accepted agent revision', async () => {
    let now = new Date()
    const { database, persistence } = await fixture({}, () => now)
    const opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const sectionId = opened.section.sectionId
    const hourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000

    now = new Date(hourStart - 2 * 3_600_000 + 5 * 60_000)
    const protectedCheckpoint = await persistence.save({
      projectSessionId: 'session',
      sectionId,
      baseRevisionId: opened.revision.sectionRevisionId,
      baseContentHash: opened.revision.contentHash,
      document: [paragraph('protected-checkpoint', 'protected checkpoint')],
      revisionSource: 'manual_checkpoint'
    })

    // Simulate the future Main-side agent application path minting an accepted
    // revision whose direct parent is the protected checkpoint.
    database.immediate((native) => {
      native
        .prepare(
          `INSERT INTO section_revisions (
             section_revision_id, section_id, revision_number, source, source_class,
             content_json, content_schema_version, content_hash, prior_revision_id,
             word_count, character_count, count_algorithm_version,
             agent_run_id, agent_tool_call_id, agent_proposal_id, created_at
           ) VALUES (?, ?, ?, 'agent', 'agent_accepted', '[]', 1, ?, ?, 0, 0, 1, ?, ?, ?, ?)`
        )
        .run(
          'agent-accepted-sub24',
          sectionId,
          10_001,
          '1'.repeat(64),
          protectedCheckpoint.revision.sectionRevisionId,
          'agent-run-sub24',
          'agent-tool-sub24',
          'agent-proposal-sub24',
          new Date(hourStart - 2 * 3_600_000 + 6 * 60_000).toISOString()
        )
    })

    now = new Date(hourStart - 2 * 3_600_000 + 10 * 60_000)
    const newerSameHour = await persistence.save({
      projectSessionId: 'session',
      sectionId,
      baseRevisionId: protectedCheckpoint.revision.sectionRevisionId,
      baseContentHash: protectedCheckpoint.revision.contentHash,
      document: [paragraph('newer-checkpoint', 'newer checkpoint')],
      revisionSource: 'manual_checkpoint'
    })

    expect(retainedBodyFlag(database, protectedCheckpoint.revision.sectionRevisionId)).toBe(1)
    expect(retainedBodyFlag(database, 'agent-accepted-sub24')).toBe(1)
    expect(retainedBodyFlag(database, newerSameHour.revision.sectionRevisionId)).toBe(1)
    database.close()
  })

  it('bounds retained import revision bodies to the latest five per section', async () => {
    const { database, persistence } = await fixture()
    let opened = persistence.openEditor().activeSection
    if (opened === null) throw new Error('Missing section')
    const ids: string[] = []
    for (let index = 0; index < 7; index += 1) {
      const result = await persistence.save(
        {
          projectSessionId: 'session',
          sectionId: opened.section.sectionId,
          baseRevisionId: opened.revision.sectionRevisionId,
          baseContentHash: opened.revision.contentHash,
          document: [paragraph(`import-${index}`, `import ${index}`)],
          revisionSource: 'import'
        },
        'import'
      )
      ids.push(result.revision.sectionRevisionId)
      opened = {
        section: { ...opened.section, currentRevisionId: result.revision.sectionRevisionId },
        revision: result.revision
      }
    }

    // Only the latest five import bodies (including the current revision) survive.
    for (const id of ids.slice(0, 2)) expect(retainedBodyFlag(database, id)).toBe(0)
    for (const id of ids.slice(2)) expect(retainedBodyFlag(database, id)).toBe(1)
    database.close()
  })
})

function retainedBodyFlag(database: ProjectDatabase, revisionId: string): unknown {
  return database.immediate((native) =>
    native
      .prepare('SELECT content_body_retained FROM section_revisions WHERE section_revision_id = ?')
      .pluck()
      .get(revisionId)
  )
}
