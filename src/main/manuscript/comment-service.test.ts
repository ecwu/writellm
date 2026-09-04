import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { CommentDomainError, ManuscriptCommentService } from './comment-service'
import { ManuscriptService } from './manuscript-service'

const directories: string[] = []
const log = pino({ level: 'silent' })
const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc800'

const paragraph = (id: string, text: string) => ({
  id,
  type: 'paragraph' as const,
  props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' as const },
  content: [{ type: 'text' as const, text, styles: {} }],
  children: []
})

async function fixture(): Promise<{
  database: ProjectDatabase
  manuscript: ManuscriptService
  comments: ManuscriptCommentService
}> {
  const root = await mkdtemp(join(tmpdir(), 'writellm-comments-'))
  directories.push(root)
  const projectRoot = join(root, 'project')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc801',
    createdAt: '2026-09-04T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    initialTitle: 'Comments',
    log
  })
  const manuscript = new ManuscriptService({
    database,
    projectId: manifest.projectId,
    log,
    now: () => new Date('2026-09-04T01:00:00.000Z')
  })
  const comments = new ManuscriptCommentService({
    database,
    manuscript,
    projectSessionId,
    log,
    now: () => new Date('2026-09-04T02:00:00.000Z')
  })
  return { database, manuscript, comments }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('ManuscriptCommentService', () => {
  it('persists author discussion state and reopens a resolved thread', async () => {
    const { database, manuscript, comments } = await fixture()
    const section = manuscript.assemble().sections[0]
    if (section === undefined) throw new Error('Missing root section')
    const revision = manuscript.appendRevision({
      sectionId: section.section.sectionId,
      baseRevisionId: section.revision.sectionRevisionId,
      baseContentHash: section.revision.contentHash,
      content: [paragraph('body', 'alpha beta')]
    })
    const created = comments.create({
      projectSessionId,
      sectionId: section.section.sectionId,
      revisionId: revision.sectionRevisionId,
      contentHash: revision.contentHash,
      quote: 'alpha',
      segments: [{ blockId: 'body', from: 0, to: 5 }],
      body: 'Clarify this.'
    })
    const replied = comments.reply({
      projectSessionId,
      threadId: created.threadId,
      expectedVersion: created.version,
      body: 'Follow up.'
    })
    const resolved = comments.resolve({
      projectSessionId,
      threadId: created.threadId,
      expectedVersion: replied.version,
      resolutionNote: 'Checked.'
    })
    const reopened = comments.reopen({
      projectSessionId,
      threadId: created.threadId,
      expectedVersion: resolved.version
    })

    expect(reopened).toMatchObject({ status: 'open', resolvedAt: null })
    expect(reopened.messages.map((message) => message.body)).toEqual([
      'Clarify this.',
      'Follow up.'
    ])
    expect(
      comments.list({ projectSessionId, status: 'open', query: '', limit: 50 }).threads
    ).toHaveLength(1)
    expect(database.immediate((native) => native.pragma('foreign_key_check'))).toEqual([])
    database.close()
  })

  it('marks anchors safe in the revision transaction and reattaches only a unique match', async () => {
    const { database, manuscript, comments } = await fixture()
    const section = manuscript.assemble().sections[0]
    if (section === undefined) throw new Error('Missing root section')
    const revision = manuscript.appendRevision({
      sectionId: section.section.sectionId,
      baseRevisionId: section.revision.sectionRevisionId,
      baseContentHash: section.revision.contentHash,
      content: [paragraph('body', 'alpha beta')]
    })
    const created = comments.create({
      projectSessionId,
      sectionId: section.section.sectionId,
      revisionId: revision.sectionRevisionId,
      contentHash: revision.contentHash,
      quote: 'alpha',
      segments: [{ blockId: 'body', from: 0, to: 5 }],
      body: 'Review alpha.'
    })
    const moved = manuscript.appendRevision({
      sectionId: section.section.sectionId,
      baseRevisionId: revision.sectionRevisionId,
      baseContentHash: revision.contentHash,
      content: [paragraph('body', 'new alpha beta')]
    })
    const transactionState = database.immediate((native) =>
      native
        .prepare(
          'SELECT anchor_status, current_revision_id FROM manuscript_comment_threads WHERE thread_id = ?'
        )
        .get(created.threadId)
    )
    expect(transactionState).toEqual({
      anchor_status: 'orphaned',
      current_revision_id: moved.sectionRevisionId
    })
    expect(comments.read(created.threadId).anchor).toMatchObject({
      status: 'attached',
      currentRevisionId: moved.sectionRevisionId,
      segments: [{ blockId: 'body', from: 4, to: 9 }]
    })

    const duplicated = manuscript.appendRevision({
      sectionId: section.section.sectionId,
      baseRevisionId: moved.sectionRevisionId,
      baseContentHash: moved.contentHash,
      content: [paragraph('body', 'alpha and alpha')]
    })
    expect(comments.read(created.threadId).anchor).toMatchObject({
      status: 'orphaned',
      currentRevisionId: duplicated.sectionRevisionId
    })
    const orphaned = comments.read(created.threadId)
    expect(
      comments.reanchor({
        projectSessionId,
        threadId: created.threadId,
        expectedVersion: orphaned.version,
        revisionId: duplicated.sectionRevisionId,
        contentHash: duplicated.contentHash,
        quote: 'alpha',
        segments: [{ blockId: 'body', from: 0, to: 5 }]
      }).anchor
    ).toMatchObject({ status: 'attached', segments: [{ blockId: 'body', from: 0, to: 5 }] })
    database.close()
  })

  it('requires a current Agent read and deduplicates Agent replies', async () => {
    const { database, manuscript, comments } = await fixture()
    const section = manuscript.assemble().sections[0]
    if (section === undefined) throw new Error('Missing root section')
    const revision = manuscript.appendRevision({
      sectionId: section.section.sectionId,
      baseRevisionId: section.revision.sectionRevisionId,
      baseContentHash: section.revision.contentHash,
      content: [paragraph('body', 'alpha beta')]
    })
    const created = comments.create({
      projectSessionId,
      sectionId: section.section.sectionId,
      revisionId: revision.sectionRevisionId,
      contentHash: revision.contentHash,
      quote: 'alpha',
      segments: [{ blockId: 'body', from: 0, to: 5 }],
      body: 'Review alpha.'
    })
    const sessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc802'
    const runId = '019c6a5c-8d34-7a8e-a602-3d37a52dc803'
    seedAgent(database, sessionId, runId)
    comments.readForAgent(created.threadId, runId)
    const replied = comments.replyForAgent(
      {
        threadId: created.threadId,
        expectedVersion: created.version,
        body: 'I need more evidence.',
        operationId: 'reply-1'
      },
      { sessionId, runId }
    )
    const duplicate = comments.replyForAgent(
      {
        threadId: created.threadId,
        expectedVersion: created.version,
        body: 'I need more evidence.',
        operationId: 'reply-1'
      },
      { sessionId, runId }
    )
    expect(duplicate.messages).toHaveLength(replied.messages.length)
    expect(() =>
      comments.resolveForAgent(
        {
          threadId: created.threadId,
          expectedVersion: replied.version,
          resolutionNote: 'Verified current text.',
          operationId: 'resolve-1'
        },
        { sessionId, runId }
      )
    ).toThrowError(CommentDomainError)
    comments.readForAgent(created.threadId, runId)
    comments.recordSectionRead(runId, section.section.sectionId, revision.sectionRevisionId)
    const resolved = comments.resolveForAgent(
      {
        threadId: created.threadId,
        expectedVersion: replied.version,
        resolutionNote: 'Verified current text.',
        operationId: 'resolve-1'
      },
      { sessionId, runId }
    )
    expect(resolved.status).toBe('resolved')
    expect(
      comments.resolveForAgent(
        {
          threadId: created.threadId,
          expectedVersion: replied.version,
          resolutionNote: 'Verified current text.',
          operationId: 'resolve-1'
        },
        { sessionId, runId }
      ).version
    ).toBe(resolved.version)
    database.close()
  })
})

function seedAgent(database: ProjectDatabase, sessionId: string, runId: string): void {
  const now = '2026-09-04T01:30:00.000Z'
  database.immediate((native) => {
    native
      .prepare(`INSERT INTO agent_sessions (
        agent_session_id, title, pi_runtime_version, event_schema_version, created_at, updated_at
      ) VALUES (?, 'Comments', '0.85.0', 4, ?, ?)`)
      .run(sessionId, now, now)
    native
      .prepare(`INSERT INTO agent_runs (
        agent_run_id, agent_session_id, status, provider_id, model_id,
        provider_fingerprint, model_fingerprint, editor_context_json,
        started_at, created_at, updated_at
      ) VALUES (?, ?, 'running', 'provider', 'model', ?, ?, '{}', ?, ?, ?)`)
      .run(runId, sessionId, 'a'.repeat(64), 'b'.repeat(64), now, now, now)
  })
}
