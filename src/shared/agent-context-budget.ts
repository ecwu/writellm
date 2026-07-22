import type { UserMessage } from '@earendil-works/pi-ai'
import type { AgentMessage } from '@earendil-works/pi-agent-core'
import type { AgentModelLimits } from './contracts/agent'

export const AGENT_CONTEXT_WINDOW_TOKENS = 131_072
export const AGENT_CONTEXT_SYSTEM_TOOL_RESERVE_TOKENS = 16_384
export const AGENT_DEFAULT_OUTPUT_TOKENS = 8_192
export const AGENT_MINIMUM_MESSAGE_BUDGET_TOKENS = 4_096

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

export class AgentModelCapacityError extends Error {
  constructor(
    readonly contextWindowTokens: number,
    readonly availableMessageTokens: number
  ) {
    super('The configured model cannot fit WriteLLM’s minimum safe Agent context budget')
    this.name = 'AgentModelCapacityError'
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

export function boundAgentContextByTokens(
  messages: AgentMessage[],
  tokenBudget: number
): AgentMessage[] {
  const budget = Math.max(AGENT_MINIMUM_MESSAGE_BUDGET_TOKENS, Math.floor(tokenBudget))
  const groups = groupAgentTurns(messages)
  const selected: AgentMessage[][] = []
  let tokens = 0
  for (const group of groups.reverse()) {
    const groupTokens = estimateAgentTokens(group)
    if (tokens + groupTokens <= budget) {
      selected.push(group)
      tokens += groupTokens
      continue
    }
    if (selected.length === 0) selected.push(truncateTurn(group, budget))
  }
  return selected.reverse().flat()
}

export function contextWouldTruncate(messages: AgentMessage[], tokenBudget: number): boolean {
  return estimateAgentTokens(messages) > tokenBudget
}

function truncateTurn(group: AgentMessage[], budget: number): AgentMessage[] {
  for (const maximumStringLength of [8192, 4096, 2048, 1024, 512, 256, 128, 64, 32, 16]) {
    const candidate = truncateStrings(group, maximumStringLength) as AgentMessage[]
    if (estimateAgentTokens(candidate) <= budget) return candidate
  }
  const timestamp = group.find(isUserMessage)?.timestamp ?? Date.now()
  return [
    {
      role: 'user',
      content: '[The current turn exceeded the bounded provider context and was safely truncated.]',
      timestamp
    }
  ]
}

function truncateStrings(value: unknown, maximum: number): unknown {
  if (typeof value === 'string') {
    if (value.length <= maximum) return value
    const suffixLength = Math.min(64, Math.floor(maximum / 4))
    return `${value.slice(0, maximum - suffixLength)}…${value.slice(-suffixLength)}`
  }
  if (Array.isArray(value)) return value.map((item) => truncateStrings(item, maximum))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, truncateStrings(child, maximum)])
    )
  }
  return value
}

function isUserMessage(message: AgentMessage): message is UserMessage {
  return (
    message !== null && typeof message === 'object' && 'role' in message && message.role === 'user'
  )
}
