import { createHash as createSha256 } from 'node:crypto'
import {
  AGENT_RUN_PROMPT_MAX_CHARACTERS,
  agentApprovalDecisionPayloadSchema,
  agentAssistantMessagePayloadSchema,
  agentCompactionSummaryPayloadSchema,
  agentUserMessagePayloadSchema,
  type AgentCompactionCheckpointPayload,
  type AgentCompactionCheckpointV2Payload,
  type AgentHistoryMessage
} from '../../shared/contracts/agent'
import {
  agentCompactionCheckpointV4PayloadSchema,
  type AgentCompactionCheckpointV4Payload
} from '../../shared/contracts/agent-compaction'
import {
  AGENT_RUNTIME_HISTORY_MAX_BYTES,
  estimateAgentTokens
} from '../../shared/agent-context-budget'
import {
  agentToolCallPayloadSchema,
  agentToolResultPayloadSchema
} from '../../shared/contracts/agent-tools'
import type { ProjectDatabase } from '../project/project-database'
import {
  formatHistoryCompactionInput,
  HISTORY_COMPACTION_SYSTEM_PROMPT
} from './prompts/task-prompts'
import { formatPromptBlock } from './prompts/prompt-block'

const PAGE_SIZE = 100
const COMPACTION_EVENT_TYPES = `
  AND type NOT IN (
    'model_retry', 'compaction_started', 'compaction_summary', 'compaction_failed'
  )`

export interface LatestCheckpoint {
  readonly eventId: string
  readonly summary: string
  readonly coveredThroughSequence: number
  readonly timestamp: number
  readonly schemaVersion: 1 | 2 | 3 | 4
  readonly handoffMode: 'bounded_conversation_memory' | null
  readonly omittedEventCount: number
  readonly estimatedTokensBefore: number | null
  readonly estimatedTokensAfter: number | null
}

export interface CompactionMaterial {
  readonly previousCheckpoint: LatestCheckpoint | null
  readonly coveredFromSequence: number
  readonly coveredThroughSequence: number
  readonly sourcePayloadJson: string
  readonly sourceEventCount: number
  readonly sourcePayloadBytes: number
  readonly projectedPromptCharacters: number
  readonly estimatedPromptTokens: number
  readonly omittedEventCount: number
  readonly retainedTail: readonly AgentHistoryMessage[]
  readonly retainedTailTokens: number
}

interface StoredEventRow {
  agent_event_id: string
  agent_run_id: string | null
  sequence: number
  type: string
  payload_json: string
}

interface ProjectedEventRow {
  readonly agent_event_id: string
  readonly agent_run_id: string | null
  readonly sequence: number
  readonly type: string
  readonly event: Record<string, unknown>
  readonly historyMessage: AgentHistoryMessage | null
  readonly payloadBytes: number
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
    const value = JSON.parse(row.payload_json) as unknown
    const v4 = agentCompactionCheckpointV4PayloadSchema.safeParse(value)
    if (v4.success) return normalizeV4Checkpoint(row.agent_event_id, v4.data)
    const legacy = agentCompactionSummaryPayloadSchema.safeParse(value)
    if (legacy.success) return normalizeLegacyCheckpoint(row.agent_event_id, legacy.data)
  }
  return null
}

function normalizeV4Checkpoint(
  eventId: string,
  checkpoint: AgentCompactionCheckpointV4Payload
): LatestCheckpoint {
  return {
    eventId,
    summary: checkpoint.summary,
    coveredThroughSequence: checkpoint.coveredThroughSequence,
    timestamp: checkpoint.timestamp,
    schemaVersion: 4,
    handoffMode: 'bounded_conversation_memory',
    omittedEventCount: checkpoint.omittedEventCount,
    estimatedTokensBefore: checkpoint.estimatedTokensBefore,
    estimatedTokensAfter: checkpoint.estimatedTokensAfter
  }
}

function normalizeLegacyCheckpoint(
  eventId: string,
  checkpoint: ReturnType<typeof agentCompactionSummaryPayloadSchema.parse>
): LatestCheckpoint {
  const schemaVersion = 'schemaVersion' in checkpoint ? checkpoint.schemaVersion : 1
  const handoffMode =
    schemaVersion === 3 && 'handoffMode' in checkpoint ? checkpoint.handoffMode : null
  return {
    eventId,
    summary: checkpoint.summary,
    coveredThroughSequence: checkpoint.coveredThroughSequence,
    timestamp: checkpoint.timestamp,
    schemaVersion,
    handoffMode,
    omittedEventCount: 0,
    estimatedTokensBefore:
      'estimatedTokensBefore' in checkpoint
        ? checkpoint.estimatedTokensBefore
        : checkpoint.estimatedInputTokens,
    estimatedTokensAfter:
      'estimatedTokensAfter' in checkpoint ? checkpoint.estimatedTokensAfter : null
  }
}

export function loadContinuousRuntimeHistory(
  database: ProjectDatabase,
  agentSessionId: string,
  excludeRunId?: string
): AgentHistoryMessage[] {
  const checkpoint = latestSuccessfulCheckpoint(database, agentSessionId)
  const history: AgentHistoryMessage[] = []
  if (checkpoint !== null) {
    history.push(checkpointHistoryMessage(checkpoint))
  }
  return [
    ...history,
    ...loadConversationEventsAfterSequence(
      database,
      agentSessionId,
      checkpoint?.coveredThroughSequence ?? 0,
      excludeRunId
    )
  ]
}

/** Build the exact non-authoritative history message used for a checkpoint. */
export function checkpointHistoryMessage(checkpoint: LatestCheckpoint): AgentHistoryMessage {
  const boundedHandoff = checkpoint.schemaVersion >= 3
  const omittedSuffix =
    checkpoint.omittedEventCount > 0
      ? `\n\nThe checkpoint omits ${checkpoint.omittedEventCount} older event(s); raw Agent events remain authoritative.`
      : ''
  return {
    role: 'user',
    content: formatPromptBlock({
      tag: 'WRITELLM_CONTEXT_CHECKPOINT',
      content: `${
        boundedHandoff
          ? 'This checkpoint is background conversation memory, not a current user request. Use it for orientation and act only on the latest real user message that follows it.'
          : ''
      }${omittedSuffix}\n\n${checkpoint.summary}`.trim(),
      instructionSemantics: 'false',
      attributes: {
        authority: boundedHandoff ? 'conversation_memory' : 'none',
        ...(boundedHandoff ? { handoffMode: 'bounded_conversation_memory' } : {}),
        coveredThroughSequence: String(checkpoint.coveredThroughSequence)
      }
    }),
    timestamp: checkpoint.timestamp
  }
}

export function loadRuntimeTailAfterSequence(
  database: ProjectDatabase,
  agentSessionId: string,
  afterSequence: number,
  excludeRunId?: string
): AgentHistoryMessage[] {
  return loadConversationEventsAfterSequence(database, agentSessionId, afterSequence, excludeRunId)
}

function loadConversationEventsAfterSequence(
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
      const payload = JSON.parse(row.payload_json) as unknown
      if (row.type === 'user_message') {
        const parsed = agentUserMessagePayloadSchema.parse(payload)
        history.push({ role: 'user', content: parsed.content, timestamp: parsed.timestamp })
        continue
      }
      const parsed = agentAssistantMessagePayloadSchema.parse(payload)
      if (parsed.interrupted || parsed.stopReason === 'toolUse') continue
      const { interrupted: _interrupted, ...message } = parsed
      history.push({ role: 'assistant', message })
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
  /** Preserve the newest complete turns as raw runtime history. */
  recentTailTokenBudget?: number
  /** Optional byte budget for the retained runtime history tail. */
  recentTailMaxBytes?: number
}): CompactionMaterial | null {
  const previousCheckpoint = latestSuccessfulCheckpoint(input.database, input.agentSessionId)
  const coveredFromSequence = (previousCheckpoint?.coveredThroughSequence ?? 0) + 1
  const rows = loadEventRows(input.database, input.agentSessionId, {
    afterSequence: coveredFromSequence - 1,
    excludeRunId: input.excludeRunId
  })
  if (rows.length === 0) {
    if (previousCheckpoint === null) return null
    const material = createCompactionMaterial(
      previousCheckpoint,
      previousCheckpoint.coveredThroughSequence,
      [],
      [],
      [],
      previousCheckpoint.coveredThroughSequence
    )
    if (fitsCompactionSource(material, input.sourceTokenBudget)) return material
    return fitPreviousCheckpointSource(
      previousCheckpoint,
      previousCheckpoint.coveredThroughSequence,
      [],
      [],
      material,
      input.sourceTokenBudget
    )
  }

  const groups = groupCompactionRows(rows)
  let tailGroups = selectRecentTailGroups(
    groups,
    input.recentTailTokenBudget,
    input.recentTailMaxBytes
  )
  let tailRowCount = tailGroups.reduce((count, group) => count + group.length, 0)
  let sourceRows = rows.slice(0, Math.max(0, rows.length - tailRowCount))
  // A manual/overflow compaction must still have one complete turn to
  // summarize when the requested tail budget would otherwise retain all of
  // the source. Never move an incomplete active group out of the tail.
  if (sourceRows.length === 0) {
    const firstTailGroup = tailGroups[0]
    const hasCompleteTail =
      firstTailGroup !== undefined && (tailGroups.length > 1 || hasTerminalEvent(firstTailGroup))
    if (hasCompleteTail) {
      tailGroups = tailGroups.slice(1)
      tailRowCount = tailGroups.reduce((count, group) => count + group.length, 0)
      sourceRows = rows.slice(0, Math.max(0, rows.length - tailRowCount))
    }
  }
  if (sourceRows.length === 0) return null
  const sourceGroups = groupCompactionRows(sourceRows)
  let material = createCompactionMaterial(
    previousCheckpoint,
    coveredFromSequence,
    sourceRows,
    tailGroups,
    sourceGroups
  )
  if (!fitsCompactionSource(material, input.sourceTokenBudget)) {
    // Keep the newest complete source turns that fit. Each candidate is a
    // suffix of the complete groups, so omitted history is always an older
    // prefix while the fitting boundary is found with logarithmic probes.
    let low = 0
    let high = sourceGroups.length
    let fittingStart = sourceGroups.length
    while (low <= high) {
      const start = Math.floor((low + high) / 2)
      const candidateGroups = sourceGroups.slice(start)
      const candidate = createCompactionMaterial(
        previousCheckpoint,
        coveredFromSequence,
        sourceRows,
        tailGroups,
        candidateGroups
      )
      if (fitsCompactionSource(candidate, input.sourceTokenBudget)) {
        fittingStart = start
        material = candidate
        high = start - 1
      } else {
        low = start + 1
      }
    }
    if (fittingStart === sourceGroups.length) {
      material = createCompactionMaterial(
        previousCheckpoint,
        coveredFromSequence,
        sourceRows,
        tailGroups,
        []
      )
    }
  }
  if (fitsCompactionSource(material, input.sourceTokenBudget)) return material
  return fitPreviousCheckpointSource(
    previousCheckpoint,
    coveredFromSequence,
    sourceRows,
    tailGroups,
    material,
    input.sourceTokenBudget
  )
}

function fitPreviousCheckpointSource(
  previousCheckpoint: LatestCheckpoint | null,
  coveredFromSequence: number,
  sourceRows: readonly ProjectedEventRow[],
  retainedTailGroups: readonly ProjectedEventRow[][],
  fallback: CompactionMaterial,
  sourceTokenBudget: number | undefined
): CompactionMaterial | null {
  if (previousCheckpoint === null) return null
  const characters = Array.from(previousCheckpoint.summary)
  let low = 0
  let high = characters.length
  let best: CompactionMaterial | null = null
  while (low <= high) {
    const count = Math.floor((low + high) / 2)
    const candidateCheckpoint = {
      ...previousCheckpoint,
      summary: characters.slice(0, count).join('')
    }
    const candidate = createCompactionMaterial(
      previousCheckpoint,
      coveredFromSequence,
      sourceRows,
      retainedTailGroups,
      [],
      fallback.coveredThroughSequence,
      candidateCheckpoint.summary
    )
    if (fitsCompactionSource(candidate, sourceTokenBudget)) {
      best = candidate
      low = count + 1
    } else {
      high = count - 1
    }
  }
  return best
}

/**
 * Select a suffix of complete conversation turns using the caller's actual
 * remaining history budget. A trailing non-terminal group is the active
 * request; it is always kept out of the summary source so it can be handled
 * by the normal current-turn capacity check, and its history tokens consume
 * the available tail budget before older complete turns are considered.
 */
function selectRecentTailGroups(
  groups: readonly ProjectedEventRow[][],
  tokenBudget: number | undefined,
  maxBytes: number | undefined
): ProjectedEventRow[][] {
  if (tokenBudget === undefined) return []
  const budget = Math.max(0, Math.floor(tokenBudget))
  const tail: ProjectedEventRow[][] = []
  let remaining = budget
  let remainingBytes = Math.max(0, Math.floor(maxBytes ?? AGENT_RUNTIME_HISTORY_MAX_BYTES))
  let end = groups.length
  const lastGroup = groups.at(-1)
  if (lastGroup !== undefined && !hasTerminalEvent(lastGroup)) {
    tail.unshift(lastGroup)
    end -= 1
    remaining = Math.max(0, remaining - historyMessageTokens(lastGroup))
    remainingBytes = Math.max(0, remainingBytes - historyMessageBytes(lastGroup))
  }
  for (let index = end - 1; index >= 0; index -= 1) {
    const group = groups[index]
    if (group === undefined) continue
    const groupTokens = historyMessageTokens(group)
    const groupBytes = historyMessageBytes(group)
    if (groupTokens > remaining || groupBytes > remainingBytes) break
    tail.unshift(group)
    remaining -= groupTokens
    remainingBytes -= groupBytes
  }
  return tail
}

function hasTerminalEvent(group: readonly ProjectedEventRow[]): boolean {
  return group.some((row) => row.type === 'run_completed' || row.type === 'run_interrupted')
}

function rowToHistoryMessages(row: ProjectedEventRow): AgentHistoryMessage[] {
  return row.historyMessage === null ? [] : [row.historyMessage]
}

function historyMessageTokens(group: readonly ProjectedEventRow[]): number {
  const messages = group.flatMap((row) => rowToHistoryMessages(row))
  return messages.length === 0 ? 0 : estimateAgentTokens(messages)
}

function historyMessageBytes(group: readonly ProjectedEventRow[]): number {
  const messages = group.flatMap((row) => rowToHistoryMessages(row))
  return new TextEncoder().encode(JSON.stringify(messages)).byteLength
}

function loadEventRows(
  database: ProjectDatabase,
  agentSessionId: string,
  input: { afterSequence: number; excludeRunId?: string }
): ProjectedEventRow[] {
  const selected: ProjectedEventRow[] = []
  let after = input.afterSequence
  while (true) {
    const rows = database.immediate(
      (native) =>
        native
          .prepare(
            `SELECT agent_event_id, agent_run_id, sequence, type, payload_json
               FROM agent_events
              WHERE agent_session_id = ? AND sequence > ?
                ${COMPACTION_EVENT_TYPES}
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
          ) as StoredEventRow[]
    )
    if (rows.length === 0) break
    for (const row of rows) {
      selected.push(projectEventRow(row))
      after = row.sequence
    }
    if (rows.length < PAGE_SIZE) break
  }
  return selected
}

function groupCompactionRows(rows: readonly ProjectedEventRow[]): ProjectedEventRow[][] {
  const groups: ProjectedEventRow[][] = []
  for (const row of rows) {
    if (row.type === 'user_message' && groups.at(-1)?.length) groups.push([])
    if (groups.length === 0) groups.push([])
    groups.at(-1)?.push(row)
  }
  return groups
}

function createCompactionMaterial(
  previousCheckpoint: LatestCheckpoint | null,
  coveredFromSequence: number,
  sourceRows: readonly ProjectedEventRow[],
  retainedTailGroups: readonly ProjectedEventRow[][],
  selectedGroups: readonly ProjectedEventRow[][],
  coveredThroughSequenceOverride?: number,
  previousCheckpointSummary?: string
): CompactionMaterial {
  const selectedRows = selectedGroups.flat()
  const omittedRows = sourceRows.slice(0, Math.max(0, sourceRows.length - selectedRows.length))
  const omittedEventCount = omittedRows.length
  const coveredThroughSequence =
    sourceRows.at(-1)?.sequence ?? coveredThroughSequenceOverride ?? coveredFromSequence
  const omittedFacts = summarizeOmittedRows(omittedRows)
  const recentTurns = selectedGroups.map((group) => group.map((row) => row.event))
  const retainedTail = retainedTailGroups.flatMap((group) =>
    group.flatMap((row) => rowToHistoryMessages(row))
  )
  const source = {
    authority: 'events-and-current-business-rows',
    coveredFromSequence,
    coveredThroughSequence,
    previousCheckpoint: previousCheckpointSummary ?? previousCheckpoint?.summary ?? null,
    omittedEventCount,
    omittedFacts,
    recentTurns
  }
  const sourcePayloadJson = JSON.stringify(source)
  const formattedPrompt = formatHistoryCompactionInput(sourcePayloadJson)
  return {
    previousCheckpoint,
    coveredFromSequence,
    coveredThroughSequence,
    sourcePayloadJson,
    sourceEventCount: sourceRows.length,
    sourcePayloadBytes: sourceRows.reduce((total, row) => total + row.payloadBytes, 0),
    projectedPromptCharacters: formattedPrompt.length,
    estimatedPromptTokens: estimateAgentTokens([HISTORY_COMPACTION_SYSTEM_PROMPT, formattedPrompt]),
    omittedEventCount,
    retainedTail,
    retainedTailTokens: retainedTail.length === 0 ? 0 : estimateAgentTokens(retainedTail)
  }
}

function fitsCompactionSource(material: CompactionMaterial, sourceTokenBudget?: number): boolean {
  return (
    material.projectedPromptCharacters <= AGENT_RUN_PROMPT_MAX_CHARACTERS &&
    (sourceTokenBudget === undefined || material.estimatedPromptTokens <= sourceTokenBudget)
  )
}

function summarizeOmittedRows(rows: readonly ProjectedEventRow[]): Record<string, unknown> {
  if (rows.length === 0) return { eventCount: 0 }
  const typeCounts = new Map<string, number>()
  const toolCounts = new Map<string, number>()
  for (const row of rows) {
    typeCounts.set(row.type, (typeCounts.get(row.type) ?? 0) + 1)
    if (row.type === 'tool_call' || row.type === 'tool_result') {
      const toolName = typeof row.event['toolName'] === 'string' ? row.event['toolName'] : 'unknown'
      toolCounts.set(toolName, (toolCounts.get(toolName) ?? 0) + 1)
    }
  }
  return {
    eventCount: rows.length,
    firstSequence: rows[0]?.sequence,
    lastSequence: rows.at(-1)?.sequence,
    eventTypes: Object.fromEntries(typeCounts),
    toolEvents: Object.fromEntries(toolCounts)
  }
}

function projectEventRow(row: StoredEventRow): ProjectedEventRow {
  const payload = JSON.parse(row.payload_json) as unknown
  let event: Record<string, unknown>
  let historyMessage: AgentHistoryMessage | null = null
  switch (row.type) {
    case 'user_message': {
      const parsed = agentUserMessagePayloadSchema.parse(payload)
      event = { sequence: row.sequence, type: row.type, content: parsed.content }
      historyMessage = { role: 'user', content: parsed.content, timestamp: parsed.timestamp }
      break
    }
    case 'assistant_message': {
      const parsed = agentAssistantMessagePayloadSchema.parse(payload)
      event = {
        sequence: row.sequence,
        type: row.type,
        content: parsed.interrupted || parsed.stopReason === 'toolUse' ? null : parsed.content,
        stopReason: parsed.stopReason,
        interrupted: parsed.interrupted
      }
      if (!parsed.interrupted && parsed.stopReason !== 'toolUse') {
        const { interrupted: _interrupted, ...message } = parsed
        historyMessage = { role: 'assistant', message }
      }
      break
    }
    case 'tool_call': {
      const parsed = agentToolCallPayloadSchema.parse(payload)
      event = {
        sequence: row.sequence,
        type: row.type,
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        args: projectSafeFacts(parsed.args)
      }
      break
    }
    case 'tool_result': {
      const parsed = agentToolResultPayloadSchema.parse(payload)
      event = {
        sequence: row.sequence,
        type: row.type,
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        isError: parsed.isError,
        citationIds: parsed.citationIds,
        facts: projectSafeFacts(unwrapToolDetails(parsed.result)),
        error: parsed.error === null ? null : projectSafeFacts(parsed.error)
      }
      break
    }
    case 'approval_decision': {
      const parsed = agentApprovalDecisionPayloadSchema.parse(payload)
      event = {
        sequence: row.sequence,
        type: row.type,
        proposalId: parsed.proposalId,
        decision: parsed.decision,
        continueRequested: parsed.continueRequested
      }
      break
    }
    default:
      event = { sequence: row.sequence, type: row.type, facts: projectSafeFacts(payload) }
      break
  }
  return {
    agent_event_id: row.agent_event_id,
    agent_run_id: row.agent_run_id,
    sequence: row.sequence,
    type: row.type,
    event,
    historyMessage,
    payloadBytes: Buffer.byteLength(row.payload_json)
  }
}

function projectSafeFacts(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || value === undefined) return null
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    if (value.startsWith('writellm://skills/')) return value.slice(0, 2_048)
    if (value.length <= 512 && !looksLikePrivatePath(value) && !looksLikeSignedUrl(value))
      return value
    return {
      redacted: true,
      originalCharacters: Array.from(value).length,
      sha256: createHash(value)
    }
  }
  if (Array.isArray(value)) return value.map((entry) => projectSafeFacts(entry, depth + 1))
  if (!isRecord(value)) return null
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) => {
      if (!SAFE_FACT_KEYS.has(key)) return []
      return [[key, projectSafeFacts(entry, depth + 1)]]
    })
  )
}

const SAFE_FACT_KEYS = new Set([
  'schemaVersion',
  'ok',
  'toolName',
  'toolCallId',
  'modelRequestId',
  'code',
  'retryable',
  'operationId',
  'proposalId',
  'status',
  'kind',
  'mode',
  'rerankStatus',
  'resultCount',
  'referenceCount',
  'answered',
  'hits',
  'sectionId',
  'sectionIds',
  'blockId',
  'blockIds',
  'blockType',
  'revisionId',
  'currentRevisionId',
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
  'displayName',
  'relativePath',
  'commit',
  'byteSize',
  'skillId',
  'uri',
  'question',
  'questions',
  'questionId',
  'header',
  'options',
  'label',
  'value',
  'answers',
  'page',
  'pageFrom',
  'pageTo',
  'cursor',
  'nextCursor',
  'count',
  'limit',
  'totalBlocks',
  'totalSections',
  'totalChars',
  'truncated',
  'isError',
  'error'
])

function unwrapToolDetails(value: unknown): unknown {
  if (!isRecord(value)) return value
  return 'data' in value ? value['data'] : value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function looksLikePrivatePath(value: string): boolean {
  return /^(?:\/|\\\\|[A-Za-z]:[\\/]|file:\/\/)/iu.test(value)
}

function looksLikeSignedUrl(value: string): boolean {
  return /^https?:\/\/[^\s]+[?&](?:sig(?:nature)?|token|key|credential|x-amz-[^=]+)=/iu.test(value)
}

function createHash(value: string): string {
  return createSha256('sha256').update(value).digest('hex')
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

export function isV4Checkpoint(value: unknown): value is AgentCompactionCheckpointV4Payload {
  return agentCompactionCheckpointV4PayloadSchema.safeParse(value).success
}
