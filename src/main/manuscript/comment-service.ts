import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { blockNoteInlinePlainText } from '../../shared/blocknote-inline-text'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import {
  commentAnchorSegmentSchema,
  commentThreadSchema,
  commentThreadSummarySchema,
  createCommentInputSchema,
  delegateCommentsInputSchema,
  editCommentInputSchema,
  listCommentsInputSchema,
  replyCommentInputSchema,
  reanchorCommentInputSchema,
  type ChangeCommentStatusInput,
  type CommentAnchorSegment,
  type CommentThread,
  type CreateCommentInput,
  type DelegateCommentsInput,
  type DelegateCommentsResult,
  type DeleteCommentInput,
  type EditCommentInput,
  type ListCommentsInput,
  type ListCommentsResult,
  type ReanchorCommentInput,
  type ReplyCommentInput
} from '../../shared/contracts/manuscript-comments'
import type {
  ManuscriptCommentMessageTable,
  ManuscriptCommentThreadTable
} from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import type { ManuscriptService } from './manuscript-service'

interface ThreadJoinedRow extends ManuscriptCommentThreadTable {
  section_title: string
}

export class CommentDomainError extends Error {
  constructor(
    readonly code: 'not_found' | 'conflict' | 'invalid_anchor' | 'stale_read',
    message: string
  ) {
    super(message)
    this.name = 'CommentDomainError'
  }
}

export class ManuscriptCommentService {
  readonly #database: ProjectDatabase
  readonly #manuscript: ManuscriptService
  readonly #log: Pick<Logger, 'info' | 'warn' | 'error'>
  readonly #now: () => Date
  readonly #projectSessionId: string

  constructor(options: {
    database: ProjectDatabase
    manuscript: ManuscriptService
    projectSessionId: string
    log: Pick<Logger, 'info' | 'warn' | 'error'>
    now?: () => Date
  }) {
    this.#database = options.database
    this.#manuscript = options.manuscript
    this.#projectSessionId = options.projectSessionId
    this.#log = options.log
    this.#now = options.now ?? (() => new Date())
  }

  create(input: CreateCommentInput): CommentThread {
    const parsed = createCommentInputSchema.parse(input)
    const revision = this.#manuscript.getRevision(parsed.revisionId)
    if (revision.sectionId !== parsed.sectionId || revision.contentHash !== parsed.contentHash) {
      throw new CommentDomainError(
        'conflict',
        'The selected manuscript revision is no longer current'
      )
    }
    const section = this.#manuscript.getSection(parsed.sectionId)
    if (section.currentRevisionId !== parsed.revisionId) {
      throw new CommentDomainError(
        'conflict',
        'The selected manuscript revision is no longer current'
      )
    }
    const segments = validateSegments(revision.content, parsed.segments)
    const selected = selectedText(revision.content, segments)
    if (normalizeSelection(selected) !== normalizeSelection(parsed.quote)) {
      throw new CommentDomainError(
        'invalid_anchor',
        'The selected text does not match the saved revision'
      )
    }
    const now = this.#now().toISOString()
    const threadId = randomUUID()
    const messageId = randomUUID()
    this.#database.immediate((database) => {
      database
        .prepare(`INSERT INTO manuscript_comment_threads (
          thread_id, section_id, status, version, anchor_status, quote, anchor_json,
          created_revision_id, current_revision_id, created_at, updated_at
        ) VALUES (?, ?, 'open', 1, 'attached', ?, ?, ?, ?, ?, ?)`)
        .run(
          threadId,
          parsed.sectionId,
          parsed.quote,
          JSON.stringify(segments),
          parsed.revisionId,
          parsed.revisionId,
          now,
          now
        )
      database
        .prepare(`INSERT INTO manuscript_comment_messages (
          message_id, thread_id, author, body, created_at, updated_at
        ) VALUES (?, ?, 'author', ?, ?, ?)`)
        .run(messageId, threadId, parsed.body, now, now)
      insertEvent(database, threadId, 'created', 'author', now, parsed.revisionId)
    })
    this.#log.info(
      { event: 'manuscript.comment.created', threadId, sectionId: parsed.sectionId },
      'Manuscript comment created'
    )
    return this.read(threadId)
  }

  list(input: ListCommentsInput): ListCommentsResult {
    const parsed = listCommentsInputSchema.parse(input)
    this.#refreshSectionAnchors(parsed.sectionId)
    const offset = parsed.cursor === undefined ? 0 : Number.parseInt(parsed.cursor, 10)
    const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0
    return this.#database.immediate((database) => {
      const conditions = ['t.deleted_at IS NULL']
      const params: unknown[] = []
      if (parsed.status !== 'all') {
        conditions.push('t.status = ?')
        params.push(parsed.status)
      }
      if (parsed.sectionId !== undefined) {
        conditions.push('t.section_id = ?')
        params.push(parsed.sectionId)
      }
      if (parsed.query.length > 0) {
        conditions.push(
          "(t.quote LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM manuscript_comment_messages mq WHERE mq.thread_id = t.thread_id AND mq.deleted_at IS NULL AND mq.body LIKE ? ESCAPE '\\'))"
        )
        const query = `%${escapeLike(parsed.query)}%`
        params.push(query, query)
      }
      const rows = database
        .prepare(`SELECT t.*, s.title AS section_title,
          (SELECT count(*) FROM manuscript_comment_messages m WHERE m.thread_id = t.thread_id AND m.deleted_at IS NULL) AS message_count,
          coalesce((SELECT substr(m.body, 1, 500) FROM manuscript_comment_messages m WHERE m.thread_id = t.thread_id AND m.deleted_at IS NULL ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1), '') AS latest_message_preview
          FROM manuscript_comment_threads t JOIN sections s ON s.section_id = t.section_id
          WHERE ${conditions.join(' AND ')}
          ORDER BY s.position, t.created_at, t.thread_id LIMIT ? OFFSET ?`)
        .all(...params, parsed.limit + 1, safeOffset) as Array<
        ThreadJoinedRow & { message_count: number; latest_message_preview: string }
      >
      const page = rows.slice(0, parsed.limit)
      return {
        threads: page.map((row) => {
          const { messages: _messages, ...thread } = threadFromRow(row, [])
          return commentThreadSummarySchema.parse({
            ...thread,
            messageCount: row.message_count,
            latestMessagePreview: row.latest_message_preview
          })
        }),
        nextCursor: rows.length > parsed.limit ? String(safeOffset + parsed.limit) : null
      }
    })
  }

  read(threadId: string): CommentThread {
    this.#refreshThreadAnchor(threadId)
    return this.#database.immediate((database) => {
      const row = database
        .prepare(`SELECT t.*, s.title AS section_title FROM manuscript_comment_threads t
          JOIN sections s ON s.section_id = t.section_id
          WHERE t.thread_id = ? AND t.deleted_at IS NULL`)
        .get(threadId) as ThreadJoinedRow | undefined
      if (row === undefined)
        throw new CommentDomainError('not_found', 'Comment thread does not exist')
      const messages = database
        .prepare(`SELECT * FROM manuscript_comment_messages
          WHERE thread_id = ? AND deleted_at IS NULL ORDER BY created_at, rowid`)
        .all(threadId) as ManuscriptCommentMessageTable[]
      return commentThreadSchema.parse(threadFromRow(row, messages))
    })
  }

  reply(
    input: ReplyCommentInput,
    actor: 'author' | 'agent' = 'author',
    agent?: { sessionId: string; runId: string }
  ): CommentThread {
    const parsed = replyCommentInputSchema.parse(input)
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      if (parsed.operationId !== undefined) {
        const existing = database
          .prepare(
            'SELECT 1 FROM manuscript_comment_messages WHERE thread_id = ? AND operation_id = ?'
          )
          .get(parsed.threadId, parsed.operationId)
        if (existing !== undefined) return
      }
      const row = requireMutableThread(database, parsed.threadId, parsed.expectedVersion)
      database
        .prepare(`INSERT INTO manuscript_comment_messages (
        message_id, thread_id, author, body, agent_session_id, agent_run_id, operation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          randomUUID(),
          parsed.threadId,
          actor,
          parsed.body,
          agent?.sessionId ?? null,
          agent?.runId ?? null,
          parsed.operationId ?? null,
          now,
          now
        )
      const changed = database
        .prepare(`UPDATE manuscript_comment_threads SET status = 'open', version = version + 1,
          resolved_by = NULL, resolution_note = NULL, resolved_revision_id = NULL,
          resolved_at = NULL, updated_at = ?
          WHERE thread_id = ? AND version = ? AND deleted_at IS NULL`)
        .run(now, row.thread_id, row.version)
      if (changed.changes !== 1) throw new CommentDomainError('conflict', 'Comment thread changed')
      if (row.status === 'resolved')
        insertEvent(database, row.thread_id, 'reopened', actor, now, row.current_revision_id, agent)
      insertEvent(database, row.thread_id, 'replied', actor, now, row.current_revision_id, agent)
    })
    return this.read(parsed.threadId)
  }

  edit(input: EditCommentInput): CommentThread {
    const parsed = editCommentInputSchema.parse(input)
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const row = requireMutableThread(database, parsed.threadId, parsed.expectedVersion)
      const changed = database
        .prepare(`UPDATE manuscript_comment_messages SET body = ?, updated_at = ?
        WHERE message_id = ? AND thread_id = ? AND author = 'author' AND deleted_at IS NULL`)
        .run(parsed.body, now, parsed.messageId, parsed.threadId)
      if (changed.changes !== 1)
        throw new CommentDomainError('not_found', 'Author comment does not exist')
      bumpThread(database, row.thread_id, row.version, now)
      insertEvent(database, row.thread_id, 'edited', 'author', now, row.current_revision_id)
    })
    return this.read(parsed.threadId)
  }

  resolve(
    input: ChangeCommentStatusInput,
    actor: 'author' | 'agent' = 'author',
    agent?: { sessionId: string; runId: string },
    resolution?: { operationId: string; proposalId?: string }
  ): CommentThread {
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const row = requireMutableThread(database, input.threadId, input.expectedVersion)
      if (actor === 'agent') {
        const receipt = database
          .prepare(`SELECT thread_version, section_revision_id, section_read_revision_id FROM manuscript_comment_reads
          WHERE agent_run_id = ? AND thread_id = ?`)
          .get(agent?.runId, input.threadId) as
          | {
              thread_version: number
              section_revision_id: string
              section_read_revision_id: string | null
            }
          | undefined
        if (
          receipt?.thread_version !== row.version ||
          receipt.section_revision_id !== row.current_revision_id ||
          receipt.section_read_revision_id !== row.current_revision_id
        ) {
          throw new CommentDomainError(
            'stale_read',
            'Read the current comment and manuscript revision before resolving'
          )
        }
        insertEvent(
          database,
          row.thread_id,
          'verified',
          actor,
          now,
          row.current_revision_id,
          agent,
          {
            note: input.resolutionNote ?? null
          }
        )
      }
      const changed = database
        .prepare(`UPDATE manuscript_comment_threads SET status = 'resolved', version = version + 1,
        resolved_by = ?, resolution_note = ?, resolved_revision_id = current_revision_id,
        resolved_at = ?, updated_at = ? WHERE thread_id = ? AND version = ? AND deleted_at IS NULL`)
        .run(actor, input.resolutionNote ?? null, now, now, input.threadId, row.version)
      if (changed.changes !== 1) throw new CommentDomainError('conflict', 'Comment thread changed')
      insertEvent(
        database,
        row.thread_id,
        'resolved',
        actor,
        now,
        row.current_revision_id,
        agent,
        {
          note: input.resolutionNote ?? null,
          ...(resolution === undefined ? {} : { operationId: resolution.operationId })
        },
        resolution?.proposalId
      )
    })
    return this.read(input.threadId)
  }

  reopen(input: ChangeCommentStatusInput): CommentThread {
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const row = requireMutableThread(database, input.threadId, input.expectedVersion)
      const changed = database
        .prepare(`UPDATE manuscript_comment_threads SET status = 'open', version = version + 1,
        resolved_by = NULL, resolution_note = NULL, resolved_revision_id = NULL, resolved_at = NULL, updated_at = ?
        WHERE thread_id = ? AND version = ? AND deleted_at IS NULL`)
        .run(now, row.thread_id, row.version)
      if (changed.changes !== 1) throw new CommentDomainError('conflict', 'Comment thread changed')
      insertEvent(database, row.thread_id, 'reopened', 'author', now, row.current_revision_id)
    })
    return this.read(input.threadId)
  }

  delete(input: DeleteCommentInput): void {
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const row = requireMutableThread(database, input.threadId, input.expectedVersion)
      const changed = database
        .prepare(`UPDATE manuscript_comment_threads SET deleted_at = ?, version = version + 1, updated_at = ?
        WHERE thread_id = ? AND version = ? AND deleted_at IS NULL`)
        .run(now, now, row.thread_id, row.version)
      if (changed.changes !== 1) throw new CommentDomainError('conflict', 'Comment thread changed')
      insertEvent(database, row.thread_id, 'deleted', 'author', now, row.current_revision_id)
    })
  }

  reanchor(input: ReanchorCommentInput): CommentThread {
    const parsed = reanchorCommentInputSchema.parse(input)
    const row = this.#database.immediate((database) =>
      requireMutableThread(database, parsed.threadId, parsed.expectedVersion)
    )
    const revision = this.#manuscript.getRevision(parsed.revisionId)
    const section = this.#manuscript.getSection(row.section_id)
    if (
      revision.sectionId !== row.section_id ||
      revision.contentHash !== parsed.contentHash ||
      section.currentRevisionId !== parsed.revisionId
    )
      throw new CommentDomainError(
        'conflict',
        'The selected manuscript revision is no longer current'
      )
    const segments = validateSegments(revision.content, parsed.segments)
    if (
      normalizeSelection(selectedText(revision.content, segments)) !==
      normalizeSelection(parsed.quote)
    )
      throw new CommentDomainError(
        'invalid_anchor',
        'The selected text does not match the saved revision'
      )
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const current = requireMutableThread(database, parsed.threadId, parsed.expectedVersion)
      const changed = database
        .prepare(`UPDATE manuscript_comment_threads SET quote = ?, anchor_json = ?,
          anchor_status = 'attached', current_revision_id = ?, version = version + 1, updated_at = ?
          WHERE thread_id = ? AND version = ? AND deleted_at IS NULL`)
        .run(
          parsed.quote,
          JSON.stringify(segments),
          parsed.revisionId,
          now,
          parsed.threadId,
          current.version
        )
      if (changed.changes !== 1) throw new CommentDomainError('conflict', 'Comment thread changed')
      insertEvent(
        database,
        parsed.threadId,
        'anchor_rebased',
        'author',
        now,
        parsed.revisionId,
        undefined,
        {
          reason: 'manual_reanchor'
        }
      )
    })
    return this.read(parsed.threadId)
  }

  delegate(input: DelegateCommentsInput): DelegateCommentsResult {
    const parsed = delegateCommentsInputSchema.parse(input)
    const threads = parsed.threadIds.map((threadId) => this.read(threadId))
    if (threads.some((thread) => thread.status !== 'open'))
      throw new CommentDomainError('conflict', 'Only open comments can be delegated')
    const ordered = [...threads].sort(
      (left, right) =>
        left.sectionTitle.localeCompare(right.sectionTitle) ||
        left.createdAt.localeCompare(right.createdAt)
    )
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      for (const thread of ordered)
        insertEvent(
          database,
          thread.threadId,
          'delegated',
          'author',
          now,
          thread.anchor.currentRevisionId,
          parsed.agentSessionId === undefined
            ? undefined
            : { sessionId: parsed.agentSessionId, runId: '' }
        )
    })
    return {
      orderedThreadIds: ordered.map((thread) => thread.threadId),
      prompt: `Address these manuscript comment threads in order: ${ordered.map((thread) => thread.threadId).join(', ')}. Read each current thread and its current section, use ordinary typed manuscript proposals for any edits, then after the applied revision is available read it again and either resolve with a concrete verification note or reply with what remains blocked.`
    }
  }

  readForAgent(threadId: string, agentRunId: string): CommentThread {
    const thread = this.read(threadId)
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      database
        .prepare(`INSERT INTO manuscript_comment_reads (
          agent_run_id, thread_id, thread_version, section_revision_id, section_read_revision_id, read_at
        ) VALUES (?, ?, ?, ?, NULL, ?) ON CONFLICT(agent_run_id, thread_id) DO UPDATE SET
        thread_version = excluded.thread_version, section_revision_id = excluded.section_revision_id,
        section_read_revision_id = NULL, read_at = excluded.read_at`)
        .run(agentRunId, threadId, thread.version, thread.anchor.currentRevisionId, now)
    })
    return thread
  }

  recordSectionRead(agentRunId: string, sectionId: string, revisionId: string): void {
    this.#database.immediate((database) => {
      database
        .prepare(`UPDATE manuscript_comment_reads SET section_read_revision_id = ?, read_at = ?
          WHERE agent_run_id = ? AND section_revision_id = ? AND thread_id IN (
            SELECT thread_id FROM manuscript_comment_threads
            WHERE section_id = ? AND deleted_at IS NULL
          )`)
        .run(revisionId, this.#now().toISOString(), agentRunId, revisionId, sectionId)
    })
  }

  listForAgent(input: Omit<ListCommentsInput, 'projectSessionId'>): ListCommentsResult {
    return this.list({ ...input, projectSessionId: this.#projectSessionId })
  }

  replyForAgent(
    input: Omit<ReplyCommentInput, 'projectSessionId'>,
    agent: { sessionId: string; runId: string }
  ): CommentThread {
    return this.reply({ ...input, projectSessionId: this.#projectSessionId }, 'agent', agent)
  }

  resolveForAgent(
    input: Omit<ChangeCommentStatusInput, 'projectSessionId'> & {
      operationId: string
      proposalId?: string
    },
    agent: { sessionId: string; runId: string }
  ): CommentThread {
    const existing = this.#database.immediate((database) =>
      database
        .prepare(
          `SELECT 1 FROM manuscript_comment_events
           WHERE thread_id = ? AND actor = 'agent' AND type = 'resolved'
             AND json_extract(payload_json, '$.operationId') = ?`
        )
        .get(input.threadId, input.operationId)
    )
    if (existing !== undefined) return this.read(input.threadId)
    if (input.proposalId !== undefined) {
      const proposal = this.#database.immediate((database) =>
        database
          .prepare(
            `SELECT status, applied_revision_id FROM mutation_proposals
             WHERE mutation_proposal_id = ? AND agent_session_id = ?`
          )
          .get(input.proposalId, agent.sessionId)
      ) as { status: string; applied_revision_id: string | null } | undefined
      if (
        proposal === undefined ||
        proposal.status !== 'applied' ||
        proposal.applied_revision_id === null
      )
        throw new CommentDomainError('conflict', 'The linked manuscript change is not applied')
      const thread = this.read(input.threadId)
      if (thread.anchor.currentRevisionId !== proposal.applied_revision_id)
        throw new CommentDomainError(
          'stale_read',
          'Read the manuscript revision produced by the linked change before resolving'
        )
    }
    const resolved = this.resolve(
      { ...input, projectSessionId: this.#projectSessionId },
      'agent',
      agent,
      { operationId: input.operationId, proposalId: input.proposalId }
    )
    return resolved
  }

  #refreshSectionAnchors(sectionId?: string): void {
    const ids = this.#database.immediate(
      (database) =>
        database
          .prepare(`SELECT thread_id FROM manuscript_comment_threads
      WHERE deleted_at IS NULL${sectionId === undefined ? '' : ' AND section_id = ?'}`)
          .all(...(sectionId === undefined ? [] : [sectionId])) as Array<{ thread_id: string }>
    )
    for (const { thread_id } of ids) this.#refreshThreadAnchor(thread_id)
  }

  #refreshThreadAnchor(threadId: string): void {
    this.#database.immediate((database) => {
      const row = database
        .prepare(
          'SELECT * FROM manuscript_comment_threads WHERE thread_id = ? AND deleted_at IS NULL'
        )
        .get(threadId) as ManuscriptCommentThreadTable | undefined
      if (row === undefined) return
      const section = this.#manuscript.getSection(row.section_id)
      if (section.currentRevisionId === row.current_revision_id && row.anchor_status === 'attached')
        return
      const revision = this.#manuscript.getRevision(section.currentRevisionId)
      const previous = commentAnchorSegmentSchema.array().parse(JSON.parse(row.anchor_json))
      const rebased = rebaseSegments(revision.content, previous, row.quote)
      const status = rebased === null ? 'orphaned' : 'attached'
      const segments = rebased ?? previous
      if (
        row.current_revision_id === revision.sectionRevisionId &&
        row.anchor_status === status &&
        JSON.stringify(previous) === JSON.stringify(segments)
      )
        return
      const now = this.#now().toISOString()
      database
        .prepare(`UPDATE manuscript_comment_threads SET anchor_status = ?, anchor_json = ?,
        current_revision_id = ?, version = version + 1, updated_at = ? WHERE thread_id = ? AND current_revision_id = ?`)
        .run(
          status,
          JSON.stringify(segments),
          revision.sectionRevisionId,
          now,
          threadId,
          row.current_revision_id
        )
      insertEvent(
        database,
        threadId,
        status === 'attached' ? 'anchor_rebased' : 'anchor_orphaned',
        'system',
        now,
        revision.sectionRevisionId
      )
    })
  }
}

function threadFromRow(
  row: ThreadJoinedRow,
  messages: ManuscriptCommentMessageTable[]
): Record<string, unknown> {
  return {
    threadId: row.thread_id,
    sectionId: row.section_id,
    sectionTitle: row.section_title,
    status: row.status,
    version: row.version,
    anchor: {
      status: row.anchor_status,
      quote: row.quote,
      createdRevisionId: row.created_revision_id,
      currentRevisionId: row.current_revision_id,
      segments: JSON.parse(row.anchor_json)
    },
    messages: messages.map((message) => ({
      messageId: message.message_id,
      author: message.author,
      body: message.body,
      agentSessionId: message.agent_session_id,
      agentRunId: message.agent_run_id,
      createdAt: message.created_at,
      updatedAt: message.updated_at
    })),
    resolvedBy: row.resolved_by,
    resolutionNote: row.resolution_note,
    resolvedRevisionId: row.resolved_revision_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at
  }
}

function requireMutableThread(
  database: Parameters<ProjectDatabase['immediate']>[0] extends (db: infer T) => unknown
    ? T
    : never,
  threadId: string,
  version: number
): ManuscriptCommentThreadTable {
  const row = database
    .prepare('SELECT * FROM manuscript_comment_threads WHERE thread_id = ? AND deleted_at IS NULL')
    .get(threadId) as ManuscriptCommentThreadTable | undefined
  if (row === undefined) throw new CommentDomainError('not_found', 'Comment thread does not exist')
  if (row.version !== version) throw new CommentDomainError('conflict', 'Comment thread changed')
  return row
}

type NativeDatabase = Parameters<Parameters<ProjectDatabase['immediate']>[0]>[0]

function bumpThread(
  database: NativeDatabase,
  threadId: string,
  version: number,
  now: string
): void {
  const changed = database
    .prepare(
      'UPDATE manuscript_comment_threads SET version = version + 1, updated_at = ? WHERE thread_id = ? AND version = ? AND deleted_at IS NULL'
    )
    .run(now, threadId, version)
  if (changed.changes !== 1) throw new CommentDomainError('conflict', 'Comment thread changed')
}

function insertEvent(
  database: NativeDatabase,
  threadId: string,
  type: ManuscriptCommentEventType,
  actor: 'author' | 'agent' | 'system',
  now: string,
  revisionId: string | null,
  agent?: { sessionId: string; runId: string },
  payload: object = {},
  proposalId?: string
): void {
  database
    .prepare(`INSERT INTO manuscript_comment_events (
    event_id, thread_id, type, actor, agent_session_id, agent_run_id, section_revision_id,
    proposal_id, payload_json, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      randomUUID(),
      threadId,
      type,
      actor,
      agent?.sessionId || null,
      agent?.runId || null,
      revisionId,
      proposalId ?? null,
      JSON.stringify(payload),
      now
    )
}

type ManuscriptCommentEventType =
  | 'created'
  | 'replied'
  | 'edited'
  | 'deleted'
  | 'resolved'
  | 'reopened'
  | 'delegated'
  | 'verified'
  | 'anchor_rebased'
  | 'anchor_orphaned'

function validateSegments(
  content: BlockNoteDocument,
  segments: CommentAnchorSegment[]
): CommentAnchorSegment[] {
  const blocks = blockTextMap(content)
  return segments.map((value) => {
    const segment = commentAnchorSegmentSchema.parse(value)
    const text = blocks.get(segment.blockId)
    if (text === undefined || segment.to > text.length)
      throw new CommentDomainError('invalid_anchor', 'Comment anchor is outside the selected block')
    return segment
  })
}

function selectedText(content: BlockNoteDocument, segments: CommentAnchorSegment[]): string {
  const blocks = blockTextMap(content)
  return segments
    .map((segment) => blocks.get(segment.blockId)?.slice(segment.from, segment.to) ?? '')
    .join('\n')
}

function rebaseSegments(
  content: BlockNoteDocument,
  previous: CommentAnchorSegment[],
  quote: string
): CommentAnchorSegment[] | null {
  const blocks = blockTextMap(content)
  const exact = previous.every(
    (segment) =>
      blocks.get(segment.blockId)?.slice(segment.from, segment.to).length ===
      segment.to - segment.from
  )
    ? selectedText(content, previous)
    : ''
  if (normalizeSelection(exact) === normalizeSelection(quote)) return previous
  if (previous.length !== 1) return null
  const text = blocks.get(previous[0].blockId)
  if (text === undefined) return null
  const first = text.indexOf(quote)
  if (first < 0 || text.indexOf(quote, first + 1) >= 0) return null
  return [{ blockId: previous[0].blockId, from: first, to: first + quote.length }]
}

function blockTextMap(content: BlockNoteDocument): Map<string, string> {
  const output = new Map<string, string>()
  const visit = (blocks: BlockNoteDocument): void => {
    for (const block of blocks) {
      if (Array.isArray(block.content))
        output.set(block.id, blockNoteInlinePlainText(block.content))
      if (block.children.length > 0) visit(block.children)
    }
  }
  visit(content)
  return output
}

function normalizeSelection(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`)
}
