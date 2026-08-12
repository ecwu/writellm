import {
  agentApprovalDecisionPayloadSchema,
  agentAssistantMessagePayloadSchema,
  agentCompactionFailedPayloadSchema,
  agentCompactionStartedPayloadSchema,
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
type AgentCompactionStartedPayload = ReturnType<typeof agentCompactionStartedPayloadSchema.parse>
type AgentCompactionFailedPayload = ReturnType<typeof agentCompactionFailedPayloadSchema.parse>
type AgentApprovalDecisionPayload = ReturnType<typeof agentApprovalDecisionPayloadSchema.parse>
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

export type AgentActivityStatus = 'running' | 'partial' | 'error' | 'complete' | 'stopped'

export type AgentRunTerminal = {
  runId: string | null
  status: 'completed' | 'interrupted' | 'failed'
  outcome: 'finished' | 'awaiting_review'
  code: string
  durationMs: number
}

export type AgentReviewState =
  | 'waiting'
  | 'approved'
  | 'rejected'
  | 'failed'
  | 'undone'
  | 'resolved'

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
      failedCount: number
      citations: AgentCitationDisplay[]
    }
  | {
      type: 'proposal'
      id: string
      tool: AgentToolActivity
      proposal: MutationProposalRecord | null
    }
  | { type: 'approval_decision'; id: string; payload: AgentApprovalDecisionPayload }
  | { type: 'run_interrupted'; id: string; terminal: AgentRunTerminal }
  | { type: 'run_completed'; id: string; terminal: AgentRunTerminal }
  | { type: 'compaction_started'; id: string; payload: AgentCompactionStartedPayload }
  | { type: 'compaction_summary'; id: string; payload: AgentCompactionSummaryPayload }
  | { type: 'compaction_failed'; id: string; payload: AgentCompactionFailedPayload }

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
  const incomingIds = new Set(incoming.map((run) => run.agentRunId))
  const merged = incoming.flatMap((run) => {
    if (run.status !== 'running') return [run]
    const previous = currentById.get(run.agentRunId)
    if (previous !== undefined && previous.status !== 'running') return [previous]
    return terminalRunIds.has(run.agentRunId) ? [] : [run]
  })
  for (const run of current) {
    if (
      run.status === 'running' &&
      !incomingIds.has(run.agentRunId) &&
      !terminalRunIds.has(run.agentRunId)
    ) {
      merged.push(run)
    }
  }
  let keptRunning = false
  return merged
    .sort((left, right) =>
      right.startedAt === left.startedAt
        ? right.agentRunId.localeCompare(left.agentRunId)
        : right.startedAt.localeCompare(left.startedAt)
    )
    .filter((run) => {
      if (run.status !== 'running') return true
      if (keptRunning) return false
      keptRunning = true
      return true
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
      failedCount: failedAgentToolCount(tools),
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
      if (parsed.data.presentation?.kind === 'approval_continuation') continue
      items.push({
        type: 'user',
        id: event.agentEventId,
        payload:
          parsed.data.presentation?.kind === 'review_feedback'
            ? { ...parsed.data, content: parsed.data.presentation.displayContent }
            : parsed.data
      })
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
        parsed.data.toolName.startsWith('submit_') ||
        parsed.data.toolName === 'generate_image'
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
    if (event.type === 'approval_decision') {
      const parsed = agentApprovalDecisionPayloadSchema.safeParse(event.payload)
      if (!parsed.success) continue
      flushTools()
      if (
        parsed.data.decision === 'rejected' &&
        parsed.data.continueRequested &&
        orderedEvents.some((candidate) => {
          if (candidate.sequence <= event.sequence || candidate.type !== 'user_message')
            return false
          const message = agentUserMessagePayloadSchema.safeParse(candidate.payload)
          return message.success && message.data.presentation?.kind === 'review_feedback'
        })
      ) {
        continue
      }
      const previous = items.at(-1)
      if (
        previous?.type === 'approval_decision' &&
        previous.payload.proposalId === parsed.data.proposalId &&
        previous.payload.decision === parsed.data.decision
      ) {
        items[items.length - 1] = {
          type: 'approval_decision',
          id: event.agentEventId,
          payload: {
            ...parsed.data,
            continueRequested: previous.payload.continueRequested || parsed.data.continueRequested
          }
        }
      } else {
        items.push({ type: 'approval_decision', id: event.agentEventId, payload: parsed.data })
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
      continue
    }
    if (event.type === 'compaction_started') {
      const parsed = agentCompactionStartedPayloadSchema.safeParse(event.payload)
      if (!parsed.success) continue
      flushTools()
      items.push({ type: 'compaction_started', id: event.agentEventId, payload: parsed.data })
      continue
    }
    if (event.type === 'compaction_failed') {
      const parsed = agentCompactionFailedPayloadSchema.safeParse(event.payload)
      if (!parsed.success) continue
      flushTools()
      items.push({ type: 'compaction_failed', id: event.agentEventId, payload: parsed.data })
    }
  }
  flushTools()
  return items
}

export function agentReviewState(
  runId: string | null,
  proposals: MutationProposalRecord[]
): AgentReviewState {
  const statuses = proposals
    .filter((proposal) => proposal.agentRunId === runId)
    .map((proposal) => proposal.status)
  if (statuses.some((status) => status === 'pending' || status === 'generating')) return 'waiting'

  const resolved = new Set<AgentReviewState>()
  for (const status of statuses) {
    if (status === 'applied' || status === 'approved' || status === 'satisfied') {
      resolved.add('approved')
    } else if (status === 'rejected') {
      resolved.add('rejected')
    } else if (status === 'failed' || status === 'conflicted') {
      resolved.add('failed')
    } else if (status === 'undone') {
      resolved.add('undone')
    }
  }
  if (resolved.size === 0) return 'waiting'
  if (resolved.size > 1) return 'resolved'
  return [...resolved][0] ?? 'resolved'
}

export function agentTimelineScrollAnchorIndex(timeline: AgentTimelineItem[]): number {
  for (let index = timeline.length - 1; index >= 0; index -= 1) {
    const item = timeline[index]
    if (
      item?.type === 'proposal' &&
      (item.proposal?.status === 'pending' || item.proposal?.status === 'generating')
    ) {
      return index
    }
  }
  return timeline.length - 1
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
  const failedCount = failedAgentToolCount(tools)
  if (failedCount > 0) return failedCount === tools.length ? 'error' : 'partial'
  if (
    tools.some((tool) => toolWasStopped(tool)) ||
    (terminalStatus !== undefined && tools.some((tool) => tool.result === null))
  )
    return 'stopped'
  if (tools.some((tool) => tool.result === null)) return 'running'
  return 'complete'
}

export function failedAgentToolCount(tools: AgentToolActivity[]): number {
  return tools.filter((tool) => tool.result?.isError === true && !toolWasStopped(tool)).length
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

export function agentTerminalLabel(code: string): string {
  switch (code) {
    case 'provider_timeout':
      return 'Provider request timed out'
    case 'provider_retries_exhausted':
      return 'Provider request failed after 5 attempts'
    case 'user_stopped':
      return 'Stopped by user'
    case 'project_closed':
      return 'Interrupted because project closed'
    case 'process_restarted':
      return 'Interrupted because the app restarted'
    case 'skill_route_failed':
      return 'Writing skill routing failed'
    case 'skill_prompt_budget_exceeded':
      return 'Writing skill exceeds the prompt budget'
    case 'compaction_failed':
      return 'Session compaction failed'
    case 'model_request_start_failed':
      return 'Model request could not be started'
    case 'agent_context_failed':
      return 'Agent context could not be built'
    case 'run_failed':
      return 'Run failed'
    default:
      return 'Run interrupted'
  }
}

function terminalFromEvent(
  event: AgentTerminalEvent,
  run: AgentRunRecord | undefined,
  events: AgentEventRecord[],
  now: number
): AgentRunTerminal {
  const outcome =
    event.payload.outcome === 'awaiting_review' ||
    (event.type === 'run_interrupted' && hasHistoricalReviewPause(event.agentRunId, events))
      ? 'awaiting_review'
      : 'finished'
  const status =
    outcome === 'awaiting_review'
      ? 'completed'
      : event.type === 'run_completed'
        ? 'completed'
        : terminalStatus(event.payload.status)
  const code =
    outcome === 'awaiting_review'
      ? 'awaiting_review'
      : typeof event.payload.code === 'string'
        ? event.payload.code
        : status
  const completedAt = run?.completedAt === null ? undefined : run?.completedAt
  const endTimestamp =
    completedAt === undefined ? Date.parse(event.createdAt) : Date.parse(completedAt)
  const startedAt = run?.startedAt ?? firstRunTimestamp(event.agentRunId, events)
  return {
    runId: event.agentRunId,
    status,
    outcome,
    code,
    durationMs: toolDurationMs(
      Date.parse(startedAt),
      Number.isNaN(endTimestamp) ? now : endTimestamp
    )
  }
}

function hasHistoricalReviewPause(runId: string | null, events: AgentEventRecord[]): boolean {
  return events.some((event) => {
    if (event.agentRunId !== runId || event.type !== 'tool_result') return false
    const parsed = agentToolResultPayloadSchema.safeParse(event.payload)
    if (!parsed.success || parsed.data.isError || parsed.data.result === null) return false
    const result = parsed.data.result
    return (
      typeof result === 'object' &&
      'continuation' in result &&
      result.continuation === 'pause_for_review'
    )
  })
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
  const contextCount = (counts.get('get_writing_context') ?? 0) + (counts.get('read_outline') ?? 0)
  if (contextCount > 0) summaries.push('Reading the manuscript')
  const sectionCount = counts.get('read_section') ?? 0
  if (sectionCount > 0)
    summaries.push(`Read ${sectionCount} ${sectionCount === 1 ? 'section' : 'sections'}`)
  const manuscriptSearchCount = counts.get('search_manuscript') ?? 0
  if (manuscriptSearchCount > 0) summaries.push('Searching the manuscript')
  const searchCount = counts.get('search_knowledge') ?? 0
  if (searchCount > 0) summaries.push('Searching sources')
  const citationCount = counts.get('read_citations') ?? 0
  if (citationCount > 0) summaries.push('Checking source evidence')
  const inspectCount = counts.get('inspect_change') ?? 0
  if (inspectCount > 0) summaries.push('Reviewing the change')
  const checkCount = counts.get('check_draft') ?? 0
  if (checkCount > 0) summaries.push('Checking the draft')
  const skillCount = counts.get('read_writing_skill') ?? 0
  if (skillCount > 0) summaries.push('Loading writing guidance')
  const knownCount =
    contextCount +
    sectionCount +
    manuscriptSearchCount +
    searchCount +
    citationCount +
    inspectCount +
    checkCount +
    skillCount
  if (tools.length > knownCount) {
    const otherCount = tools.length - knownCount
    summaries.push(`Ran ${otherCount} ${otherCount === 1 ? 'action' : 'actions'}`)
  }
  return summaries.length > 0 ? joinSummaryParts(summaries) : 'Worked on the request'
}

export function agentToolActivityLabel(tool: AgentToolActivity): string {
  const running = tool.result === null && !toolWasStopped(tool)
  switch (tool.call.toolName) {
    case 'get_writing_context':
      return running ? 'Reading manuscript context' : 'Read manuscript context'
    case 'read_outline':
      return running ? 'Reading the outline' : 'Read the outline'
    case 'read_section':
      return running ? 'Reading a section' : 'Read a section'
    case 'search_manuscript':
      return running ? 'Searching the manuscript' : 'Searched the manuscript'
    case 'search_knowledge':
      return running ? 'Searching sources' : 'Searched sources'
    case 'read_citations':
      return running ? 'Checking source evidence' : 'Checked source evidence'
    case 'read_writing_skill':
      return running ? 'Loading writing guidance' : 'Loaded writing guidance'
    case 'inspect_change':
      return running ? 'Reviewing the change' : 'Reviewed the change'
    case 'check_draft':
      return running ? 'Checking the draft' : 'Checked the draft'
    case 'submit_brief_change':
    case 'submit_outline_change':
    case 'submit_section_change':
    case 'propose_brief_update':
    case 'propose_outline_patch':
    case 'propose_section_patch':
      return running ? 'Preparing a reviewable change' : 'Prepared a reviewable change'
    case 'generate_image':
      return running ? 'Generating an image' : 'Generated an image'
  }
}

export function currentAgentActivitySummary(
  timeline: AgentTimelineItem[],
  runId: string | null
): string | null {
  if (runId === null) return null
  for (const item of [...timeline].reverse()) {
    if (item.type === 'activity' && item.runId === runId && item.status === 'running') {
      return item.summary
    }
    if (item.type === 'proposal' && item.tool.runId === runId && item.tool.result === null) {
      return agentToolActivityLabel(item.tool)
    }
  }
  return null
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
    if (!parsed.success || parsed.data.delivery !== 'prompt') continue
    if (parsed.data.presentation?.kind === 'approval_continuation') continue
    if (parsed.data.presentation?.kind === 'review_feedback') {
      return parsed.data.presentation.displayContent
    }
    return parsed.data.content
  }
  return null
}

export function aggregateAgentUsage(
  events: AgentEventRecord[],
  runs: AgentRunRecord[] = []
): {
  inputTokens: number
  outputTokens: number
  retryCount: number
  skillRouteRequests: number
} {
  let inputTokens = 0
  let outputTokens = 0
  let retryCount = 0
  let skillRouteRequests = 0
  for (const event of events) {
    if (event.type !== 'assistant_message') continue
    const parsed = agentAssistantMessagePayloadSchema.safeParse(event.payload)
    if (!parsed.success) continue
    inputTokens += parsed.data.metadata.usage.inputTokens ?? 0
    outputTokens += parsed.data.metadata.usage.outputTokens ?? 0
    retryCount += parsed.data.metadata.retryCount
  }
  for (const run of runs) {
    if (run.skillRouteUsage === null) continue
    skillRouteRequests += 1
    inputTokens += run.skillRouteUsage.inputTokens ?? 0
    outputTokens += run.skillRouteUsage.outputTokens ?? 0
    retryCount += run.skillRouteUsage.retryCount
  }
  return { inputTokens, outputTokens, retryCount, skillRouteRequests }
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
