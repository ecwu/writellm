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
import { estimateAgentTokens } from '../../shared/agent-context-budget'
import {
  agentToolCallPayloadSchema,
  agentToolResultPayloadSchema,
  type AgentToolName,
  askUserArgsSchema,
  askUserResultSchema,
  persistedAgentToolNameSchema
} from '../../shared/contracts/agent-tools'
import type { ProjectDatabase } from '../project/project-database'
import {
  formatHistoryCompactionInput,
  HISTORY_COMPACTION_SYSTEM_PROMPT
} from './prompts/task-prompts'
import { formatPromptBlock } from './prompts/prompt-block'

const PAGE_SIZE = 50
export const COMPACTION_SOURCE_EVENT_LIMIT = 2_000
const COMPACTION_TOOL_OUTCOME_LIMIT = 512
const COMPACTION_CITATION_LIMIT = 1_000

type CompactionToolPolicy =
  | 'observation'
  | 'citation_observation'
  | 'question'
  | 'authoritative_read'
  | 'authoritative_effect'

export const COMPACTION_TOOL_POLICIES = {
  get_writing_context: 'observation',
  read_outline: 'observation',
  read_section: 'observation',
  search_manuscript: 'observation',
  search_knowledge: 'observation',
  read_citations: 'citation_observation',
  read_writing_skill: 'observation',
  ask_user: 'question',
  activate_tool_groups: 'observation',
  inspect_change: 'authoritative_read',
  check_draft: 'observation',
  list_review_issues: 'authoritative_read',
  record_review_issues: 'authoritative_effect',
  update_review_issues: 'authoritative_effect',
  get_writing_task: 'authoritative_read',
  create_writing_task: 'authoritative_effect',
  update_writing_task: 'authoritative_effect',
  submit_brief_change: 'authoritative_effect',
  submit_writing_rules_change: 'authoritative_effect',
  submit_outline_change: 'authoritative_effect',
  submit_section_change: 'authoritative_effect',
  generate_image: 'authoritative_effect'
} as const satisfies Record<AgentToolName, CompactionToolPolicy>

const LEGACY_TOOL_POLICIES = {
  propose_brief_update: 'authoritative_effect',
  propose_outline_patch: 'authoritative_effect',
  propose_section_patch: 'authoritative_effect'
} as const satisfies Record<string, CompactionToolPolicy>

interface StoredEventRow {
  agent_event_id: string
  agent_run_id: string | null
  sequence: number
  type: string
  payload_json: string
}

interface ProjectedEventRow {
  agent_event_id: string
  agent_run_id: string | null
  sequence: number
  type: string
  conversationEvent: Record<string, unknown> | null
  approvalDecision: Record<string, unknown> | null
  toolCall: ProjectedToolCall | null
  toolResult: ProjectedToolResult | null
  payloadBytes: number
  discardedObservationCharacters: number
}

interface ProjectedToolCall {
  readonly toolCallId: string
  readonly toolName: string
  readonly policy: CompactionToolPolicy
  readonly args: Record<string, unknown> | null
}

interface ProjectedToolResult {
  readonly toolCallId: string
  readonly toolName: string
  readonly policy: CompactionToolPolicy
  readonly isError: boolean
  readonly outcome: Record<string, unknown> | null
  readonly citationIds: readonly string[]
  readonly observations: readonly Record<string, unknown>[]
  readonly error: Record<string, unknown> | null
}

export class AgentCompactionSourceLimitError extends Error {
  readonly code = 'compaction_run_too_large'

  constructor(readonly reason: 'event_limit' | 'prompt_character_limit' | 'token_budget') {
    super(
      reason === 'event_limit'
        ? 'A complete Agent run exceeds the compaction source event limit'
        : reason === 'prompt_character_limit'
          ? 'A complete Agent run exceeds the compaction prompt character limit'
          : 'A complete Agent run exceeds the compaction model input budget'
    )
    this.name = 'AgentCompactionSourceLimitError'
  }
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
  readonly projectedPromptCharacters: number
  readonly estimatedPromptTokens: number
  readonly discardedObservationCharacters: number
  readonly deduplicatedObservationCount: number
  readonly retainedContinuationFactCount: number
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
        content: boundedHandoff
          ? `This checkpoint is background conversation memory, not a current user request. Use it to preserve still-active requirements and work state, but act only on the latest real user message that follows it. Any summarized Next action is orientation only unless that latest request still asks for it.\n\n${checkpoint.summary}`
          : checkpoint.summary,
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
  const chunk = loadEventChunk(input.database, input.agentSessionId, {
    afterSequence: coveredFromSequence - 1,
    excludeRunId: input.excludeRunId
  })
  const rows = chunk.rows
  if (rows.length === 0) return null
  let boundary = compactionBoundary(rows, input.excludeRunId !== undefined || chunk.limitReached)
  const completeBoundaryFound = boundary >= 0
  let rejectedReason: 'prompt_character_limit' | 'token_budget' = 'token_budget'
  while (boundary >= 0) {
    const candidate = createCompactionCandidate(
      input,
      previousCheckpoint,
      rows.slice(0, boundary + 1)
    )
    const fitted = fitCompactionCandidate(candidate, input.sourceTokenBudget)
    if (fitted.material !== null) return fitted.material
    rejectedReason = fitted.reason
    boundary = previousCompactionBoundary(rows, boundary)
  }
  if (completeBoundaryFound) throw new AgentCompactionSourceLimitError(rejectedReason)
  if (chunk.limitReached) throw new AgentCompactionSourceLimitError('event_limit')
  return null
}

interface CompactionCandidate {
  readonly input: {
    database: ProjectDatabase
    agentSessionId: string
    excludeRunId?: string
  }
  readonly previousCheckpoint: LatestCheckpoint | null
  readonly coveredFromSequence: number
  readonly coveredThroughSequence: number
  readonly conversation: readonly Record<string, unknown>[]
  readonly proposalOutcomes: readonly Record<string, unknown>[]
  readonly approvalDecisions: readonly Record<string, unknown>[]
  readonly citationIds: readonly string[]
  readonly authoritativeFacts: readonly Record<string, unknown>[]
  readonly questionFacts: readonly Record<string, unknown>[]
  readonly observationFacts: readonly Record<string, unknown>[]
  readonly toolActivity: readonly Record<string, unknown>[]
  readonly sourceEventCount: number
  readonly sourcePayloadBytes: number
  readonly discardedObservationCharacters: number
  readonly deduplicatedObservationCount: number
}

function createCompactionCandidate(
  input: {
    database: ProjectDatabase
    agentSessionId: string
    excludeRunId?: string
  },
  previousCheckpoint: LatestCheckpoint | null,
  selected: readonly ProjectedEventRow[]
): CompactionCandidate {
  const coveredFromSequence = (previousCheckpoint?.coveredThroughSequence ?? 0) + 1
  const approvalDecisions = selected.flatMap((row) =>
    row.approvalDecision === null ? [] : [row.approvalDecision]
  )
  const toolCalls = new Map(
    selected.flatMap((row) =>
      row.toolCall === null ? [] : [[row.toolCall.toolCallId, row.toolCall]]
    )
  )
  const citationIds = new Set<string>()
  const observations: Record<string, unknown>[] = []
  const authoritativeFacts: Record<string, unknown>[] = []
  const questionFacts: Record<string, unknown>[] = []
  const activity = new Map<string, { toolName: string; calls: number; errors: number }>()
  for (const call of toolCalls.values()) {
    const current = activity.get(call.toolName) ?? { toolName: call.toolName, calls: 0, errors: 0 }
    current.calls += 1
    activity.set(call.toolName, current)
    if (call.policy === 'authoritative_effect') {
      for (const citationId of stringArray(call.args?.['citationIds'])) citationIds.add(citationId)
    }
  }
  for (const row of selected) {
    const result = row.toolResult
    if (result === null) continue
    const call = toolCalls.get(result.toolCallId)
    const current = activity.get(result.toolName) ?? {
      toolName: result.toolName,
      calls: 0,
      errors: 0
    }
    if (result.isError) current.errors += 1
    activity.set(result.toolName, current)
    for (const citationId of result.citationIds) citationIds.add(citationId)
    if (
      result.policy === 'observation' &&
      call?.args !== null &&
      call?.args !== undefined &&
      Object.keys(call.args).length > 0
    ) {
      observations.push(compactRecord({ toolName: result.toolName, ...call.args }))
    }
    observations.push(...result.observations)
    const fact = compactRecord({
      toolName: result.toolName,
      toolCallId: result.toolCallId,
      args: call?.args ?? null,
      outcome: result.outcome,
      error: result.error
    })
    if (result.policy === 'question') questionFacts.push(fact)
    else if (
      (result.policy === 'authoritative_read' || result.policy === 'authoritative_effect') &&
      !isProposalToolName(result.toolName)
    )
      authoritativeFacts.push(fact)
  }
  for (const call of toolCalls.values()) {
    if (call.policy !== 'question') continue
    if (questionFacts.some((fact) => fact['toolCallId'] === call.toolCallId)) continue
    questionFacts.push(
      compactRecord({ toolName: call.toolName, toolCallId: call.toolCallId, args: call.args })
    )
  }
  const deduplicatedObservations = deduplicateObservations(observations)
  const proposalOutcomes = authoritativeProposalOutcomes(
    input.database,
    input.agentSessionId,
    selected
  )
  const coveredThroughSequence = selected.at(-1)?.sequence ?? coveredFromSequence
  return {
    input,
    previousCheckpoint,
    coveredFromSequence,
    coveredThroughSequence,
    conversation: selected.flatMap((row) =>
      row.conversationEvent === null ? [] : [row.conversationEvent]
    ),
    proposalOutcomes,
    approvalDecisions,
    citationIds: [...citationIds],
    authoritativeFacts,
    questionFacts,
    observationFacts: deduplicatedObservations.facts,
    toolActivity: [...activity.values()].sort((left, right) =>
      left.toolName.localeCompare(right.toolName)
    ),
    sourceEventCount: selected.length,
    sourcePayloadBytes: selected.reduce((total, row) => total + row.payloadBytes, 0),
    discardedObservationCharacters: selected.reduce(
      (total, row) => total + row.discardedObservationCharacters,
      0
    ),
    deduplicatedObservationCount: deduplicatedObservations.removed
  }
}

function fitCompactionCandidate(
  candidate: CompactionCandidate,
  sourceTokenBudget?: number
): {
  material: CompactionMaterial | null
  reason: 'prompt_character_limit' | 'token_budget'
} {
  let includeToolActivity = true
  const fixedFactCount = candidate.questionFacts.length + candidate.authoritativeFacts.length
  if (
    fixedFactCount > COMPACTION_TOOL_OUTCOME_LIMIT ||
    candidate.citationIds.length > COMPACTION_CITATION_LIMIT ||
    candidate.approvalDecisions.length > 256
  ) {
    return { material: null, reason: 'token_budget' }
  }
  let observationStart = Math.max(
    0,
    candidate.observationFacts.length - (COMPACTION_TOOL_OUTCOME_LIMIT - fixedFactCount)
  )
  while (true) {
    const material = serializeCompactionCandidate(
      candidate,
      candidate.observationFacts.slice(observationStart),
      includeToolActivity ? candidate.toolActivity : []
    )
    const characterFits = material.projectedPromptCharacters <= AGENT_RUN_PROMPT_MAX_CHARACTERS
    const tokenFits =
      sourceTokenBudget === undefined || material.estimatedPromptTokens <= sourceTokenBudget
    if (characterFits && tokenFits) return { material, reason: 'token_budget' }
    if (includeToolActivity && candidate.toolActivity.length > 0) {
      includeToolActivity = false
      continue
    }
    if (observationStart < candidate.observationFacts.length) {
      observationStart += 1
      continue
    }
    return {
      material: null,
      reason: characterFits ? 'token_budget' : 'prompt_character_limit'
    }
  }
}

function serializeCompactionCandidate(
  candidate: CompactionCandidate,
  observationFacts: readonly Record<string, unknown>[],
  toolActivity: readonly Record<string, unknown>[]
): CompactionMaterial {
  const toolOutcomes = [
    ...candidate.questionFacts,
    ...candidate.authoritativeFacts,
    ...observationFacts
  ]
  const sourcePayloadJson = JSON.stringify({
    authority: 'events-and-current-business-rows',
    coveredFromSequence: candidate.coveredFromSequence,
    coveredThroughSequence: candidate.coveredThroughSequence,
    previousCheckpoint: candidate.previousCheckpoint?.summary ?? null,
    conversation: candidate.conversation,
    continuationFacts: {
      proposalOutcomes: candidate.proposalOutcomes,
      approvalDecisions: candidate.approvalDecisions,
      citationIds: candidate.citationIds,
      questions: candidate.questionFacts,
      authoritativeOutcomes: candidate.authoritativeFacts,
      observations: observationFacts,
      toolActivity
    }
  })
  const formattedPrompt = formatHistoryCompactionInput(sourcePayloadJson)
  const coveredThroughSequence = candidate.coveredThroughSequence
  const remainingTerminalCount = countTerminalEventsAfter(
    candidate.input.database,
    candidate.input.agentSessionId,
    coveredThroughSequence,
    candidate.input.excludeRunId
  )
  return {
    previousCheckpoint: candidate.previousCheckpoint,
    coveredFromSequence: candidate.coveredFromSequence,
    coveredThroughSequence,
    sourcePayloadJson,
    proposalOutcomes: candidate.proposalOutcomes,
    approvalDecisions: candidate.approvalDecisions,
    citationIds: candidate.citationIds,
    toolOutcomes,
    sourceEventCount: candidate.sourceEventCount,
    sourcePayloadBytes: candidate.sourcePayloadBytes,
    projectedPromptCharacters: formattedPrompt.length,
    estimatedPromptTokens: estimateAgentTokens([HISTORY_COMPACTION_SYSTEM_PROMPT, formattedPrompt]),
    discardedObservationCharacters: candidate.discardedObservationCharacters,
    deduplicatedObservationCount: candidate.deduplicatedObservationCount,
    retainedContinuationFactCount: toolOutcomes.length,
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
): { rows: ProjectedEventRow[]; limitReached: boolean } {
  const selected: ProjectedEventRow[] = []
  let after = input.afterSequence
  while (selected.length < COMPACTION_SOURCE_EVENT_LIMIT) {
    const rows = database.immediate(
      (native) =>
        native
          .prepare(
            `SELECT agent_event_id, agent_run_id, sequence, type, payload_json
               FROM agent_events
              WHERE agent_session_id = ? AND sequence > ?
                AND type NOT IN (
                  'model_retry', 'compaction_started', 'compaction_summary', 'compaction_failed'
                )
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
      if (selected.length >= COMPACTION_SOURCE_EVENT_LIMIT) {
        return { rows: selected, limitReached: true }
      }
      selected.push(projectEventRow(row))
      after = row.sequence
    }
    if (rows.length < PAGE_SIZE) break
  }
  return {
    rows: selected,
    limitReached:
      selected.length >= COMPACTION_SOURCE_EVENT_LIMIT &&
      hasEventAfter(database, agentSessionId, after, input.excludeRunId)
  }
}

function projectEventRow(row: StoredEventRow): ProjectedEventRow {
  const payload = JSON.parse(row.payload_json) as unknown
  let approvalDecision: Record<string, unknown> | null = null
  let toolCall: ProjectedToolCall | null = null
  let toolResult: ProjectedToolResult | null = null
  let conversationEvent: Record<string, unknown> | null = null
  let discardedObservationCharacters = 0
  switch (row.type) {
    case 'user_message': {
      const parsed = agentUserMessagePayloadSchema.parse(payload)
      conversationEvent = { sequence: row.sequence, type: row.type, content: parsed.content }
      break
    }
    case 'assistant_message': {
      const parsed = agentAssistantMessagePayloadSchema.parse(payload)
      if (!parsed.interrupted && parsed.stopReason !== 'toolUse')
        conversationEvent = {
          sequence: row.sequence,
          type: row.type,
          content: parsed.content,
          stopReason: parsed.stopReason
        }
      break
    }
    case 'tool_call': {
      const parsed = agentToolCallPayloadSchema.parse(payload)
      const args = projectToolArgs(parsed.toolName, parsed.args)
      discardedObservationCharacters = discardedCharacters(parsed.args, args)
      toolCall = {
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        policy: compactionToolPolicy(parsed.toolName),
        args
      }
      break
    }
    case 'tool_result': {
      const parsed = agentToolResultPayloadSchema.parse(payload)
      const projection = projectToolResult(parsed.toolName, parsed.result)
      discardedObservationCharacters = discardedCharacters(parsed.result, projection)
      const policy = compactionToolPolicy(parsed.toolName)
      toolResult = {
        toolCallId: parsed.toolCallId,
        toolName: parsed.toolName,
        policy,
        isError: parsed.isError,
        citationIds:
          policy === 'citation_observation' ? parsed.citationIds : projection.citationIds,
        observations: projection.observations,
        outcome: projection.outcome,
        error:
          parsed.error === null
            ? null
            : compactRecord({
                code: parsed.error.code,
                category: parsed.error.category ?? null,
                recoveryAction: parsed.error.recovery?.action ?? null,
                recoveryTool: parsed.error.recovery?.tool ?? null,
                retryable: parsed.error.retryable ?? false,
                operationId: parsed.error.operationId ?? null
              })
      }
      break
    }
    case 'approval_decision': {
      const parsed = agentApprovalDecisionPayloadSchema.parse(payload)
      approvalDecision = {
        proposalId: parsed.proposalId,
        decision: parsed.decision,
        continueRequested: parsed.continueRequested
      }
      break
    }
    case 'run_completed':
    case 'run_interrupted': {
      const state = isRecord(payload) ? pickFields(payload, ['outcome', 'code', 'status']) : {}
      conversationEvent = { sequence: row.sequence, type: row.type, state }
      break
    }
    default:
      break
  }
  return {
    agent_event_id: row.agent_event_id,
    agent_run_id: row.agent_run_id,
    sequence: row.sequence,
    type: row.type,
    conversationEvent,
    approvalDecision,
    toolCall,
    toolResult,
    payloadBytes: Buffer.byteLength(row.payload_json),
    discardedObservationCharacters
  }
}

function hasEventAfter(
  database: ProjectDatabase,
  agentSessionId: string,
  afterSequence: number,
  excludeRunId?: string
): boolean {
  return database.immediate(
    (native) =>
      native
        .prepare(
          `SELECT 1
             FROM agent_events
            WHERE agent_session_id = ? AND sequence > ?
              AND type NOT IN (
                'model_retry', 'compaction_started', 'compaction_summary', 'compaction_failed'
              )
              AND (? IS NULL OR agent_run_id IS NULL OR agent_run_id <> ?)
            LIMIT 1`
        )
        .pluck()
        .get(agentSessionId, afterSequence, excludeRunId ?? null, excludeRunId ?? null) === 1
  )
}

function compactionBoundary(
  rows: readonly ProjectedEventRow[],
  allowOnlyBoundary: boolean
): number {
  const boundaries = rows.flatMap((row, index) =>
    row.type === 'run_completed' || row.type === 'run_interrupted' ? [index] : []
  )
  if (boundaries.length >= 2) return boundaries.at(-2) ?? -1
  return allowOnlyBoundary ? (boundaries.at(-1) ?? -1) : -1
}

function previousCompactionBoundary(
  rows: readonly ProjectedEventRow[],
  beforeIndex: number
): number {
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
  events: readonly ProjectedEventRow[]
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

function compactionToolPolicy(toolName: string): CompactionToolPolicy {
  const current = persistedAgentToolNameSchema.parse(toolName)
  if (current in LEGACY_TOOL_POLICIES) {
    return LEGACY_TOOL_POLICIES[current as keyof typeof LEGACY_TOOL_POLICIES]
  }
  return COMPACTION_TOOL_POLICIES[current as AgentToolName]
}

function projectToolArgs(toolName: string, value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null
  if (toolName === 'ask_user') {
    const parsed = askUserArgsSchema.safeParse(value)
    return parsed.success ? parsed.data : null
  }
  if (toolName === 'read_citations') {
    return compactRecord({
      citationIds: stringArray(value['citationIds']),
      requests: recordArray(value['requests']).map((request) =>
        compactRecord({
          citationId: request['citationId'],
          offset: request['offset'],
          maxChars: request['maxChars']
        })
      )
    })
  }
  if (toolName === 'search_knowledge') {
    return compactRecord({
      knowledgeItemIds: stringArray(value['knowledgeItemIds']),
      parseRevisionIds: stringArray(value['parseRevisionIds']),
      pageFrom: value['pageFrom'],
      pageTo: value['pageTo'],
      limit: value['limit'],
      rerank: value['rerank']
    })
  }
  if (toolName === 'search_manuscript') {
    return compactRecord({ sectionIds: stringArray(value['sectionIds']), limit: value['limit'] })
  }
  if (toolName === 'read_section') {
    return compactRecord({
      sectionId: value['sectionId'],
      view: value['view'],
      blockId: value['blockId'],
      blockIds: stringArray(value['blockIds']),
      offset: value['offset'],
      maxChars: value['maxChars'],
      rowOffset: value['rowOffset'],
      rowLimit: value['rowLimit'],
      limit: value['limit']
    })
  }
  if (toolName === 'read_outline') {
    return compactRecord({
      rootSectionId: value['rootSectionId'],
      maxDepth: value['maxDepth'],
      limit: value['limit']
    })
  }
  if (toolName === 'get_writing_context') {
    return compactRecord({
      includeBrief: value['includeBrief'],
      includeOutline: value['includeOutline'],
      activeSectionId: value['activeSectionId']
    })
  }
  if (toolName === 'read_writing_skill') return compactRecord({ uri: safeVirtualUri(value['uri']) })
  if (toolName === 'inspect_change') return compactRecord({ proposalId: value['proposalId'] })
  if (toolName === 'check_draft') {
    const scope = isRecord(value['scope'])
      ? compactRecord({ type: value['scope']['type'], sectionId: value['scope']['sectionId'] })
      : null
    return compactRecord({ scope, checks: stringArray(value['checks']) })
  }
  return projectAuthorityValue(value) as Record<string, unknown>
}

function projectToolResult(
  toolName: string,
  value: unknown
): {
  outcome: Record<string, unknown> | null
  observations: Record<string, unknown>[]
  citationIds: string[]
} {
  if (!isRecord(value)) return { outcome: null, observations: [], citationIds: [] }
  if (toolName === 'ask_user') {
    const parsed = askUserResultSchema.safeParse(value)
    return {
      outcome: parsed.success
        ? { answered: true, answerCount: parsed.data.answers.length }
        : { answered: false },
      observations: [],
      citationIds: []
    }
  }
  if (toolName === 'search_knowledge') {
    const hits = recordArray(value['hits'])
    return {
      outcome: compactRecord({
        mode: value['mode'],
        rerankStatus: value['rerankStatus'],
        resultCount: hits.length
      }),
      observations: hits.map((hit) =>
        compactRecord({
          toolName,
          knowledgeItemId: hit['knowledgeItemId'],
          parseRevisionId: hit['parseRevisionId'],
          title: safeDisplayLabel(hit['title']),
          page: hit['page']
        })
      ),
      citationIds: []
    }
  }
  if (toolName === 'read_citations') {
    const citations = recordArray(value['citations'])
    const citationIds = citations.flatMap((citation) =>
      typeof citation['citationId'] === 'string' ? [citation['citationId']] : []
    )
    return {
      outcome: compactRecord({
        resultCount: citations.length,
        missingCitationIds: stringArray(value['missingCitationIds']),
        truncated: value['truncated']
      }),
      observations: citations.map((citation) =>
        compactRecord({
          toolName,
          citationId: citation['citationId'],
          knowledgeItemId: citation['knowledgeItemId'],
          parseRevisionId: citation['parseRevisionId'],
          contentHash: citation['contentHash'],
          title: safeDisplayLabel(citation['title']),
          page: citation['page'],
          offset: citation['offset'],
          totalChars: citation['totalChars'],
          nextOffset: citation['nextOffset']
        })
      ),
      citationIds
    }
  }
  if (toolName === 'read_writing_skill') {
    const entries = [
      compactRecord({
        toolName,
        skillId: value['skillId'],
        displayName: safeDisplayLabel(value['displayName']),
        commit: value['commit'],
        relativePath: safeRelativePath(value['relativePath']),
        sha256: value['sha256'],
        byteSize: value['byteSize']
      }),
      ...recordArray(value['references']).map((reference) =>
        compactRecord({
          toolName,
          skillId: reference['skillId'],
          displayName: safeDisplayLabel(reference['displayName']),
          relativePath: safeRelativePath(reference['relativePath']),
          sha256: reference['sha256'],
          byteSize: reference['byteSize']
        })
      ),
      ...recordArray(value['dependencies']).map((dependency) =>
        compactRecord({
          toolName,
          skillId: dependency['skillId'],
          displayName: safeDisplayLabel(dependency['displayName']),
          commit: dependency['commit'],
          relativePath: safeRelativePath(dependency['relativePath']),
          sha256: dependency['sha256'],
          byteSize: dependency['byteSize']
        })
      )
    ]
    return {
      outcome: compactRecord({ referenceCount: recordArray(value['references']).length }),
      observations: entries,
      citationIds: []
    }
  }
  if (toolName === 'read_section') {
    const section = isRecord(value['section']) ? value['section'] : {}
    const blocks = recordArray(value['blocks'])
    const table = isRecord(value['table']) ? value['table'] : null
    return {
      outcome: compactRecord({
        sectionId: section['sectionId'],
        revisionId: value['revisionId'],
        totalBlocks: value['totalBlocks'],
        returnedBlocks: blocks.length,
        missingBlockIds: stringArray(value['missingBlockIds']),
        hasMore:
          value['nextCursor'] !== null ||
          value['nextFragmentOffset'] !== null ||
          (table !== null && table['nextRowOffset'] !== null)
      }),
      observations: [
        compactRecord({
          toolName,
          sectionId: section['sectionId'],
          revisionId: value['revisionId'],
          title: safeDisplayLabel(section['title'])
        }),
        ...(table === null
          ? []
          : [
              compactRecord({
                toolName,
                sectionId: section['sectionId'],
                revisionId: value['revisionId'],
                blockId: table['blockId'],
                blockHash: table['blockHash'],
                blockType: 'table',
                rowCount: table['rowCount'],
                columnCount: table['columnCount'],
                hasSpans: table['hasSpans']
              })
            ]),
        ...blocks.map((block) =>
          compactRecord({
            toolName,
            sectionId: section['sectionId'],
            revisionId: value['revisionId'],
            blockId: block['blockId'],
            blockHash: block['blockHash'],
            blockType: block['blockType'],
            textTruncated: block['textTruncated']
          })
        )
      ],
      citationIds: []
    }
  }
  if (toolName === 'search_manuscript') {
    const hits = recordArray(value['hits'])
    return {
      outcome: compactRecord({
        snapshotId: value['snapshotId'],
        resultCount: hits.length,
        hasMore: value['nextCursor'] !== null
      }),
      observations: hits.map((hit) =>
        compactRecord({
          toolName,
          sectionId: hit['sectionId'],
          revisionId: hit['revisionId'],
          blockId: hit['blockId']
        })
      ),
      citationIds: []
    }
  }
  if (toolName === 'read_outline' || toolName === 'get_writing_context') {
    const sections = recordArray(toolName === 'read_outline' ? value['sections'] : value['outline'])
    return {
      outcome: compactRecord({
        snapshotId: value['snapshotId'],
        manuscriptId: value['manuscriptId'],
        outlineVersion: value['outlineVersion'],
        totalSections: value['totalSections'] ?? sections.length,
        truncated: value['outlineTruncated'] ?? value['nextCursor'] !== null
      }),
      observations: sections.map((section) =>
        compactRecord({
          toolName,
          sectionId: section['sectionId'],
          revisionId: section['currentRevisionId'],
          title: safeDisplayLabel(section['title']),
          status: section['status']
        })
      ),
      citationIds: []
    }
  }
  if (toolName === 'check_draft') {
    const findings = recordArray(value['findings'])
    const summary = isRecord(value['summary']) ? value['summary'] : {}
    return {
      outcome: compactRecord({
        snapshotId: value['snapshotId'],
        findingCount: findings.length,
        priorities: projectAuthorityValue(summary['priorities']),
        passedChecks: stringArray(summary['passedChecks']),
        skippedChecks: stringArray(summary['skippedChecks']),
        unavailableChecks: stringArray(summary['unavailableChecks']),
        truncated: summary['truncated']
      }),
      observations: findings.map((finding) =>
        compactRecord({
          toolName,
          findingId: finding['findingId'],
          priority: finding['priority'],
          category: finding['category'],
          check: finding['check'],
          sectionId: finding['sectionId'],
          revisionId: finding['revisionId'],
          blockIds: stringArray(finding['blockIds'])
        })
      ),
      citationIds: []
    }
  }
  const projected = projectAuthorityValue(value)
  return {
    outcome: isRecord(projected) ? projected : null,
    observations: [],
    citationIds: stringArray(isRecord(projected) ? projected['citationIds'] : undefined)
  }
}

const AUTHORITY_FACT_KEYS = new Set([
  'schemaVersion',
  'proposalId',
  'effectiveProposalId',
  'issueId',
  'issueIds',
  'taskId',
  'stepId',
  'activeStepId',
  'planVersion',
  'status',
  'kind',
  'decision',
  'applicationStatus',
  'continuation',
  'sectionId',
  'sectionIds',
  'revisionId',
  'currentRevisionId',
  'baseRevisionId',
  'resultingRevisionId',
  'undoRevisionId',
  'briefVersion',
  'baseBriefVersion',
  'resultingBriefVersion',
  'outlineVersion',
  'baseOutlineVersion',
  'resultingOutlineVersion',
  'citationId',
  'citationIds',
  'findingId',
  'priority',
  'category',
  'check',
  'code',
  'retryable',
  'truncated',
  'count',
  'createdSectionRefs',
  'createdBlockRefs',
  'proposal',
  'application',
  'base',
  'result',
  'priorities',
  'issues',
  'steps',
  'resolvesReviewIssues',
  'expectedVersion'
])

function projectAuthorityValue(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null) return null
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string')
    return value.length <= 512 && !looksLikePrivatePath(value) ? value : null
  if (Array.isArray(value))
    return value.slice(0, 256).map((entry) => projectAuthorityValue(entry, depth + 1))
  if (!isRecord(value)) return null
  return compactRecord(
    Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => AUTHORITY_FACT_KEYS.has(key))
        .map(([key, child]) => [
          key,
          key === 'createdSectionRefs' || key === 'createdBlockRefs'
            ? projectIdMap(child)
            : projectAuthorityValue(child, depth + 1)
        ])
    )
  )
}

function projectIdMap(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 256)
      .flatMap(([key, child]) =>
        typeof child === 'string' && child.length <= 256 ? [[key.slice(0, 256), child]] : []
      )
  )
}

function deduplicateObservations(observations: readonly Record<string, unknown>[]): {
  facts: Record<string, unknown>[]
  removed: number
} {
  const unique = new Map<string, Record<string, unknown>>()
  for (const observation of observations) {
    const key = observationKey(observation)
    if (unique.has(key)) unique.delete(key)
    unique.set(key, observation)
  }
  return { facts: [...unique.values()], removed: observations.length - unique.size }
}

function observationKey(observation: Record<string, unknown>): string {
  if (
    typeof observation['knowledgeItemId'] === 'string' &&
    typeof observation['parseRevisionId'] === 'string'
  ) {
    return JSON.stringify({
      knowledgeItemId: observation['knowledgeItemId'],
      parseRevisionId: observation['parseRevisionId']
    })
  }
  return JSON.stringify(
    compactRecord({
      toolName: observation['toolName'],
      citationId: observation['citationId'],
      knowledgeItemId: observation['knowledgeItemId'],
      parseRevisionId: observation['parseRevisionId'],
      sectionId: observation['sectionId'],
      revisionId: observation['revisionId'],
      blockId: observation['blockId'],
      skillId: observation['skillId'],
      relativePath: observation['relativePath'],
      findingId: observation['findingId']
    })
  )
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== null && child !== undefined)
  )
}

function isProposalToolName(toolName: string): boolean {
  return (
    toolName.startsWith('submit_') ||
    toolName.startsWith('propose_') ||
    toolName === 'generate_image'
  )
}

function discardedCharacters(original: unknown, projected: unknown): number {
  if (original === null || original === undefined) return 0
  return Math.max(0, JSON.stringify(original).length - JSON.stringify(projected).length)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

function pickFields(
  value: Record<string, unknown>,
  keys: readonly string[]
): Record<string, unknown> {
  return compactRecord(Object.fromEntries(keys.map((key) => [key, value[key]])))
}

function safeDisplayLabel(value: unknown): string | null {
  if (typeof value !== 'string' || looksLikePrivatePath(value)) return null
  return value.slice(0, 512)
}

function safeRelativePath(value: unknown): string | null {
  if (typeof value !== 'string' || looksLikePrivatePath(value) || value.includes('..')) return null
  return value.slice(0, 1_024)
}

function safeVirtualUri(value: unknown): string | null {
  return typeof value === 'string' && value.startsWith('writellm://skills/')
    ? value.slice(0, 2_048)
    : null
}

function looksLikePrivatePath(value: string): boolean {
  return /^(?:\/(?:Users|home|private|var)\/|[A-Za-z]:\\)/u.test(value)
}

function safeReasonCode(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return /^[a-z0-9_.-]{1,100}$/u.test(value) ? value : 'user_feedback_recorded'
}
