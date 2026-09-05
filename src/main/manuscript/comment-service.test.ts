import { mkdir, mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { MainAgentTools } from '../agent/tools'
import { MainAgentReadTools } from '../agent/read-tools'
import { afterEach, describe, expect, it } from 'vitest'
import {
  initializeProjectDatabase,
  openProjectDatabase,
  type ProjectDatabase
} from '../project/project-database'
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
  projectRoot: string
  manifest: ProjectManifest
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
  return { database, manuscript, comments, projectRoot, manifest }
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
      anchor_status: 'attached',
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
    const agent = { sessionId, runId, modelRequestId: 'resolve-request' }
    seedAgent(database, sessionId, runId)
    authorizeComments(database, comments, sessionId, runId, [created.threadId])
    comments.readForAgent(created.threadId, runId, 'read-request')
    const replied = comments.replyForAgent(
      {
        threadId: created.threadId,
        expectedVersion: created.version,
        body: 'I need more evidence.',
        operationId: 'reply-1'
      },
      agent
    )
    const duplicate = comments.replyForAgent(
      {
        threadId: created.threadId,
        expectedVersion: created.version,
        body: 'I need more evidence.',
        operationId: 'reply-1'
      },
      agent
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
        agent
      )
    ).toThrowError(CommentDomainError)
    comments.readForAgent(created.threadId, runId, 'read-request')
    await readFullSection(manuscript, comments, runId, section.section.sectionId)
    const resolved = comments.resolveForAgent(
      {
        threadId: created.threadId,
        expectedVersion: replied.version,
        resolutionNote: 'Verified current text.',
        operationId: 'resolve-1'
      },
      agent
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
        agent
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

function authorizeComments(
  database: ProjectDatabase,
  comments: ManuscriptCommentService,
  sessionId: string,
  runId: string,
  threadIds: string[]
): void {
  database.immediate((db) =>
    db
      .prepare(
        "UPDATE agent_runs SET status = 'completed', completed_at = updated_at WHERE agent_run_id = ?"
      )
      .run(runId)
  )
  comments.delegate({ projectSessionId, agentSessionId: sessionId, threadIds })
  database.immediate((db) =>
    db
      .prepare(
        "UPDATE agent_runs SET status = 'running', completed_at = NULL WHERE agent_run_id = ?"
      )
      .run(runId)
  )
}
function readTools(manuscript: ManuscriptService): MainAgentReadTools {
  return new MainAgentReadTools({
    projectSessionId,
    manuscript,
    references: { list: () => [] } as never,
    retrieval: null,
    log
  })
}
async function readFullSection(
  manuscript: ManuscriptService,
  comments: ManuscriptCommentService,
  runId: string,
  sectionId: string
): Promise<void> {
  const args = { sectionId, view: 'summary' as const, limit: 50 }
  const result = await readTools(manuscript).execute({
    toolName: 'read_section',
    args,
    editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
    signal: new AbortController().signal
  })
  comments.recordSectionRead(runId, 'section-request', result, args)
}

describe('acceptance regression probes', () => {
  async function prepared(text: string, quote: string, from: number, to: number) {
    const f = await fixture()
    const section = f.manuscript.assemble().sections[0]
    const revision = f.manuscript.appendRevision({
      sectionId: section.section.sectionId,
      baseRevisionId: section.revision.sectionRevisionId,
      baseContentHash: section.revision.contentHash,
      content: [paragraph('body', text)]
    })
    const thread = f.comments.create({
      projectSessionId,
      sectionId: section.section.sectionId,
      revisionId: revision.sectionRevisionId,
      contentHash: revision.contentHash,
      quote,
      segments: [{ blockId: 'body', from, to }],
      body: 'Please clarify this text.'
    })
    return { ...f, revision, thread, sectionId: section.section.sectionId }
  }
  it('keeps a replaced selection attached to its replacement', async () => {
    const f = await prepared('alpha beta', 'alpha', 0, 5)
    try {
      f.manuscript.appendRevision({
        sectionId: f.sectionId,
        baseRevisionId: f.revision.sectionRevisionId,
        baseContentHash: f.revision.contentHash,
        content: [paragraph('body', 'gamma beta')]
      })
      expect(f.comments.read(f.thread.threadId).anchor.status).toBe('attached')
    } finally {
      f.database.close()
    }
  })
  it('does not silently bind a deleted first occurrence to the remaining duplicate', async () => {
    const f = await prepared('alpha alpha', 'alpha', 0, 5)
    try {
      f.manuscript.appendRevision({
        sectionId: f.sectionId,
        baseRevisionId: f.revision.sectionRevisionId,
        baseContentHash: f.revision.contentHash,
        content: [paragraph('body', 'alpha')]
      })
      expect(f.comments.read(f.thread.threadId).anchor.status).toBe('orphaned')
    } finally {
      f.database.close()
    }
  })
  it('rejects Agent resolution with a lost anchor and no applied deletion evidence', async () => {
    const f = await prepared('alpha beta', 'alpha', 0, 5)
    try {
      f.manuscript.appendRevision({
        sectionId: f.sectionId,
        baseRevisionId: f.revision.sectionRevisionId,
        baseContentHash: f.revision.contentHash,
        content: []
      })
      const sessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc802'
      const runId = '019c6a5c-8d34-7a8e-a602-3d37a52dc803'
      seedAgent(f.database, sessionId, runId)
      authorizeComments(f.database, f.comments, sessionId, runId, [f.thread.threadId])
      const read = f.comments.readForAgent(f.thread.threadId, runId, 'read-request')
      expect(read.anchor.status).toBe('orphaned')
      await readFullSection(f.manuscript, f.comments, runId, f.sectionId)
      expect(() =>
        f.comments.resolveForAgent(
          {
            threadId: read.threadId,
            expectedVersion: read.version,
            resolutionNote: 'Looks fixed.',
            operationId: 'probe'
          },
          { sessionId, runId, modelRequestId: 'resolve-request' }
        )
      ).toThrow()
    } finally {
      f.database.close()
    }
  })
  it('does not allow zero-block read_section to qualify as full verification', async () => {
    const f = await prepared('alpha beta', 'alpha', 0, 5)
    try {
      const sessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc802'
      const runId = '019c6a5c-8d34-7a8e-a602-3d37a52dc803'
      seedAgent(f.database, sessionId, runId)
      authorizeComments(f.database, f.comments, sessionId, runId, [f.thread.threadId])
      const reads = new MainAgentReadTools({
        projectSessionId,
        manuscript: f.manuscript,
        references: { list: () => [] } as never,
        retrieval: null,
        log
      })
      const tools = new MainAgentTools(reads, {} as never, undefined, f.comments)
      const common = {
        agentSessionId: sessionId,
        agentRunId: runId,
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
        toolCallId: 'probe',
        toolCallEventId: 'probe',
        modelRequestId: 'same-request',
        signal: new AbortController().signal,
        snapshot: reads.contextBuilder().capture('probe-snapshot', {
          activeSectionId: null,
          activeBlockId: null,
          selectedBlockIds: []
        })
      }
      const thread = await tools.execute({
        ...common,
        toolName: 'read_comment',
        args: { threadId: f.thread.threadId }
      })
      const section = await tools.execute({
        ...common,
        toolName: 'read_section',
        args: { sectionId: f.sectionId, view: 'summary', blockIds: [] }
      })
      expect(section.blocks).toHaveLength(0)
      await expect(
        tools.execute({
          ...common,
          toolName: 'resolve_comment',
          args: {
            threadId: thread.threadId,
            expectedVersion: thread.version,
            verificationNote: 'Verified without reading any blocks.',
            operationId: 'empty-read'
          }
        })
      ).rejects.toThrow()
    } finally {
      f.database.close()
    }
  })
})

describe('comment project recovery', () => {
  it('upgrades v44 with a verified backup and preserves comments in a copied project', async () => {
    const f = await fixture()
    const entry = f.manuscript.assemble().sections[0]
    const revision = f.manuscript.appendRevision({
      sectionId: entry.section.sectionId,
      baseRevisionId: entry.revision.sectionRevisionId,
      baseContentHash: entry.revision.contentHash,
      content: [paragraph('body', 'Review me')]
    })
    const thread = f.comments.create({
      projectSessionId,
      sectionId: entry.section.sectionId,
      revisionId: revision.sectionRevisionId,
      contentHash: revision.contentHash,
      quote: 'Review',
      segments: [{ blockId: 'body', from: 0, to: 6 }],
      body: 'Preserve this discussion'
    })
    f.database.immediate((db) =>
      db.exec(`
      DROP TABLE manuscript_comment_anchor_history;
      DROP TABLE manuscript_comment_delegations;
      DROP TABLE manuscript_comment_changes;
      ALTER TABLE manuscript_comment_threads DROP COLUMN anchor_revision_id;
      ALTER TABLE manuscript_comment_reads DROP COLUMN model_request_id;
      ALTER TABLE manuscript_comment_reads DROP COLUMN section_model_request_id;
      ALTER TABLE manuscript_comment_reads DROP COLUMN covered_blocks_json;
      ALTER TABLE manuscript_comment_reads DROP COLUMN fragment_ranges_json;
      DELETE FROM schema_migrations WHERE version = 45;
      UPDATE schema_manifest SET schema_version = 44 WHERE id = 1;
      PRAGMA user_version = 44;
    `)
    )
    f.database.close()
    const upgraded = await openProjectDatabase({
      projectRoot: f.projectRoot,
      manifest: f.manifest,
      applicationVersion: 'test',
      log
    })
    try {
      expect(upgraded.immediate((db) => db.pragma('integrity_check'))).toEqual([
        { integrity_check: 'ok' }
      ])
      expect(upgraded.immediate((db) => db.pragma('foreign_key_check'))).toEqual([])
      expect(
        (await readdir(join(f.projectRoot, '.writellm', 'backups'))).some((name) =>
          name.startsWith('migration-v44-to-v45-')
        )
      ).toBe(true)
      const copyRoot = await mkdtemp(join(tmpdir(), 'writellm-comment-copy-'))
      directories.push(copyRoot)
      await mkdir(join(copyRoot, '.writellm'))
      await upgraded.backup(join(copyRoot, '.writellm', 'project.sqlite'))
      const copy = await openProjectDatabase({
        projectRoot: copyRoot,
        manifest: f.manifest,
        applicationVersion: 'test',
        log
      })
      try {
        const manuscript = new ManuscriptService({
          database: copy,
          projectId: f.manifest.projectId,
          log
        })
        const comments = new ManuscriptCommentService({
          database: copy,
          manuscript,
          projectSessionId,
          log
        })
        expect(comments.read(thread.threadId)).toMatchObject({
          status: 'open',
          anchor: { status: 'attached' },
          messages: [{ body: 'Preserve this discussion' }]
        })
      } finally {
        copy.close()
      }
    } finally {
      upgraded.close()
    }
  })
})

describe('comment ordering and pagination', () => {
  it('paginates every thread and delegates in manuscript order rather than creation order', async () => {
    const f = await fixture()
    try {
      const entry = f.manuscript.assemble().sections[0]
      const revision = f.manuscript.appendRevision({
        sectionId: entry.section.sectionId,
        baseRevisionId: entry.revision.sectionRevisionId,
        baseContentHash: entry.revision.contentHash,
        content: Array.from({ length: 103 }, (_, i) => paragraph(`block-${i}`, `word ${i}`))
      })
      const ids: string[] = []
      for (let i = 102; i >= 0; i--)
        ids.push(
          f.comments.create({
            projectSessionId,
            sectionId: entry.section.sectionId,
            revisionId: revision.sectionRevisionId,
            contentHash: revision.contentHash,
            quote: 'word',
            segments: [{ blockId: `block-${i}`, from: 0, to: 4 }],
            body: `Comment ${i}`
          }).threadId
        )
      const first = f.comments.list({ projectSessionId, status: 'open', query: '', limit: 100 })
      const second = f.comments.list({
        projectSessionId,
        status: 'open',
        query: '',
        limit: 100,
        cursor: first.nextCursor ?? undefined
      })
      expect([...first.threads, ...second.threads].map((t) => t.threadId)).toEqual(
        [...ids].reverse()
      )
      expect(second.nextCursor).toBeNull()
      const sessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc802'
      const runId = '019c6a5c-8d34-7a8e-a602-3d37a52dc803'
      seedAgent(f.database, sessionId, runId)
      f.database.immediate((db) =>
        db
          .prepare(
            "UPDATE agent_runs SET status='completed',completed_at=updated_at WHERE agent_run_id=?"
          )
          .run(runId)
      )
      expect(
        f.comments.delegate({
          projectSessionId,
          agentSessionId: sessionId,
          threadIds: ids.slice(0, 3)
        }).orderedThreadIds
      ).toEqual(ids.slice(0, 3).reverse())
    } finally {
      f.database.close()
    }
  })
})
