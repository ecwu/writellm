import {
  agentAssistantMessagePayloadSchema,
  agentCompactionSummaryPayloadSchema,
  agentUserMessagePayloadSchema
} from '../../../../shared/contracts/agent'
import type { AgentEventRecord, AgentRunRecord } from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import {
  agentToolCallPayloadSchema,
  agentToolResultPayloadSchema,
  readCitationsResultSchema,
  searchKnowledgeResultSchema
} from '../../../../shared/contracts/agent-tools'

type AgentToolResultPayload = ReturnType<typeof agentToolResultPayloadSchema.parse>
type AgentToolCallPayload = ReturnType<typeof agentToolCallPayloadSchema.parse>
type AgentUserMessagePayload = ReturnType<typeof agentUserMessagePayloadSchema.parse>
type AgentAssistantMessagePayload = ReturnType<typeof agentAssistantMessagePayloadSchema.parse>
type AgentCompactionSummaryPayload = ReturnType<typeof agentCompactionSummaryPayloadSchema.parse>
type AgentTerminalEvent = AgentEventRecord & {
  type: 'run_interrupted' | 'run_completed'
}

export interface AgentCitationDisplay {
  citationId: string
  title: string
  page?: number
}

export interface AgentToolActivity {
  eventId: string
  runId: string | null
  call: AgentToolCallPayload
  result: AgentToolResultPayload | null
  durationMs: number
  stopped: boolean
}

export type AgentActivityStatus = 'running' | 'error' | 'complete' | 'stopped'

export type AgentRunTerminal = {
  runId: string | null
  status: 'completed' | 'interrupted' | 'failed'
  code: string
  durationMs: number
}

export type AgentTimelineItem =
  | { type: 'user'; id: string; payload: AgentUserMessagePayload }
  | { type: 'assistant'; id: string; payload: AgentAssistantMessagePayload }
  | {
      type: 'activity'
      id: string
      runId: string | null
      tools: AgentToolActivity[]
      status: AgentActivityStatus
      summary: string
      citations: AgentCitationDisplay[]
    }
  | {
      type: 'proposal'
      id: string
      tool: AgentToolActivity
      proposal: MutationProposalRecord | null
    }
  | { type: 'run_interrupted'; id: string; terminal: AgentRunTerminal }
  | { type: 'run_completed'; id: string; terminal: AgentRunTerminal }
  | { type: 'compaction_summary'; id: string; payload: AgentCompactionSummaryPayload }

export function mergeAgentEvents(
  current: AgentEventRecord[],
  incoming: AgentEventRecord
): AgentEventRecord[] {
  if (current.some((event) => event.sequence === incoming.sequence)) return current
  return [...current, incoming].sort((left, right) => left.sequence - right.sequence)
}

export function protectTerminalAgentRuns(
  current: AgentRunRecord[],
  incoming: AgentRunRecord[],
  terminalRunIds: ReadonlySet<string>
): AgentRunRecord[] {
  const currentById = new Map(current.map((run) => [run.agentRunId, run] as const))
  return incoming.flatMap((run) => {
    if (run.status !== 'running') return [run]
    const previous = currentById.get(run.agentRunId)
    if (previous !== undefined && previous.status !== 'running') return [previous]
    return terminalRunIds.has(run.agentRunId) ? [] : [run]
  })
}

export function applyAgentTerminalEvent(
  runs: AgentRunRecord[],
  event: AgentEventRecord
): AgentRunRecord[] {
  if (
    event.agentRunId === null ||
    (event.type !== 'run_completed' && event.type !== 'run_interrupted')
  ) {
    return runs
  }
  const status = event.type === 'run_completed' ? 'completed' : terminalStatus(event.payload.status)
  const errorCode =
    status === 'completed'
      ? null
      : typeof event.payload.code === 'string'
        ? event.payload.code
        : status
  return runs.map((run) =>
    run.agentRunId === event.agentRunId
      ? {
          ...run,
          status,
          errorCode,
          completedAt: run.completedAt ?? event.createdAt,
          updatedAt: event.createdAt
        }
      : run
  )
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

  return [...new Set(result.citationIds)].map(
    (citationId) => displays.get(citationId) ?? { citationId, title: citationId }
  )
}

export function projectAgentTimeline(
  events: AgentEventRecord[],
  proposals: MutationProposalRecord[] = [],
  runs: AgentRunRecord[] = [],
  now = Date.now()
): AgentTimelineItem[] {
  const orderedEvents = [...events].sort((left, right) => left.sequence - right.sequence)
  const runsById = new Map(runs.map((run) => [run.agentRunId, run] as const))
  const terminalsByRunId = new Map<string, AgentRunTerminal>()
  for (const event of orderedEvents) {
    if (event.type !== 'run_interrupted' && event.type !== 'run_completed') continue
    const run = event.agentRunId === null ? undefined : runsById.get(event.agentRunId)
    terminalsByRunId.set(
      event.agentRunId ?? '',
      terminalFromEvent(event as AgentTerminalEvent, run, orderedEvents, now)
    )
  }
  const results = new Map<string, AgentToolResultPayload>()
  for (const event of orderedEvents) {
    if (event.type !== 'tool_result') continue
    const parsed = agentToolResultPayloadSchema.safeParse(event.payload)
    if (parsed.success) results.set(parsed.data.toolCallId, parsed.data)
  }
  const replacedProposalIds = new Set(
    proposals.flatMap((proposal) =>
      proposal.replacesProposalId === null ? [] : [proposal.replacesProposalId]
    )
  )
  const proposalsByToolCall = new Map(
    proposals
      .filter((proposal) => !replacedProposalIds.has(proposal.proposalId))
      .map((proposal) => [proposal.agentToolCallId, proposal] as const)
  )

  const items: AgentTimelineItem[] = []
  let pendingTools: AgentToolActivity[] = []
  const flushTools = (): void => {
    if (pendingTools.length === 0) return
    const tools = pendingTools
    pendingTools = []
    const runId = tools[0]?.runId ?? null
    const terminal = terminalsByRunId.get(runId ?? '')
    items.push({
      type: 'activity',
      id: `activity-${tools[0]?.eventId ?? items.length}`,
      runId,
      tools,
      status: activityStatus(tools, terminal?.status),
      summary: summarizeAgentActivity(tools),
      citations: dedupeCitationDisplays(
        tools.flatMap((tool) =>
          tool.result === null ? [] : citationDisplaysForToolResult(tool.result)
        )
      )
    })
  }

  for (const event of orderedEvents) {
    if (event.type === 'user_message') {
      const parsed = agentUserMessagePayloadSchema.safeParse(event.payload)
      if (!parsed.success) continue
      flushTools()
      items.push({ type: 'user', id: event.agentEventId, payload: parsed.data })
      continue
    }
    if (event.type === 'assistant_message') {
      const parsed = agentAssistantMessagePayloadSchema.safeParse(event.payload)
      if (!parsed.success || parsed.data.content.trim().length === 0) continue
      flushTools()
      items.push({ type: 'assistant', id: event.agentEventId, payload: parsed.data })
      continue
    }
    if (event.type === 'tool_call') {
      const parsed = agentToolCallPayloadSchema.safeParse(event.payload)
      if (!parsed.success) continue
      const tool = {
        eventId: event.agentEventId,
        runId: event.agentRunId,
        call: parsed.data,
        result: results.get(parsed.data.toolCallId) ?? null,
        durationMs: toolDurationMs(
          parsed.data.timestamp,
          toolEndTimestamp(event, parsed.data.toolCallId, results, orderedEvents, runsById, now)
        ),
        stopped:
          results.get(parsed.data.toolCallId) === undefined &&
          event.agentRunId !== null &&
          terminalsByRunId.has(event.agentRunId)
      }
      if (
        parsed.data.toolName.startsWith('propose_') ||
        parsed.data.toolName.startsWith('submit_')
      ) {
        flushTools()
        items.push({
          type: 'proposal',
          id: event.agentEventId,
          tool,
          proposal: proposalsByToolCall.get(parsed.data.toolCallId) ?? null
        })
      } else {
        pendingTools.push(tool)
      }
      continue
    }
    if (event.type === 'run_interrupted' || event.type === 'run_completed') {
      flushTools()
      const run = event.agentRunId === null ? undefined : runsById.get(event.agentRunId)
      items.push({
        type: event.type,
        id: event.agentEventId,
        terminal: terminalFromEvent(event as AgentTerminalEvent, run, orderedEvents, now)
      })
      continue
    }
    if (event.type === 'compaction_summary') {
      const parsed = agentCompactionSummaryPayloadSchema.safeParse(event.payload)
      if (!parsed.success) continue
      flushTools()
      items.push({ type: 'compaction_summary', id: event.agentEventId, payload: parsed.data })
    }
  }
  flushTools()
  return items
}

export function isSectionProposalOutdated(
  proposal: MutationProposalRecord,
  currentRevisionIds: Readonly<Record<string, string>>
): boolean {
  if (
    proposal.status !== 'pending' ||
    (proposal.payload.kind !== 'section_patch' &&
      proposal.payload.kind !== 'generated_image_insert')
  )
    return false
  const mutation = proposal.payload.mutation
  return currentRevisionIds[mutation.sectionId] !== mutation.baseRevisionId
}

export function activityStatus(
  tools: AgentToolActivity[],
  terminalStatus?: AgentRunTerminal['status']
): AgentActivityStatus {
  if (tools.some((tool) => tool.result?.isError === true && !toolWasStopped(tool))) return 'error'
  if (
    tools.some((tool) => toolWasStopped(tool)) ||
    (terminalStatus !== undefined && tools.some((tool) => tool.result === null))
  )
    return 'stopped'
  if (tools.some((tool) => tool.result === null)) return 'running'
  return 'complete'
}

export function toolWasStopped(tool: AgentToolActivity): boolean {
  return tool.stopped || tool.result?.error?.code === 'aborted'
}

export function toolDurationMs(startTimestamp: number, endTimestamp: number | undefined): number {
  if (endTimestamp === undefined) return 0
  if (!Number.isFinite(startTimestamp) || !Number.isFinite(endTimestamp)) return 0
  return Math.max(0, endTimestamp - startTimestamp)
}

export function formatAgentDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000))
  const hours = Math.floor(totalSeconds / 3_600)
  const minutes = Math.floor((totalSeconds % 3_600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

function terminalFromEvent(
  event: AgentTerminalEvent,
  run: AgentRunRecord | undefined,
  events: AgentEventRecord[],
  now: number
): AgentRunTerminal {
  const status = event.type === 'run_completed' ? 'completed' : terminalStatus(event.payload.status)
  const code = typeof event.payload.code === 'string' ? event.payload.code : status
  const completedAt = run?.completedAt === null ? undefined : run?.completedAt
  const endTimestamp =
    completedAt === undefined ? Date.parse(event.createdAt) : Date.parse(completedAt)
  const startedAt = run?.startedAt ?? firstRunTimestamp(event.agentRunId, events)
  return {
    runId: event.agentRunId,
    status,
    code,
    durationMs: toolDurationMs(
      Date.parse(startedAt),
      Number.isNaN(endTimestamp) ? now : endTimestamp
    )
  }
}

function terminalStatus(value: unknown): 'interrupted' | 'failed' {
  return value === 'failed' ? 'failed' : 'interrupted'
}

function firstRunTimestamp(runId: string | null, events: AgentEventRecord[]): string {
  const timestamp = events.find((event) => event.agentRunId === runId)?.createdAt
  return timestamp ?? new Date(0).toISOString()
}

function terminalTimestamp(
  runId: string,
  events: AgentEventRecord[],
  runs: Map<string, AgentRunRecord>,
  now: number
): number {
  const run = runs.get(runId)
  if (run?.completedAt !== null && run?.completedAt !== undefined) {
    const timestamp = Date.parse(run.completedAt)
    if (!Number.isNaN(timestamp)) return timestamp
  }
  const terminal = events.find(
    (event) =>
      event.agentRunId === runId &&
      (event.type === 'run_interrupted' || event.type === 'run_completed')
  )
  const timestamp = terminal === undefined ? Number.NaN : Date.parse(terminal.createdAt)
  return Number.isNaN(timestamp) ? now : timestamp
}

function toolEndTimestamp(
  event: AgentEventRecord,
  toolCallId: string,
  results: Map<string, AgentToolResultPayload>,
  events: AgentEventRecord[],
  runs: Map<string, AgentRunRecord>,
  now: number
): number | undefined {
  const resultTimestamp = results.get(toolCallId)?.timestamp
  if (resultTimestamp !== undefined) return resultTimestamp
  if (event.agentRunId === null) return undefined
  return terminalTimestamp(event.agentRunId, events, runs, now)
}

export function summarizeAgentActivity(tools: AgentToolActivity[]): string {
  const counts = new Map<string, number>()
  for (const tool of tools)
    counts.set(tool.call.toolName, (counts.get(tool.call.toolName) ?? 0) + 1)

  const summaries: string[] = []
  const contextCount = counts.get('get_writing_context') ?? 0
  if (contextCount > 0)
    summaries.push(
      contextCount === 1 ? 'Read writing context' : `Read writing context ${contextCount} times`
    )
  const sectionCount = counts.get('read_section') ?? 0
  if (sectionCount > 0)
    summaries.push(`Read ${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'}`)
  const searchCount = counts.get('search_knowledge') ?? 0
  if (searchCount > 0)
    summaries.push(
      searchCount === 1 ? 'Searched knowledge' : `Searched knowledge ${searchCount} times`
    )
  const citationCount = counts.get('read_citations') ?? 0
  if (citationCount > 0)
    summaries.push(citationCount === 1 ? 'Read citations' : `Read citations ${citationCount} times`)
  const knownCount = contextCount + sectionCount + searchCount + citationCount
  if (tools.length > knownCount) {
    const otherCount = tools.length - knownCount
    summaries.push(`Ran ${otherCount} ${otherCount === 1 ? 'action' : 'actions'}`)
  }
  return summaries.length > 0 ? joinSummaryParts(summaries) : 'Worked on the request'
}

function dedupeCitationDisplays(citations: AgentCitationDisplay[]): AgentCitationDisplay[] {
  const deduped = new Map<string, AgentCitationDisplay>()
  for (const citation of citations) {
    const current = deduped.get(citation.citationId)
    if (current === undefined || current.title === current.citationId) {
      deduped.set(citation.citationId, citation)
    }
  }
  return [...deduped.values()]
}

function joinSummaryParts(parts: string[]): string {
  if (parts.length === 1) return parts[0] ?? 'Worked on the request'
  return parts
    .map((part, index) => (index === 0 ? part : `${part.charAt(0).toLowerCase()}${part.slice(1)}`))
    .join(', ')
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

export function latestAgentContextUsage(events: AgentEventRecord[]): {
  used: number
  estimated: boolean
} | null {
  for (const event of [...events].reverse()) {
    if (event.type !== 'assistant_message') continue
    const parsed = agentAssistantMessagePayloadSchema.safeParse(event.payload)
    if (!parsed.success) continue
    const metadata = parsed.data.metadata
    const providerUsed =
      metadata.usage.inputTokens === null
        ? null
        : metadata.usage.inputTokens + (metadata.usage.cacheReadTokens ?? 0)
    const used = metadata.contextTokensUsed ?? providerUsed
    if (used !== null) {
      return { used, estimated: metadata.contextTokensEstimated ?? false }
    }
  }
  return null
}

export function toolCallFromEvent(event: AgentEventRecord) {
  return event.type === 'tool_call' ? agentToolCallPayloadSchema.safeParse(event.payload) : null
}
