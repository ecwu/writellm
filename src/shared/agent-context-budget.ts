import { createHash } from 'node:crypto'
import type { UserMessage } from '@earendil-works/pi-ai'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AgentModelLimits } from './contracts/agent'

export const AGENT_CONTEXT_WINDOW_TOKENS = 131_072
export const AGENT_CONTEXT_SYSTEM_TOOL_RESERVE_TOKENS = 16_384
export const AGENT_DEFAULT_OUTPUT_TOKENS = 8_192
export const AGENT_MINIMUM_MESSAGE_BUDGET_TOKENS = 4_096
const PROJECTABLE_READ_TOOLS = new Set([
  'get_writing_context',
  'read_outline',
  'read_section',
  'search_knowledge',
  'search_manuscript',
  'read_citations',
  'read_writing_skill',
  'inspect_change',
  'check_draft',
  'list_review_issues'
])
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
  'sectionId',
  'revisionId',
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
  'count',
  'limit',
  'totalBlocks',
  'totalSections',
  'totalChars',
  'truncated',
  'isError'
])

export function agentOutputLimit(
  requestedTokens: number,
  limits: AgentModelLimits = legacyLimits()
): number {
  const outputLimit = limits.outputLimitTokens ?? requestedTokens
  return Math.min(requestedTokens, outputLimit)
}

export function agentMessageBudget(
  maxOutputTokens = AGENT_DEFAULT_OUTPUT_TOKENS,
  limits: AgentModelLimits = legacyLimits()
): number {
  const outputReserve = agentOutputLimit(maxOutputTokens, limits)
  const contextInputLimit =
    limits.contextWindowTokens - AGENT_CONTEXT_SYSTEM_TOOL_RESERVE_TOKENS - outputReserve
  const budget = Math.floor(
    Math.min(contextInputLimit, limits.inputLimitTokens ?? Number.POSITIVE_INFINITY)
  )
  if (budget < AGENT_MINIMUM_MESSAGE_BUDGET_TOKENS) {
    throw new AgentModelCapacityError(limits.contextWindowTokens, budget)
  }
  return budget
}

export function agentRuntimeMessageBudget(input: {
  maxOutputTokens: number
  limits: AgentModelLimits
  systemPrompt: string
  advertisedTools: unknown
}): number {
  const outputReserve = agentOutputLimit(input.maxOutputTokens, input.limits)
  const effectiveInputLimit = Math.floor(
    Math.min(
      input.limits.inputLimitTokens ?? Number.POSITIVE_INFINITY,
      input.limits.contextWindowTokens - outputReserve
    )
  )
  const safetyBuffer = Math.min(16_384, Math.max(4_096, Math.floor(effectiveInputLimit * 0.05)))
  const budget = Math.floor(
    effectiveInputLimit -
      safetyBuffer -
      estimateAgentTokens(input.systemPrompt) -
      estimateAgentTokens(input.advertisedTools)
  )
  if (budget < AGENT_MINIMUM_MESSAGE_BUDGET_TOKENS) {
    throw new AgentModelCapacityError(input.limits.contextWindowTokens, budget)
  }
  return budget
}

export class AgentModelCapacityError extends Error {
  constructor(
    readonly contextWindowTokens: number,
    readonly availableMessageTokens: number
  ) {
    super('The configured model cannot fit WriteLLM’s minimum safe Agent context budget')
    this.name = 'AgentModelCapacityError'
  }
}

export class AgentCurrentTurnTooLargeError extends Error {
  readonly code = 'current_turn_too_large'

  constructor() {
    super('The current Agent turn exceeds the bounded provider context')
    this.name = 'AgentCurrentTurnTooLargeError'
  }
}

function legacyLimits(): AgentModelLimits {
  return {
    contextWindowTokens: AGENT_CONTEXT_WINDOW_TOKENS,
    inputLimitTokens: null,
    outputLimitTokens: null,
    source: 'legacy_fallback',
    catalogModelKey: null,
    resolvedAt: null
  }
}

/** Deterministic conservative estimate: ASCII is ~4 chars/token; non-ASCII uses UTF-8 width. */
export function estimateAgentTokens(value: unknown): number {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  let ascii = 0
  let nonAsciiBytes = 0
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 0x7f) ascii += 1
    else nonAsciiBytes += new TextEncoder().encode(character).byteLength
  }
  return Math.max(1, Math.ceil(ascii / 4) + Math.ceil(nonAsciiBytes / 3))
}

export function groupAgentTurns(messages: AgentMessage[]): AgentMessage[][] {
  const groups: AgentMessage[][] = []
  for (const message of messages) {
    if (isUserMessage(message) || groups.length === 0) groups.push([])
    groups.at(-1)?.push(message)
  }
  return groups
}

type AgentContextUnit = {
  readonly messages: AgentMessage[]
  readonly kind: 'user' | 'assistant_batch' | 'other'
  readonly batchKey: string | null
  readonly projectableReadBatch: boolean
}

export type AgentContextProjectionEvent =
  | { readonly type: 'active_batch_retry'; readonly batchKey: string; readonly toolNames: string[] }
  | { readonly type: 'active_batch_recovered'; readonly batchKey: string }

export class AgentToolBatchContextExhaustedError extends Error {
  readonly code = 'tool_batch_context_exhausted'

  constructor() {
    super('The latest Agent read batch still exceeds context after one smaller-read recovery')
    this.name = 'AgentToolBatchContextExhaustedError'
  }
}

export class AgentContextBudgetController {
  #pendingRecoveryBatchKey: string | null = null
  #terminalError: AgentToolBatchContextExhaustedError | null = null

  constructor(
    private tokenBudget: number,
    private readonly onProjection?: (event: AgentContextProjectionEvent) => void
  ) {}

  setTokenBudget(tokenBudget: number): void {
    if (tokenBudget < AGENT_MINIMUM_MESSAGE_BUDGET_TOKENS) {
      throw new AgentModelCapacityError(0, tokenBudget)
    }
    this.tokenBudget = Math.floor(tokenBudget)
  }

  transform(messages: AgentMessage[]): AgentMessage[] {
    if (this.#terminalError !== null) throw this.#terminalError
    const result = boundAgentContext(messages, this.tokenBudget)
    if (result.activeRetryBatchKey === null) {
      if (
        this.#pendingRecoveryBatchKey !== null &&
        result.latestBatchKey !== this.#pendingRecoveryBatchKey
      ) {
        this.onProjection?.({
          type: 'active_batch_recovered',
          batchKey: this.#pendingRecoveryBatchKey
        })
        this.#pendingRecoveryBatchKey = null
      }
      return result.messages
    }
    if (
      this.#pendingRecoveryBatchKey !== null &&
      this.#pendingRecoveryBatchKey !== result.activeRetryBatchKey
    ) {
      this.#terminalError = new AgentToolBatchContextExhaustedError()
      throw this.#terminalError
    }
    if (this.#pendingRecoveryBatchKey === null) {
      this.#pendingRecoveryBatchKey = result.activeRetryBatchKey
      this.onProjection?.({
        type: 'active_batch_retry',
        batchKey: result.activeRetryBatchKey,
        toolNames: result.activeRetryToolNames
      })
    }
    return result.messages
  }

  terminalError(): AgentToolBatchContextExhaustedError | null {
    return this.#terminalError
  }
}

export function boundAgentContextByTokens(
  messages: AgentMessage[],
  tokenBudget: number
): AgentMessage[] {
  return boundAgentContext(messages, tokenBudget).messages
}

function boundAgentContext(
  messages: AgentMessage[],
  tokenBudget: number
): {
  messages: AgentMessage[]
  activeRetryBatchKey: string | null
  activeRetryToolNames: string[]
  latestBatchKey: string | null
} {
  const budget = Math.max(AGENT_MINIMUM_MESSAGE_BUDGET_TOKENS, Math.floor(tokenBudget))
  const activeStart = activeRequestStart(messages)
  const completedGroups = groupAgentTurns(messages.slice(0, activeStart))
  const activeUnits = groupAgentMessageBatches(messages.slice(activeStart))
  const latestBatchIndex = findLatestAssistantBatch(activeUnits)
  const latestBatch = latestBatchIndex < 0 ? undefined : activeUnits[latestBatchIndex]
  const requiredIndexes = new Set<number>()
  for (const [index, unit] of activeUnits.entries()) {
    if (
      unit.kind === 'user' ||
      !unit.projectableReadBatch ||
      (latestBatchIndex >= 0 && index === latestBatchIndex)
    ) {
      requiredIndexes.add(index)
    }
  }
  let activeRetryBatchKey: string | null = null
  let activeRetryToolNames: string[] = []
  let selectedActive = activeUnits.map((unit) => unit.messages)
  let selectedMessages = selectedActive.flat()
  if (estimateAgentTokens(selectedMessages) > budget) {
    selectedActive = activeUnits.map((unit, index) =>
      requiredIndexes.has(index) ? unit.messages : projectToolBatch(unit, 'historical_projection')
    )
    selectedMessages = selectedActive.flat()
  }
  if (estimateAgentTokens(selectedMessages) > budget) {
    if (latestBatch === undefined || !latestBatch.projectableReadBatch) {
      throw new AgentCurrentTurnTooLargeError()
    }
    selectedActive = activeUnits.map((unit, index) => {
      if (index === latestBatchIndex) return projectToolBatch(unit, 'active_batch_retry')
      if (requiredIndexes.has(index)) return unit.messages
      return projectToolBatch(unit, 'historical_projection')
    })
    selectedMessages = selectedActive.flat()
    if (estimateAgentTokens(selectedMessages) > budget) throw new AgentCurrentTurnTooLargeError()
    activeRetryBatchKey = latestBatch.batchKey
    activeRetryToolNames = toolResultNames(latestBatch)
  }

  let tokens = estimateAgentTokens(selectedMessages)
  const selectedCompleted: AgentMessage[][] = []
  for (const group of [...completedGroups].reverse()) {
    const groupTokens = estimateAgentTokens(group)
    if (tokens + groupTokens > budget) continue
    selectedCompleted.push(group)
    tokens += groupTokens
  }
  return {
    messages: [...selectedCompleted.reverse().flat(), ...selectedMessages],
    activeRetryBatchKey,
    activeRetryToolNames,
    latestBatchKey: latestBatch?.batchKey ?? null
  }
}

function activeRequestStart(messages: readonly AgentMessage[]): number {
  let start = 0
  for (const [index, message] of messages.entries()) {
    if (isTerminalAssistant(message)) start = index + 1
  }
  return start
}

function isTerminalAssistant(message: AgentMessage): boolean {
  return message.role === 'assistant' && !message.content.some((part) => part.type === 'toolCall')
}

function groupAgentMessageBatches(messages: readonly AgentMessage[]): AgentContextUnit[] {
  const units: AgentContextUnit[] = []
  let index = 0
  while (index < messages.length) {
    const message = messages[index]
    if (message === undefined) break
    if (message.role === 'assistant') {
      const batch: AgentMessage[] = [message]
      index += 1
      while (index < messages.length && messages[index]?.role === 'toolResult') {
        const toolResult = messages[index]
        if (toolResult !== undefined) batch.push(toolResult)
        index += 1
      }
      const results = batch.filter(isToolResult)
      units.push({
        messages: batch,
        kind: 'assistant_batch',
        batchKey:
          results.length === 0 ? null : results.map((result) => result.toolCallId).join(':'),
        projectableReadBatch:
          results.length > 0 && results.every((result) => isProjectableToolResult(result))
      })
      continue
    }
    units.push({
      messages: [message],
      kind: message.role === 'user' ? 'user' : 'other',
      batchKey: null,
      projectableReadBatch: false
    })
    index += 1
  }
  return units
}

function findLatestAssistantBatch(units: readonly AgentContextUnit[]): number {
  for (let index = units.length - 1; index >= 0; index -= 1) {
    if (units[index]?.kind === 'assistant_batch' && units[index]?.batchKey !== null) return index
  }
  return -1
}

function projectToolBatch(
  unit: AgentContextUnit,
  mode: 'historical_projection' | 'active_batch_retry'
): AgentMessage[] {
  if (!unit.projectableReadBatch) return unit.messages
  return unit.messages.map((message) => {
    if (!isProjectableToolResult(message)) return message
    const activeRetry = mode === 'active_batch_retry'
    const envelope = activeRetry
      ? {
          schemaVersion: 1,
          projection: mode,
          contentAvailable: false,
          mutationAuthority: false,
          code: 'tool_result_batch_too_large',
          retryable: true,
          toolName: message.toolName,
          toolCallId: message.toolCallId,
          recovery: {
            action: 'retry_smaller_read',
            maxAttempts: 1,
            constraints: {
              maxConcurrentBodyReads: 1,
              readSectionSummaryLimit: 5,
              canonicalFragmentMaxChars: 8_192,
              searchLimit: 5,
              citationRequests: 1
            }
          }
        }
      : {
          schemaVersion: 1,
          projection: mode,
          contentAvailable: false,
          mutationAuthority: false,
          toolName: message.toolName,
          toolCallId: message.toolCallId,
          isError: message.isError,
          facts: projectSafeFacts(unwrapToolDetails(message.details))
        }
    return {
      ...message,
      content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
      details: envelope,
      isError: activeRetry || message.isError
    }
  })
}

function toolResultNames(unit: AgentContextUnit): string[] {
  return [...new Set(unit.messages.filter(isToolResult).map((message) => message.toolName))]
}

function isToolResult(
  message: AgentMessage
): message is Extract<AgentMessage, { role: 'toolResult' }> {
  return message.role === 'toolResult'
}

function isProjectableToolResult(
  message: AgentMessage
): message is Extract<AgentMessage, { role: 'toolResult' }> {
  return (
    message !== null &&
    typeof message === 'object' &&
    'role' in message &&
    message.role === 'toolResult' &&
    PROJECTABLE_READ_TOOLS.has(message.toolName)
  )
}

function projectSafeFacts(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null) return null
  if (typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') {
    if (value.length <= 512 && !looksLikePrivatePath(value)) return value
    return {
      redacted: true,
      originalCharacters: Array.from(value).length,
      sha256: createHash('sha256').update(value).digest('hex')
    }
  }
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((entry) => projectSafeFacts(entry, depth + 1))
  }
  if (typeof value !== 'object') return null
  const facts: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (SAFE_FACT_KEYS.has(key)) {
      facts[key] = projectSafeFacts(entry, depth + 1)
      continue
    }
    if (entry !== null && typeof entry === 'object') {
      const nested = projectSafeFacts(entry, depth + 1)
      if (hasProjectedFacts(nested)) facts[key] = nested
    }
  }
  return facts
}

function unwrapToolDetails(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  return 'data' in record ? record.data : value
}

function hasProjectedFacts(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0
}

function looksLikePrivatePath(value: string): boolean {
  return /^(?:\/(?:Users|home|private|var)\/|[A-Za-z]:\\)/u.test(value)
}

export function contextWouldTruncate(messages: AgentMessage[], tokenBudget: number): boolean {
  return estimateAgentTokens(messages) > tokenBudget
}

function isUserMessage(message: AgentMessage): message is UserMessage {
  return (
    message !== null && typeof message === 'object' && 'role' in message && message.role === 'user'
  )
}
