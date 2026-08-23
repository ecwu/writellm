import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ManuscriptDomainError } from '../../shared/contracts/manuscript'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { ManuscriptService, type SectionDeletionGuard } from './manuscript-service'

const directories: string[] = []
const silentLog = pino({ level: 'silent' })
const paragraph = (text: string) => ({
  id: `block-${text}`,
  type: 'paragraph' as const,
  props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
  content: [{ type: 'text' as const, text, styles: {} }],
  children: []
})

async function fixture(
  options: {
    log?: typeof silentLog
    deletionGuard?: SectionDeletionGuard
    createId?: () => string
  } = {}
): Promise<{ database: ProjectDatabase; service: ManuscriptService; manifest: ProjectManifest }> {
  const root = await mkdtemp(join(tmpdir(), 'writellm-manuscript-'))
  directories.push(root)
  await mkdir(join(root, 'project'))
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: crypto.randomUUID(),
    createdAt: '2026-07-15T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot: join(root, 'project'),
    manifest,
    applicationVersion: 'test',
    initialTitle: 'Initial title',
    log: options.log ?? silentLog
  })
  const service = new ManuscriptService({
    database,
    projectId: manifest.projectId,
    log: options.log ?? silentLog,
    deletionGuard: options.deletionGuard,
    createId: options.createId,
    now: () => new Date('2026-07-15T01:00:00.000Z')
  })
  return { database, service, manifest }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('ManuscriptService', () => {
  it('keeps figure identity through metadata edits and replacement undo', async () => {
    const { database, service } = await fixture()
    const root = service.assemble().sections[0]
    if (root === undefined) throw new Error('Missing root fixture')
    const assetId = '019d0000-0000-4000-8000-000000000501'
    const now = '2026-07-15T01:00:00.000Z'
    database.immediate((native) => {
      native
        .prepare(
          `INSERT INTO manuscript_assets (
             asset_id, sha256, byte_size, mime_type, extension, relative_path, source_type,
             original_name, generation_request_json, model_request_id, agent_run_id,
             agent_tool_call_id, created_at, last_referenced_at
           ) VALUES (?, ?, 1, 'image/png', '.png', ?, 'upload', 'figure.png', NULL, NULL, NULL,
                     NULL, ?, ?)`
        )
        .run(assetId, 'b'.repeat(64), `manuscript/assets/${'b'.repeat(64)}.png`, now, now)
    })
    const seeded = service.appendRevision({
      sectionId: root.section.sectionId,
      baseRevisionId: root.revision.sectionRevisionId,
      baseContentHash: root.revision.contentHash,
      content: [
        {
          id: 'figure-block',
          type: 'image',
          props: {
            backgroundColor: 'default',
            textAlignment: 'center',
            name: 'Legacy description',
            url: `writellm-asset:${assetId}`,
            caption: 'Alpha caption',
            showPreview: true,
            previewWidth: 720
          },
          children: []
        }
      ]
    })
    const figureId = seeded.content[0]?.props.figureId
    expect(seeded).toMatchObject({ contentSchemaVersion: 5 })
    expect(figureId).toBe(`figure:${root.section.sectionId}:figure-block`)
    expect(seeded.content[0]?.props.altText).toBe('Legacy description')

    const applied = service.applyReplacementBatch({
      outlineVersion: service.assemble().outlineVersion,
      replacement: 'Beta',
      sections: [
        {
          sectionId: root.section.sectionId,
          baseRevisionId: seeded.sectionRevisionId,
          baseContentHash: seeded.contentHash,
          operations: [
            {
              target: {
                kind: 'block_caption',
                sectionId: root.section.sectionId,
                revisionId: seeded.sectionRevisionId,
                blockId: 'figure-block',
                property: 'caption',
                range: { from: 0, to: 5 }
              },
              sourceSliceHash: createHash('sha256').update('Alpha').digest('hex')
            }
          ]
        }
      ]
    })
    expect(applied.revisions[0]?.content[0]?.props.figureId).toBe(figureId)
    const undone = service.undoReplacementRevision({
      sectionId: root.section.sectionId,
      appliedRevisionId: applied.revisions[0]?.sectionRevisionId ?? ''
    })
    expect(undone.content[0]?.props).toMatchObject({
      figureId,
      altText: 'Legacy description',
      caption: 'Alpha caption'
    })
    database.close()
  })

  it('applies an atomic replacement batch and appends a guarded undo revision', async () => {
    const { database, service } = await fixture()
    const root = service.assemble().sections[0]
    if (root === undefined) throw new Error('Missing root fixture')
    const seeded = service.appendRevision({
      sectionId: root.section.sectionId,
      baseRevisionId: root.revision.sectionRevisionId,
      baseContentHash: root.revision.contentHash,
      content: [paragraph('alpha alpha')]
    })
    const outlineVersion = service.assemble().outlineVersion
    const applied = service.applyReplacementBatch({
      outlineVersion,
      replacement: 'beta',
      sections: [
        {
          sectionId: root.section.sectionId,
          baseRevisionId: seeded.sectionRevisionId,
          baseContentHash: seeded.contentHash,
          operations: [
            {
              target: {
                kind: 'block_inline',
                sectionId: root.section.sectionId,
                revisionId: seeded.sectionRevisionId,
                blockId: 'block-alpha alpha',
                segments: [{ inlineIndex: 0, range: { from: 6, to: 11 } }],
                flatRange: { from: 6, to: 11 }
              },
              sourceSliceHash: createHash('sha256').update('alpha').digest('hex')
            }
          ]
        }
      ]
    })
    expect(applied.revisions).toHaveLength(1)
    expect(applied.revisions[0]).toMatchObject({
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      priorRevisionId: seeded.sectionRevisionId
    })
    expect(JSON.stringify(applied.revisions[0]?.content)).toContain('alpha beta')

    const undone = service.undoReplacementRevision({
      sectionId: root.section.sectionId,
      appliedRevisionId: applied.revisions[0]?.sectionRevisionId ?? ''
    })
    expect(undone).toMatchObject({
      source: 'undo',
      sourceClass: 'manual_checkpoint',
      priorRevisionId: applied.revisions[0]?.sectionRevisionId
    })
    expect(JSON.stringify(undone.content)).toContain('alpha alpha')
    expect(() =>
      service.undoReplacementRevision({
        sectionId: root.section.sectionId,
        appliedRevisionId: applied.revisions[0]?.sectionRevisionId ?? ''
      })
    ).toThrowError(expect.objectContaining({ code: 'section_revision_conflict' }))
    database.close()
  })

  it('rolls back every replacement revision when any section precondition conflicts', async () => {
    const { database, service } = await fixture()
    const first = service.assemble().sections[0]
    if (first === undefined) throw new Error('Missing root fixture')
    const secondSection = service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Second',
      position: 1
    })
    const firstSeed = service.appendRevision({
      sectionId: first.section.sectionId,
      baseRevisionId: first.revision.sectionRevisionId,
      baseContentHash: first.revision.contentHash,
      content: [paragraph('alpha')]
    })
    const second = service
      .getWorkspace()
      .sections.find((entry) => entry.section.sectionId === secondSection.sectionId)
    if (second === undefined) throw new Error('Missing second fixture')
    const secondSeed = service.appendRevision({
      sectionId: secondSection.sectionId,
      baseRevisionId: second.revision.sectionRevisionId,
      baseContentHash: second.revision.contentHash,
      content: [paragraph('alpha')]
    })
    const revisionsBefore = database.immediate((native) =>
      native.prepare('SELECT COUNT(*) FROM section_revisions').pluck().get()
    )
    expect(() =>
      service.applyReplacementBatch({
        outlineVersion: service.assemble().outlineVersion,
        replacement: 'beta',
        sections: [
          replacementSection(first.section.sectionId, firstSeed),
          {
            ...replacementSection(secondSection.sectionId, secondSeed),
            baseContentHash: '0'.repeat(64)
          }
        ]
      })
    ).toThrowError(expect.objectContaining({ code: 'section_revision_conflict' }))
    expect(
      database.immediate((native) =>
        native.prepare('SELECT COUNT(*) FROM section_revisions').pluck().get()
      )
    ).toBe(revisionsBefore)
    database.close()
  })
  it('requires exactly one primary manuscript', async () => {
    const missing = await fixture()
    missing.database.immediate((database) =>
      database.prepare('UPDATE manuscripts SET is_primary = 0').run()
    )
    expect(
      () =>
        new ManuscriptService({
          database: missing.database,
          projectId: missing.manifest.projectId,
          log: silentLog
        })
    ).toThrowError(expect.objectContaining({ code: 'primary_manuscript_missing' }))
    missing.database.close()

    const ambiguous = await fixture()
    ambiguous.database.immediate((database) => {
      database.prepare('DROP INDEX manuscripts_one_primary_per_project').run()
      database
        .prepare(
          "INSERT INTO manuscripts (manuscript_id, project_id, is_primary, outline_version, created_at, updated_at) VALUES ('second', ?, 1, 1, ?, ?)"
        )
        .run(
          ambiguous.manifest.projectId,
          ambiguous.manifest.createdAt,
          ambiguous.manifest.createdAt
        )
    })
    expect(
      () =>
        new ManuscriptService({
          database: ambiguous.database,
          projectId: ambiguous.manifest.projectId,
          log: silentLog
        })
    ).toThrowError(expect.objectContaining({ code: 'primary_manuscript_ambiguous' }))
    ambiguous.database.close()
  })

  it('appends immutable brief versions and rejects a stale base version', async () => {
    const { database, service } = await fixture()
    const initial = service.getBrief()
    expect(initial).toMatchObject({ version: 1, title: 'Initial title', schemaVersion: 1 })
    const fields = {
      baseVersion: 1,
      title: 'Version two',
      description: 'description',
      topic: 'topic',
      targetAudience: 'audience',
      language: 'en',
      styleTone: 'direct',
      scopeExclusions: 'none',
      targetLength: '1000',
      citationRequirements: 'APA',
      additionalInstructions: 'extra',
      extensible: { key: 'value' }
    }
    expect(service.updateBrief(fields)).toMatchObject({ version: 2, title: 'Version two' })
    expect(() => service.updateBrief(fields)).toThrowError(
      expect.objectContaining({ code: 'brief_version_conflict' })
    )
    expect(
      database.immediate((native) =>
        native.prepare('SELECT title FROM manuscript_briefs ORDER BY version').pluck().all()
      )
    ).toEqual(['Initial title', 'Version two'])
    database.close()
  })

  it('creates a nested outline, moves a subtree, and keeps contiguous sibling positions', async () => {
    const { database, service } = await fixture()
    const root = service.listSections()[0]
    if (root === undefined) throw new Error('Missing root fixture')
    const second = service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Second',
      position: 1
    })
    const child = service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Child',
      parentSectionId: root.sectionId,
      position: 0
    })
    const grandchild = service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Grandchild',
      parentSectionId: child.sectionId,
      position: 0
    })
    service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Inserted',
      position: 1
    })

    expect(
      service.listSections().map(({ title, level, position }) => [title, level, position])
    ).toEqual([
      ['Untitled Section', 1, 0],
      ['Child', 2, 0],
      ['Grandchild', 3, 0],
      ['Inserted', 1, 1],
      ['Second', 1, 2]
    ])
    service.moveSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      sectionId: child.sectionId,
      parentSectionId: second.sectionId,
      position: 0
    })
    expect(
      service.listSections().map(({ title, level, position }) => [title, level, position])
    ).toEqual([
      ['Untitled Section', 1, 0],
      ['Inserted', 1, 1],
      ['Second', 1, 2],
      ['Child', 2, 0],
      ['Grandchild', 3, 0]
    ])
    expect(() =>
      service.moveSection({
        baseOutlineVersion: service.assemble().outlineVersion,
        sectionId: second.sectionId,
        parentSectionId: grandchild.sectionId,
        position: 0
      })
    ).toThrowError(expect.objectContaining({ code: 'section_cycle' }))
    expect(database.immediate((native) => native.pragma('foreign_key_check'))).toEqual([])
    database.close()
  })

  it('enforces the outline depth cap on create and subtree moves', async () => {
    const { database, service } = await fixture()
    const roots = service.listSections()
    const root = roots[0]
    if (root === undefined) throw new Error('Missing root fixture')
    let parentId = root.sectionId
    for (let level = 2; level <= 64; level += 1) {
      const child = service.createSection({
        baseOutlineVersion: service.assemble().outlineVersion,
        title: `Depth ${level}`,
        parentSectionId: parentId,
        position: 0
      })
      parentId = child.sectionId
    }
    expect(() =>
      service.createSection({
        baseOutlineVersion: service.assemble().outlineVersion,
        title: 'Too deep',
        parentSectionId: parentId,
        position: 0
      })
    ).toThrowError(expect.objectContaining({ code: 'outline_depth_exceeded' }))

    const movableRoot = service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Movable root',
      position: 1
    })
    service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Movable child',
      parentSectionId: movableRoot.sectionId,
      position: 0
    })
    expect(() =>
      service.moveSection({
        baseOutlineVersion: service.assemble().outlineVersion,
        sectionId: movableRoot.sectionId,
        parentSectionId: parentId,
        position: 0
      })
    ).toThrowError(expect.objectContaining({ code: 'outline_depth_exceeded' }))
    database.close()
  })

  it('increments outline version only for metadata and structure changes', async () => {
    const { database, service } = await fixture()
    const initial = service.assemble()
    const root = initial.sections[0]
    if (root === undefined) throw new Error('Missing root fixture')
    service.updateBrief({
      baseVersion: 1,
      title: 'Brief only',
      description: '',
      topic: '',
      targetAudience: '',
      language: '',
      styleTone: '',
      scopeExclusions: '',
      targetLength: '',
      citationRequirements: '',
      additionalInstructions: '',
      extensible: {}
    })
    service.appendRevision({
      sectionId: root.section.sectionId,
      baseRevisionId: root.revision.sectionRevisionId,
      baseContentHash: root.revision.contentHash,
      content: [paragraph('Body')]
    })
    expect(service.assemble().outlineVersion).toBe(initial.outlineVersion)
    service.updateSection({
      baseOutlineVersion: initial.outlineVersion,
      sectionId: root.section.sectionId,
      status: 'completed'
    })
    expect(service.assemble().outlineVersion).toBe(initial.outlineVersion + 1)
    expect(() =>
      service.createSection({
        baseOutlineVersion: initial.outlineVersion,
        title: 'Stale writer',
        position: 1
      })
    ).toThrowError(expect.objectContaining({ code: 'outline_version_conflict' }))
    database.close()
  })

  it('uses revision ID and hash CAS, preserves history, and treats identical content as a no-op', async () => {
    let id = 0
    const { database, service } = await fixture({ createId: () => `generated-${++id}` })
    const initial = service.assemble().sections[0]
    if (initial === undefined) throw new Error('Missing root fixture')
    const content = [paragraph('Hello 世界')]
    const first = service.appendRevision({
      sectionId: initial.section.sectionId,
      baseRevisionId: initial.revision.sectionRevisionId,
      baseContentHash: initial.revision.contentHash,
      content
    })
    expect(first).toMatchObject({
      revisionNumber: 2,
      priorRevisionId: initial.revision.sectionRevisionId
    })
    expect(
      service.appendRevision({
        sectionId: initial.section.sectionId,
        baseRevisionId: first.sectionRevisionId,
        baseContentHash: first.contentHash,
        content: [paragraph('Hello 世界')]
      }).sectionRevisionId
    ).toBe(first.sectionRevisionId)
    expect(() =>
      service.appendRevision({
        sectionId: initial.section.sectionId,
        baseRevisionId: initial.revision.sectionRevisionId,
        baseContentHash: initial.revision.contentHash,
        content: [paragraph('Competing writer')]
      })
    ).toThrowError(expect.objectContaining({ code: 'section_revision_conflict' }))
    expect(
      database.immediate((native) =>
        native
          .prepare('SELECT revision_number FROM section_revisions ORDER BY revision_number')
          .pluck()
          .all()
      )
    ).toEqual([1, 2])
    database.close()
  })

  it('reserves non-manual sources and lineage for later checkpoints', async () => {
    const { database, service } = await fixture()
    const initial = service.assemble().sections[0]
    if (initial === undefined) throw new Error('Missing root fixture')
    expect(() =>
      service.appendRevision({
        sectionId: initial.section.sectionId,
        baseRevisionId: initial.revision.sectionRevisionId,
        baseContentHash: initial.revision.contentHash,
        content: [],
        source: 'agent',
        agentRunId: 'run',
        agentToolCallId: null,
        agentProposalId: 'proposal'
      })
    ).toThrow('only permits manual and import')
    database.close()
  })

  it('enforces leaf, last-section, and deletion guard constraints', async () => {
    const guard = { assertCanDelete: vi.fn() }
    const { database, service } = await fixture({ deletionGuard: guard })
    const root = service.listSections()[0]
    if (root === undefined) throw new Error('Missing root fixture')
    expect(() =>
      service.deleteSection({
        baseOutlineVersion: service.assemble().outlineVersion,
        sectionId: root.sectionId
      })
    ).toThrowError(expect.objectContaining({ code: 'section_is_last' }))
    const child = service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Child',
      parentSectionId: root.sectionId,
      position: 0
    })
    expect(() =>
      service.deleteSection({
        baseOutlineVersion: service.assemble().outlineVersion,
        sectionId: root.sectionId
      })
    ).toThrowError(expect.objectContaining({ code: 'section_has_children' }))
    guard.assertCanDelete.mockImplementationOnce(() => {
      throw new Error('pending proposal')
    })
    expect(() =>
      service.deleteSection({
        baseOutlineVersion: service.assemble().outlineVersion,
        sectionId: child.sectionId
      })
    ).toThrowError(expect.objectContaining({ code: 'section_deletion_blocked' }))
    service.deleteSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      sectionId: child.sectionId
    })
    expect(service.listSections()).toHaveLength(1)
    expect(() => service.getSection(child.sectionId)).toThrowError(
      expect.objectContaining({ code: 'section_not_found' })
    )
    expect(
      database.immediate((native) =>
        native
          .prepare('SELECT deleted_at FROM sections WHERE section_id = ?')
          .pluck()
          .get(child.sectionId)
      )
    ).toBe('2026-07-15T01:00:00.000Z')
    expect(
      database.immediate((native) =>
        native
          .prepare('SELECT COUNT(*) FROM section_revisions WHERE section_id = ?')
          .pluck()
          .get(child.sectionId)
      )
    ).toBe(1)
    const replacement = service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Replacement child',
      parentSectionId: root.sectionId,
      position: 0
    })
    expect(replacement.position).toBe(0)
    database.close()
  })

  it('assembles outline order and aggregates persisted revision counts', async () => {
    const { database, service } = await fixture()
    const root = service.assemble().sections[0]
    if (root === undefined) throw new Error('Missing root fixture')
    service.appendRevision({
      sectionId: root.section.sectionId,
      baseRevisionId: root.revision.sectionRevisionId,
      baseContentHash: root.revision.contentHash,
      content: [paragraph('First body')]
    })
    service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Second title',
      position: 1
    })
    const assembly = service.assemble()
    expect(assembly.sections.map(({ section }) => section.title)).toEqual([
      'Untitled Section',
      'Second title'
    ])
    expect(assembly.sections[0]?.revision.content).toEqual([paragraph('First body')])
    expect(assembly.wordCount).toBe(2)
    expect(assembly.characterCount).toBe(9)
    database.close()
  })

  it('builds the reference index from current revisions in outline order', async () => {
    const { database, service } = await fixture()
    const root = service.assemble().sections[0]
    if (root === undefined) throw new Error('Missing root fixture')
    const obsolete = service.appendRevision({
      sectionId: root.section.sectionId,
      baseRevisionId: root.revision.sectionRevisionId,
      baseContentHash: root.revision.contentHash,
      content: [{ ...paragraph('[Source: Obsolete source]'), id: 'obsolete-citation' }]
    })
    service.appendRevision({
      sectionId: root.section.sectionId,
      baseRevisionId: obsolete.sectionRevisionId,
      baseContentHash: obsolete.contentHash,
      content: [{ ...paragraph('[Source: Café, p. 1]'), id: 'root-citation' }]
    })
    const second = service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Second',
      position: 1
    })
    const secondCurrent = service
      .assemble()
      .sections.find(({ section }) => section.sectionId === second.sectionId)
    if (secondCurrent === undefined) throw new Error('Missing second section fixture')
    service.appendRevision({
      sectionId: second.sectionId,
      baseRevisionId: secondCurrent.revision.sectionRevisionId,
      baseContentHash: secondCurrent.revision.contentHash,
      content: [
        {
          ...paragraph('【来源：Café，第 9 页】 and [Source: café]'),
          id: 'second-citations'
        }
      ]
    })

    const index = service.getReferenceIndex()

    expect(index.outlineVersion).toBe(service.assemble().outlineVersion)
    expect(index.entries).toEqual([
      {
        number: 1,
        title: 'Café',
        count: 2,
        occurrences: [
          expect.objectContaining({
            sectionId: root.section.sectionId,
            blockId: 'root-citation',
            ordinal: 0,
            pageIndex: 0
          }),
          expect.objectContaining({
            sectionId: second.sectionId,
            blockId: 'second-citations',
            ordinal: 0,
            pageIndex: 8,
            title: 'Café'
          })
        ]
      },
      {
        number: 2,
        title: 'café',
        count: 1,
        occurrences: [
          expect.objectContaining({
            sectionId: second.sectionId,
            blockId: 'second-citations',
            ordinal: 1,
            title: 'café'
          })
        ]
      }
    ])
    expect(JSON.stringify(index)).not.toContain('Obsolete source')
    database.close()
  })

  it('logs the original transformed error without logging brief or body content', async () => {
    const error = vi.fn()
    const info = vi.fn()
    const log = { error, info } as unknown as typeof silentLog
    const { database, service } = await fixture({ log })
    const root = service.assemble().sections[0]
    if (root === undefined) throw new Error('Missing root fixture')
    const privateBody = 'PRIVATE BODY CONTENT'
    expect(() =>
      service.appendRevision({
        sectionId: root.section.sectionId,
        baseRevisionId: 'stale-revision',
        baseContentHash: root.revision.contentHash,
        content: [paragraph(privateBody)]
      })
    ).toThrow(ManuscriptDomainError)
    const failure = error.mock.calls.at(-1)?.[0]
    expect(failure).toEqual(expect.objectContaining({ err: expect.any(ManuscriptDomainError) }))
    expect(JSON.stringify(error.mock.calls)).not.toContain(privateBody)
    database.close()
  })

  it('logs content and brief serialization failures with the original top-level error', async () => {
    const error = vi.fn()
    const log = { error, info: vi.fn() } as unknown as typeof silentLog
    const { database, service } = await fixture({ log })
    const root = service.assemble().sections[0]
    if (root === undefined) throw new Error('Missing root fixture')

    let contentError: unknown
    try {
      service.appendRevision({
        sectionId: root.section.sectionId,
        baseRevisionId: root.revision.sectionRevisionId,
        baseContentHash: root.revision.contentHash,
        content: [
          { ...paragraph('invalid'), content: [{ type: 'text', text: undefined, styles: {} }] }
        ]
      })
    } catch (err) {
      contentError = err
    }
    expect(contentError).toBeInstanceOf(Error)
    expect(
      error.mock.calls.find(([fields]) => fields.event === 'manuscript.revision.append_failed')?.[0]
    ).toEqual(expect.objectContaining({ err: contentError }))

    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    let briefError: unknown
    try {
      service.updateBrief({
        baseVersion: 1,
        title: 'Serialization boundary',
        description: '',
        topic: '',
        targetAudience: '',
        language: '',
        styleTone: '',
        scopeExclusions: '',
        targetLength: '',
        citationRequirements: '',
        additionalInstructions: '',
        extensible: cyclic
      })
    } catch (err) {
      briefError = err
    }
    expect(briefError).toBeInstanceOf(TypeError)
    expect(
      error.mock.calls.find(([fields]) => fields.event === 'manuscript.brief.update_failed')?.[0]
    ).toEqual(expect.objectContaining({ err: briefError }))
    database.close()
  })

  it('logs the original deletion guard error before returning a safe domain error', async () => {
    const original = new Error('proposal lookup failed')
    const guard = {
      assertCanDelete: vi.fn(() => {
        throw original
      })
    }
    const error = vi.fn()
    const log = { error, info: vi.fn() } as unknown as typeof silentLog
    const { database, service } = await fixture({ deletionGuard: guard, log })
    const root = service.listSections()[0]
    if (root === undefined) throw new Error('Missing root fixture')
    const child = service.createSection({
      baseOutlineVersion: service.assemble().outlineVersion,
      title: 'Guarded child',
      parentSectionId: root.sectionId,
      position: 0
    })

    expect(() =>
      service.deleteSection({
        baseOutlineVersion: service.assemble().outlineVersion,
        sectionId: child.sectionId
      })
    ).toThrowError(expect.objectContaining({ code: 'section_deletion_blocked', cause: original }))
    expect(
      error.mock.calls.find(
        ([fields]) => fields.event === 'manuscript.section.deletion_guard_failed'
      )?.[0]
    ).toEqual(expect.objectContaining({ err: original, sectionId: child.sectionId }))
    database.close()
  })
})

function replacementSection(
  sectionId: string,
  revision: { sectionRevisionId: string; contentHash: string }
) {
  return {
    sectionId,
    baseRevisionId: revision.sectionRevisionId,
    baseContentHash: revision.contentHash,
    operations: [
      {
        target: {
          kind: 'block_inline' as const,
          sectionId,
          revisionId: revision.sectionRevisionId,
          blockId: 'block-alpha',
          segments: [{ inlineIndex: 0, range: { from: 0, to: 5 } }],
          flatRange: { from: 0, to: 5 }
        },
        sourceSliceHash: createHash('sha256').update('alpha').digest('hex')
      }
    ]
  }
}
