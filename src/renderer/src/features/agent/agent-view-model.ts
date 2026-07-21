import {
  agentAssistantMessagePayloadSchema,
  agentUserMessagePayloadSchema
} from '../../../../shared/contracts/agent'
import type { AgentEventRecord } from '../../../../shared/contracts/agent-ipc'
import {
  agentToolCallPayloadSchema,
  agentToolResultPayloadSchema,
  readCitationsResultSchema,
  searchKnowledgeResultSchema
} from '../../../../shared/contracts/agent-tools'

type AgentToolResultPayload = ReturnType<typeof agentToolResultPayloadSchema.parse>

export interface AgentCitationDisplay {
  citationId: string
  title: string
  page?: number
}

export function mergeAgentEvents(
  current: AgentEventRecord[],
  incoming: AgentEventRecord
): AgentEventRecord[] {
  if (current.some((event) => event.sequence === incoming.sequence)) return current
  return [...current, incoming].sort((left, right) => left.sequence - right.sequence)
}

export function findToolResult(
  events: AgentEventRecord[],
  toolCallId: string
): AgentToolResultPayload | null {
  for (const event of events) {
    if (event.type !== 'tool_result') continue
    const parsed = agentToolResultPayloadSchema.safeParse(event.payload)
    if (parsed.success && parsed.data.toolCallId === toolCallId) return parsed.data
  }
  return null
}

export function citationDisplaysForToolResult(
  result: AgentToolResultPayload
): AgentCitationDisplay[] {
  const displays = new Map<string, AgentCitationDisplay>()
  if (result.toolName === 'search_knowledge') {
    const parsed = searchKnowledgeResultSchema.safeParse(result.result)
    if (parsed.success) {
      for (const hit of parsed.data.hits) {
        displays.set(hit.citationId, {
          citationId: hit.citationId,
          title: hit.title,
          ...(hit.page === undefined ? {} : { page: hit.page })
        })
      }
    }
  } else if (result.toolName === 'read_citations') {
    const parsed = readCitationsResultSchema.safeParse(result.result)
    if (parsed.success) {
      for (const citation of parsed.data.citations) {
        displays.set(citation.citationId, {
          citationId: citation.citationId,
          title: citation.title,
          ...(citation.page === undefined ? {} : { page: citation.page })
        })
      }
    }
  }

  return result.citationIds.map(
    (citationId) => displays.get(citationId) ?? { citationId, title: citationId }
  )
}

export function findLatestPrompt(events: AgentEventRecord[]): string | null {
  for (const event of [...events].reverse()) {
    if (event.type !== 'user_message') continue
    const parsed = agentUserMessagePayloadSchema.safeParse(event.payload)
    if (parsed.success && parsed.data.delivery === 'prompt') return parsed.data.content
  }
  return null
}

export function aggregateAgentUsage(events: AgentEventRecord[]): {
  inputTokens: number
  outputTokens: number
  retryCount: number
} {
  let inputTokens = 0
  let outputTokens = 0
  let retryCount = 0
  for (const event of events) {
    if (event.type !== 'assistant_message') continue
    const parsed = agentAssistantMessagePayloadSchema.safeParse(event.payload)
    if (!parsed.success) continue
    inputTokens += parsed.data.metadata.usage.inputTokens ?? 0
    outputTokens += parsed.data.metadata.usage.outputTokens ?? 0
    retryCount += parsed.data.metadata.retryCount
  }
  return { inputTokens, outputTokens, retryCount }
}

export function toolCallFromEvent(event: AgentEventRecord) {
  return event.type === 'tool_call' ? agentToolCallPayloadSchema.safeParse(event.payload) : null
}
