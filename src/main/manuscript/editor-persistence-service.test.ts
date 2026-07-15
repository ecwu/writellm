import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeProjectDatabase } from '../project/project-database'
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
  faults: ConstructorParameters<typeof EditorPersistenceService>[0]['faults'] = {}
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
  const manuscript = new ManuscriptService({ database, projectId: manifest.projectId, log })
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
      contentSchemaVersion: 1,
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
})
