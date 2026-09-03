import type { AgentRunRecord } from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { AgentDiagnosticError } from '../../../../shared/agent-diagnostic-error'
import {
  AlertCircle,
  Check,
  ChevronDown,
  CircleDotDashed,
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
  agentTerminalDetail,
  agentTerminalLabel,
  agentTimelineScrollAnchorIndex,
  formatAgentDuration,
  type AgentPreflightFailure,
  type AgentActivityStatus,
  type AgentCitationDisplay,
  type AgentTimelineItem,
  type AgentToolPresentation,
  type AgentPresentation
} from './agent-view-model'
import { AgentDisclosure, AgentDisclosureProvider } from './agent-disclosure'
import { ProposalPresentation } from './proposal-presentation'
import { blockOperationDisplays, deliveryLabel } from './agent-panel-logic'

export function EventTimeline(props: {
  presentation: AgentPresentation
  projectSessionId: string
  sectionTitles: Readonly<Record<string, string>>
  busy: boolean
  onNew(): void
  onProposalAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'request_changes' | 'reject' | 'undo' | 'cancel_image'
  ): Promise<void>
}): React.JSX.Element {
  const { timeline } = props.presentation
  const scrollAnchorIndex = agentTimelineScrollAnchorIndex(timeline)

  return (
    <AgentDisclosureProvider key={props.projectSessionId}>
      <MessageScrollerProvider autoScroll>
        <MessageScroller data-testid='agent-event-timeline'>
          <MessageScrollerViewport>
            <MessageScrollerContent className='gap-5 overflow-hidden px-4 py-4 pb-6'>
              {timeline.map((item, index) => (
                <MessageScrollerItem
                  key={item.id}
                  messageId={item.id}
                  scrollAnchor={index === scrollAnchorIndex}
                >
                  <TimelineItem
                    item={item}
                    projectSessionId={props.projectSessionId}
                    busy={props.busy}
                    sectionTitles={props.sectionTitles}
                    onProposalAction={props.onProposalAction}
                    onNew={props.onNew}
                  />
                  {item.runDurationMs === undefined ? null : (
                    <MessageFooter className='mt-2 gap-1.5 tabular-nums'>
                      <Clock3 className='size-3.5' /> Worked for{' '}
                      {formatAgentDuration(item.runDurationMs)}
                    </MessageFooter>
                  )}
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </AgentDisclosureProvider>
  )
}

function TimelineItem(props: {
  item: AgentTimelineItem
  projectSessionId: string
  busy: boolean
  onNew(): void
  sectionTitles: Readonly<Record<string, string>>
  onProposalAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'request_changes' | 'reject' | 'undo' | 'cancel_image'
  ): Promise<void>
}): React.JSX.Element | null {
  const { item } = props
  if (item.type === 'message' && item.role === 'user') {
    return (
      <Message align='end'>
        <MessageContent>
          <MessageHeader>
            {item.payload.presentation?.kind === 'review_feedback'
              ? 'Requested changes'
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
  if (item.type === 'message' && item.role === 'assistant') {
    return (
      <Message>
        <MessageContent>
          <Bubble variant='ghost'>
            <BubbleContent>
              <AgentMarkdown content={item.payload.content} />
            </BubbleContent>
          </Bubble>
          {item.streaming ? (
            <MessageFooter>
              <span>Writing response…</span>
            </MessageFooter>
          ) : null}
        </MessageContent>
      </Message>
    )
  }
  if (item.type === 'question') return <QuestionHistoryMessage item={item} />
  if (item.type === 'activity') return <ActivityGroup item={item} />
  if (item.type === 'notice' && item.kind === 'preflight') {
    return <PreflightFailureMessage failure={item.failure} disclosureId={item.id} />
  }
  if (item.type === 'notice' && item.kind === 'approval') {
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
  if (item.type === 'change') {
    return (
      <ProposalMessage
        item={item}
        projectSessionId={props.projectSessionId}
        busy={props.busy}
        sectionTitles={props.sectionTitles}
        onAction={props.onProposalAction}
      />
    )
  }
  if (item.type === 'notice' && item.kind === 'terminal') {
    if (item.terminal.outcome === 'awaiting_review') {
      return null
    }
    const terminalDetail = agentTerminalDetail(item.terminal.code)
    const diagnostic = item.terminal.diagnostic
    const terminalMessage =
      diagnostic?.message ||
      (item.terminal.code === 'user_stopped' ? 'Stopped' : agentTerminalLabel(item.terminal.code))
    return (
      <Marker role='status'>
        <MarkerIcon>
          {item.terminal.status === 'failed' ? (
            <AlertCircle className='text-destructive' />
          ) : (
            <CircleStop className='text-destructive' />
          )}
        </MarkerIcon>
        <MarkerContent
          className={
            diagnostic !== undefined || terminalDetail !== null ? 'flex flex-col gap-1' : undefined
          }
        >
          <span className='wrap-anywhere'>
            {terminalMessage} · after {formatAgentDuration(item.terminal.durationMs)}
          </span>
          {diagnostic === undefined || diagnostic.message.length === 0 ? null : (
            <AgentDiagnosticDetails diagnostic={diagnostic} />
          )}
          {diagnostic !== undefined || terminalDetail === null ? null : (
            <span className='text-xs text-muted-foreground'>{terminalDetail}</span>
          )}
        </MarkerContent>
      </Marker>
    )
  }
  if (item.type === 'notice' && item.kind === 'tool') {
    return (
      <AgentDisclosure disclosureId={item.id}>
        <CollapsibleTrigger className='text-left text-sm'>
          {item.tool.result?.error?.message ?? `${item.tool.label} · ${item.tool.statusLabel}`}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ToolActivityRow tool={item.tool} />
        </CollapsibleContent>
      </AgentDisclosure>
    )
  }
  if (item.type === 'compaction' && item.state === 'running') {
    return (
      <Marker role='status'>
        <MarkerIcon>
          <Spinner />
        </MarkerIcon>
        <MarkerContent>Summarizing earlier conversation…</MarkerContent>
      </Marker>
    )
  }
  if (item.type === 'compaction' && item.state === 'error') {
    return <CompactionFailureMessage payload={item.payload} onNew={props.onNew} />
  }
  if (item.type === 'compaction' && item.state === 'complete')
    return <CompactionCheckpointMarker payload={item.payload} disclosureId={item.id} />
  return null
}

export function CompactionFailureMessage(props: {
  payload: Extract<AgentTimelineItem, { type: 'compaction'; state: 'error' }>['payload']
  onNew(): void
}): React.JSX.Element {
  const sourceTooLarge = props.payload.code === 'compaction_run_too_large'
  const diagnostic = props.payload.diagnostic
  const fallbackMessage = props.payload.aborted
    ? 'Conversation summary stopped'
    : sourceTooLarge
      ? 'A complete run is too large to summarize safely'
      : 'Conversation summary failed'
  return (
    <Marker role='status'>
      <MarkerIcon>
        {props.payload.aborted ? <CircleStop /> : <AlertCircle className='text-destructive' />}
      </MarkerIcon>
      <MarkerContent className='flex flex-col items-start gap-2'>
        <span className='wrap-anywhere'>
          {diagnostic?.message ?? fallbackMessage} · original history preserved
        </span>
        {diagnostic === undefined ? null : <AgentDiagnosticDetails diagnostic={diagnostic} />}
        {sourceTooLarge ? (
          <Button variant='outline' size='sm' onClick={props.onNew}>
            <MessageSquarePlus /> New conversation
          </Button>
        ) : null}
      </MarkerContent>
    </Marker>
  )
}

export function PreflightFailureMessage(props: {
  failure: AgentPreflightFailure
  disclosureId?: string
  defaultOpen?: boolean
}): React.JSX.Element {
  const { failure } = props
  return (
    <AgentDisclosure
      disclosureId={props.disclosureId ?? 'preflight'}
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
            <span className='min-w-0 flex-1 truncate text-foreground'>{failure.message}</span>
            <span className='shrink-0 truncate text-xs text-muted-foreground'>
              · {failure.toolName} · {failure.code}
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
              {failure.details === undefined ? null : (
                <AgentDiagnosticDetails
                  diagnostic={failure.details}
                  defaultOpen={props.defaultOpen}
                />
              )}
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
    </AgentDisclosure>
  )
}

function QuestionHistoryMessage(props: {
  item: Extract<AgentTimelineItem, { type: 'question' }>
}): React.JSX.Element {
  if (props.item.questions.length === 0 || props.item.tool.status !== 'complete') {
    return (
      <Marker role='status'>
        <MarkerIcon>
          <CircleStop />
        </MarkerIcon>
        <MarkerContent>
          {props.item.tool.result?.error?.message ?? 'Clarification ended without an answer'}
        </MarkerContent>
      </Marker>
    )
  }
  return (
    <Message>
      <MessageContent>
        <MessageHeader>Agent asked · You answered</MessageHeader>
        <Bubble variant='ghost'>
          <BubbleContent>
            <ol className='flex min-w-0 list-none flex-col gap-4'>
              {props.item.questions.map((question) => {
                const answer = question.answer
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
  payload: Extract<AgentTimelineItem, { type: 'compaction'; state: 'complete' }>['payload']
  disclosureId: string
}): React.JSX.Element {
  if (!('schemaVersion' in props.payload)) {
    return (
      <Marker variant='separator'>
        <MarkerContent>Earlier conversation summarized · legacy checkpoint</MarkerContent>
      </Marker>
    )
  }
  const payload = props.payload
  const stepDetail = 'stepIndex' in payload ? ` · step ${payload.stepIndex}` : ''
  const omittedEventCount =
    'omittedEventCount' in payload && payload.omittedEventCount > 0
      ? payload.omittedEventCount.toLocaleString()
      : null
  return (
    <AgentDisclosure
      disclosureId={props.disclosureId}
      className='group/checkpoint min-w-0 max-w-full'
    >
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
            Covered events {payload.coveredFromSequence}–{payload.coveredThroughSequence}
            {stepDetail}
          </p>
          {omittedEventCount === null ? null : (
            <p>{omittedEventCount} older events omitted from this checkpoint.</p>
          )}
          <p>
            Estimated context {payload.estimatedTokensBefore.toLocaleString()} →{' '}
            {payload.estimatedTokensAfter.toLocaleString()} tokens
          </p>
          <p>AI-generated context checkpoint, not manuscript authority.</p>
        </div>
      </CollapsibleContent>
    </AgentDisclosure>
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
  const durationMs = item.durationMs
  return (
    <AgentDisclosure
      disclosureId={item.id}
      className='group/activity min-w-0 max-w-full overflow-hidden'
      defaultOpen={item.defaultOpen}
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
          {item.failedCount > 0 ? (
            <p className='text-xs text-muted-foreground'>
              Some actions did not complete. Open Details for diagnostics.
            </p>
          ) : null}
        </div>
      </CollapsibleContent>
    </AgentDisclosure>
  )
}

function AgentActivityStep(props: { tool: AgentToolPresentation }): React.JSX.Element {
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <Marker data-testid={`agent-activity-step-${props.tool.call.toolCallId}`}>
        <MarkerIcon>{activityIcon(props.tool.status)}</MarkerIcon>
        <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-3'>
          <span className='min-w-0 truncate text-foreground'>{props.tool.label}</span>
          <span className='shrink-0 whitespace-nowrap text-xs'>
            {props.tool.statusLabel} · {formatAgentDuration(props.tool.durationMs)}
          </span>
        </MarkerContent>
      </Marker>
      {props.tool.result?.error ? (
        <p className='text-xs text-destructive'>{props.tool.result.error.message}</p>
      ) : null}
      {props.tool.citations.length > 0 ? (
        <CitationAttachments citations={props.tool.citations} />
      ) : null}
    </div>
  )
}

export function ToolActivityRow(props: { tool: AgentToolPresentation }): React.JSX.Element {
  const { tool } = props
  const citations = tool.citations
  const error = tool.result?.error ?? null
  const diagnostic = tool.diagnostic
  const recovery = tool.recoveryLabel
  return (
    <div
      className='flex min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm'
      data-testid={`agent-tool-${tool.call.toolCallId}`}
    >
      <div className='flex min-w-0 items-center gap-2'>
        {activityIcon(tool.status)}
        <span className='min-w-0 flex-1 truncate font-medium'>{tool.call.toolName}</span>
        <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
          {tool.statusLabel} · {formatAgentDuration(tool.durationMs)}
        </span>
      </div>
      <BoundedJsonDetails label='Bounded arguments' value={tool.call.args} />
      {error ? (
        <Alert variant='destructive'>
          <AlertCircle />
          <AlertTitle>{error.code}</AlertTitle>
          <AlertDescription className='flex flex-col gap-1'>
            <span className='wrap-anywhere'>{error.message}</span>
            {diagnostic === undefined ? null : <AgentDiagnosticDetails diagnostic={diagnostic} />}
            {recovery === null ? null : <span>{recovery}</span>}
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

export function AgentDiagnosticDetails(props: {
  diagnostic: AgentDiagnosticError
  defaultOpen?: boolean
}): React.JSX.Element {
  const { diagnostic } = props
  return (
    <Collapsible
      className='min-w-0 max-w-full'
      defaultOpen={props.defaultOpen}
      data-testid='agent-diagnostic-details'
    >
      <CollapsibleTrigger className='text-xs text-muted-foreground hover:text-foreground'>
        Show diagnostic details
      </CollapsibleTrigger>
      <CollapsibleContent className='pt-2'>
        <div className='flex min-w-0 flex-col gap-2 rounded-md border bg-muted/20 p-2 text-xs'>
          <p className='min-w-0 wrap-anywhere text-foreground'>{diagnostic.message}</p>
          <dl className='grid min-w-0 gap-x-3 gap-y-1 @sm/agent:grid-cols-[auto_minmax(0,1fr)]'>
            <dt className='text-muted-foreground'>Stage</dt>
            <dd className='min-w-0 wrap-anywhere text-foreground'>{diagnostic.stage}</dd>
            {diagnostic.code === undefined ? null : (
              <>
                <dt className='text-muted-foreground'>Code</dt>
                <dd className='min-w-0 wrap-anywhere font-mono text-foreground'>
                  {diagnostic.code}
                </dd>
              </>
            )}
            {diagnostic.httpStatus === undefined ? null : (
              <>
                <dt className='text-muted-foreground'>HTTP status</dt>
                <dd className='text-foreground'>{diagnostic.httpStatus}</dd>
              </>
            )}
          </dl>
          {diagnostic.causes.length === 0 ? null : (
            <div className='min-w-0'>
              <p className='mb-1 text-muted-foreground'>Causes</p>
              <ol className='m-0 flex min-w-0 list-decimal flex-col gap-2 pl-4'>
                {diagnostic.causes.map((cause) => (
                  <li
                    key={cause.stack ?? `${cause.name}:${cause.message}`}
                    className='min-w-0 wrap-anywhere text-foreground'
                  >
                    <span>
                      {cause.name}: {cause.message}
                    </span>
                    {cause.code === undefined && cause.httpStatus === undefined ? null : (
                      <span className='ml-1 text-muted-foreground'>
                        {cause.code === undefined ? '' : `code ${cause.code}`}
                        {cause.code !== undefined && cause.httpStatus !== undefined ? ' · ' : ''}
                        {cause.httpStatus === undefined ? '' : `HTTP ${cause.httpStatus}`}
                      </span>
                    )}
                    {cause.stack === undefined ? null : (
                      <pre className='mt-1 max-h-32 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere rounded bg-muted p-1.5 font-mono text-[11px] text-muted-foreground'>
                        {cause.stack}
                      </pre>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {diagnostic.stack === undefined ? null : (
            <div className='min-w-0'>
              <p className='mb-1 text-muted-foreground'>Stack</p>
              <pre className='max-h-48 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere rounded bg-muted p-1.5 font-mono text-[11px] text-muted-foreground'>
                {diagnostic.stack}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ProposalMessage(props: {
  item: Extract<AgentTimelineItem, { type: 'change' }>
  projectSessionId: string
  busy: boolean
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
    const diagnostic = props.item.tool.diagnostic
    const recovery = props.item.tool.recoveryLabel
    return (
      <Marker role='status'>
        <MarkerIcon>{activityIcon(props.item.tool.status)}</MarkerIcon>
        <MarkerContent
          className={
            failed
              ? 'flex flex-col gap-1 text-destructive'
              : props.item.tool.status === 'running'
                ? 'shimmer'
                : ''
          }
        >
          {props.item.summary}
          {diagnostic === undefined ? null : <AgentDiagnosticDetails diagnostic={diagnostic} />}
          {recovery === null ? null : <span className='text-xs'>{recovery}</span>}
        </MarkerContent>
      </Marker>
    )
  }
  const preview = proposal.payload.preview
  const isPending = props.item.pending
  const isOutdated = props.item.outdated
  const canUndo = props.item.canUndo
  const sources = props.item.citations
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
            {props.item.failureMessage === null ? null : (
              <p className='text-sm text-destructive' role='alert'>
                {props.item.failureMessage}
              </p>
            )}
            <AgentDisclosure disclosureId={props.item.id} defaultOpen={props.item.defaultOpen}>
              <CollapsibleTrigger className='text-xs text-muted-foreground hover:text-foreground'>
                View proposal details
              </CollapsibleTrigger>
              <CollapsibleContent className='pt-3'>{detail}</CollapsibleContent>
            </AgentDisclosure>
          </BubbleContent>
        </Bubble>
      </MessageContent>
    </Message>
  )
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

export function elapsedRunMs(run: AgentRunRecord | null, now: number): number {
  if (run === null) return 0
  const start = Date.parse(run.startedAt)
  const end = run.completedAt === null ? now : Date.parse(run.completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, end - start)
}
