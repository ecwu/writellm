import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import { AnnotationService } from './annotation-service'
import { ManuscriptService } from './manuscript-service'

const directories: string[] = []
const log = pino({ level: 'silent' })
const projectId = '019d0000-0000-7000-8000-000000000200'

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('AnnotationService', () => {
  it('keeps notes outside manuscript state, preserves exact block anchors, and reports orphaning', async () => {
    const { database, manuscript, service, sectionId, revisionId } = await fixture()
    const created = service.create({
      sectionId,
      blockId: 'anchor-block',
      kind: 'todo',
      body: 'Verify the supporting evidence.',
      textAnchor: 'supporting evidence'
    })
    expect(created).toMatchObject({
      kind: 'todo',
      status: 'open',
      sectionId,
      blockId: 'anchor-block',
      anchorRevisionId: revisionId,
      anchorStatus: 'current'
    })
    expect(created.textAnchorFingerprint).toMatch(/^[a-f0-9]{64}$/u)
    expect(JSON.stringify(manuscript.getWorkspace())).not.toContain(
      'Verify the supporting evidence'
    )

    const current = manuscript.getRevision(revisionId)
    const preserved = manuscript.appendRevision({
      sectionId,
      baseRevisionId: revisionId,
      baseContentHash: current.contentHash,
      content: [paragraph('anchor-block', 'Changed text, stable block identity')],
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null
    })
    expect(service.list({ limit: 50 }).annotations[0]?.anchorStatus).toBe('current')
    manuscript.appendRevision({
      sectionId,
      baseRevisionId: preserved.sectionRevisionId,
      baseContentHash: preserved.contentHash,
      content: [paragraph('replacement-block', 'Replacement block')],
      source: 'manual',
      sourceClass: 'manual_checkpoint',
      agentRunId: null,
      agentToolCallId: null,
      agentProposalId: null
    })
    expect(service.list({ limit: 50 }).annotations[0]?.anchorStatus).toBe('orphaned')

    const replacementAnnotation = service.create({
      sectionId,
      blockId: 'replacement-block',
      kind: 'note',
      body: 'This section will be tombstoned.'
    })
    database.immediate((database) =>
      database
        .prepare('UPDATE sections SET deleted_at = ? WHERE section_id = ?')
        .run('2026-08-13T01:00:00.000Z', sectionId)
    )
    expect(
      service
        .list({ limit: 50 })
        .annotations.find(
          (annotation) => annotation.annotationId === replacementAnnotation.annotationId
        )?.anchorStatus
    ).toBe('orphaned')
    database.close()
  })

  it('supports optimistic edit, resolve, reopen, bounded paging, and explicit Agent inclusion', async () => {
    const { database, service, sectionId } = await fixture()
    const first = service.create({
      sectionId,
      blockId: 'anchor-block',
      kind: 'note',
      body: 'Private note'
    })
    const edited = service.update({
      action: 'edit',
      annotationId: first.annotationId,
      expectedVersion: first.version,
      kind: 'todo',
      body: 'Actionable private note'
    })
    const resolved = service.update({
      action: 'resolve',
      annotationId: edited.annotationId,
      expectedVersion: edited.version
    })
    expect(resolved.status).toBe('resolved')
    expect(() =>
      service.update({
        action: 'reopen',
        annotationId: resolved.annotationId,
        expectedVersion: edited.version
      })
    ).toThrow('Annotation changed')
    const reopened = service.update({
      action: 'reopen',
      annotationId: resolved.annotationId,
      expectedVersion: resolved.version
    })
    expect(reopened.status).toBe('open')
    for (let index = 0; index < 105; index += 1) {
      service.create({
        sectionId,
        blockId: 'anchor-block',
        kind: index % 2 === 0 ? 'todo' : 'note',
        body: `Bounded annotation ${index}`
      })
    }
    const page = service.list({ statuses: ['open'], limit: 100 })
    expect(page.annotations).toHaveLength(100)
    expect(page.total).toBe(106)
    expect(page.nextCursor).not.toBeNull()
    expect(
      service.list({ statuses: ['open'], limit: 100, cursor: page.nextCursor as string })
        .annotations
    ).toHaveLength(6)
    const included = service.agentContext([reopened.annotationId])
    expect(included.ids).toEqual([reopened.annotationId])
    expect(included.content).toContain('Actionable private note')
    expect(() => service.agentContext(['019d0000-0000-7000-8000-000000000299'])).toThrow(
      'Annotation does not exist'
    )
    database.close()
  })
})

async function fixture(): Promise<{
  database: ProjectDatabase
  manuscript: ManuscriptService
  service: AnnotationService
  sectionId: string
  revisionId: string
}> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-annotations-'))
  directories.push(parent)
  const projectRoot = join(parent, 'Annotations.writellm')
  await mkdir(projectRoot)
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId,
      createdAt: '2026-08-13T00:00:00.000Z'
    },
    applicationVersion: 'test',
    log
  })
  const manuscript = new ManuscriptService({ database, projectId, log })
  const section = manuscript.listSections()[0]
  if (section === undefined) throw new Error('Missing fixture section')
  const initial = manuscript.getRevision(section.currentRevisionId)
  const anchored = manuscript.appendRevision({
    sectionId: section.sectionId,
    baseRevisionId: initial.sectionRevisionId,
    baseContentHash: initial.contentHash,
    content: [paragraph('anchor-block', 'Anchor text')],
    source: 'manual',
    sourceClass: 'manual_checkpoint',
    agentRunId: null,
    agentToolCallId: null,
    agentProposalId: null
  })
  return {
    database,
    manuscript,
    service: new AnnotationService({ database, log }),
    sectionId: section.sectionId,
    revisionId: anchored.sectionRevisionId
  }
}

function paragraph(id: string, text: string) {
  return {
    id,
    type: 'paragraph' as const,
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
    content: [{ type: 'text' as const, text, styles: {} }],
    children: []
  }
}
