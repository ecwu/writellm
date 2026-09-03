import {
  citationDisplaysForToolResult,
  presentAgentTool,
  summarizeAgentActivity,
  toolWasStopped,
  type AgentToolActivity,
  type AgentToolPresentation,
  type AgentCitationDisplay,
  type AgentThinkingVisualState
} from './agent-tool-presentation'
export {
  agentToolActivityLabel,
  citationDisplaysForToolResult,
  toolWasStopped
} from './agent-tool-presentation'
export type {
  AgentToolActivity,
  AgentToolPresentation,
  AgentCitationDisplay,
  AgentThinkingVisualState
} from './agent-tool-presentation'
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
import {
  agentDiagnosticErrorSchema,
  type AgentDiagnosticError
} from '../../../../shared/agent-diagnostic-error'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { AgentModelSelection } from '../../../../shared/contracts/providers'
import {
  agentToolCallPayloadSchema,
  agentToolResultPayloadSchema,
  askUserArgsSchema,
  askUserResultSchema
} from '../../../../shared/contracts/agent-tools'

type AgentToolResultPayload = ReturnType<typeof agentToolResultPayloadSchema.parse>
type AgentUserMessagePayload = ReturnType<typeof agentUserMessagePayloadSchema.parse>
type AgentAssistantMessagePayload = ReturnType<typeof agentAssistantMessagePayloadSchema.parse>
type AgentCompactionSummaryPayload = ReturnType<typeof agentCompactionSummaryPayloadSchema.parse>
type AgentCompactionStartedPayload = ReturnType<typeof agentCompactionStartedPayloadSchema.parse>
type AgentCompactionFailedPayload = ReturnType<typeof agentCompactionFailedPayloadSchema.parse>
type AgentApprovalDecisionPayload = ReturnType<typeof agentApprovalDecisionPayloadSchema.parse>
type AgentTerminalEvent = AgentEventRecord & {
  type: 'run_interrupted' | 'run_completed'
}

export interface AgentPreflightFailure {
  toolName: string
  code: 'invalid_arguments' | 'unknown_tool' | 'preparation_failed'
  message: string
  details?: AgentDiagnosticError
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

export type AgentRunTerminal = {
  runId: string | null
  status: 'completed' | 'interrupted' | 'failed'
  outcome: 'finished' | 'awaiting_review'
  code: string
  durationMs: number
  diagnostic?: AgentDiagnosticError
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

type AgentContent =
  | {
      type: 'message'
      role: 'user'
      id: string
      runId: string | null
      payload: AgentUserMessagePayload
    }
  | {
      type: 'message'
      role: 'assistant'
      id: string
      runId: string | null
      payload: Pick<AgentAssistantMessagePayload, 'content' | 'interrupted'>
      streaming: boolean
    }
  | {
      type: 'activity'
      id: string
      runId: string | null
      tools: AgentToolPresentation[]
      status: AgentActivityStatus
      summary: string
      failedCount: number
      citations: AgentCitationDisplay[]
      durationMs: number
    }
  | {
      type: 'change'
      id: string
      tool: AgentToolPresentation
      proposal: MutationProposalRecord | null
      pending: boolean
      outdated: boolean
      canUndo: boolean
      failureMessage: string | null
      summary: string
      citations: AgentCitationDisplay[]
    }
  | {
      type: 'question'
      id: string
      tool: AgentToolPresentation
      questions: {
        id: string
        question: string
        answer?: { kind: 'option' | 'custom'; value: string }
      }[]
    }
  | { type: 'notice'; kind: 'preflight'; id: string; failure: AgentPreflightFailure }
  | { type: 'notice'; kind: 'tool'; id: string; tool: AgentToolPresentation }
  | { type: 'notice'; kind: 'approval'; id: string; payload: AgentApprovalDecisionPayload }
  | { type: 'notice'; kind: 'terminal'; id: string; terminal: AgentRunTerminal }
  | { type: 'compaction'; state: 'running'; id: string; payload: AgentCompactionStartedPayload }
  | { type: 'compaction'; state: 'complete'; id: string; payload: AgentCompactionSummaryPayload }
  | { type: 'compaction'; state: 'error'; id: string; payload: AgentCompactionFailedPayload }

export type AgentTimelineItem = AgentContent & {
  runId: string | null
  defaultOpen: boolean
  runDurationMs?: number
}

export interface AgentPresentation {
  timeline: AgentTimelineItem[]
  tools: AgentToolPresentation[]
  citationsById: ReadonlyMap<string, AgentCitationDisplay>
  currentActivity: string | null
  currentVisual: AgentThinkingVisualState
  providerMetadata: AgentAssistantMessagePayload['metadata'] | null
  historicalDiagnostics: AgentEventRecord[]
}

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

export function projectAgentPresentation(input: {
  events: AgentEventRecord[]
  proposals?: MutationProposalRecord[]
  runs?: AgentRunRecord[]
  streaming?: Readonly<Record<string, string>>
  activeRunId?: string | null
  currentRevisionIds?: Readonly<Record<string, string>>
  now?: number
}): AgentPresentation {
  const {
    events,
    proposals = [],
    runs = [],
    streaming = {},
    activeRunId = null,
    currentRevisionIds = {},
    now = Date.now()
  } = input
  const historicalDiagnostics: AgentEventRecord[] = []
  const orderedEvents = [...new Map(events.map((event) => [event.sequence, event])).values()].sort(
    (left, right) => left.sequence - right.sequence
  )
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
    if (parsed.success) results.set(`${event.agentRunId}:${parsed.data.toolCallId}`, parsed.data)
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

  const items: AgentContent[] = []
  const toolsById = new Map<string, AgentToolPresentation>()
  const messageCounts = new Map<string, number>()
  let providerMetadata: AgentAssistantMessagePayload['metadata'] | null = null
  let pendingTools: AgentToolPresentation[] = []
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
      durationMs:
        Math.max(...tools.map((tool) => tool.call.timestamp + tool.durationMs)) -
        Math.min(...tools.map((tool) => tool.call.timestamp)),
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
      if (!parsed.success) {
        historicalDiagnostics.push(event)
        continue
      }
      flushTools()
      if (
        parsed.data.presentation?.kind === 'approval_continuation' ||
        parsed.data.presentation?.kind === 'clarification_answer'
      )
        continue
      items.push({
        type: 'message',
        role: 'user',
        id: event.agentEventId,
        runId: event.agentRunId,
        payload:
          parsed.data.presentation?.kind === 'review_feedback'
            ? { ...parsed.data, content: parsed.data.presentation.displayContent }
            : parsed.data
      })
      continue
    }
    if (event.type === 'assistant_message') {
      const parsed = agentAssistantMessagePayloadSchema.safeParse(event.payload)
      if (!parsed.success) {
        historicalDiagnostics.push(event)
        continue
      }
      providerMetadata = parsed.data.metadata
      if (parsed.data.content.trim().length === 0) continue
      flushTools()
      const count = (messageCounts.get(event.agentRunId ?? '') ?? 0) + 1
      messageCounts.set(event.agentRunId ?? '', count)
      items.push({
        type: 'message',
        role: 'assistant',
        streaming: false,
        id:
          event.agentRunId === null ? event.agentEventId : `assistant-${event.agentRunId}-${count}`,
        runId: event.agentRunId,
        payload: parsed.data
      })
      continue
    }
    if (event.type === 'tool_call') {
      const parsed = agentToolCallPayloadSchema.safeParse(event.payload)
      if (!parsed.success) {
        historicalDiagnostics.push(event)
        continue
      }
      const toolKey = `${event.agentRunId}:${parsed.data.toolCallId}`
      if (toolsById.has(toolKey)) continue
      const tool = presentAgentTool({
        eventId: event.agentEventId,
        runId: event.agentRunId,
        call: parsed.data,
        result: results.get(`${event.agentRunId}:${parsed.data.toolCallId}`) ?? null,
        durationMs: toolDurationMs(
          parsed.data.timestamp,
          toolEndTimestamp(event, parsed.data.toolCallId, results, orderedEvents, runsById, now)
        ),
        stopped:
          results.get(`${event.agentRunId}:${parsed.data.toolCallId}`) === undefined &&
          event.agentRunId !== null &&
          (terminalsByRunId.has(event.agentRunId) ||
            (runsById.has(event.agentRunId) &&
              runsById.get(event.agentRunId)?.status !== 'running'))
      })
      toolsById.set(toolKey, tool)
      if (pendingTools.length > 0 && pendingTools[0]?.runId !== tool.runId) flushTools()
      if (tool.kind === 'question') {
        flushTools()
        if (tool.status !== 'running') {
          const args = askUserArgsSchema.safeParse(tool.call.args)
          const result = askUserResultSchema.safeParse(tool.result?.result)
          const answers = new Map(
            result.success ? result.data.answers.map((answer) => [answer.questionId, answer]) : []
          )
          items.push({
            type: 'question',
            id: event.agentEventId,
            tool,
            questions: args.success
              ? args.data.questions.map((question) => ({
                  id: question.id,
                  question: question.question,
                  answer: answers.get(question.id)
                }))
              : []
          })
        }
        continue
      }
      if (tool.kind === 'change') {
        flushTools()
        const proposal = proposalsByToolCall.get(parsed.data.toolCallId) ?? null
        items.push({
          type: 'change',
          id: event.agentEventId,
          tool,
          proposal,
          pending: proposal?.status === 'pending',
          failureMessage:
            proposal?.status === 'conflicted'
              ? `This proposal conflicts with the latest section. ${proposal.rejectedReason ?? ''}`.trim()
              : proposal?.status === 'failed'
                ? (proposal.rejectedReason ?? 'The proposed change failed.')
                : null,
          outdated: proposal !== null && isSectionProposalOutdated(proposal, currentRevisionIds),
          canUndo:
            proposal?.status === 'applied' &&
            (proposal.kind === 'section_patch' || proposal.kind === 'generated_image_insert'),
          summary:
            proposal?.payload.preview.summary ??
            tool.result?.error?.message ??
            (tool.status === 'running'
              ? 'Preparing a reviewable proposal…'
              : tool.status === 'stopped'
                ? 'Proposal preparation stopped'
                : 'No reviewable proposal is available'),
          citations: []
        })
      } else if (tool.internal) {
        if (tool.status === 'error' || tool.status === 'stopped') {
          flushTools()
          items.push({ type: 'notice', kind: 'tool', id: event.agentEventId, tool })
        }
      } else {
        pendingTools.push(tool)
      }
      continue
    }
    if (event.type === 'tool_preflight_failed') {
      flushTools()
      const diagnostic = agentToolPreflightDiagnosticSchema.safeParse(event.payload.diagnostic)
      items.push({
        type: 'notice',
        kind: 'preflight',
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
          ...(diagnostic.success && diagnostic.data.details !== undefined
            ? { details: diagnostic.data.details }
            : {}),
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
      if (!parsed.success) {
        historicalDiagnostics.push(event)
        continue
      }
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
        previous?.type === 'notice' &&
        previous.kind === 'approval' &&
        previous.payload.proposalId === parsed.data.proposalId &&
        previous.payload.decision === parsed.data.decision
      ) {
        items[items.length - 1] = {
          type: 'notice',
          kind: 'approval',
          id: event.agentEventId,
          payload: {
            ...parsed.data,
            continueRequested: previous.payload.continueRequested || parsed.data.continueRequested
          }
        }
      } else {
        items.push({
          type: 'notice',
          kind: 'approval',
          id: event.agentEventId,
          payload: parsed.data
        })
      }
      continue
    }
    if (event.type === 'run_interrupted' || event.type === 'run_completed') {
      flushTools()
      const run = event.agentRunId === null ? undefined : runsById.get(event.agentRunId)
      items.push({
        type: 'notice',
        kind: 'terminal',
        id: event.agentEventId,
        terminal: terminalFromEvent(event as AgentTerminalEvent, run, orderedEvents, now)
      })
      continue
    }
    if (event.type === 'compaction_summary') {
      const parsed = agentCompactionSummaryPayloadSchema.safeParse(event.payload)
      if (!parsed.success) {
        historicalDiagnostics.push(event)
        continue
      }
      const checkpoint = parsed.data
      if (
        'finalStep' in checkpoint &&
        !checkpoint.finalStep &&
        items.some(
          (item) =>
            item.type === 'compaction' &&
            item.state === 'running' &&
            item.payload.compactionId === checkpoint.compactionId
        )
      ) {
        historicalDiagnostics.push(event)
        continue
      }
      flushTools()
      items.push({
        type: 'compaction',
        state: 'complete',
        id:
          'compactionId' in parsed.data
            ? `compaction-${parsed.data.compactionId}`
            : event.agentEventId,
        payload: parsed.data
      })
      continue
    }
    if (event.type === 'compaction_started') {
      const parsed = agentCompactionStartedPayloadSchema.safeParse(event.payload)
      if (!parsed.success) {
        historicalDiagnostics.push(event)
        continue
      }
      flushTools()
      if ((settledCompactionSequences.get(parsed.data.compactionId) ?? 0) > event.sequence) continue
      items.push({
        type: 'compaction',
        state: 'running',
        id: `compaction-${parsed.data.compactionId}`,
        payload: parsed.data
      })
      continue
    }
    if (event.type === 'compaction_failed') {
      if (event.sequence < latestSuccessfulCompactionSequence) continue
      const parsed = agentCompactionFailedPayloadSchema.safeParse(event.payload)
      if (!parsed.success) {
        historicalDiagnostics.push(event)
        continue
      }
      flushTools()
      items.push({
        type: 'compaction',
        state: 'error',
        id: `compaction-${parsed.data.compactionId}`,
        payload: parsed.data
      })
      continue
    }
    if (event.type === 'tool_attempted' || event.type === 'model_retry')
      historicalDiagnostics.push(event)
  }
  flushTools()
  for (const [runId, content] of Object.entries(streaming)) {
    if (
      !content.trim() ||
      terminalsByRunId.has(runId) ||
      (runsById.has(runId) && runsById.get(runId)?.status !== 'running')
    )
      continue
    items.push({
      type: 'message',
      role: 'assistant',
      id: `assistant-${runId}-${(messageCounts.get(runId) ?? 0) + 1}`,
      runId,
      payload: { content, interrupted: false },
      streaming: true
    })
  }
  const tools = [...toolsById.values()]
  const citationsById = new Map(
    dedupeCitationDisplays(tools.flatMap((tool) => tool.citations)).map((citation) => [
      citation.citationId,
      citation
    ])
  )
  const eventById = new Map(orderedEvents.map((event) => [event.agentEventId, event]))
  const timeline: AgentTimelineItem[] = items
    .filter((item, index) => {
      if (item.type === 'notice' && item.kind === 'terminal')
        return item.terminal.status !== 'completed' && item.terminal.outcome !== 'awaiting_review'
      if (item.type === 'compaction') {
        // Keep one lifecycle row. Historical rolling checkpoints do not settle a live start.
        return !items
          .slice(index + 1)
          .some((next) => next.type === 'compaction' && next.id === item.id)
      }
      return true
    })
    .map((item) => {
      const runId =
        'runId' in item
          ? item.runId
          : 'tool' in item
            ? item.tool.runId
            : (eventById.get(item.id)?.agentRunId ?? null)
      if (item.type === 'change' && item.proposal !== null) {
        item.citations = item.proposal.payload.preview.citedSources.map(
          (source) =>
            citationsById.get(source.citationId) ?? {
              citationId: source.citationId,
              title: source.citationId
            }
        )
      }
      return {
        ...item,
        runId,
        defaultOpen:
          item.type === 'activity'
            ? agentActivityDefaultOpen(item.status)
            : item.type === 'change' && item.pending
      }
    })
  for (const terminal of terminalsByRunId.values()) {
    if (terminal.runId === null) continue
    const item =
      timeline.findLast(
        (candidate) =>
          candidate.runId === terminal.runId &&
          candidate.type === 'message' &&
          candidate.role === 'assistant'
      ) ?? timeline.findLast((candidate) => candidate.runId === terminal.runId)
    if (item !== undefined && terminal.status === 'completed')
      item.runDurationMs = terminal.durationMs
  }
  const current = tools.findLast((tool) => tool.runId === activeRunId && tool.status === 'running')
  return {
    timeline,
    tools,
    citationsById,
    currentActivity: current?.label ?? null,
    currentVisual: current?.visual ?? 'working',
    providerMetadata,
    historicalDiagnostics
  }
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
      item?.type === 'change' &&
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

export function writingSkillDegradationLabel(run: AgentRunRecord | null): string | null {
  const snapshot = run?.skillSnapshot
  if (
    snapshot === undefined ||
    snapshot.mode !== 'explicit' ||
    snapshot.routingStatus !== 'degraded'
  ) {
    return null
  }
  const reason = (() => {
    switch (snapshot.safeError) {
      case 'skill_mention_ambiguous':
        return 'the requested name is ambiguous'
      case 'skill_mention_unavailable':
        return 'the requested Skill is unavailable'
      case 'skill_mention_limit':
        return 'too many Skills were requested'
      case 'skill_dependency_cycle':
        return 'its dependency graph contains a cycle'
      case 'skill_dependency_limit':
        return 'its dependency graph exceeds the limit'
      case 'skill_dependency_unavailable':
        return 'a required dependency is unavailable'
      case 'skill_prompt_budget_exceeded':
        return 'the complete Skill bundle does not fit the context budget'
      default:
        return 'the Skill bundle could not be prepared'
    }
  })()
  return `Writing Skill injection was skipped because ${reason}. The Agent continued without it.`
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
      'WriteLLM continued with a smaller read. Earlier confirmed changes remain; ' +
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
  const eventDiagnostic = agentDiagnosticErrorSchema.safeParse(event.payload.diagnostic)
  const diagnostic = eventDiagnostic.success
    ? eventDiagnostic.data
    : (run?.errorDetails ?? undefined)
  return {
    runId: event.agentRunId,
    status,
    outcome,
    code,
    ...(diagnostic === undefined ? {} : { diagnostic }),
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
  const resultTimestamp = results.get(`${event.agentRunId}:${toolCallId}`)?.timestamp
  if (resultTimestamp !== undefined) return resultTimestamp
  if (event.agentRunId === null) return undefined
  return terminalTimestamp(event.agentRunId, events, runs, now)
}

export function agentActivityDefaultOpen(status: AgentActivityStatus): boolean {
  return status !== 'complete'
}

export function agentThinkingVisualState(input: {
  currentVisual: AgentThinkingVisualState
  workflowState: AgentSessionRecord['workflowState']
  choosingSkill: boolean
  hasStreamingRun: boolean
}): AgentThinkingVisualState {
  if (input.workflowState === 'generating') return 'shaping'
  if (input.workflowState === 'compacting' || input.hasStreamingRun) return 'composing'
  if (input.workflowState === 'awaiting_input' || input.choosingSkill) return 'connecting'
  return input.currentVisual
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

export function findLatestPrompt(events: AgentEventRecord[]): string | null {
  for (const event of [...events].reverse()) {
    if (event.type !== 'user_message') continue
    const parsed = agentUserMessagePayloadSchema.safeParse(event.payload)
    if (!parsed.success || parsed.data.delivery !== 'prompt') continue
    if (parsed.data.presentation?.kind === 'approval_continuation') continue
    if (parsed.data.presentation?.kind === 'review_feedback') {
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
