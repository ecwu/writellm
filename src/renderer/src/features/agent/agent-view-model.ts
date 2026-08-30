import {
  agentApprovalDecisionPayloadSchema,
  agentAssistantMessagePayloadSchema,
  agentCompactionFailedPayloadSchema,
  agentCompactionStartedPayloadSchema,
  agentCompactionSummaryPayloadSchema,
  agentToolPreflightDiagnosticSchema,
  agentUserMessagePayloadSchema
} from '../../../../shared/contracts/agent'
import type {
  AgentEventRecord,
  AgentRunRecord,
  AgentSessionRecord
} from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { AgentModelSelection } from '../../../../shared/contracts/providers'
import {
  agentToolCallPayloadSchema,
  agentToolResultPayloadSchema,
  readCitationsResultSchema,
  readSectionResultSchema,
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

export interface AgentPreflightFailure {
  toolName: string
  code: 'invalid_arguments' | 'unknown_tool' | 'preparation_failed'
  message: string
  paths: string[]
  durationMs: number
}

export interface WritingTaskChangeSetEntry {
  proposal: MutationProposalRecord
  stale: boolean
  reviewProposalId: string
  stepTitle: string | null
}

export interface WritingTaskChangeSetGroup {
  key: string
  label: string
  entries: WritingTaskChangeSetEntry[]
}

export interface WritingTaskChangeSet {
  proposalCount: number
  staleCount: number
  statusCounts: Partial<Record<MutationProposalRecord['status'], number>>
  groups: WritingTaskChangeSetGroup[]
}

export type AgentActivityStatus = 'running' | 'partial' | 'error' | 'complete' | 'stopped'
export type AgentThinkingVisualState =
  | 'working'
  | 'searching'
  | 'solving'
  | 'connecting'
  | 'composing'
  | 'shaping'

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

export function agentHeaderStatusLabel(input: {
  archived: boolean
  workflowState: AgentSessionRecord['workflowState']
  choosingSkill: boolean
  currentActivity: string | null
  hasStreamingRun: boolean
  elapsedMs: number
}): string {
  if (input.archived) return 'Archived · read only'
  if (input.workflowState === 'running') {
    const activity = input.choosingSkill
      ? 'Loading writing guidance'
      : (input.currentActivity ??
        (input.hasStreamingRun ? 'Writing an update' : 'Preparing the next step'))
    return `${activity} · ${formatAgentDuration(input.elapsedMs)}`
  }
  if (input.workflowState === 'awaiting_input') return 'Waiting for your answer'
  if (input.workflowState === 'compacting') return 'Summarizing earlier conversation…'
  if (input.workflowState === 'generating') return 'Generating an image'
  if (input.workflowState === 'awaiting_review') return 'Ready for review'
  return 'Ready'
}

export function groupAgentConversations(sessions: readonly AgentSessionRecord[]): {
  needsInput: AgentSessionRecord[]
  needsReview: AgentSessionRecord[]
  working: AgentSessionRecord[]
  recent: AgentSessionRecord[]
  archived: AgentSessionRecord[]
} {
  const sorted = [...sessions].sort((left, right) =>
    right.updatedAt === left.updatedAt
      ? right.agentSessionId.localeCompare(left.agentSessionId)
      : right.updatedAt.localeCompare(left.updatedAt)
  )
  return {
    needsInput: sorted.filter(
      (session) => session.status === 'active' && session.workflowState === 'awaiting_input'
    ),
    needsReview: sorted.filter(
      (session) => session.status === 'active' && session.workflowState === 'awaiting_review'
    ),
    working: sorted.filter(
      (session) =>
        session.status === 'active' &&
        (session.workflowState === 'running' ||
          session.workflowState === 'generating' ||
          session.workflowState === 'compacting')
    ),
    recent: sorted.filter(
      (session) => session.status === 'active' && session.workflowState === 'idle'
    ),
    archived: sorted.filter((session) => session.status === 'archived')
  }
}

export type AgentTimelineItem =
  | { type: 'user'; id: string; runId: string | null; payload: AgentUserMessagePayload }
  | {
      type: 'assistant'
      id: string
      runId: string | null
      payload: AgentAssistantMessagePayload
    }
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
  | { type: 'question'; id: string; tool: AgentToolActivity }
  | { type: 'preflight_failure'; id: string; failure: AgentPreflightFailure }
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
  const latestSuccessfulCompactionSequence = orderedEvents.reduce((latest, event) => {
    if (event.type !== 'compaction_summary') return latest
    return agentCompactionSummaryPayloadSchema.safeParse(event.payload).success
      ? Math.max(latest, event.sequence)
      : latest
  }, 0)
  const settledCompactionSequences = new Map<string, number>()
  for (const event of orderedEvents) {
    if (event.type === 'compaction_summary') {
      const parsed = agentCompactionSummaryPayloadSchema.safeParse(event.payload)
      if (
        !parsed.success ||
        !('compactionId' in parsed.data) ||
        !('finalStep' in parsed.data) ||
        !parsed.data.finalStep
      )
        continue
      settledCompactionSequences.set(parsed.data.compactionId, event.sequence)
      continue
    }
    if (event.type === 'compaction_failed') {
      const parsed = agentCompactionFailedPayloadSchema.safeParse(event.payload)
      if (!parsed.success) continue
      settledCompactionSequences.set(parsed.data.compactionId, event.sequence)
    }
  }
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
      if (
        parsed.data.presentation?.kind === 'approval_continuation' ||
        parsed.data.presentation?.kind === 'clarification_answer'
      )
        continue
      items.push({
        type: 'user',
        id: event.agentEventId,
        runId: event.agentRunId,
        payload:
          parsed.data.presentation?.kind === 'review_feedback' ||
          parsed.data.presentation?.kind === 'annotation_context'
            ? { ...parsed.data, content: parsed.data.presentation.displayContent }
            : parsed.data
      })
      continue
    }
    if (event.type === 'assistant_message') {
      const parsed = agentAssistantMessagePayloadSchema.safeParse(event.payload)
      if (!parsed.success || parsed.data.content.trim().length === 0) continue
      flushTools()
      items.push({
        type: 'assistant',
        id: event.agentEventId,
        runId: event.agentRunId,
        payload: parsed.data
      })
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
      if (parsed.data.toolName === 'ask_user') {
        flushTools()
        items.push({ type: 'question', id: event.agentEventId, tool })
        continue
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
    if (event.type === 'tool_preflight_failed') {
      flushTools()
      const diagnostic = agentToolPreflightDiagnosticSchema.safeParse(event.payload.diagnostic)
      items.push({
        type: 'preflight_failure',
        id: event.agentEventId,
        failure: {
          toolName:
            typeof event.payload.requestedToolName === 'string'
              ? event.payload.requestedToolName.slice(0, 256)
              : 'unknown tool',
          code: diagnostic.success ? diagnostic.data.code : 'preparation_failed',
          message: diagnostic.success
            ? diagnostic.data.message
            : 'Tool preparation failed before Main dispatch. Open Details for the historical diagnostic.',
          paths: diagnostic.success ? diagnostic.data.paths : [],
          durationMs:
            typeof event.payload.durationMs === 'number' && event.payload.durationMs >= 0
              ? event.payload.durationMs
              : 0
        }
      })
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
      if ((settledCompactionSequences.get(parsed.data.compactionId) ?? 0) > event.sequence) continue
      items.push({ type: 'compaction_started', id: event.agentEventId, payload: parsed.data })
      continue
    }
    if (event.type === 'compaction_failed') {
      if (event.sequence < latestSuccessfulCompactionSequence) continue
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
    if (item?.type === 'question' && item.tool.result === null) return index
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

export function buildWritingTaskChangeSet(input: {
  taskId: string
  proposals: MutationProposalRecord[]
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  stepTitles?: Readonly<Record<string, string>>
}): WritingTaskChangeSet {
  const proposals = input.proposals
    .filter((proposal) => proposal.writingTaskId === input.taskId)
    .sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.proposalId.localeCompare(right.proposalId)
        : left.createdAt.localeCompare(right.createdAt)
    )
  const replacements = new Map<string, MutationProposalRecord>()
  for (const proposal of proposals) {
    if (proposal.replacesProposalId !== null)
      replacements.set(proposal.replacesProposalId, proposal)
  }
  const reviewTarget = (proposal: MutationProposalRecord): string => {
    const seen = new Set<string>()
    let current = proposal
    while (!seen.has(current.proposalId)) {
      seen.add(current.proposalId)
      const replacement = replacements.get(current.proposalId)
      if (replacement === undefined) break
      current = replacement
    }
    return current.proposalId
  }
  const statusCounts: WritingTaskChangeSet['statusCounts'] = {}
  const groups = new Map<string, WritingTaskChangeSetGroup>()
  let staleCount = 0
  for (const proposal of proposals) {
    statusCounts[proposal.status] = (statusCounts[proposal.status] ?? 0) + 1
    const stale = isSectionProposalOutdated(proposal, input.currentRevisionIds)
    if (stale) staleCount += 1
    const group = changeSetGroup(proposal, input.sectionTitles)
    const current = groups.get(group.key) ?? { ...group, entries: [] }
    current.entries.push({
      proposal,
      stale,
      reviewProposalId: reviewTarget(proposal),
      stepTitle:
        proposal.writingTaskStepId === null
          ? null
          : (input.stepTitles?.[proposal.writingTaskStepId] ?? null)
    })
    groups.set(group.key, current)
  }
  return {
    proposalCount: proposals.length,
    staleCount,
    statusCounts,
    groups: [...groups.values()].sort((left, right) => left.key.localeCompare(right.key))
  }
}

function changeSetGroup(
  proposal: MutationProposalRecord,
  sectionTitles: Readonly<Record<string, string>>
): Pick<WritingTaskChangeSetGroup, 'key' | 'label'> {
  if (proposal.kind === 'brief_update') return { key: '0:brief', label: 'Project brief' }
  if (proposal.kind === 'outline_patch') return { key: '1:outline', label: 'Outline' }
  const sectionId = proposal.payload.preview.affectedSectionIds[0]
  if (sectionId === undefined) return { key: '2:section:unknown', label: 'Manuscript section' }
  return {
    key: `2:section:${sectionId}`,
    label: sectionTitles[sectionId] ?? `Section ${sectionId.slice(0, 8)}`
  }
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
    case 'skill_mention_ambiguous':
      return 'Writing skill name is ambiguous'
    case 'skill_mention_unavailable':
      return 'Requested writing skill is unavailable'
    case 'skill_mention_limit':
      return 'Too many writing skills were requested'
    case 'skill_request_unfulfilled':
      return 'Requested writing skill was not loaded'
    case 'compaction_failed':
      return 'Session compaction failed'
    case 'compaction_required':
      return 'Conversation could not be compacted safely'
    case 'compaction_run_too_large':
      return 'A conversation run is too large to summarize safely'
    case 'continuation_lost':
      return 'Tool continuation could not be resumed safely'
    case 'model_request_start_failed':
      return 'Model request could not be started'
    case 'agent_context_failed':
      return 'Agent context could not be built'
    case 'current_turn_too_large':
      return 'The request is too large for this model context'
    case 'context_overflow':
      return 'The model context limit was exceeded'
    case 'context_overflow_after_activity':
      return 'The model context limit was exceeded after work began'
    case 'tool_batch_context_exhausted':
      return 'Reading context was too large to continue safely'
    case 'run_failed':
      return 'Run failed'
    default:
      return 'Run interrupted'
  }
}

export function agentTerminalDetail(code: string): string | null {
  if (code === 'compaction_required') {
    return (
      'WriteLLM stopped before dropping an earlier user requirement. Retry Compact, choose a ' +
      'larger-context model, or continue in a new conversation with the requirements you still need.'
    )
  }
  if (code === 'compaction_run_too_large') {
    return (
      'One complete run exceeds the safe summary limit. Original history was preserved; ' +
      'start a new conversation and carry forward the requirements you still need.'
    )
  }
  if (code === 'continuation_lost') {
    return 'WriteLLM stopped instead of marking an authorized but unconsumed model request complete.'
  }
  if (code === 'tool_batch_context_exhausted') {
    return (
      'WriteLLM retried with a smaller read once. Earlier confirmed changes remain; ' +
      'the remaining content was not force-edited. Continue with one section or a smaller range.'
    )
  }
  return null
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

type WritingSkillActivityIdentity = {
  displayName: string
  relativePath: string
}

function writingSkillActivityIdentity(tool: AgentToolActivity): WritingSkillActivityIdentity {
  const projected = tool.result?.result
  const projectedName =
    projected !== null && typeof projected?.displayName === 'string' ? projected.displayName : null
  const projectedPath =
    projected !== null && typeof projected?.relativePath === 'string'
      ? projected.relativePath
      : null
  const argumentName =
    typeof tool.call.args.displayName === 'string' ? tool.call.args.displayName : null
  const argumentPath =
    typeof tool.call.args.relativePath === 'string' ? tool.call.args.relativePath : null
  const uri = typeof tool.call.args.uri === 'string' ? tool.call.args.uri : ''
  const match = /^writellm:\/\/skills\/([^/]+)\/[a-f0-9]{40}\/(.+)$/u.exec(uri)
  const skillId = match?.[1] ?? 'writing-skill'
  return {
    displayName: projectedName ?? argumentName ?? humanizeSkillId(skillId),
    relativePath: projectedPath ?? argumentPath ?? match?.[2] ?? 'SKILL.md'
  }
}

function humanizeSkillId(skillId: string): string {
  const name = skillId.split(':').at(-1) ?? skillId
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function summarizeWritingSkillActivity(tools: AgentToolActivity[]): string {
  const skillTools = tools.filter((tool) => tool.call.toolName === 'read_writing_skill')
  const successful = skillTools.filter((tool) => tool.result !== null && !tool.result.isError)
  const entrypoints = successful.filter(
    (tool) => writingSkillActivityIdentity(tool).relativePath === 'SKILL.md'
  )
  const references = successful.filter(
    (tool) => writingSkillActivityIdentity(tool).relativePath !== 'SKILL.md'
  )
  const parts: string[] = []
  if (entrypoints.length === 1) {
    parts.push(`Loaded ${writingSkillActivityIdentity(entrypoints[0]).displayName}`)
  } else if (entrypoints.length > 1) {
    parts.push(`Loaded ${entrypoints.length} Writing Skills`)
  }
  if (references.length > 0) {
    parts.push(
      `${references.length} ${references.length === 1 ? 'reference file' : 'reference files'}`
    )
  }
  if (parts.length > 0) return parts.join(' · ')
  const running = skillTools.find((tool) => tool.result === null && !toolWasStopped(tool))
  if (running !== undefined) {
    const identity = writingSkillActivityIdentity(running)
    return identity.relativePath === 'SKILL.md'
      ? `Loading ${identity.displayName}`
      : `Reading ${identity.displayName} · ${identity.relativePath}`
  }
  return 'Writing Skill loading failed'
}

function writingSkillActivityLabel(tool: AgentToolActivity, running: boolean): string {
  const identity = writingSkillActivityIdentity(tool)
  const entrypoint = identity.relativePath === 'SKILL.md'
  if (running) {
    return entrypoint
      ? `Loading ${identity.displayName}`
      : `Reading ${identity.displayName} · ${identity.relativePath}`
  }
  if (tool.result?.isError === true || toolWasStopped(tool)) {
    return entrypoint
      ? `Could not load ${identity.displayName}`
      : `Could not read ${identity.displayName} · ${identity.relativePath}`
  }
  return entrypoint
    ? `Loaded ${identity.displayName} · SKILL.md`
    : `Read ${identity.displayName} · ${identity.relativePath}`
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
  const issueCount =
    (counts.get('list_review_issues') ?? 0) +
    (counts.get('record_review_issues') ?? 0) +
    (counts.get('update_review_issues') ?? 0)
  if (issueCount > 0) summaries.push('Updating review issues')
  const skillCount = counts.get('read_writing_skill') ?? 0
  if (skillCount > 0) summaries.push(summarizeWritingSkillActivity(tools))
  const activationCount = counts.get('activate_tool_groups') ?? 0
  if (activationCount > 0) summaries.push('Prepared writing tools')
  const taskCount =
    (counts.get('get_writing_task') ?? 0) +
    (counts.get('create_writing_task') ?? 0) +
    (counts.get('update_writing_task') ?? 0)
  if (taskCount > 0) summaries.push('Updating the writing plan')
  const knownCount =
    contextCount +
    sectionCount +
    manuscriptSearchCount +
    searchCount +
    citationCount +
    inspectCount +
    checkCount +
    issueCount +
    skillCount +
    activationCount +
    taskCount
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
    case 'read_section': {
      if (running) return 'Reading a section'
      const result =
        tool.result?.isError === false
          ? readSectionResultSchema.safeParse(tool.result.result)
          : null
      return result?.success === true ? `Read · ${result.data.section.title}` : 'Read a section'
    }
    case 'search_manuscript':
      return running ? 'Searching the manuscript' : 'Searched the manuscript'
    case 'search_knowledge':
      return running ? 'Searching sources' : 'Searched sources'
    case 'read_citations':
      return running ? 'Checking source evidence' : 'Checked source evidence'
    case 'read_writing_skill':
      return writingSkillActivityLabel(tool, running)
    case 'ask_user':
      return running ? 'Waiting for your answer' : 'Asked for clarification'
    case 'activate_tool_groups':
      return running ? 'Preparing writing tools' : 'Prepared writing tools'
    case 'inspect_change':
      return running ? 'Reviewing the change' : 'Reviewed the change'
    case 'check_draft':
      return running ? 'Checking the draft' : 'Checked the draft'
    case 'list_review_issues':
      return running ? 'Reading review issues' : 'Read review issues'
    case 'record_review_issues':
      return running ? 'Recording review issues' : 'Recorded review issues'
    case 'update_review_issues':
      return running ? 'Updating review issues' : 'Updated review issues'
    case 'get_writing_task':
      return running ? 'Reading the writing plan' : 'Read the writing plan'
    case 'create_writing_task':
      return running ? 'Creating the writing plan' : 'Created the writing plan'
    case 'update_writing_task':
      return running ? 'Updating the writing plan' : 'Updated the writing plan'
    case 'submit_brief_change':
    case 'submit_writing_rules_change':
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

export function agentActivityDefaultOpen(status: AgentActivityStatus): boolean {
  return status !== 'complete'
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
    if (item.type === 'question' && item.tool.runId === runId && item.tool.result === null) {
      return 'Waiting for your answer'
    }
  }
  return null
}

export function agentThinkingVisualState(input: {
  timeline: AgentTimelineItem[]
  runId: string | null
  workflowState:
    | 'idle'
    | 'running'
    | 'awaiting_input'
    | 'compacting'
    | 'generating'
    | 'awaiting_review'
  choosingSkill: boolean
  hasStreamingRun: boolean
}): AgentThinkingVisualState {
  if (input.workflowState === 'generating') return 'shaping'
  if (input.workflowState === 'compacting') return 'composing'
  if (input.workflowState === 'awaiting_input') return 'connecting'
  if (input.hasStreamingRun) return 'composing'
  if (input.choosingSkill) return 'connecting'
  if (input.runId === null) return 'working'
  for (const item of [...input.timeline].reverse()) {
    const tool =
      item.type === 'activity' && item.runId === input.runId && item.status === 'running'
        ? [...item.tools].reverse().find((candidate) => candidate.result === null)
        : item.type === 'proposal' && item.tool.runId === input.runId && item.tool.result === null
          ? item.tool
          : item.type === 'question' && item.tool.runId === input.runId && item.tool.result === null
            ? item.tool
            : undefined
    if (tool === undefined) continue
    const name = tool.call.toolName
    if (name === 'generate_image') return 'shaping'
    if (name === 'inspect_change' || name === 'check_draft') return 'solving'
    if (
      name === 'get_writing_context' ||
      name === 'read_outline' ||
      name === 'read_section' ||
      name === 'search_manuscript' ||
      name === 'search_knowledge' ||
      name === 'read_citations' ||
      name === 'read_writing_skill' ||
      name === 'list_review_issues' ||
      name === 'get_writing_task'
    ) {
      return 'searching'
    }
    if (
      name === 'submit_brief_change' ||
      name === 'submit_writing_rules_change' ||
      name === 'submit_outline_change' ||
      name === 'submit_section_change'
    ) {
      return 'composing'
    }
    return 'working'
  }
  return 'working'
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
    if (parsed.data.presentation?.kind === 'annotation_context') {
      return parsed.data.presentation.displayContent
    }
    if (parsed.data.presentation?.kind === 'quick_action') {
      return parsed.data.presentation.displayInstruction ?? parsed.data.presentation.selectedText
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

export interface AgentContextSnapshot {
  agentRunId: string
  used: number
  estimated: boolean
  contextWindowTokens: number
  percent: number
}

export function latestAgentContextSnapshot(
  events: AgentEventRecord[],
  runs: AgentRunRecord[],
  selection: AgentModelSelection | null
): AgentContextSnapshot | null {
  if (selection === null) return null
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
      const run = runs.find((candidate) => candidate.agentRunId === event.agentRunId)
      if (
        run === undefined ||
        run.providerPresetId !== selection.presetId ||
        run.modelId !== selection.modelId
      ) {
        return null
      }
      const contextWindowTokens = run.modelLimits.contextWindowTokens
      return {
        agentRunId: run.agentRunId,
        used,
        estimated: metadata.contextTokensEstimated ?? false,
        contextWindowTokens,
        percent: Math.min(100, Math.max(0, (used / contextWindowTokens) * 100))
      }
    }
  }
  return null
}

export function toolCallFromEvent(event: AgentEventRecord) {
  return event.type === 'tool_call' ? agentToolCallPayloadSchema.safeParse(event.payload) : null
}
