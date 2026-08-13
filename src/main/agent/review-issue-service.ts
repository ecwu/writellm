import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import {
  listReviewIssuesArgsSchema,
  listReviewIssuesResultSchema,
  recordReviewIssuesArgsSchema,
  recordReviewIssuesResultSchema,
  reviewIssueEventSchema,
  reviewIssueRecordSchema,
  reviewIssueUserOperationSchema,
  updateReviewIssuesArgsSchema,
  updateReviewIssuesResultSchema,
  type ReviewIssueEvent,
  type ReviewIssueRecord,
  type ReviewIssueStatus,
  type ReviewIssueUserOperation
} from '../../shared/contracts/review'
import {
  blockNoteDocumentSchema,
  type BlockNoteBlockValue
} from '../../shared/contracts/manuscript'
import type { ProjectDatabase } from '../project/project-database'
import type { ReviewIssueTable } from '../project/database-types'
import type { WritingSnapshot } from './context'
import { AgentToolDomainError } from './read-tools'

interface AgentActor {
  agentSessionId: string
  agentRunId: string
}

export class ReviewIssueService {
  constructor(
    private readonly options: {
      database: ProjectDatabase
      log: Pick<Logger, 'info' | 'error'>
      now?: () => Date
      createId?: () => string
    }
  ) {}

  list(rawArgs: unknown): ReturnType<typeof listReviewIssuesResultSchema.parse> {
    const args = listReviewIssuesArgsSchema.parse(rawArgs)
    const offset = decodeCursor(args.cursor)
    const conditions: string[] = []
    const parameters: unknown[] = []
    appendInFilter(conditions, parameters, 'status', args.statuses)
    appendInFilter(conditions, parameters, 'priority', args.priorities)
    appendInFilter(conditions, parameters, 'category', args.categories)
    if (args.sectionId !== undefined) {
      conditions.push('section_id = ?')
      parameters.push(args.sectionId)
    }
    const where = conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`
    return this.options.database.immediate((database) => {
      const total = (
        database
          .prepare(`SELECT COUNT(*) AS count FROM review_issues ${where}`)
          .get(...parameters) as { count: number }
      ).count
      const rows = database
        .prepare(
          `SELECT * FROM review_issues ${where}
            ORDER BY CASE priority WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,
                     updated_at DESC, review_issue_id
            LIMIT ? OFFSET ?`
        )
        .all(...parameters, args.limit, offset) as ReviewIssueTable[]
      return listReviewIssuesResultSchema.parse({
        issues: rows.map((row) => mapIssue(database, row)),
        nextCursor: offset + rows.length < total ? encodeCursor(offset + rows.length) : null,
        total
      })
    })
  }

  events(issueId: string): ReviewIssueEvent[] {
    return this.options.database.immediate((database) =>
      database
        .prepare(
          `SELECT * FROM review_issue_events WHERE review_issue_id = ?
            ORDER BY rowid`
        )
        .all(issueId)
        .map((row) => mapEvent(row as Record<string, unknown>))
    )
  }

  record(rawArgs: unknown, actor: AgentActor, snapshot: WritingSnapshot) {
    const args = recordReviewIssuesArgsSchema.parse(rawArgs)
    const startedAt = Date.now()
    try {
      const result = this.options.database.immediate((database) => {
        assertCitationsWereRead(
          database,
          actor,
          args.issues.flatMap((issue) => issue.citationIds)
        )
        const currentRunCount = (
          database
            .prepare(
              `SELECT COUNT(*) AS count FROM review_issue_events
               WHERE event_type = 'created' AND actor_agent_run_id = ?`
            )
            .get(actor.agentRunId) as { count: number }
        ).count
        let created = 0
        let refreshed = 0
        let deduplicated = 0
        let truncated = false
        const issues: ReviewIssueRecord[] = []
        for (const candidate of args.issues) {
          assertAnchorInSnapshot(candidate.anchor, snapshot)
          const fingerprint = issueFingerprint(candidate)
          if (candidate.existingIssueId !== undefined) {
            const existing = requireIssue(database, candidate.existingIssueId)
            assertExpectedVersion(existing, candidate.expectedVersion as number)
            updateIssueEvidence(database, existing, candidate, fingerprint, actor, this.#now())
            refreshed += 1
            issues.push(mapIssue(database, requireIssue(database, existing.review_issue_id)))
            continue
          }
          const exact = database
            .prepare('SELECT * FROM review_issues WHERE fingerprint = ?')
            .get(fingerprint) as ReviewIssueTable | undefined
          if (exact !== undefined) {
            deduplicated += 1
            issues.push(mapIssue(database, exact))
            continue
          }
          if (currentRunCount + created >= 100) {
            truncated = true
            break
          }
          const issueId = this.#createId()
          const now = this.#now()
          database
            .prepare(
              `INSERT INTO review_issues (
                 review_issue_id, fingerprint, priority, category, title, description,
                 evidence_summary, citation_ids_json, source_kind, check_id, section_id,
                 revision_id, block_id, source_agent_session_id, source_agent_run_id, status,
                 assigned_agent_session_id, version, resolved_by_proposal_id, resolution_summary,
                 created_at, updated_at, resolved_at, dismissed_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', NULL, 1,
                         NULL, NULL, ?, ?, NULL, NULL)`
            )
            .run(
              issueId,
              fingerprint,
              candidate.priority,
              candidate.category,
              candidate.title,
              candidate.description,
              candidate.evidence,
              JSON.stringify(candidate.citationIds),
              candidate.sourceKind,
              candidate.checkId,
              candidate.anchor?.sectionId ?? null,
              candidate.anchor?.revisionId ?? null,
              candidate.anchor?.blockId ?? null,
              actor.agentSessionId,
              actor.agentRunId,
              now,
              now
            )
          insertEvent(
            database,
            this.#createId(),
            issueId,
            'created',
            null,
            'open',
            'agent',
            actor,
            null,
            null,
            now
          )
          created += 1
          issues.push(mapIssue(database, requireIssue(database, issueId)))
        }
        return recordReviewIssuesResultSchema.parse({
          issues,
          created,
          refreshed,
          deduplicated,
          truncated
        })
      })
      this.options.log.info(
        {
          event: 'review.issues.recorded',
          agentRunId: actor.agentRunId,
          created: result.created,
          refreshed: result.refreshed,
          deduplicated: result.deduplicated,
          truncated: result.truncated,
          durationMs: Date.now() - startedAt
        },
        'Review issues recorded'
      )
      return result
    } catch (err) {
      this.options.log.error(
        { event: 'review.issues.record_failed', err, agentRunId: actor.agentRunId },
        'Review issue recording failed'
      )
      throw err
    }
  }

  update(rawArgs: unknown, actor: AgentActor) {
    const args = updateReviewIssuesArgsSchema.parse(rawArgs)
    return this.options.database.immediate((database) => {
      const issues = args.operations.map((operation) => {
        const existing = requireIssue(database, operation.issueId)
        assertExpectedVersion(existing, operation.expectedVersion)
        const now = this.#now()
        const next = agentTransition(existing, operation, actor.agentSessionId)
        database
          .prepare(
            `UPDATE review_issues SET status = ?, assigned_agent_session_id = ?, version = version + 1,
               resolution_summary = ?, resolved_by_proposal_id = NULL, resolved_at = ?,
               dismissed_at = NULL, updated_at = ? WHERE review_issue_id = ? AND version = ?`
          )
          .run(
            next.status,
            next.assigned,
            next.summary,
            next.status === 'resolved' ? now : null,
            now,
            existing.review_issue_id,
            existing.version
          )
        insertEvent(
          database,
          this.#createId(),
          existing.review_issue_id,
          next.event,
          existing.status,
          next.status,
          'agent',
          actor,
          null,
          next.summary,
          now
        )
        return mapIssue(database, requireIssue(database, existing.review_issue_id))
      })
      this.options.log.info(
        { event: 'review.issues.updated', agentRunId: actor.agentRunId, count: issues.length },
        'Review issues updated'
      )
      return updateReviewIssuesResultSchema.parse({ issues })
    })
  }

  updateByUser(rawOperation: unknown): ReviewIssueRecord {
    const operation = reviewIssueUserOperationSchema.parse(rawOperation)
    return this.options.database.immediate((database) => {
      const existing = requireIssue(database, operation.issueId)
      assertExpectedVersion(existing, operation.expectedVersion)
      const now = this.#now()
      if (operation.action === 'setPriority') {
        database
          .prepare(
            'UPDATE review_issues SET priority = ?, version = version + 1, updated_at = ? WHERE review_issue_id = ? AND version = ?'
          )
          .run(operation.priority, now, existing.review_issue_id, existing.version)
        insertEvent(
          database,
          this.#createId(),
          existing.review_issue_id,
          'priority_changed',
          existing.status,
          existing.status,
          'user',
          null,
          null,
          null,
          now
        )
      } else {
        const next = userTransition(existing, operation)
        database
          .prepare(
            `UPDATE review_issues SET status = ?, assigned_agent_session_id = NULL,
               version = version + 1, resolution_summary = ?, resolved_by_proposal_id = NULL,
               resolved_at = NULL, dismissed_at = ?, updated_at = ?
             WHERE review_issue_id = ? AND version = ?`
          )
          .run(
            next.status,
            next.summary,
            next.status === 'dismissed' ? now : null,
            now,
            existing.review_issue_id,
            existing.version
          )
        insertEvent(
          database,
          this.#createId(),
          existing.review_issue_id,
          next.event,
          existing.status,
          next.status,
          'user',
          null,
          null,
          next.summary,
          now
        )
      }
      return mapIssue(database, requireIssue(database, existing.review_issue_id))
    })
  }

  validateResolutionTargets(
    targets: readonly { issueId: string; expectedVersion: number; resolutionSummary: string }[],
    agentSessionId: string
  ): void {
    this.options.database.immediate((database) => {
      for (const target of targets) {
        const issue = requireIssue(database, target.issueId)
        assertExpectedVersion(issue, target.expectedVersion)
        if (issue.status !== 'in_progress' || issue.assigned_agent_session_id !== agentSessionId) {
          throw new AgentToolDomainError(
            'conflict',
            'Every linked review issue must be claimed by this conversation'
          )
        }
      }
    })
  }

  linkProposal(
    proposalId: string,
    targets: readonly { issueId: string; expectedVersion: number; resolutionSummary: string }[],
    actor: AgentActor
  ): string[] {
    const warnings: string[] = []
    this.options.database.immediate((database) => {
      const now = this.#now()
      for (const target of targets) {
        const issue = requireIssue(database, target.issueId)
        if (
          issue.version !== target.expectedVersion ||
          issue.status !== 'in_progress' ||
          issue.assigned_agent_session_id !== actor.agentSessionId
        ) {
          warnings.push(`Review issue ${target.issueId} changed before proposal linkage.`)
          continue
        }
        insertEvent(
          database,
          this.#createId(),
          issue.review_issue_id,
          'proposal_linked',
          issue.status,
          issue.status,
          'agent',
          actor,
          proposalId,
          target.resolutionSummary,
          now
        )
      }
    })
    return warnings
  }

  resolveForProposal(
    proposalId: string,
    targets: readonly { issueId: string; expectedVersion: number; resolutionSummary: string }[],
    actor: AgentActor
  ): string[] {
    const warnings: string[] = []
    try {
      this.options.database.immediate((database) => {
        const now = this.#now()
        for (const target of targets) {
          const issue = requireIssue(database, target.issueId)
          if (
            issue.version !== target.expectedVersion ||
            issue.status !== 'in_progress' ||
            issue.assigned_agent_session_id !== actor.agentSessionId
          ) {
            warnings.push(`Review issue ${target.issueId} changed and was not resolved.`)
            continue
          }
          database
            .prepare(
              `UPDATE review_issues SET status = 'resolved', assigned_agent_session_id = NULL,
                 version = version + 1, resolved_by_proposal_id = ?, resolution_summary = ?,
                 resolved_at = ?, dismissed_at = NULL, updated_at = ?
               WHERE review_issue_id = ? AND version = ?`
            )
            .run(
              proposalId,
              target.resolutionSummary,
              now,
              now,
              issue.review_issue_id,
              issue.version
            )
          insertEvent(
            database,
            this.#createId(),
            issue.review_issue_id,
            'resolved',
            issue.status,
            'resolved',
            'system',
            actor,
            proposalId,
            target.resolutionSummary,
            now
          )
        }
      })
      this.options.log.info(
        { event: 'review.proposal.reconciled', proposalId, warningCount: warnings.length },
        'Review issues reconciled with proposal'
      )
    } catch (err) {
      this.options.log.error(
        { event: 'review.proposal.reconcile_failed', err, proposalId },
        'Review issue reconciliation failed after proposal application'
      )
      warnings.push('Review issue reconciliation failed; the manuscript change remains applied.')
    }
    return warnings
  }

  reopenForUndo(proposalId: string): string[] {
    const warnings: string[] = []
    try {
      this.options.database.immediate((database) => {
        const issues = database
          .prepare(
            `SELECT * FROM review_issues i
             WHERE i.resolved_by_proposal_id = ? AND i.status = 'resolved'
               AND NOT EXISTS (
                 SELECT 1 FROM review_issue_events e
                 WHERE e.review_issue_id = i.review_issue_id
                   AND e.actor_kind = 'user' AND e.occurred_at >= i.resolved_at
               )`
          )
          .all(proposalId) as ReviewIssueTable[]
        const now = this.#now()
        for (const issue of issues) {
          database
            .prepare(
              `UPDATE review_issues SET status = 'open', version = version + 1,
                 resolved_by_proposal_id = NULL, resolution_summary = NULL, resolved_at = NULL,
                 updated_at = ? WHERE review_issue_id = ? AND version = ?`
            )
            .run(now, issue.review_issue_id, issue.version)
          insertEvent(
            database,
            this.#createId(),
            issue.review_issue_id,
            'reopened',
            'resolved',
            'open',
            'system',
            null,
            proposalId,
            'The resolving proposal was undone.',
            now
          )
        }
      })
    } catch (err) {
      this.options.log.error(
        { event: 'review.proposal.undo_reconcile_failed', err, proposalId },
        'Review issue undo reconciliation failed'
      )
      warnings.push('Review issues could not be reopened after undo.')
    }
    return warnings
  }

  #now(): string {
    return (this.options.now?.() ?? new Date()).toISOString()
  }

  #createId(): string {
    return this.options.createId?.() ?? randomUUID()
  }
}

function appendInFilter(
  conditions: string[],
  parameters: unknown[],
  column: string,
  values: readonly string[]
): void {
  if (values.length === 0) return
  conditions.push(`${column} IN (${values.map(() => '?').join(', ')})`)
  parameters.push(...values)
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !('offset' in parsed) ||
      !Number.isInteger(parsed.offset) ||
      (parsed.offset as number) < 0
    ) {
      throw new Error('Invalid cursor payload')
    }
    return parsed.offset as number
  } catch (err) {
    throw new AgentToolDomainError('stale_cursor', 'Review issue cursor is invalid', false, {
      cause: err
    })
  }
}

function issueFingerprint(candidate: {
  category: string
  title: string
  checkId: string | null
  anchor: { sectionId: string; revisionId: string; blockId: string | null } | null
  sourceKind: string
}): string {
  const anchor = candidate.anchor
    ? `${candidate.anchor.sectionId}:${candidate.anchor.revisionId}:${candidate.anchor.blockId ?? ''}`
    : 'manuscript'
  return createHash('sha256')
    .update(
      [
        candidate.sourceKind,
        candidate.checkId ?? '',
        candidate.category,
        candidate.title.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase(),
        anchor
      ].join('\0')
    )
    .digest('hex')
}

function assertAnchorInSnapshot(
  anchor: { sectionId: string; revisionId: string; blockId: string | null } | null,
  snapshot: WritingSnapshot
): void {
  if (anchor === null) return
  const section = snapshot.workspace.sections.find(
    (entry) => entry.section.sectionId === anchor.sectionId
  )
  if (section?.revision.sectionRevisionId !== anchor.revisionId) {
    throw new AgentToolDomainError(
      'invalid_arguments',
      'Review issue anchor is not in the Agent snapshot'
    )
  }
  const content = snapshot.sectionContents.get(anchor.revisionId)
  if (content === undefined) {
    throw new AgentToolDomainError('conflict', 'Review issue snapshot content expired')
  }
  if (anchor.blockId !== null && !containsBlock(content, anchor.blockId)) {
    throw new AgentToolDomainError(
      'invalid_arguments',
      'Review issue block is not in the Agent snapshot'
    )
  }
}

function containsBlock(blocks: readonly BlockNoteBlockValue[], blockId: string): boolean {
  return blocks.some((block) => block.id === blockId || containsBlock(block.children, blockId))
}

function assertCitationsWereRead(
  database: Database.Database,
  actor: AgentActor,
  citationIds: string[]
): void {
  const requested = new Set(citationIds)
  if (requested.size === 0) return
  const found = new Set<string>()
  const rows = database
    .prepare(
      `SELECT payload_json FROM agent_events
       WHERE agent_session_id = ? AND agent_run_id = ? AND type = 'tool_result'`
    )
    .all(actor.agentSessionId, actor.agentRunId) as Array<{ payload_json: string }>
  for (const row of rows) {
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>
    if (payload['toolName'] !== 'read_citations' || payload['isError'] !== false) continue
    const result = payload['result']
    if (result === null || typeof result !== 'object') continue
    const citations = (result as Record<string, unknown>)['citations']
    if (!Array.isArray(citations)) continue
    for (const citation of citations) {
      if (citation !== null && typeof citation === 'object') {
        const citationId = (citation as Record<string, unknown>)['citationId']
        if (typeof citationId === 'string') found.add(citationId)
      }
    }
  }
  if ([...requested].some((citationId) => !found.has(citationId))) {
    throw new AgentToolDomainError(
      'invalid_arguments',
      'Review issue cites evidence that was not expanded in this Agent run'
    )
  }
}

function updateIssueEvidence(
  database: Database.Database,
  existing: ReviewIssueTable,
  candidate: ReturnType<typeof recordReviewIssuesArgsSchema.parse>['issues'][number],
  fingerprint: string,
  actor: AgentActor,
  now: string
): void {
  database
    .prepare(
      `UPDATE review_issues SET fingerprint = ?, priority = ?, category = ?, title = ?,
         description = ?, evidence_summary = ?, citation_ids_json = ?, source_kind = ?,
         check_id = ?, section_id = ?, revision_id = ?, block_id = ?, source_agent_session_id = ?,
         source_agent_run_id = ?, version = version + 1, updated_at = ?
       WHERE review_issue_id = ? AND version = ?`
    )
    .run(
      fingerprint,
      candidate.priority,
      candidate.category,
      candidate.title,
      candidate.description,
      candidate.evidence,
      JSON.stringify(candidate.citationIds),
      candidate.sourceKind,
      candidate.checkId,
      candidate.anchor?.sectionId ?? null,
      candidate.anchor?.revisionId ?? null,
      candidate.anchor?.blockId ?? null,
      actor.agentSessionId,
      actor.agentRunId,
      now,
      existing.review_issue_id,
      existing.version
    )
  insertEvent(
    database,
    randomUUID(),
    existing.review_issue_id,
    'refreshed',
    existing.status,
    existing.status,
    'agent',
    actor,
    null,
    null,
    now
  )
}

function requireIssue(database: Database.Database, issueId: string): ReviewIssueTable {
  const row = database
    .prepare('SELECT * FROM review_issues WHERE review_issue_id = ?')
    .get(issueId) as ReviewIssueTable | undefined
  if (row === undefined) throw new AgentToolDomainError('not_found', 'Review issue does not exist')
  return row
}

function assertExpectedVersion(issue: ReviewIssueTable, expectedVersion: number): void {
  if (issue.version !== expectedVersion) {
    throw new AgentToolDomainError(
      'conflict',
      'Review issue version changed; refresh the Problem Set'
    )
  }
}

function agentTransition(
  issue: ReviewIssueTable,
  operation: ReturnType<typeof updateReviewIssuesArgsSchema.parse>['operations'][number],
  agentSessionId: string
): {
  status: ReviewIssueStatus
  assigned: string | null
  event: 'claimed' | 'reassigned' | 'released' | 'resolved' | 'reopened'
  summary: string | null
} {
  if (operation.action === 'claim') {
    if (issue.status === 'resolved' || issue.status === 'dismissed') {
      throw new AgentToolDomainError('conflict', 'Only open or in-progress issues can be claimed')
    }
    return {
      status: 'in_progress',
      assigned: agentSessionId,
      event:
        issue.assigned_agent_session_id === null ||
        issue.assigned_agent_session_id === agentSessionId
          ? 'claimed'
          : 'reassigned',
      summary: null
    }
  }
  if (operation.action === 'reopen') {
    if (issue.status !== 'resolved' && issue.status !== 'dismissed') {
      throw new AgentToolDomainError(
        'conflict',
        'Only resolved or dismissed issues can be reopened'
      )
    }
    return { status: 'open', assigned: null, event: 'reopened', summary: null }
  }
  if (issue.status !== 'in_progress' || issue.assigned_agent_session_id !== agentSessionId) {
    throw new AgentToolDomainError('conflict', 'Review issue is not claimed by this conversation')
  }
  if (operation.action === 'release') {
    return { status: 'open', assigned: null, event: 'released', summary: null }
  }
  return { status: 'resolved', assigned: null, event: 'resolved', summary: operation.reason }
}

function userTransition(
  issue: ReviewIssueTable,
  operation: ReviewIssueUserOperation
): {
  status: ReviewIssueStatus
  event: 'dismissed' | 'reopened' | 'released'
  summary: string | null
} {
  if (operation.action === 'dismiss') {
    return { status: 'dismissed', event: 'dismissed', summary: operation.reason }
  }
  if (operation.action === 'reopen') {
    if (issue.status !== 'resolved' && issue.status !== 'dismissed') {
      throw new AgentToolDomainError(
        'conflict',
        'Only resolved or dismissed issues can be reopened'
      )
    }
    return { status: 'open', event: 'reopened', summary: null }
  }
  if (operation.action === 'release' && issue.status !== 'in_progress') {
    throw new AgentToolDomainError('conflict', 'Only an in-progress issue can be released')
  }
  return { status: 'open', event: 'released', summary: null }
}

function mapIssue(database: Database.Database, row: ReviewIssueTable): ReviewIssueRecord {
  const anchor =
    row.section_id === null || row.revision_id === null
      ? null
      : { sectionId: row.section_id, revisionId: row.revision_id, blockId: row.block_id }
  let anchorStatus: 'current' | 'orphaned' | 'manuscript' = 'manuscript'
  if (anchor !== null) {
    const current = database
      .prepare(
        `SELECT s.current_revision_id, r.content_json
         FROM sections s LEFT JOIN section_revisions r ON r.section_revision_id = s.current_revision_id
         WHERE s.section_id = ? AND s.deleted_at IS NULL`
      )
      .get(anchor.sectionId) as
      | { current_revision_id: string; content_json: string | null }
      | undefined
    anchorStatus =
      current?.current_revision_id === anchor.revisionId &&
      (anchor.blockId === null ||
        (current.content_json !== null &&
          containsBlock(
            blockNoteDocumentSchema.parse(JSON.parse(current.content_json)),
            anchor.blockId
          )))
        ? 'current'
        : 'orphaned'
  }
  return reviewIssueRecordSchema.parse({
    issueId: row.review_issue_id,
    fingerprint: row.fingerprint,
    priority: row.priority,
    category: row.category,
    title: row.title,
    description: row.description,
    evidence: row.evidence_summary,
    citationIds: JSON.parse(row.citation_ids_json),
    sourceKind: row.source_kind,
    checkId: row.check_id,
    anchor,
    anchorStatus,
    sourceAgentSessionId: row.source_agent_session_id,
    sourceAgentRunId: row.source_agent_run_id,
    status: row.status,
    assignedAgentSessionId: row.assigned_agent_session_id,
    version: row.version,
    resolvedByProposalId: row.resolved_by_proposal_id,
    resolutionSummary: row.resolution_summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    dismissedAt: row.dismissed_at
  })
}

function insertEvent(
  database: Database.Database,
  eventId: string,
  issueId: string,
  eventType: string,
  fromStatus: ReviewIssueStatus | null,
  toStatus: ReviewIssueStatus,
  actorKind: 'agent' | 'user' | 'system',
  actor: AgentActor | null,
  proposalId: string | null,
  summary: string | null,
  occurredAt: string
): void {
  database
    .prepare(
      `INSERT INTO review_issue_events (
         review_issue_event_id, review_issue_id, event_type, from_status, to_status, actor_kind,
         actor_agent_session_id, actor_agent_run_id, proposal_id, summary, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      eventId,
      issueId,
      eventType,
      fromStatus,
      toStatus,
      actorKind,
      actor?.agentSessionId ?? null,
      actor?.agentRunId ?? null,
      proposalId,
      summary,
      occurredAt
    )
}

function mapEvent(row: Record<string, unknown>): ReviewIssueEvent {
  return reviewIssueEventSchema.parse({
    eventId: row['review_issue_event_id'],
    issueId: row['review_issue_id'],
    eventType: row['event_type'],
    fromStatus: row['from_status'],
    toStatus: row['to_status'],
    actorKind: row['actor_kind'],
    actorAgentSessionId: row['actor_agent_session_id'],
    actorAgentRunId: row['actor_agent_run_id'],
    proposalId: row['proposal_id'],
    summary: row['summary'],
    occurredAt: row['occurred_at']
  })
}
