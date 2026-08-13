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
    if (selected.length === 0) {
      const projected = projectReadToolResults(group)
      const projectedTokens = estimateAgentTokens(projected)
      if (projectedTokens <= budget) {
        selected.push(projected)
        tokens += projectedTokens
        continue
      }
      throw new AgentCurrentTurnTooLargeError()
    }
  }
  return selected.reverse().flat()
}

function projectReadToolResults(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((message) => {
    if (!isProjectableToolResult(message)) return message
    const facts = projectSafeFacts(message.details)
    return {
      ...message,
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            projected: true,
            toolName: message.toolName,
            toolCallId: message.toolCallId,
            isError: message.isError,
            facts
          })
        }
      ],
      details: facts
    }
  })
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
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => SAFE_FACT_KEYS.has(key))
      .map(([key, entry]) => [key, projectSafeFacts(entry, depth + 1)])
  )
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
