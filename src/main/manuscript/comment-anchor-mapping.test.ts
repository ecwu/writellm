import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { ManuscriptCommentService } from './comment-service'
import { ManuscriptService } from './manuscript-service'

const log = pino({ level: 'silent' })
const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc800'
const directories: string[] = []

const paragraph = (id: string, text: string, backgroundColor = 'default') => ({
  id,
  type: 'paragraph' as const,
  props: {
    backgroundColor,
    textColor: 'default',
    textAlignment: 'left' as const
  },
  content: [{ type: 'text' as const, text, styles: {} }],
  children: []
})

async function fixture(): Promise<{
  database: ProjectDatabase
  manuscript: ManuscriptService
  comments: ManuscriptCommentService
}> {
  const root = await mkdtemp(join(tmpdir(), 'writellm-comment-anchor-'))
  directories.push(root)
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc801',
    createdAt: '2026-09-05T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    initialTitle: 'Anchor mapping',
    log
  })
  const manuscript = new ManuscriptService({ database, projectId: manifest.projectId, log })
  const comments = new ManuscriptCommentService({
    database,
    manuscript,
    projectSessionId,
    log
  })
  return { database, manuscript, comments }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

async function seed(
  manuscript: ManuscriptService,
  comments: ManuscriptCommentService,
  content: ReturnType<typeof paragraph>[],
  quote: string,
  segments: Array<{ blockId: string; from: number; to: number }>
) {
  const section = manuscript.assemble().sections[0]
  if (section === undefined) throw new Error('Missing root section')
  const base = manuscript.appendRevision({
    sectionId: section.section.sectionId,
    baseRevisionId: section.revision.sectionRevisionId,
    baseContentHash: section.revision.contentHash,
    content
  })
  const thread = comments.create({
    projectSessionId,
    sectionId: section.section.sectionId,
    revisionId: base.sectionRevisionId,
    contentHash: base.contentHash,
    quote,
    segments,
    body: 'Please review this passage.'
  })
  return { section, base, thread }
}

describe('comment anchor mapping', () => {
  it('maps replacements, insertions, formatting changes, and stable block moves', async () => {
    const { database, manuscript, comments } = await fixture()
    const initial = await seed(manuscript, comments, [paragraph('a', 'alpha beta')], 'alpha', [
      { blockId: 'a', from: 0, to: 5 }
    ])
    const replaced = manuscript.appendRevision({
      sectionId: initial.section.section.sectionId,
      baseRevisionId: initial.base.sectionRevisionId,
      baseContentHash: initial.base.contentHash,
      content: [paragraph('a', 'gamma beta')]
    })
    expect(comments.read(initial.thread.threadId).anchor).toMatchObject({
      status: 'attached',
      currentRevisionId: replaced.sectionRevisionId,
      segments: [{ blockId: 'a', from: 0, to: 5 }]
    })

    const inserted = manuscript.appendRevision({
      sectionId: initial.section.section.sectionId,
      baseRevisionId: replaced.sectionRevisionId,
      baseContentHash: replaced.contentHash,
      content: [paragraph('a', 'new gamma beta')]
    })
    expect(comments.read(initial.thread.threadId).anchor.segments).toEqual([
      { blockId: 'a', from: 4, to: 9 }
    ])

    const formatted = manuscript.appendRevision({
      sectionId: initial.section.section.sectionId,
      baseRevisionId: inserted.sectionRevisionId,
      baseContentHash: inserted.contentHash,
      content: [paragraph('a', 'new gamma beta', 'red')]
    })
    expect(comments.read(initial.thread.threadId).anchor).toMatchObject({
      status: 'attached',
      currentRevisionId: formatted.sectionRevisionId,
      segments: [{ blockId: 'a', from: 4, to: 9 }]
    })
    const moved = manuscript.appendRevision({
      sectionId: initial.section.section.sectionId,
      baseRevisionId: formatted.sectionRevisionId,
      baseContentHash: formatted.contentHash,
      content: [paragraph('b', 'other'), paragraph('a', 'new gamma beta', 'blue')]
    })
    expect(comments.read(initial.thread.threadId).anchor).toMatchObject({
      status: 'attached',
      currentRevisionId: moved.sectionRevisionId,
      segments: [{ blockId: 'a', from: 4, to: 9 }]
    })
    database.close()
  })

  it('maps multi-block ranges and UTF-16 offsets', async () => {
    const { database, manuscript, comments } = await fixture()
    const initial = await seed(
      manuscript,
      comments,
      [paragraph('a', 'first alpha'), paragraph('b', 'second')],
      'alpha\nsecond',
      [
        { blockId: 'a', from: 6, to: 11 },
        { blockId: 'b', from: 0, to: 6 }
      ]
    )
    const changed = manuscript.appendRevision({
      sectionId: initial.section.section.sectionId,
      baseRevisionId: initial.base.sectionRevisionId,
      baseContentHash: initial.base.contentHash,
      content: [paragraph('a', 'prefix first alpha'), paragraph('b', 'new second')]
    })
    expect(comments.read(initial.thread.threadId).anchor).toMatchObject({
      status: 'attached',
      currentRevisionId: changed.sectionRevisionId,
      segments: [
        { blockId: 'a', from: 13, to: 18 },
        { blockId: 'b', from: 4, to: 10 }
      ]
    })

    const emoji = await seed(manuscript, comments, [paragraph('emoji', '🙂 alpha')], 'alpha', [
      { blockId: 'emoji', from: 3, to: 8 }
    ])
    const emojiChanged = manuscript.appendRevision({
      sectionId: emoji.section.section.sectionId,
      baseRevisionId: emoji.base.sectionRevisionId,
      baseContentHash: emoji.base.contentHash,
      content: [paragraph('emoji', '🙂 new alpha')]
    })
    expect(comments.read(emoji.thread.threadId).anchor).toMatchObject({
      status: 'attached',
      currentRevisionId: emojiChanged.sectionRevisionId,
      segments: [{ blockId: 'emoji', from: 7, to: 12 }]
    })
    database.close()
  })

  it('maps uniquely provable split and merge relations', async () => {
    const { database, manuscript, comments } = await fixture()
    const split = await seed(manuscript, comments, [paragraph('old', 'alpha beta')], 'beta', [
      { blockId: 'old', from: 6, to: 10 }
    ])
    const splitRevision = manuscript.appendRevision({
      sectionId: split.section.section.sectionId,
      baseRevisionId: split.base.sectionRevisionId,
      baseContentHash: split.base.contentHash,
      content: [paragraph('left', 'alpha '), paragraph('right', 'beta')]
    })
    expect(comments.read(split.thread.threadId).anchor).toMatchObject({
      status: 'attached',
      currentRevisionId: splitRevision.sectionRevisionId,
      segments: [{ blockId: 'right', from: 0, to: 4 }]
    })

    const merge = await seed(
      manuscript,
      comments,
      [paragraph('left2', 'alpha '), paragraph('right2', 'beta')],
      'beta',
      [{ blockId: 'right2', from: 0, to: 4 }]
    )
    const mergeRevision = manuscript.appendRevision({
      sectionId: merge.section.section.sectionId,
      baseRevisionId: merge.base.sectionRevisionId,
      baseContentHash: merge.base.contentHash,
      content: [paragraph('merged', 'alpha beta')]
    })
    expect(comments.read(merge.thread.threadId).anchor).toMatchObject({
      status: 'attached',
      currentRevisionId: mergeRevision.sectionRevisionId,
      segments: [{ blockId: 'merged', from: 6, to: 10 }]
    })
    database.close()
  })

  it('restores an exact historical anchor only when the document hash matches', async () => {
    const { database, manuscript, comments } = await fixture()
    const initial = await seed(manuscript, comments, [paragraph('a', 'alpha alpha')], 'alpha', [
      { blockId: 'a', from: 0, to: 5 }
    ])
    const duplicateRemoved = manuscript.appendRevision({
      sectionId: initial.section.section.sectionId,
      baseRevisionId: initial.base.sectionRevisionId,
      baseContentHash: initial.base.contentHash,
      content: [paragraph('a', 'alpha')]
    })
    expect(comments.read(initial.thread.threadId).anchor.status).toBe('orphaned')

    const restored = manuscript.appendRevision({
      sectionId: initial.section.section.sectionId,
      baseRevisionId: duplicateRemoved.sectionRevisionId,
      baseContentHash: duplicateRemoved.contentHash,
      content: [paragraph('a', 'alpha alpha')]
    })
    expect(comments.read(initial.thread.threadId).anchor).toMatchObject({
      status: 'attached',
      currentRevisionId: restored.sectionRevisionId,
      segments: [{ blockId: 'a', from: 0, to: 5 }]
    })
    const historyCount = database.immediate(
      (native) =>
        native
          .prepare(
            'SELECT count(*) AS count FROM manuscript_comment_anchor_history WHERE thread_id = ?'
          )
          .get(initial.thread.threadId) as { count: number }
    )
    expect(historyCount.count).toBe(3)
    database.close()
  })
})
