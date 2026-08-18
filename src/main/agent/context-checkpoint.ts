import { createHash } from 'node:crypto'
import {
  agentApprovalDecisionPayloadSchema,
  agentAssistantMessagePayloadSchema,
  agentCompactionSummaryPayloadSchema,
  agentUserMessagePayloadSchema,
  type AgentCompactionCheckpointPayload,
  type AgentCompactionCheckpointV2Payload,
  type AgentHistoryMessage
} from '../../shared/contracts/agent'
import { estimateAgentTokens } from '../../shared/agent-context-budget'
import {
  agentToolCallPayloadSchema,
  agentToolResultPayloadSchema
} from '../../shared/contracts/agent-tools'
import type { ProjectDatabase } from '../project/project-database'
import { formatPromptBlock } from './prompts/prompt-block'

const PAGE_SIZE = 50
const SOURCE_EVENT_LIMIT = 240
const SAFE_TOOL_KEYS = new Set([
  'proposalId',
  'effectiveProposalId',
  'status',
  'kind',
  'sectionId',
  'revisionId',
  'currentRevisionId',
  'baseRevisionId',
  'briefVersion',
  'outlineVersion',
  'knowledgeItemId',
  'knowledgeItemIds',
  'parseRevisionId',
  'parseRevisionIds',
  'citationId',
  'citationIds',
  'contentHash',
  'blockHash',
  'sha256',
  'title',
  'page',
  'pageFrom',
  'pageTo',
  'cursor',
  'nextCursor',
  'nextOffset',
  'offset',
  'totalChars',
  'totalBlocks',
  'totalSections',
  'count',
  'limit',
  'truncated',
  'isError',
  'code',
  'retryable',
  'operationId'
])

interface EventRow {
  agent_event_id: string
  agent_run_id: string | null
  sequence: number
  type: string
  payload_json: string
}

export interface LatestCheckpoint {
  readonly eventId: string
  readonly summary: string
  readonly coveredThroughSequence: number
  readonly timestamp: number
  readonly schemaVersion: 1 | 2 | 3
  readonly handoffMode: 'bounded_conversation_memory' | null
}

export interface CompactionMaterial {
  readonly previousCheckpoint: LatestCheckpoint | null
  readonly coveredFromSequence: number
  readonly coveredThroughSequence: number
  readonly sourcePayloadJson: string
  readonly proposalOutcomes: readonly Record<string, unknown>[]
  readonly approvalDecisions: readonly Record<string, unknown>[]
  readonly citationIds: readonly string[]
  readonly toolOutcomes: readonly Record<string, unknown>[]
  readonly sourceEventCount: number
  readonly sourcePayloadBytes: number
  readonly hasMoreCompactionCandidate: boolean
}

export function latestSuccessfulCheckpoint(
  database: ProjectDatabase,
  agentSessionId: string
): LatestCheckpoint | null {
  const rows = database.immediate(
    (native) =>
      native
        .prepare(
          `SELECT agent_event_id, payload_json
             FROM agent_events
            WHERE agent_session_id = ? AND type = 'compaction_summary'
            ORDER BY sequence DESC
            LIMIT ?`
        )
        .all(agentSessionId, PAGE_SIZE) as Array<{ agent_event_id: string; payload_json: string }>
  )
  for (const row of rows) {
    const parsed = agentCompactionSummaryPayloadSchema.safeParse(JSON.parse(row.payload_json))
    if (!parsed.success) continue
    return {
      eventId: row.agent_event_id,
      summary: parsed.data.summary,
      coveredThroughSequence: parsed.data.coveredThroughSequence,
      timestamp: parsed.data.timestamp,
      schemaVersion: 'schemaVersion' in parsed.data ? parsed.data.schemaVersion : 1,
      handoffMode: 'handoffMode' in parsed.data ? parsed.data.handoffMode : null
    }
  }
  return null
}

export function uncheckpointedEnvelope(
  database: ProjectDatabase,
  agentSessionId: string,
  coveredThroughSequence: number,
  excludeRunId?: string
): { eventCount: number; payloadBytes: number } {
  return database.immediate((native) => {
    const row = native
      .prepare(
        `SELECT COUNT(*) AS event_count,
                COALESCE(SUM(length(CAST(payload_json AS BLOB))), 0) AS payload_bytes
           FROM agent_events
          WHERE agent_session_id = ? AND sequence > ?
            AND (? IS NULL OR agent_run_id IS NULL OR agent_run_id <> ?)`
      )
      .get(agentSessionId, coveredThroughSequence, excludeRunId ?? null, excludeRunId ?? null) as {
      event_count: number
      payload_bytes: number
    }
    return { eventCount: row.event_count, payloadBytes: row.payload_bytes }
  })
}

export function loadContinuousRuntimeHistory(
  database: ProjectDatabase,
  agentSessionId: string,
  excludeRunId?: string
): AgentHistoryMessage[] {
  const checkpoint = latestSuccessfulCheckpoint(database, agentSessionId)
  const history: AgentHistoryMessage[] = []
  if (checkpoint !== null) {
    const boundedHandoff =
      checkpoint.schemaVersion === 3 && checkpoint.handoffMode === 'bounded_conversation_memory'
    history.push({
      role: 'user',
      content: formatPromptBlock({
        tag: 'WRITELLM_CONTEXT_CHECKPOINT',
        content: checkpoint.summary,
        instructionSemantics: 'false',
        attributes: {
          authority: boundedHandoff ? 'conversation_memory' : 'none',
          ...(boundedHandoff ? { handoffMode: checkpoint.handoffMode } : {}),
          coveredThroughSequence: String(checkpoint.coveredThroughSequence)
        }
      }),
      timestamp: checkpoint.timestamp
    })
  }
  let after = checkpoint?.coveredThroughSequence ?? 0
  while (true) {
    const rows = database.immediate(
      (native) =>
        native
          .prepare(
            `SELECT sequence, type, payload_json
               FROM agent_events
              WHERE agent_session_id = ? AND sequence > ?
                AND type IN ('user_message', 'assistant_message')
                AND (? IS NULL OR agent_run_id IS NULL OR agent_run_id <> ?)
              ORDER BY sequence
              LIMIT ?`
          )
          .all(
            agentSessionId,
            after,
            excludeRunId ?? null,
            excludeRunId ?? null,
            PAGE_SIZE
          ) as Array<{ sequence: number; type: string; payload_json: string }>
    )
    if (rows.length === 0) break
    for (const row of rows) {
      after = row.sequence
      if (row.type === 'user_message') {
        const payload = agentUserMessagePayloadSchema.parse(JSON.parse(row.payload_json))
        history.push({ role: 'user', content: payload.content, timestamp: payload.timestamp })
      } else {
        const payload = agentAssistantMessagePayloadSchema.parse(JSON.parse(row.payload_json))
        if (payload.interrupted || payload.stopReason === 'toolUse') continue
        const { interrupted: _interrupted, ...message } = payload
        history.push({ role: 'assistant', message })
      }
    }
    if (rows.length < PAGE_SIZE) break
  }
  return history
}

export function loadRuntimeTailAfterSequence(
  database: ProjectDatabase,
  agentSessionId: string,
  afterSequence: number,
  excludeRunId?: string
): AgentHistoryMessage[] {
  const history: AgentHistoryMessage[] = []
  let after = afterSequence
  while (true) {
    const rows = database.immediate(
      (native) =>
        native
          .prepare(
            `SELECT sequence, type, payload_json
               FROM agent_events
              WHERE agent_session_id = ? AND sequence > ?
                AND type IN ('user_message', 'assistant_message')
                AND (? IS NULL OR agent_run_id IS NULL OR agent_run_id <> ?)
              ORDER BY sequence
              LIMIT ?`
          )
          .all(
            agentSessionId,
            after,
            excludeRunId ?? null,
            excludeRunId ?? null,
            PAGE_SIZE
          ) as Array<{ sequence: number; type: string; payload_json: string }>
    )
    if (rows.length === 0) break
    for (const row of rows) {
      after = row.sequence
      if (row.type === 'user_message') {
        const payload = agentUserMessagePayloadSchema.parse(JSON.parse(row.payload_json))
        history.push({ role: 'user', content: payload.content, timestamp: payload.timestamp })
      } else {
        const payload = agentAssistantMessagePayloadSchema.parse(JSON.parse(row.payload_json))
        if (payload.interrupted || payload.stopReason === 'toolUse') continue
        const { interrupted: _interrupted, ...message } = payload
        history.push({ role: 'assistant', message })
      }
    }
    if (rows.length < PAGE_SIZE) break
  }
  return history
}

export function buildNextCompactionMaterial(input: {
  database: ProjectDatabase
  agentSessionId: string
  excludeRunId?: string
  sourceTokenBudget?: number
}): CompactionMaterial | null {
  const previousCheckpoint = latestSuccessfulCheckpoint(input.database, input.agentSessionId)
  const coveredFromSequence = (previousCheckpoint?.coveredThroughSequence ?? 0) + 1
  const rows = loadEventChunk(input.database, input.agentSessionId, {
    afterSequence: coveredFromSequence - 1,
    excludeRunId: input.excludeRunId
  })
  if (rows.length === 0) return null
  let boundary = compactionBoundary(rows, input.excludeRunId !== undefined)
  while (boundary >= 0) {
    const material = createCompactionMaterial(
      input,
      previousCheckpoint,
      rows.slice(0, boundary + 1)
    )
    if (
      input.sourceTokenBudget === undefined ||
      estimateAgentTokens(material.sourcePayloadJson) <= input.sourceTokenBudget
    ) {
      return material
    }
    boundary = previousCompactionBoundary(rows, boundary)
  }
  return null
}

function createCompactionMaterial(
  input: {
    database: ProjectDatabase
    agentSessionId: string
    excludeRunId?: string
  },
  previousCheckpoint: LatestCheckpoint | null,
  selected: readonly EventRow[]
): CompactionMaterial {
  const coveredFromSequence = (previousCheckpoint?.coveredThroughSequence ?? 0) + 1
  const remainingTerminalCount = countTerminalEventsAfter(
    input.database,
    input.agentSessionId,
    selected.at(-1)?.sequence ?? 0,
    input.excludeRunId
  )
  const approvalDecisions: Record<string, unknown>[] = []
  const toolOutcomes: Record<string, unknown>[] = []
  const citationIds = new Set<string>()
  const projectedEvents = selected.map((row) => {
    const payload = JSON.parse(row.payload_json) as unknown
    switch (row.type) {
      case 'user_message': {
        const parsed = agentUserMessagePayloadSchema.parse(payload)
        return { sequence: row.sequence, type: row.type, content: parsed.content }
      }
      case 'assistant_message': {
        const parsed = agentAssistantMessagePayloadSchema.parse(payload)
        return {
          sequence: row.sequence,
          type: row.type,
          content: parsed.content,
          stopReason: parsed.stopReason,
          interrupted: parsed.interrupted
        }
      }
      case 'tool_call': {
        const parsed = agentToolCallPayloadSchema.parse(payload)
        return {
          sequence: row.sequence,
          type: row.type,
          toolCallId: parsed.toolCallId,
          toolName: parsed.toolName,
          args: projectSafeObject(parsed.args)
        }
      }
      case 'tool_result': {
        const parsed = agentToolResultPayloadSchema.parse(payload)
        for (const id of parsed.citationIds) citationIds.add(id)
        const outcome = {
          toolCallId: parsed.toolCallId,
          toolName: parsed.toolName,
          isError: parsed.isError,
          citationIds: parsed.citationIds,
          knowledgeItemIds: parsed.knowledgeItemIds,
          parseRevisionIds: parsed.parseRevisionIds,
          result: projectSafeObject(parsed.result),
          error:
            parsed.error === null
              ? null
              : {
                  code: parsed.error.code,
                  message: parsed.error.message,
                  category: parsed.error.category ?? null,
                  recovery: parsed.error.recovery ?? null,
                  retryable: parsed.error.retryable ?? false,
                  operationId: parsed.error.operationId ?? null
                }
        }
        toolOutcomes.push(outcome)
        return { sequence: row.sequence, type: row.type, ...outcome }
      }
      case 'approval_decision': {
        const parsed = agentApprovalDecisionPayloadSchema.parse(payload)
        const decision = {
          proposalId: parsed.proposalId,
          decision: parsed.decision,
          continueRequested: parsed.continueRequested
        }
        approvalDecisions.push(decision)
        return { sequence: row.sequence, type: row.type, ...decision }
      }
      case 'run_completed':
      case 'run_interrupted':
        return { sequence: row.sequence, type: row.type, state: projectSafeObject(payload) }
      case 'tool_attempted':
      case 'tool_preflight_failed':
        return { sequence: row.sequence, type: row.type, state: projectSafeObject(payload) }
      default:
        return { sequence: row.sequence, type: row.type }
    }
  })
  const proposalOutcomes = authoritativeProposalOutcomes(
    input.database,
    input.agentSessionId,
    selected
  )
  const coveredThroughSequence = selected.at(-1)?.sequence ?? coveredFromSequence
  const sourcePayloadJson = JSON.stringify({
    authority: 'events-and-current-business-rows',
    coveredFromSequence,
    coveredThroughSequence,
    previousCheckpoint: previousCheckpoint?.summary ?? null,
    events: projectedEvents,
    proposalOutcomes,
    approvalDecisions,
    citationIds: [...citationIds],
    toolOutcomes
  })
  return {
    previousCheckpoint,
    coveredFromSequence,
    coveredThroughSequence,
    sourcePayloadJson,
    proposalOutcomes,
    approvalDecisions,
    citationIds: [...citationIds],
    toolOutcomes,
    sourceEventCount: selected.length,
    sourcePayloadBytes: selected.reduce(
      (total, row) => total + Buffer.byteLength(row.payload_json),
      0
    ),
    hasMoreCompactionCandidate: remainingTerminalCount >= 2
  }
}

export function isV2Checkpoint(
  value: ReturnType<typeof agentCompactionSummaryPayloadSchema.parse>
): value is AgentCompactionCheckpointV2Payload {
  return 'schemaVersion' in value && value.schemaVersion === 2
}

export function isV3Checkpoint(
  value: ReturnType<typeof agentCompactionSummaryPayloadSchema.parse>
): value is AgentCompactionCheckpointPayload {
  return 'schemaVersion' in value && value.schemaVersion === 3
}

function loadEventChunk(
  database: ProjectDatabase,
  agentSessionId: string,
  input: { afterSequence: number; excludeRunId?: string }
): EventRow[] {
  const selected: EventRow[] = []
  let after = input.afterSequence
  while (selected.length < SOURCE_EVENT_LIMIT) {
    const rows = database.immediate(
      (native) =>
        native
          .prepare(
            `SELECT agent_event_id, agent_run_id, sequence, type, payload_json
               FROM agent_events
              WHERE agent_session_id = ? AND sequence > ?
                AND type NOT IN ('compaction_started', 'compaction_summary', 'compaction_failed')
                AND (? IS NULL OR agent_run_id IS NULL OR agent_run_id <> ?)
              ORDER BY sequence
              LIMIT ?`
          )
          .all(
            agentSessionId,
            after,
            input.excludeRunId ?? null,
            input.excludeRunId ?? null,
            PAGE_SIZE
          ) as EventRow[]
    )
    if (rows.length === 0) break
    for (const row of rows) {
      if (selected.length >= SOURCE_EVENT_LIMIT) return selected
      selected.push(row)
      after = row.sequence
    }
    if (rows.length < PAGE_SIZE) break
  }
  return selected
}

function compactionBoundary(rows: readonly EventRow[], allowOnlyBoundary: boolean): number {
  const boundaries = rows.flatMap((row, index) =>
    row.type === 'run_completed' || row.type === 'run_interrupted' ? [index] : []
  )
  if (boundaries.length >= 2) return boundaries.at(-2) ?? -1
  return allowOnlyBoundary ? (boundaries.at(-1) ?? -1) : -1
}

function previousCompactionBoundary(rows: readonly EventRow[], beforeIndex: number): number {
  for (let index = beforeIndex - 1; index >= 0; index -= 1) {
    const type = rows[index]?.type
    if (type === 'run_completed' || type === 'run_interrupted') return index
  }
  return -1
}

function countTerminalEventsAfter(
  database: ProjectDatabase,
  agentSessionId: string,
  afterSequence: number,
  excludeRunId?: string
): number {
  return database.immediate((native) =>
    Number(
      native
        .prepare(
          `SELECT COUNT(*)
             FROM agent_events
            WHERE agent_session_id = ? AND sequence > ?
              AND type IN ('run_completed', 'run_interrupted')
              AND (? IS NULL OR agent_run_id IS NULL OR agent_run_id <> ?)`
        )
        .pluck()
        .get(agentSessionId, afterSequence, excludeRunId ?? null, excludeRunId ?? null)
    )
  )
}

function authoritativeProposalOutcomes(
  database: ProjectDatabase,
  agentSessionId: string,
  events: readonly EventRow[]
): Record<string, unknown>[] {
  const runIds = [
    ...new Set(events.flatMap((event) => (event.agent_run_id ? [event.agent_run_id] : [])))
  ]
  if (runIds.length === 0) return []
  const placeholders = runIds.map(() => '?').join(', ')
  return database
    .immediate(
      (native) =>
        native
          .prepare(
            `SELECT mutation_proposal_id, kind, status, decision_at, applied_revision_id,
                  applied_brief_version, applied_outline_version, undo_revision_id,
                  replaces_proposal_id, rejected_reason
             FROM mutation_proposals
            WHERE agent_session_id = ? AND agent_run_id IN (${placeholders})
            ORDER BY created_at
            LIMIT 256`
          )
          .all(agentSessionId, ...runIds) as Record<string, unknown>[]
    )
    .map((row) => ({
      proposalId: row['mutation_proposal_id'],
      kind: row['kind'],
      status: row['status'],
      decisionAt: row['decision_at'],
      appliedRevisionId: row['applied_revision_id'],
      appliedBriefVersion: row['applied_brief_version'],
      appliedOutlineVersion: row['applied_outline_version'],
      undoRevisionId: row['undo_revision_id'],
      replacesProposalId: row['replaces_proposal_id'],
      reasonCode: safeReasonCode(row['rejected_reason'])
    }))
}

function projectSafeObject(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null) return null
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    if (looksLikePrivatePath(value) || value.length > 2_048) return safeStringReference(value)
    return value
  }
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => projectSafeObject(item, depth + 1))
  if (typeof value !== 'object') return null
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => SAFE_TOOL_KEYS.has(key))
      .map(([key, child]) => [key, projectSafeObject(child, depth + 1)])
  )
}

function safeStringReference(value: string): Record<string, unknown> {
  return {
    redacted: true,
    originalCharacters: Array.from(value).length,
    sha256: createHash('sha256').update(value).digest('hex')
  }
}

function looksLikePrivatePath(value: string): boolean {
  return /^(?:\/(?:Users|home|private|var)\/|[A-Za-z]:\\)/u.test(value)
}

function safeReasonCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return /^[a-z0-9_.-]{1,100}$/u.test(value) ? value : 'user_feedback_recorded'
}
