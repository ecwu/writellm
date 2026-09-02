import type { UserMessage } from '@earendil-works/pi-ai'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AgentModelLimits } from './contracts/agent'

export const AGENT_CONTEXT_WINDOW_TOKENS = 131_072
export const AGENT_DEFAULT_OUTPUT_TOKENS = 8_192
/** The existing generic runtime message boundary, shared with agentHistorySchema. */
export const AGENT_RUNTIME_HISTORY_MAX_BYTES = 2_097_152

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

export function agentOutputLimit(
  requestedTokens: number,
  limits: AgentModelLimits = legacyLimits()
): number {
  const outputLimit = limits.outputLimitTokens ?? requestedTokens
  return Math.min(requestedTokens, outputLimit)
}

/**
 * Return the model input window after reserving its output.  Prompt and tool
 * overhead is accounted for by `agentRuntimeMessageBudget`, where it is
 * available; this helper deliberately has no hidden safety reserve.
 */
export function agentMessageBudget(
  maxOutputTokens = AGENT_DEFAULT_OUTPUT_TOKENS,
  limits: AgentModelLimits = legacyLimits()
): number {
  const outputReserve = agentOutputLimit(maxOutputTokens, limits)
  const budget = Math.floor(
    Math.min(
      limits.inputLimitTokens ?? Number.POSITIVE_INFINITY,
      limits.contextWindowTokens - outputReserve
    )
  )
  if (budget <= 0) {
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
  const budget = Math.floor(
    effectiveInputLimit -
      estimateAgentTokens(input.systemPrompt) -
      estimateAgentTokens(input.advertisedTools)
  )
  if (budget <= 0) {
    throw new AgentModelCapacityError(input.limits.contextWindowTokens, budget)
  }
  return budget
}

export class AgentModelCapacityError extends Error {
  constructor(
    readonly contextWindowTokens: number,
    readonly availableMessageTokens: number
  ) {
    super('The configured model has no positive Agent input capacity after reserving output')
    this.name = 'AgentModelCapacityError'
  }
}

export class AgentCurrentTurnTooLargeError extends Error {
  readonly code = 'current_turn_too_large'

  constructor(
    readonly requiredTokens: number | null = null,
    readonly availableTokens: number | null = null
  ) {
    super(
      requiredTokens !== null && availableTokens !== null
        ? `The current Agent turn needs approximately ${requiredTokens} tokens, but only ${availableTokens} are available`
        : 'The current Agent turn exceeds the selected provider context'
    )
    this.name = 'AgentCurrentTurnTooLargeError'
  }
}

/**
 * This event is retained as a wire-compatible name for old workers.  It is a
 * stateless projection notice, not a retry counter or a recovery state.
 */
export type AgentContextProjectionEvent = {
  readonly type: 'active_batch_retry'
  readonly batchKey: string
  readonly toolNames: string[]
  readonly requiredTokens: number
  readonly availableTokens: number
}

export class AgentContextBudgetController {
  constructor(
    private tokenBudget: number,
    private readonly onProjection?: (event: AgentContextProjectionEvent) => void
  ) {
    this.tokenBudget = normalizeTokenBudget(tokenBudget)
  }

  setTokenBudget(tokenBudget: number): void {
    this.tokenBudget = normalizeTokenBudget(tokenBudget)
  }

  transform(messages: AgentMessage[]): AgentMessage[] {
    const result = boundAgentContext(messages, this.tokenBudget)
    for (const projection of result.projectedBatches) {
      this.onProjection?.(projection)
    }
    return result.messages
  }
}

export function boundAgentContextByTokens(
  messages: AgentMessage[],
  tokenBudget: number
): AgentMessage[] {
  return boundAgentContext(messages, normalizeTokenBudget(tokenBudget)).messages
}

type AgentContextUnit = {
  readonly messages: AgentMessage[]
  readonly kind: 'user' | 'assistant_batch' | 'other'
  readonly batchKey: string | null
  readonly projectableReadBatch: boolean
}

type BoundAgentContextResult = {
  readonly messages: AgentMessage[]
  readonly projectedBatches: AgentContextProjectionEvent[]
}

function boundAgentContext(messages: AgentMessage[], tokenBudget: number): BoundAgentContextResult {
  const activeStart = activeRequestStart(messages)
  const completedGroups = groupAgentTurns(messages.slice(0, activeStart))
  const activeUnits = groupAgentMessageBatches(messages.slice(activeStart))
  const selectedActive = activeUnits.map((unit) => unit.messages)
  const projectedBatches: AgentContextProjectionEvent[] = []

  // The active request is never dropped.  Read results can be replaced with
  // a stateless delivery error, while mutation/effect results remain atomic
  // and therefore make the current turn fail with concrete token details.
  let activeTokens = estimateAgentTokens(selectedActive.flat())
  let activeBytes = serializedAgentMessageBytes(selectedActive.flat())
  const projectableIndexes = activeUnits
    .map((unit, index) => ({ index, tokens: estimateAgentTokens(unit.messages), unit }))
    .filter(({ unit }) => unit.projectableReadBatch)
    .sort((left, right) => right.tokens - left.tokens)
  for (const candidate of projectableIndexes) {
    if (activeTokens <= tokenBudget && activeBytes <= AGENT_RUNTIME_HISTORY_MAX_BYTES) break
    const availableTokens = Math.max(
      0,
      tokenBudget -
        estimateAgentTokens(selectedActive.filter((_, index) => index !== candidate.index).flat())
    )
    selectedActive[candidate.index] = projectToolBatch(
      candidate.unit,
      'active_batch_retry',
      candidate.tokens,
      availableTokens
    )
    activeTokens = estimateAgentTokens(selectedActive.flat())
    activeBytes = serializedAgentMessageBytes(selectedActive.flat())
    const batchKey = candidate.unit.batchKey
    if (batchKey !== null) {
      projectedBatches.push({
        type: 'active_batch_retry',
        batchKey,
        toolNames: toolResultNames(candidate.unit),
        requiredTokens: candidate.tokens,
        availableTokens
      })
    }
  }
  if (activeTokens > tokenBudget || activeBytes > AGENT_RUNTIME_HISTORY_MAX_BYTES) {
    throw new AgentCurrentTurnTooLargeError(activeTokens, tokenBudget)
  }

  let tokens = activeTokens
  const selectedCompleted: AgentMessage[][] = []
  for (const group of [...completedGroups].reverse()) {
    const groupTokens = estimateAgentTokens(group)
    const candidateMessages = [...group, ...selectedCompleted.flat(), ...selectedActive.flat()]
    if (
      tokens + groupTokens > tokenBudget ||
      serializedAgentMessageBytes(candidateMessages) > AGENT_RUNTIME_HISTORY_MAX_BYTES
    )
      break
    selectedCompleted.push(group)
    tokens += groupTokens
  }
  return {
    messages: [...selectedCompleted.reverse().flat(), ...selectedActive.flat()],
    projectedBatches
  }
}

function normalizeTokenBudget(tokenBudget: number): number {
  const budget = Math.floor(tokenBudget)
  if (!Number.isFinite(budget) || budget <= 0) {
    throw new AgentModelCapacityError(0, budget)
  }
  return budget
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
          results.length > 0 &&
          results.every(
            (result) => isProjectableToolResult(result) && !isProjectedReadResult(result)
          )
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

function projectToolBatch(
  unit: AgentContextUnit,
  mode: 'active_batch_retry',
  requiredTokens: number,
  availableTokens: number
): AgentMessage[] {
  if (!unit.projectableReadBatch) return unit.messages
  return unit.messages.map((message) => {
    if (!isProjectableToolResult(message)) return message
    const envelope = {
      schemaVersion: 2,
      projection: mode,
      contentAvailable: false,
      mutationAuthority: false,
      code: 'tool_result_batch_too_large',
      retryable: true,
      toolName: message.toolName,
      toolCallId: message.toolCallId,
      requiredTokens,
      availableTokens,
      message: `This read result needs approximately ${requiredTokens} tokens, but only ${availableTokens} are available. Retry the read with a smaller range, page, or result count.`
    }
    return {
      ...message,
      content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
      details: envelope,
      isError: true
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
  return message.role === 'toolResult' && PROJECTABLE_READ_TOOLS.has(message.toolName)
}

function isProjectedReadResult(message: Extract<AgentMessage, { role: 'toolResult' }>): boolean {
  return (
    message.details !== undefined &&
    message.details !== null &&
    typeof message.details === 'object' &&
    'projection' in message.details &&
    message.details['projection'] === 'active_batch_retry'
  )
}

export function contextWouldTruncate(messages: AgentMessage[], tokenBudget: number): boolean {
  return (
    estimateAgentTokens(messages) > tokenBudget ||
    serializedAgentMessageBytes(messages) > AGENT_RUNTIME_HISTORY_MAX_BYTES
  )
}

function serializedAgentMessageBytes(messages: readonly AgentMessage[]): number {
  return new TextEncoder().encode(JSON.stringify(messages)).byteLength
}

export function groupAgentTurns(messages: AgentMessage[]): AgentMessage[][] {
  const groups: AgentMessage[][] = []
  for (const message of messages) {
    if (isUserMessage(message) || groups.length === 0) groups.push([])
    groups.at(-1)?.push(message)
  }
  return groups
}

function isUserMessage(message: AgentMessage): message is UserMessage {
  return message.role === 'user'
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

/** Deterministic estimate: ASCII is ~4 chars/token; non-ASCII uses UTF-8 width. */
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
