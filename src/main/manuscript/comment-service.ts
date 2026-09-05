import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { blockNoteInlinePlainText } from '../../shared/blocknote-inline-text'
import type { ReadSectionResult, ReadSectionArgs } from '../../shared/contracts/agent-tools'
import { updateCommentAnchors } from './comment-anchor-mapping'
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
    readonly code: 'not_found' | 'conflict' | 'invalid_anchor' | 'stale_read' | 'unauthorized',
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
          ORDER BY s.position, t.created_at, t.thread_id`)
        .all(...params) as Array<
        ThreadJoinedRow & { message_count: number; latest_message_preview: string }
      >
      const ranks = new Map(
        orderThreads(
          this.#manuscript,
          rows.map((row) => commentThreadSchema.parse(threadFromRow(row, [])))
        ).map((thread, index) => [thread.threadId, index])
      )
      rows.sort((a, b) => (ranks.get(a.thread_id) ?? 0) - (ranks.get(b.thread_id) ?? 0))
      const page = rows.slice(safeOffset, safeOffset + parsed.limit)
      return {
        threads: page.map((row) => {
          const { messages: _messages, ...thread } = threadFromRow(row, [])
          return commentThreadSummarySchema.parse({
            ...thread,
            activity: commentActivity(database, row.thread_id),
            messageCount: row.message_count,
            latestMessagePreview: row.latest_message_preview.slice(0, 500)
          })
        }),
        nextCursor:
          rows.length > safeOffset + parsed.limit ? String(safeOffset + parsed.limit) : null
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
      return commentThreadSchema.parse({
        ...threadFromRow(row, messages),
        events: commentEvents(database, threadId),
        activity: commentActivity(database, threadId)
      })
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
    this.#log.info(
      {
        event: 'manuscript.comment.replied',
        threadId: parsed.threadId,
        actor,
        agentRunId: agent?.runId
      },
      'Comment reply recorded'
    )
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
    resolution?: { operationId: string; proposalId?: string; modelRequestId: string }
  ): CommentThread {
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const row = requireMutableThread(database, input.threadId, input.expectedVersion)
      if (actor === 'agent') {
        if (agent === undefined || resolution === undefined)
          throw new CommentDomainError('unauthorized', 'Agent context is required')
        assertAgentScope(database, input.threadId, agent)
        const receipt = database
          .prepare(`SELECT thread_version, section_revision_id, section_read_revision_id, model_request_id, section_model_request_id FROM manuscript_comment_reads
          WHERE agent_run_id = ? AND thread_id = ?`)
          .get(agent?.runId, input.threadId) as
          | {
              thread_version: number
              section_revision_id: string
              section_read_revision_id: string | null
              model_request_id: string | null
              section_model_request_id: string | null
            }
          | undefined
        if (
          receipt?.thread_version !== row.version ||
          receipt.section_revision_id !== row.current_revision_id ||
          receipt.section_read_revision_id !== row.current_revision_id ||
          receipt.model_request_id === null ||
          receipt.section_model_request_id === null ||
          receipt.model_request_id === resolution.modelRequestId ||
          receipt.section_model_request_id === resolution.modelRequestId
        ) {
          throw new CommentDomainError(
            'stale_read',
            'Read the current thread and all section blocks, then verify in a subsequent model request before resolving'
          )
        }
        const linked = database
          .prepare(`SELECT p.* FROM mutation_proposals p
          JOIN manuscript_comment_changes c ON c.proposal_id = p.mutation_proposal_id
          WHERE c.thread_id = ? AND p.agent_session_id = ? ORDER BY p.created_at DESC, p.rowid DESC`)
          .all(row.thread_id, agent.sessionId) as Array<{
          mutation_proposal_id: string
          status: string
          applied_revision_id: string | null
        }>
        if (linked.length > 0 && linked[0].status !== 'applied')
          throw new CommentDomainError(
            'conflict',
            'The latest linked change must be applied before resolution'
          )
        resolution.proposalId ??= linked[0]?.mutation_proposal_id
        if (resolution.proposalId !== undefined) {
          const proposal = database
            .prepare(`SELECT status, applied_revision_id FROM mutation_proposals
            WHERE mutation_proposal_id = ? AND agent_session_id = ?`)
            .get(resolution.proposalId, agent.sessionId) as
            | { status: string; applied_revision_id: string | null }
            | undefined
          if (
            proposal?.status !== 'applied' ||
            proposal.applied_revision_id !== row.current_revision_id
          )
            throw new CommentDomainError(
              'conflict',
              'The linked change is not applied to the current section revision'
            )
        }
        if (
          row.anchor_status === 'orphaned' &&
          !isVerifiedDeletion(database, row, resolution.proposalId)
        )
          throw new CommentDomainError(
            'invalid_anchor',
            'Relink the lost anchor before resolving; only an applied deletion with preserved anchor evidence is exempt'
          )
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
    this.#log.info(
      {
        event: 'manuscript.comment.resolved',
        threadId: input.threadId,
        actor,
        agentRunId: agent?.runId
      },
      'Comment resolved'
    )
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
        .prepare(`UPDATE manuscript_comment_threads SET quote = ?, anchor_json = ?, anchor_revision_id = current_revision_id,
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
    const ordered = orderThreads(this.#manuscript, threads)
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const session = database
        .prepare(
          'SELECT interaction_mode, archived_at FROM agent_sessions WHERE agent_session_id = ?'
        )
        .get(parsed.agentSessionId) as
        | { interaction_mode: string; archived_at: string | null }
        | undefined
      if (session?.interaction_mode !== 'write' || session.archived_at !== null)
        throw new CommentDomainError(
          'unauthorized',
          'Select an active Write conversation before delegating comments'
        )
      const active = database
        .prepare(
          "SELECT 1 FROM agent_runs WHERE agent_session_id = ? AND status IN ('running', 'awaiting_review', 'awaiting_user')"
        )
        .get(parsed.agentSessionId)
      if (active !== undefined)
        throw new CommentDomainError(
          'conflict',
          'Finish or resume the active work before changing comment scope'
        )
      database
        .prepare('DELETE FROM manuscript_comment_delegations WHERE agent_session_id = ?')
        .run(parsed.agentSessionId)
      for (const thread of ordered) {
        database
          .prepare(
            'INSERT INTO manuscript_comment_delegations (agent_session_id, thread_id, delegated_at) VALUES (?, ?, ?)'
          )
          .run(parsed.agentSessionId, thread.threadId, now)
        insertEvent(
          database,
          thread.threadId,
          'delegated',
          'author',
          now,
          thread.anchor.currentRevisionId,
          { sessionId: parsed.agentSessionId, runId: '' }
        )
      }
    })
    this.#log.info(
      {
        event: 'manuscript.comment.delegated',
        agentSessionId: parsed.agentSessionId,
        count: ordered.length
      },
      'Comments delegated'
    )
    return {
      orderedThreadIds: ordered.map((thread) => thread.threadId),
      prompt: `Address these manuscript comment threads in order: ${ordered.map((thread) => thread.threadId).join(', ')}. Read each thread immediately before its work. Use ordinary proposals for edits. After application, read the thread and all current section blocks (paginate; read canonical or all fragments for truncated blocks). In a subsequent model request resolve with concrete evidence and the proposal ID, or reply with what remains blocked. Do not include other threads.`
    }
  }

  readForAgent(threadId: string, agentRunId: string, modelRequestId: string): CommentThread {
    const thread = this.read(threadId)
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      database
        .prepare('DELETE FROM manuscript_comment_reads WHERE agent_run_id = ? AND thread_id = ?')
        .run(agentRunId, threadId)
      database
        .prepare(`INSERT INTO manuscript_comment_reads (
        agent_run_id, thread_id, thread_version, section_revision_id, section_read_revision_id, read_at, model_request_id
      ) VALUES (?, ?, ?, ?, NULL, ?, ?)`)
        .run(
          agentRunId,
          threadId,
          thread.version,
          thread.anchor.currentRevisionId,
          now,
          modelRequestId
        )
      database
        .prepare(
          `UPDATE manuscript_comment_delegations SET agent_run_id = ? WHERE thread_id = ? AND agent_session_id = (SELECT agent_session_id FROM agent_runs WHERE agent_run_id = ?)`
        )
        .run(agentRunId, threadId, agentRunId)
    })
    return thread
  }

  recordSectionRead(
    agentRunId: string,
    modelRequestId: string,
    result: ReadSectionResult,
    args: ReadSectionArgs
  ): void {
    const revision = this.#manuscript.getRevision(result.revisionId)
    const blocks = new Map<string, { json: string }>()
    const visit = (content: BlockNoteDocument): void => {
      for (const block of content) {
        blocks.set(block.id, { json: JSON.stringify(block) })
        visit(block.children)
      }
    }
    visit(revision.content)
    this.#database.immediate((database) => {
      const receipts = database
        .prepare(`SELECT thread_id, covered_blocks_json, fragment_ranges_json FROM manuscript_comment_reads
        WHERE agent_run_id = ? AND section_revision_id = ?`)
        .all(agentRunId, result.revisionId) as Array<{
        thread_id: string
        covered_blocks_json: string
        fragment_ranges_json: string
      }>
      for (const receipt of receipts) {
        const covered = new Set<string>(JSON.parse(receipt.covered_blocks_json))
        const fragments = JSON.parse(receipt.fragment_ranges_json) as Record<
          string,
          Array<[number, number]>
        >
        for (const block of result.blocks)
          if (!block.textTruncated && blocks.has(block.blockId)) covered.add(block.blockId)
        if (
          args.view === 'canonical' &&
          result.canonicalBlock != null &&
          JSON.stringify(result.canonicalBlock) === blocks.get(args.blockId)?.json
        )
          covered.add(args.blockId)
        if (
          args.view === 'fragment' &&
          result.canonicalFragment !== null &&
          blocks.has(args.blockId)
        ) {
          const ranges = [
            ...(fragments[args.blockId] ?? []),
            [args.offset, args.offset + result.canonicalFragment.length] as [number, number]
          ].sort((a, b) => a[0] - b[0])
          const merged: Array<[number, number]> = []
          for (const range of ranges) {
            const last = merged.at(-1)
            if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
            else merged.push(range)
          }
          fragments[args.blockId] = merged
          if (
            merged[0]?.[0] === 0 &&
            merged[0][1] >= (blocks.get(args.blockId)?.json.length ?? Infinity)
          )
            covered.add(args.blockId)
        }
        const complete =
          [...blocks.keys()].every((id) => covered.has(id)) &&
          (blocks.size > 0 ||
            (args.view === 'summary' && args.blockIds === undefined && args.cursor === undefined))
        database
          .prepare(
            `UPDATE manuscript_comment_reads SET covered_blocks_json = ?, fragment_ranges_json = ?, section_read_revision_id = ?, section_model_request_id = ?, read_at = ? WHERE agent_run_id = ? AND thread_id = ?`
          )
          .run(
            JSON.stringify([...covered]),
            JSON.stringify(fragments),
            complete ? result.revisionId : null,
            complete ? modelRequestId : null,
            this.#now().toISOString(),
            agentRunId,
            receipt.thread_id
          )
      }
    })
  }

  linkProposedChange(agentRunId: string, sectionId: string, proposalId: string): void {
    this.#database.immediate((database) => {
      const receipt = database
        .prepare(`SELECT r.thread_id FROM manuscript_comment_reads r
        JOIN manuscript_comment_threads t ON t.thread_id = r.thread_id
        JOIN agent_runs a ON a.agent_run_id = r.agent_run_id
        JOIN manuscript_comment_delegations d ON d.thread_id = r.thread_id AND d.agent_session_id = a.agent_session_id
        WHERE r.agent_run_id = ? AND t.section_id = ? ORDER BY r.read_at DESC, r.rowid DESC LIMIT 1`)
        .get(agentRunId, sectionId) as { thread_id: string } | undefined
      if (receipt !== undefined)
        database
          .prepare(
            'INSERT OR IGNORE INTO manuscript_comment_changes (thread_id, proposal_id) VALUES (?, ?)'
          )
          .run(receipt.thread_id, proposalId)
    })
  }

  listForAgent(input: Omit<ListCommentsInput, 'projectSessionId'>): ListCommentsResult {
    return this.list({ ...input, projectSessionId: this.#projectSessionId })
  }

  replyForAgent(
    input: Omit<ReplyCommentInput, 'projectSessionId'>,
    agent: { sessionId: string; runId: string }
  ): CommentThread {
    this.#database.immediate((database) => assertAgentScope(database, input.threadId, agent))
    return this.reply({ ...input, projectSessionId: this.#projectSessionId }, 'agent', agent)
  }

  resolveForAgent(
    input: Omit<ChangeCommentStatusInput, 'projectSessionId'> & {
      operationId: string
      proposalId?: string
    },
    agent: { sessionId: string; runId: string; modelRequestId: string }
  ): CommentThread {
    this.#database.immediate((database) => assertAgentScope(database, input.threadId, agent))
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
    const resolved = this.resolve(
      { ...input, projectSessionId: this.#projectSessionId },
      'agent',
      agent,
      {
        operationId: input.operationId,
        proposalId: input.proposalId,
        modelRequestId: agent.modelRequestId
      }
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
          'SELECT section_id FROM manuscript_comment_threads WHERE thread_id = ? AND deleted_at IS NULL'
        )
        .get(threadId) as { section_id: string } | undefined
      if (row !== undefined) updateCommentAnchors(database, row.section_id)
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

function assertAgentScope(
  database: NativeDatabase,
  threadId: string,
  agent: { sessionId: string; runId: string }
): void {
  const run = database
    .prepare(
      `SELECT interaction_mode, status FROM agent_runs WHERE agent_run_id = ? AND agent_session_id = ?`
    )
    .get(agent.runId, agent.sessionId) as { interaction_mode: string; status: string } | undefined
  const delegated = database
    .prepare(
      `SELECT 1 FROM manuscript_comment_delegations WHERE agent_session_id = ? AND thread_id = ?`
    )
    .get(agent.sessionId, threadId)
  if (run?.interaction_mode !== 'write' || run.status !== 'running' || delegated === undefined)
    throw new CommentDomainError(
      'unauthorized',
      'This active Write run may only change explicitly delegated comment threads'
    )
  database
    .prepare(
      'UPDATE manuscript_comment_delegations SET agent_run_id = ? WHERE agent_session_id = ? AND thread_id = ?'
    )
    .run(agent.runId, agent.sessionId, threadId)
}

function isVerifiedDeletion(
  database: NativeDatabase,
  row: ManuscriptCommentThreadTable,
  proposalId?: string
): boolean {
  if (proposalId === undefined) return false
  const proposal = database
    .prepare(`SELECT p.base_revision_id, r.content_json, b.content_json AS base_content_json FROM mutation_proposals p
    JOIN section_revisions r ON r.section_revision_id = p.applied_revision_id
    JOIN section_revisions b ON b.section_revision_id = p.base_revision_id
    WHERE p.mutation_proposal_id = ? AND p.status = 'applied'`)
    .get(proposalId) as
    | { base_revision_id: string; content_json: string; base_content_json: string }
    | undefined
  if (proposal === undefined) return false
  const history = database
    .prepare(
      `SELECT anchor_json FROM manuscript_comment_anchor_history WHERE thread_id = ? AND revision_id = ? AND anchor_status = 'attached'`
    )
    .get(row.thread_id, proposal.base_revision_id) as { anchor_json: string } | undefined
  if (history === undefined) return false
  const segments = commentAnchorSegmentSchema.array().parse(JSON.parse(history.anchor_json))
  const remaining = blockTextMap(JSON.parse(proposal.content_json))
  const previous = blockTextMap(JSON.parse(proposal.base_content_json))
  const expected = new Map(previous)
  for (const segment of [...segments].sort((a, b) => b.from - a.from)) {
    const text = expected.get(segment.blockId)
    if (text === undefined) return false
    expected.set(segment.blockId, text.slice(0, segment.from) + text.slice(segment.to))
  }
  return segments.every(
    (segment) =>
      !remaining.has(segment.blockId) ||
      remaining.get(segment.blockId) === expected.get(segment.blockId)
  )
}

function commentEvents(database: NativeDatabase, threadId: string): unknown[] {
  const rows = database
    .prepare(
      `SELECT * FROM (SELECT *, rowid AS event_order FROM manuscript_comment_events WHERE thread_id = ? ORDER BY rowid DESC LIMIT 500) ORDER BY event_order`
    )
    .all(threadId) as Array<{
    event_id: string
    type: string
    actor: string
    agent_session_id: string | null
    agent_run_id: string | null
    proposal_id: string | null
    section_revision_id: string | null
    payload_json: string
    created_at: string
  }>
  return rows.map((row) => {
    const payload = JSON.parse(row.payload_json) as { note?: string; reason?: string }
    return {
      eventId: row.event_id,
      type: row.type,
      actor: row.actor,
      agentSessionId: row.agent_session_id,
      agentRunId: row.agent_run_id,
      proposalId: row.proposal_id,
      sectionRevisionId: row.section_revision_id,
      note: payload.note ?? payload.reason ?? null,
      createdAt: row.created_at
    }
  })
}

function commentActivity(database: NativeDatabase, threadId: string): unknown {
  const delegation = database
    .prepare(`SELECT d.agent_session_id, d.agent_run_id, r.status FROM manuscript_comment_delegations d
    LEFT JOIN agent_runs r ON r.agent_run_id = d.agent_run_id WHERE d.thread_id = ? ORDER BY d.delegated_at DESC LIMIT 1`)
    .get(threadId) as
    | { agent_session_id: string; agent_run_id: string | null; status: string | null }
    | undefined
  if (delegation === undefined) return null
  const proposal = database
    .prepare(`SELECT p.mutation_proposal_id, p.status FROM manuscript_comment_changes c
    JOIN mutation_proposals p ON p.mutation_proposal_id = c.proposal_id WHERE c.thread_id = ? AND p.agent_session_id = ? ORDER BY p.rowid DESC LIMIT 1`)
    .get(threadId, delegation.agent_session_id) as
    | { mutation_proposal_id: string; status: string }
    | undefined
  return {
    agentSessionId: delegation.agent_session_id,
    agentRunId: delegation.agent_run_id,
    status:
      proposal?.status === 'pending' || proposal?.status === 'approved'
        ? 'awaiting_review'
        : (delegation.status ?? 'delegated'),
    proposalId: proposal?.mutation_proposal_id ?? null
  }
}

function orderThreads<
  T extends {
    sectionId: string
    anchor: { segments: CommentAnchorSegment[] }
    createdAt: string
    threadId: string
  }
>(manuscript: ManuscriptService, threads: T[]): T[] {
  const sections = manuscript.assemble().sections
  const ranks = new Map(sections.map((entry, index) => [entry.section.sectionId, index]))
  const blockRanks = new Map<string, Map<string, number>>()
  for (const entry of sections)
    blockRanks.set(
      entry.section.sectionId,
      new Map([...blockTextMap(entry.revision.content).keys()].map((id, index) => [id, index]))
    )
  return [...threads].sort(
    (a, b) =>
      (ranks.get(a.sectionId) ?? 0) - (ranks.get(b.sectionId) ?? 0) ||
      (blockRanks.get(a.sectionId)?.get(a.anchor.segments[0]?.blockId) ?? Infinity) -
        (blockRanks.get(b.sectionId)?.get(b.anchor.segments[0]?.blockId) ?? Infinity) ||
      (a.anchor.segments[0]?.from ?? 0) - (b.anchor.segments[0]?.from ?? 0) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.threadId.localeCompare(b.threadId)
  )
}
