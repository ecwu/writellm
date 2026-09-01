import type { AgentRunRecord } from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import { askUserArgsSchema, askUserResultSchema } from '../../../../shared/contracts/agent-tools'
import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleDotDashed,
  CircleHelp,
  CircleStop,
  Clock3,
  FileText,
  FilePenLine,
  ListCollapse,
  MessageSquarePlus,
  TriangleAlert,
  Undo2,
  X
} from 'lucide-react'
import { useMemo } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle
} from '@/components/ui/attachment'
import { Badge } from '@/components/ui/badge'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Message, MessageContent, MessageFooter, MessageHeader } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport
} from '@/components/ui/message-scroller'
import { Spinner } from '@/components/ui/spinner'
import { useTheme } from '@/theme-provider'
import { AgentMarkdown } from './agent-markdown'
import {
  agentActivityDefaultOpen,
  agentToolActivityLabel,
  agentTerminalDetail,
  agentTerminalLabel,
  agentTimelineScrollAnchorIndex,
  citationDisplaysForToolResult,
  formatAgentDuration,
  isSectionProposalOutdated,
  type AgentPreflightFailure,
  type AgentActivityStatus,
  type AgentCitationDisplay,
  type AgentTimelineItem,
  type AgentToolActivity,
  toolWasStopped
} from './agent-view-model'
import { ProposalPresentation } from './proposal-presentation'
import { blockOperationDisplays, deliveryLabel } from './agent-panel-logic'

export function EventTimeline(props: {
  timeline: AgentTimelineItem[]
  projectSessionId: string
  proposals: MutationProposalRecord[]
  runs: AgentRunRecord[]
  streaming: Record<string, string>
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  busy: boolean
  onNew(): void
  onProposalAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'request_changes' | 'reject' | 'undo' | 'cancel_image'
  ): Promise<void>
}): React.JSX.Element {
  const citationsById = useMemo(() => {
    const citations = new Map<string, AgentCitationDisplay>()
    for (const item of props.timeline) {
      if (item.type === 'activity') {
        for (const citation of item.citations) citations.set(citation.citationId, citation)
      } else if (item.type === 'proposal' && item.tool.result !== null) {
        for (const citation of citationDisplaysForToolResult(item.tool.result)) {
          citations.set(citation.citationId, citation)
        }
      }
    }
    return citations
  }, [props.timeline])
  const scrollAnchorIndex = agentTimelineScrollAnchorIndex(props.timeline)
  const runDurationById = useMemo(() => {
    const durations = new Map<string, number>()
    for (const item of props.timeline) {
      if (
        (item.type === 'run_completed' || item.type === 'run_interrupted') &&
        item.terminal.runId !== null
      ) {
        durations.set(item.terminal.runId, item.terminal.durationMs)
      }
    }
    return durations
  }, [props.timeline])

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller data-testid='agent-event-timeline'>
        <MessageScrollerViewport>
          <MessageScrollerContent className='gap-5 overflow-hidden px-4 py-4 pb-6'>
            {props.timeline.map((item, index) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                scrollAnchor={
                  Object.keys(props.streaming).length === 0 && index === scrollAnchorIndex
                }
              >
                <TimelineItem
                  item={item}
                  projectSessionId={props.projectSessionId}
                  proposals={props.proposals}
                  runs={props.runs}
                  citationsById={citationsById}
                  busy={props.busy}
                  currentRevisionIds={props.currentRevisionIds}
                  sectionTitles={props.sectionTitles}
                  onProposalAction={props.onProposalAction}
                  onNew={props.onNew}
                  runDurationById={runDurationById}
                />
              </MessageScrollerItem>
            ))}
            {Object.entries(props.streaming).map(([runId, content]) =>
              content.length === 0 ? null : (
                <MessageScrollerItem key={runId} messageId={runId} scrollAnchor>
                  <Message>
                    <MessageContent>
                      <Bubble variant='ghost'>
                        <BubbleContent>
                          <AgentMarkdown content={content} />
                        </BubbleContent>
                      </Bubble>
                      <MessageFooter>
                        <span>Writing response…</span>
                      </MessageFooter>
                    </MessageContent>
                  </Message>
                </MessageScrollerItem>
              )
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  )
}

function TimelineItem(props: {
  item: AgentTimelineItem
  projectSessionId: string
  proposals: MutationProposalRecord[]
  runs: AgentRunRecord[]
  citationsById: Map<string, AgentCitationDisplay>
  busy: boolean
  onNew(): void
  runDurationById: ReadonlyMap<string, number>
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  onProposalAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'request_changes' | 'reject' | 'undo' | 'cancel_image'
  ): Promise<void>
}): React.JSX.Element | null {
  const { item } = props
  if (item.type === 'user') {
    return (
      <Message align='end'>
        <MessageContent>
          <MessageHeader>
            {item.payload.presentation?.kind === 'review_feedback'
              ? 'Requested changes'
              : item.payload.presentation?.kind === 'annotation_context'
                ? `Prompt · ${item.payload.presentation.annotationCount} selected annotations`
                : item.payload.presentation?.kind === 'quick_action'
                  ? `Quick action · ${item.payload.presentation.label}`
                  : deliveryLabel(item.payload.delivery)}
          </MessageHeader>
          <Bubble variant='muted' align='end'>
            <BubbleContent className='whitespace-pre-wrap'>
              {item.payload.presentation?.kind === 'quick_action' ? (
                <div className='flex min-w-0 flex-col gap-2'>
                  {item.payload.presentation.displayInstruction === null ? null : (
                    <p>{item.payload.presentation.displayInstruction}</p>
                  )}
                  <Alert>
                    <AlertTitle>Captured selection</AlertTitle>
                    <AlertDescription className='max-h-40 overflow-y-auto whitespace-pre-wrap'>
                      {item.payload.presentation.selectedText}
                    </AlertDescription>
                  </Alert>
                </div>
              ) : (
                item.payload.content
              )}
            </BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }
  if (item.type === 'assistant') {
    const durationMs = item.runId === null ? undefined : props.runDurationById.get(item.runId)
    return (
      <Message>
        <MessageContent>
          <Bubble variant='ghost'>
            <BubbleContent>
              <AgentMarkdown content={item.payload.content} />
            </BubbleContent>
          </Bubble>
          {durationMs === undefined ? null : (
            <MessageFooter className='gap-1.5 tabular-nums'>
              <Clock3 className='size-3.5' /> Worked for {formatAgentDuration(durationMs)}
            </MessageFooter>
          )}
        </MessageContent>
      </Message>
    )
  }
  if (item.type === 'question') return <QuestionHistoryMessage item={item} />
  if (item.type === 'activity') return <ActivityGroup item={item} />
  if (item.type === 'preflight_failure') {
    return <PreflightFailureMessage failure={item.failure} />
  }
  if (item.type === 'approval_decision') {
    return (
      <Marker role='status'>
        <MarkerIcon>
          {item.payload.decision === 'approved' ? (
            <Check className='text-success' />
          ) : (
            <X className='text-destructive' />
          )}
        </MarkerIcon>
        <MarkerContent>
          {item.payload.decision === 'approved'
            ? item.payload.continueRequested
              ? 'Applied · continuing'
              : 'Applied'
            : item.payload.continueRequested
              ? 'Requested changes'
              : 'Proposal rejected'}
        </MarkerContent>
      </Marker>
    )
  }
  if (item.type === 'proposal') {
    return (
      <ProposalMessage
        item={item}
        projectSessionId={props.projectSessionId}
        citationsById={props.citationsById}
        busy={props.busy}
        currentRevisionIds={props.currentRevisionIds}
        sectionTitles={props.sectionTitles}
        onAction={props.onProposalAction}
      />
    )
  }
  if (item.type === 'run_interrupted') {
    if (item.terminal.outcome === 'awaiting_review') {
      return null
    }
    const terminalDetail = agentTerminalDetail(item.terminal.code)
    return (
      <Marker role='status'>
        <MarkerIcon>
          {item.terminal.status === 'failed' ? (
            <AlertCircle className='text-destructive' />
          ) : (
            <CircleStop className='text-destructive' />
          )}
        </MarkerIcon>
        <MarkerContent className={terminalDetail === null ? undefined : 'flex flex-col gap-1'}>
          <span>
            {item.terminal.code === 'user_stopped'
              ? 'Stopped'
              : agentTerminalLabel(item.terminal.code)}{' '}
            · after {formatAgentDuration(item.terminal.durationMs)}
          </span>
          {terminalDetail === null ? null : (
            <span className='text-xs text-muted-foreground'>{terminalDetail}</span>
          )}
        </MarkerContent>
      </Marker>
    )
  }
  if (item.type === 'run_completed') {
    return null
  }
  if (item.type === 'compaction_started') {
    return (
      <Marker role='status'>
        <MarkerIcon>
          <Spinner />
        </MarkerIcon>
        <MarkerContent>Summarizing earlier conversation…</MarkerContent>
      </Marker>
    )
  }
  if (item.type === 'compaction_failed') {
    const sourceTooLarge = item.payload.code === 'compaction_run_too_large'
    return (
      <Marker role='status'>
        <MarkerIcon>
          {item.payload.aborted ? <CircleStop /> : <AlertCircle className='text-destructive' />}
        </MarkerIcon>
        <MarkerContent className='flex flex-col items-start gap-2'>
          <span>
            {item.payload.aborted
              ? 'Conversation summary stopped'
              : sourceTooLarge
                ? 'A complete run is too large to summarize safely'
                : 'Conversation summary failed'}{' '}
            · original history preserved
          </span>
          {sourceTooLarge ? (
            <Button variant='outline' size='sm' onClick={props.onNew}>
              <MessageSquarePlus /> New conversation
            </Button>
          ) : null}
        </MarkerContent>
      </Marker>
    )
  }
  return <CompactionCheckpointMarker payload={item.payload} />
}

export function PreflightFailureMessage(props: {
  failure: AgentPreflightFailure
  defaultOpen?: boolean
}): React.JSX.Element {
  const { failure } = props
  return (
    <Collapsible
      className='group/preflight min-w-0 max-w-full overflow-hidden'
      defaultOpen={props.defaultOpen}
      data-testid='agent-preflight-failure'
    >
      <CollapsibleTrigger
        className='w-full cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
        aria-label='Show tool execution failure details'
      >
        <Marker role='status'>
          <MarkerIcon>
            <AlertCircle className='text-muted-foreground' />
          </MarkerIcon>
          <MarkerContent className='flex min-w-0 flex-1 items-center gap-2'>
            <span className='min-w-0 truncate text-foreground'>Tool execution failed</span>
            <span className='shrink-0 truncate text-xs text-muted-foreground'>
              · {failure.toolName}
            </span>
          </MarkerContent>
          <ChevronDown className='ml-auto shrink-0 text-muted-foreground transition-transform group-data-[state=open]/preflight:rotate-180' />
        </Marker>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='mt-2 ml-2 min-w-0 overflow-hidden border-l pl-4'>
          <Alert variant='destructive' data-testid='agent-preflight-failure-details'>
            <AlertCircle />
            <AlertTitle>
              {failure.toolName} · {failure.code}
            </AlertTitle>
            <AlertDescription className='flex flex-col gap-1'>
              <span>{failure.message}</span>
              {failure.paths.length > 0 ? (
                <span className='font-mono text-xs'>{failure.paths.join(', ')}</span>
              ) : null}
              <span className='text-xs'>
                Failed before dispatch · {formatAgentDuration(failure.durationMs)}
              </span>
            </AlertDescription>
          </Alert>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function QuestionHistoryMessage(props: {
  item: Extract<AgentTimelineItem, { type: 'question' }>
}): React.JSX.Element {
  const args = askUserArgsSchema.safeParse(props.item.tool.call.args)
  const result = askUserResultSchema.safeParse(props.item.tool.result?.result)
  if (!args.success) {
    return (
      <Marker role='status'>
        <MarkerIcon>
          <CircleHelp />
        </MarkerIcon>
        <MarkerContent>Agent requested clarification</MarkerContent>
      </Marker>
    )
  }
  if (props.item.tool.result === null && props.item.tool.stopped) {
    return (
      <Marker role='status'>
        <MarkerIcon>
          <CircleStop className='text-destructive' />
        </MarkerIcon>
        <MarkerContent>Clarification ended without an answer</MarkerContent>
      </Marker>
    )
  }
  if (props.item.tool.result === null) {
    return (
      <Marker role='status'>
        <MarkerIcon>
          <CircleHelp className='text-warning' />
        </MarkerIcon>
        <MarkerContent>
          Agent asked {args.data.questions.length} clarification question
          {args.data.questions.length === 1 ? '' : 's'}
        </MarkerContent>
      </Marker>
    )
  }
  if (props.item.tool.result.isError || !result.success) {
    return (
      <Marker role='status'>
        <MarkerIcon>
          <CircleStop className='text-destructive' />
        </MarkerIcon>
        <MarkerContent>Clarification ended without an answer</MarkerContent>
      </Marker>
    )
  }
  const answers = new Map(result.data.answers.map((answer) => [answer.questionId, answer]))
  return (
    <Message>
      <MessageContent>
        <MessageHeader>Agent asked · You answered</MessageHeader>
        <Bubble variant='ghost'>
          <BubbleContent>
            <ol className='flex min-w-0 list-none flex-col gap-4'>
              {args.data.questions.map((question) => {
                const answer = answers.get(question.id)
                return (
                  <li key={question.id} className='flex min-w-0 flex-col gap-1.5'>
                    <p className='wrap-anywhere text-sm font-medium'>{question.question}</p>
                    {answer === undefined ? null : (
                      <div className='flex min-w-0 items-start gap-2 text-sm'>
                        <Badge variant='secondary' className='shrink-0'>
                          {answer.kind === 'option' ? 'Selected' : 'Custom'}
                        </Badge>
                        <span className='wrap-anywhere min-w-0'>{answer.value}</span>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function CompactionCheckpointMarker(props: {
  payload: Extract<AgentTimelineItem, { type: 'compaction_summary' }>['payload']
}): React.JSX.Element {
  if (!('schemaVersion' in props.payload)) {
    return (
      <Marker variant='separator'>
        <MarkerContent>Earlier conversation summarized · legacy checkpoint</MarkerContent>
      </Marker>
    )
  }
  const payload = props.payload
  return (
    <Collapsible className='group/checkpoint min-w-0 max-w-full'>
      <CollapsibleTrigger className='w-full cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
        <Marker variant='separator'>
          <MarkerIcon>
            <ListCollapse />
          </MarkerIcon>
          <MarkerContent>
            Earlier conversation summarized · {compactionTriggerLabel(payload.trigger)}
          </MarkerContent>
          <ChevronDown className='ml-auto transition-transform group-data-[state=open]/checkpoint:rotate-180' />
        </Marker>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='mt-3 ml-2 flex min-w-0 flex-col gap-2 border-l pl-4 text-xs text-muted-foreground'>
          <p>
            Covered events {payload.coveredFromSequence}–{payload.coveredThroughSequence} · step{' '}
            {payload.stepIndex}
          </p>
          <p>
            Estimated context {payload.estimatedTokensBefore.toLocaleString()} →{' '}
            {payload.estimatedTokensAfter.toLocaleString()} tokens
          </p>
          <p>AI-generated context checkpoint, not manuscript authority.</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function compactionTriggerLabel(
  trigger: 'auto_threshold' | 'manual' | 'provider_overflow'
): string {
  if (trigger === 'manual') return 'manual'
  if (trigger === 'provider_overflow') return 'provider overflow recovery'
  return 'context limit'
}

function ActivityGroup(props: {
  item: Extract<AgentTimelineItem, { type: 'activity' }>
}): React.JSX.Element {
  const { item } = props
  const durationMs = item.tools.reduce((total, tool) => total + tool.durationMs, 0)
  return (
    <Collapsible
      className='group/activity min-w-0 max-w-full overflow-hidden'
      defaultOpen={agentActivityDefaultOpen(item.status)}
      data-testid='agent-activity-group'
      data-status={item.status}
    >
      <CollapsibleTrigger className='w-full cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
        <Marker role='status'>
          <MarkerIcon>{activityIcon(item.status)}</MarkerIcon>
          <MarkerContent className='min-w-0'>
            <span className='block truncate text-foreground'>{item.summary}</span>
            <span className='block text-xs text-muted-foreground tabular-nums'>
              {item.tools.length} {item.tools.length === 1 ? 'action' : 'actions'} ·{' '}
              {activityStatusLabel(item.status)} · {formatAgentDuration(durationMs)}
            </span>
            {item.failedCount > 0 ? (
              <Badge
                className='mt-1'
                variant={item.status === 'partial' ? 'warning' : 'destructive'}
              >
                {item.failedCount} of {item.tools.length} failed
              </Badge>
            ) : null}
          </MarkerContent>
          <ChevronDown className='ml-auto transition-transform group-data-[state=open]/activity:rotate-180' />
        </Marker>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='mt-3 ml-2 flex min-w-0 flex-col gap-3 overflow-hidden border-l pl-4'>
          <div className='flex min-w-0 flex-col gap-2'>
            {item.tools.map((tool) => (
              <AgentActivityStep key={tool.eventId} tool={tool} />
            ))}
          </div>
          {item.citations.length > 0 ? <CitationAttachments citations={item.citations} /> : null}
          {item.failedCount > 0 ? (
            <p className='text-xs text-muted-foreground'>
              Some actions did not complete. Open Details for diagnostics.
            </p>
          ) : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function AgentActivityStep(props: { tool: AgentToolActivity }): React.JSX.Element {
  const stopped = toolWasStopped(props.tool)
  return (
    <Marker data-testid={`agent-activity-step-${props.tool.call.toolCallId}`}>
      <MarkerIcon>{toolResultIcon(props.tool, stopped)}</MarkerIcon>
      <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-3'>
        <span className='min-w-0 truncate text-foreground'>
          {agentToolActivityLabel(props.tool)}
        </span>
        <span className='shrink-0 whitespace-nowrap text-xs'>
          {toolResultLabel(props.tool, stopped)} · {formatAgentDuration(props.tool.durationMs)}
        </span>
      </MarkerContent>
    </Marker>
  )
}

export function ToolActivityRow(props: {
  tool: AgentToolActivity
  stopped: boolean
}): React.JSX.Element {
  const { tool } = props
  const citations = tool.result === null ? [] : citationDisplaysForToolResult(tool.result)
  return (
    <div
      className='flex min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm'
      data-testid={`agent-tool-${tool.call.toolCallId}`}
    >
      <div className='flex min-w-0 items-center gap-2'>
        {toolResultIcon(tool, props.stopped)}
        <span className='min-w-0 flex-1 truncate font-medium'>{tool.call.toolName}</span>
        <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
          {toolResultLabel(tool, props.stopped)} · {formatAgentDuration(tool.durationMs)}
        </span>
      </div>
      <BoundedJsonDetails label='Bounded arguments' value={tool.call.args} />
      {tool.result?.error ? (
        <Alert variant='destructive'>
          <AlertCircle />
          <AlertTitle>{tool.result.error.code}</AlertTitle>
          <AlertDescription className='flex flex-col gap-1'>
            <span>{tool.result.error.message}</span>
            {toolRecoveryLabel(tool.result.error.recovery) === null ? null : (
              <span>{toolRecoveryLabel(tool.result.error.recovery)}</span>
            )}
          </AlertDescription>
        </Alert>
      ) : null}
      {citations.length > 0 ? <CitationAttachments citations={citations} /> : null}
      {tool.result?.result ? (
        <BoundedJsonDetails label='Bounded result' value={tool.result.result} />
      ) : null}
    </div>
  )
}

export function BoundedJsonDetails(props: { label: string; value: unknown }): React.JSX.Element {
  return (
    <Collapsible>
      <CollapsibleTrigger className='text-xs text-muted-foreground hover:text-foreground'>
        {props.label}
      </CollapsibleTrigger>
      <CollapsibleContent className='pt-2'>
        <pre className='max-h-48 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md bg-muted p-2 text-xs'>
          {JSON.stringify(props.value, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ProposalMessage(props: {
  item: Extract<AgentTimelineItem, { type: 'proposal' }>
  projectSessionId: string
  citationsById: Map<string, AgentCitationDisplay>
  busy: boolean
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  onAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'reject' | 'undo' | 'cancel_image'
  ): Promise<void>
}): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const proposal = props.item.proposal
  if (proposal === null) {
    const failed = props.item.tool.result?.isError === true
    const error = props.item.tool.result?.error ?? null
    return (
      <Marker role='status'>
        <MarkerIcon>{failed ? <X className='text-destructive' /> : <Spinner />}</MarkerIcon>
        <MarkerContent className={failed ? 'flex flex-col gap-1 text-destructive' : 'shimmer'}>
          {failed
            ? (error?.message ?? 'Proposal could not be prepared')
            : 'Preparing a reviewable proposal…'}
          {error === null || toolRecoveryLabel(error.recovery) === null ? null : (
            <span className='text-xs'>{toolRecoveryLabel(error.recovery)}</span>
          )}
        </MarkerContent>
      </Marker>
    )
  }
  const preview = proposal.payload.preview
  const isPending = proposal.status === 'pending'
  const isOutdated = isSectionProposalOutdated(proposal, props.currentRevisionIds)
  const canUndo =
    proposal.status === 'applied' &&
    (proposal.kind === 'section_patch' || proposal.kind === 'generated_image_insert')
  const sources = preview.citedSources.map(
    (source) =>
      props.citationsById.get(source.citationId) ?? {
        citationId: source.citationId,
        title: source.citationId
      }
  )
  const detail = (
    <div className='flex min-w-0 flex-col gap-3 overflow-hidden'>
      <div className='flex flex-wrap gap-1 text-xs'>
        {preview.affectedSectionIds.map((sectionId) => (
          <Badge key={sectionId} className='max-w-full' variant='outline' title={sectionId}>
            {props.sectionTitles[sectionId] ?? `Section ${sectionId.slice(0, 8)}`}
          </Badge>
        ))}
        {blockOperationDisplays(proposal).map((operation) => (
          <Badge key={operation.raw} className='max-w-full' variant='outline' title={operation.raw}>
            {operation.label}
          </Badge>
        ))}
      </div>
      <ProposalPresentation
        proposal={proposal}
        projectSessionId={props.projectSessionId}
        sectionTitles={props.sectionTitles}
        dark={resolvedTheme === 'dark'}
      />
      {sources.length > 0 ? <CitationAttachments citations={sources} /> : null}
      {proposal.replacesProposalId !== null ? (
        <p className='text-xs text-muted-foreground'>Refreshed from an outdated proposal.</p>
      ) : null}
      {proposal.status === 'conflicted' ? (
        <p className='text-sm text-destructive' role='alert'>
          This proposal conflicts with the latest section. {proposal.rejectedReason}
        </p>
      ) : null}
      {proposal.status === 'satisfied' ? (
        <p className='text-sm text-muted-foreground'>
          No update is needed because the latest section already contains this change.
        </p>
      ) : null}
      <div className='grid w-full min-w-0 gap-2 @xl/agent:flex @xl/agent:flex-wrap @xl/agent:justify-end'>
        {proposal.status === 'generating' ? (
          <Button
            variant='outline'
            size='sm'
            className='w-full @xl/agent:w-auto'
            onClick={() => void props.onAction(proposal, 'cancel_image')}
          >
            <X data-icon='inline-start' /> Cancel generation
          </Button>
        ) : null}
      </div>
    </div>
  )
  return (
    <Message data-testid={`agent-proposal-${proposal.proposalId}`} tabIndex={-1}>
      <MessageContent>
        <MessageHeader className='gap-2'>
          <FilePenLine className='size-4' />
          {isPending ? 'Review required' : 'Proposal result'}
        </MessageHeader>
        <Bubble
          variant='outline'
          className={
            isPending
              ? 'w-full max-w-full border-primary/50 ring-2 ring-primary/10'
              : 'w-full max-w-full'
          }
          data-testid='agent-proposal-bubble'
        >
          <BubbleContent className='flex w-full min-w-0 flex-col gap-3'>
            <div className='grid min-w-0 gap-2 @sm/agent:grid-cols-[minmax(0,1fr)_auto] @sm/agent:items-center'>
              <span className='min-w-0 flex-1 wrap-anywhere font-medium'>{preview.summary}</span>
              <div className='flex min-w-0 flex-wrap items-center gap-2 @sm/agent:justify-end'>
                <Badge variant={isPending ? 'warning' : 'outline'}>
                  {isOutdated ? 'outdated' : proposal.status}
                </Badge>
                {canUndo ? (
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={props.busy}
                    onClick={() => void props.onAction(proposal, 'undo')}
                  >
                    <Undo2 data-icon='inline-start' /> Undo
                  </Button>
                ) : null}
              </div>
            </div>
            {isPending ? (
              detail
            ) : (
              <Collapsible>
                <CollapsibleTrigger className='text-xs text-muted-foreground hover:text-foreground'>
                  View proposal details
                </CollapsibleTrigger>
                <CollapsibleContent className='pt-3'>{detail}</CollapsibleContent>
              </Collapsible>
            )}
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
}

function toolRecoveryLabel(
  recovery:
    | {
        action: string
        tool?: string
        maxAttempts?: number
        uri?: string
      }
    | undefined
): string | null {
  if (recovery === undefined) return null
  const target = recovery.uri ?? recovery.tool
  const attempts =
    recovery.maxAttempts === undefined ? '' : ` · at most ${recovery.maxAttempts} retry`
  return `Recovery: ${recovery.action}${target === undefined ? '' : ` with ${target}`}${attempts}`
}

function CitationAttachments(props: { citations: AgentCitationDisplay[] }): React.JSX.Element {
  return (
    <AttachmentGroup aria-label='Knowledge sources'>
      {props.citations.map((citation) => (
        <Attachment
          key={citation.citationId}
          className='w-64 max-w-full flex-nowrap overflow-hidden'
          size='sm'
          title={citation.citationId}
        >
          <AttachmentMedia>
            <FileText />
          </AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>{citation.title}</AttachmentTitle>
            <AttachmentDescription>
              {citation.page === undefined ? 'Knowledge source' : `Page ${citation.page + 1}`}
            </AttachmentDescription>
          </AttachmentContent>
        </Attachment>
      ))}
    </AttachmentGroup>
  )
}

function activityIcon(status: AgentActivityStatus): React.JSX.Element {
  if (status === 'running') return <CircleDotDashed className='text-muted-foreground' />
  if (status === 'partial')
    return <TriangleAlert className='text-warning-foreground dark:text-warning' />
  if (status === 'error') return <AlertCircle className='text-destructive' />
  if (status === 'stopped') return <CircleStop className='text-destructive' />
  return <Check className='text-success' />
}

function activityStatusLabel(status: AgentActivityStatus): string {
  if (status === 'running') return 'Running'
  if (status === 'partial') return 'Needs attention'
  if (status === 'error') return 'Failed'
  if (status === 'stopped') return 'Stopped'
  return 'Complete'
}

function toolResultIcon(tool: AgentToolActivity, stopped: boolean): React.JSX.Element {
  if ((tool.result === null && stopped) || toolWasStopped(tool))
    return <CircleStop className='text-destructive' />
  if (tool.result === null) return <CircleDotDashed className='text-muted-foreground' />
  if (tool.result.isError) return <X className='text-destructive' />
  return <Check className='text-success' />
}

function toolResultLabel(tool: AgentToolActivity, stopped: boolean): string {
  if ((tool.result === null && stopped) || toolWasStopped(tool)) return 'Stopped'
  if (tool.result === null) return 'Running'
  return tool.result.isError ? 'Error' : 'Complete'
}

export function elapsedRunMs(run: AgentRunRecord | null, now: number): number {
  if (run === null) return 0
  const start = Date.parse(run.startedAt)
  const end = run.completedAt === null ? now : Date.parse(run.completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, end - start)
}
