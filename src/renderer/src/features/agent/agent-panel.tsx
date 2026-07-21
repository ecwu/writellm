import {
  agentAssistantMessagePayloadSchema,
  agentCompactionSummaryPayloadSchema,
  agentUserMessagePayloadSchema
} from '../../../../shared/contracts/agent'
import type {
  AgentEventRecord,
  AgentRunRecord,
  AgentSessionRecord,
  AgentStartScope
} from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import { agentToolCallPayloadSchema } from '../../../../shared/contracts/agent-tools'
import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  FilePenLine,
  FolderOpen,
  LoaderCircle,
  MessageSquarePlus,
  RotateCcw,
  Send,
  TextCursorInput,
  Undo2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { approveProposalAfterEditorFlush } from '../manuscript/agent-proposal-actions'
import { AgentMarkdown } from './agent-markdown'
import {
  aggregateAgentUsage,
  citationDisplaysForToolResult,
  findLatestPrompt,
  findToolResult,
  mergeAgentEvents
} from './agent-view-model'

export interface AgentPanelSelection {
  sectionId: string
  activeBlockId: string | null
  selectedBlockIds: string[]
}

export function AgentPanel(props: {
  open: boolean
  onOpenChange(open: boolean): void
  projectSessionId: string
  activeSectionId: string | null
  selection: AgentPanelSelection | null
  flushCurrent(): Promise<boolean>
  refreshManuscript(): Promise<void>
  onError(message: string): void
}): React.JSX.Element {
  const [sessions, setSessions] = useState<AgentSessionRecord[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<AgentEventRecord[]>([])
  const [runs, setRuns] = useState<AgentRunRecord[]>([])
  const [proposals, setProposals] = useState<MutationProposalRecord[]>([])
  const [streaming, setStreaming] = useState<Record<string, string>>({})
  const [prompt, setPrompt] = useState('')
  const [scope, setScope] = useState<AgentStartScope>('section')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const activeSessionIdRef = useRef<string | null>(null)
  activeSessionIdRef.current = activeSessionId

  const refreshSessions = useCallback(async (): Promise<AgentSessionRecord[]> => {
    const next = await window.desktop.agent.listSessions({
      projectSessionId: props.projectSessionId
    })
    setSessions(next)
    setActiveSessionId((current) =>
      current !== null && next.some((session) => session.agentSessionId === current)
        ? current
        : (next[0]?.agentSessionId ?? null)
    )
    return next
  }, [props.projectSessionId])

  const refreshSessionTruth = useCallback(
    async (agentSessionId: string): Promise<void> => {
      const [nextRuns, nextProposals] = await Promise.all([
        window.desktop.agent.listRuns({
          projectSessionId: props.projectSessionId,
          agentSessionId
        }),
        window.desktop.agent.listProposals({
          projectSessionId: props.projectSessionId,
          agentSessionId
        })
      ])
      if (activeSessionIdRef.current !== agentSessionId) return
      setRuns(nextRuns)
      setProposals(nextProposals)
    },
    [props.projectSessionId]
  )

  useEffect(() => {
    if (!props.open) return
    let disposed = false
    setLoading(true)
    setError(null)
    void refreshSessions()
      .catch((cause) => {
        if (disposed) return
        setError('Agent sessions could not be loaded.')
        props.onError(errorMessage(cause))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [props.open, props.onError, refreshSessions])

  useEffect(() => {
    if (!props.open || activeSessionId === null) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    setEvents([])
    setRuns([])
    setProposals([])
    setStreaming({})
    setError(null)
    void refreshSessionTruth(activeSessionId).catch((cause) => {
      if (!disposed) {
        setError('The selected conversation could not be loaded.')
        props.onError(errorMessage(cause))
      }
    })
    void window.desktop.agent
      .subscribeEvents(
        { projectSessionId: props.projectSessionId, agentSessionId: activeSessionId },
        (rendererEvent) => {
          if (disposed) return
          if (rendererEvent.kind === 'delta') {
            setStreaming((current) => ({
              ...current,
              [rendererEvent.agentRunId]:
                `${current[rendererEvent.agentRunId] ?? ''}${rendererEvent.delta}`.slice(
                  0,
                  2_097_152
                )
            }))
            return
          }
          setEvents((current) => mergeAgentEvents(current, rendererEvent.event))
          if (rendererEvent.event.type === 'assistant_message') {
            const runId = rendererEvent.event.agentRunId
            if (runId !== null) {
              setStreaming((current) => {
                const next = { ...current }
                delete next[runId]
                return next
              })
            }
          }
          if (
            rendererEvent.event.type === 'tool_result' ||
            rendererEvent.event.type === 'run_completed' ||
            rendererEvent.event.type === 'run_interrupted'
          ) {
            void refreshSessionTruth(activeSessionId).catch((cause) =>
              props.onError(errorMessage(cause))
            )
          }
        }
      )
      .then((release) => {
        if (disposed) release()
        else unsubscribe = release
      })
      .catch((cause) => {
        if (!disposed) {
          setError('Conversation event replay is unavailable.')
          props.onError(errorMessage(cause))
        }
      })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [activeSessionId, props.onError, props.open, props.projectSessionId, refreshSessionTruth])

  const selectionIsAvailable = selectionAvailable({
    activeSectionId: props.activeSectionId,
    selection: props.selection
  })

  useEffect(() => {
    if (scope === 'selection' && !selectionIsAvailable) setScope('section')
    if (scope === 'section' && props.activeSectionId === null) setScope('project')
  }, [props.activeSectionId, scope, selectionIsAvailable])

  const activeSession =
    sessions.find((session) => session.agentSessionId === activeSessionId) ?? null
  const activeRun = runs.find((run) => run.status === 'running') ?? null
  const usage = useMemo(() => aggregateAgentUsage(events), [events])
  const latestPrompt = useMemo(() => findLatestPrompt(events), [events])

  const createSession = async (): Promise<AgentSessionRecord> => {
    const created = await window.desktop.agent.createSession({
      projectSessionId: props.projectSessionId,
      title: `Conversation ${sessions.length + 1}`
    })
    setSessions((current) => [created, ...current])
    setActiveSessionId(created.agentSessionId)
    return created
  }

  const startRun = async (content: string): Promise<void> => {
    const trimmed = content.trim()
    if (trimmed.length === 0 || busy || activeRun !== null) return
    setBusy(true)
    setError(null)
    try {
      if (!(await props.flushCurrent())) {
        setError('Save the active section before starting the Agent.')
        return
      }
      const session = activeSession ?? (await createSession())
      const run = await window.desktop.agent.startRun({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId,
        prompt: trimmed,
        scope,
        editorContext: editorContextForScope(scope, props.activeSectionId, props.selection)
      })
      setRuns((current) => [run, ...current.filter((item) => item.agentRunId !== run.agentRunId)])
      setPrompt('')
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      props.onError(message)
    } finally {
      setBusy(false)
    }
  }

  const queueMessage = async (delivery: 'steer' | 'follow_up'): Promise<void> => {
    if (activeRun === null || prompt.trim().length === 0 || busy) return
    setBusy(true)
    setError(null)
    try {
      const input = {
        projectSessionId: props.projectSessionId,
        agentRunId: activeRun.agentRunId,
        content: prompt.trim()
      }
      if (delivery === 'steer') await window.desktop.agent.steerRun(input)
      else await window.desktop.agent.followUpRun(input)
      setPrompt('')
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      props.onError(message)
    } finally {
      setBusy(false)
    }
  }

  const updateProposal = (proposal: MutationProposalRecord): void => {
    setProposals((current) => [
      ...current.filter((item) => item.proposalId !== proposal.proposalId),
      proposal
    ])
  }

  const proposalAction = async (
    proposal: MutationProposalRecord,
    action: 'approve' | 'reject' | 'undo'
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'approve') {
        const result = await approveProposalAfterEditorFlush({
          proposal,
          activeSectionId: props.activeSectionId,
          flushCurrent: props.flushCurrent,
          approve: () =>
            window.desktop.agent.approveProposal({
              projectSessionId: props.projectSessionId,
              agentSessionId: proposal.agentSessionId,
              proposalId: proposal.proposalId
            })
        })
        if (result === null) throw new Error('The active editor could not be saved before approval')
        updateProposal(result.proposal)
        await props.refreshManuscript()
      } else if (action === 'reject') {
        const result = await window.desktop.agent.rejectProposal({
          projectSessionId: props.projectSessionId,
          agentSessionId: proposal.agentSessionId,
          proposalId: proposal.proposalId,
          reason: 'Rejected by the user in the Agent panel.'
        })
        updateProposal(result.proposal)
      } else {
        const result = await window.desktop.agent.undoProposal({
          projectSessionId: props.projectSessionId,
          agentSessionId: proposal.agentSessionId,
          proposalId: proposal.proposalId
        })
        updateProposal(result.proposal)
        await props.refreshManuscript()
      }
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      props.onError(message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent
        className='flex w-full flex-col gap-0 p-0 sm:max-w-2xl'
        data-testid='agent-panel'
      >
        <SheetHeader className='border-b px-5 py-4'>
          <div className='flex items-start justify-between gap-3 pr-8'>
            <div>
              <SheetTitle className='flex items-center gap-2'>
                <Bot className='size-4' /> Writing agent
              </SheetTitle>
              <SheetDescription>
                Evidence-grounded assistance with reviewable manuscript proposals.
              </SheetDescription>
            </div>
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() => void createSession().catch((cause) => setError(errorMessage(cause)))}
            >
              <MessageSquarePlus /> New
            </Button>
          </div>
          <fieldset
            className='flex gap-2 overflow-x-auto border-0 p-0 pt-2'
            aria-label='Agent conversations'
          >
            {sessions.map((session) => (
              <Button
                key={session.agentSessionId}
                size='sm'
                variant={session.agentSessionId === activeSessionId ? 'secondary' : 'ghost'}
                disabled={busy}
                onClick={() => setActiveSessionId(session.agentSessionId)}
              >
                {session.title}
                {!session.compatible ? <Badge variant='destructive'>Read only</Badge> : null}
              </Button>
            ))}
          </fieldset>
        </SheetHeader>

        <div className='flex flex-wrap items-center gap-2 border-b px-5 py-2 text-xs text-muted-foreground'>
          {activeRun ? (
            <>
              <LoaderCircle className='size-3 animate-spin' />
              <span>Working…</span>
              <Badge variant='outline'>{activeRun.providerId}</Badge>
              <Badge variant='outline'>{activeRun.modelId}</Badge>
            </>
          ) : (
            <span>Idle</span>
          )}
          <span className='ml-auto'>
            {usage.inputTokens.toLocaleString()} in · {usage.outputTokens.toLocaleString()} out
            {usage.retryCount > 0 ? ` · ${usage.retryCount} retries` : ''}
          </span>
        </div>

        <ScrollArea className='min-h-0 flex-1 px-5 py-4'>
          {loading ? (
            <div className='flex items-center gap-2 text-sm text-muted-foreground'>
              <LoaderCircle className='size-4 animate-spin' /> Loading conversations…
            </div>
          ) : activeSession === null ? (
            <div className='flex min-h-64 flex-col items-center justify-center gap-3 text-center'>
              <Bot className='size-8 text-muted-foreground' />
              <p className='font-medium'>Start a writing conversation</p>
              <p className='max-w-sm text-sm text-muted-foreground'>
                Choose project, section, or selected-block context. Agent changes always remain
                proposals until you approve them.
              </p>
            </div>
          ) : (
            <EventTimeline
              events={events}
              proposals={proposals}
              streaming={streaming}
              onProposalAction={proposalAction}
              busy={busy}
            />
          )}
        </ScrollArea>

        <div className='space-y-3 border-t px-5 py-4'>
          {error ? (
            <Alert variant='destructive'>
              <AlertCircle />
              <AlertTitle>Agent action failed</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {activeRun === null ? (
            <fieldset
              className='flex flex-wrap gap-2 border-0 p-0'
              aria-label='Agent context scope'
            >
              <ScopeButton
                active={scope === 'selection'}
                disabled={!selectionIsAvailable}
                icon={<TextCursorInput />}
                label='Selection'
                onClick={() => setScope('selection')}
              />
              <ScopeButton
                active={scope === 'section'}
                disabled={props.activeSectionId === null}
                icon={<FilePenLine />}
                label='Section'
                onClick={() => setScope('section')}
              />
              <ScopeButton
                active={scope === 'project'}
                disabled={false}
                icon={<FolderOpen />}
                label='Project'
                onClick={() => setScope('project')}
              />
            </fieldset>
          ) : null}
          <Textarea
            aria-label='Agent message'
            value={prompt}
            placeholder={
              activeRun ? 'Steer the current turn or queue a follow-up…' : 'Ask the writing agent…'
            }
            rows={3}
            disabled={busy || activeSession?.compatible === false}
            onChange={(event) => setPrompt(event.target.value)}
          />
          <div className='flex flex-wrap justify-end gap-2'>
            {activeRun ? (
              <>
                <Button
                  variant='outline'
                  disabled={busy || prompt.trim().length === 0}
                  onClick={() => void queueMessage('steer')}
                >
                  <ChevronRight /> Steer
                </Button>
                <Button
                  variant='outline'
                  disabled={busy || prompt.trim().length === 0}
                  onClick={() => void queueMessage('follow_up')}
                >
                  <Send /> Follow up
                </Button>
                <Button
                  variant='destructive'
                  disabled={busy}
                  onClick={() => {
                    setBusy(true)
                    void window.desktop.agent
                      .abortRun({
                        projectSessionId: props.projectSessionId,
                        agentRunId: activeRun.agentRunId
                      })
                      .catch((cause) => setError(errorMessage(cause)))
                      .finally(() => setBusy(false))
                  }}
                >
                  <CircleStop /> Stop
                </Button>
              </>
            ) : (
              <>
                {latestPrompt ? (
                  <Button
                    variant='outline'
                    disabled={busy}
                    onClick={() => void startRun(latestPrompt)}
                  >
                    <RotateCcw /> Retry
                  </Button>
                ) : null}
                {events.length > 0 ? (
                  <Button
                    variant='outline'
                    disabled={busy}
                    onClick={() => void startRun('Continue from the previous response.')}
                  >
                    <ChevronRight /> Continue
                  </Button>
                ) : null}
                <Button
                  disabled={
                    busy || prompt.trim().length === 0 || activeSession?.compatible === false
                  }
                  onClick={() => void startRun(prompt)}
                >
                  <Send /> Send
                </Button>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function EventTimeline(props: {
  events: AgentEventRecord[]
  proposals: MutationProposalRecord[]
  streaming: Record<string, string>
  busy: boolean
  onProposalAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'reject' | 'undo'
  ): Promise<void>
}): React.JSX.Element {
  return (
    <div className='space-y-4 pb-4' data-testid='agent-event-timeline'>
      {props.events.map((event) => {
        if (event.type === 'user_message') {
          const payload = agentUserMessagePayloadSchema.safeParse(event.payload)
          if (!payload.success) return null
          return (
            <div key={event.agentEventId} className='ml-10 rounded-lg bg-muted px-3 py-2 text-sm'>
              <div className='mb-1 text-xs text-muted-foreground'>
                {deliveryLabel(payload.data.delivery)}
              </div>
              <p className='whitespace-pre-wrap'>{payload.data.content}</p>
            </div>
          )
        }
        if (event.type === 'assistant_message') {
          const payload = agentAssistantMessagePayloadSchema.safeParse(event.payload)
          if (!payload.success) return null
          if (payload.data.content.length === 0 && payload.data.stopReason === 'toolUse')
            return null
          return (
            <div key={event.agentEventId} className='space-y-2 rounded-lg border px-3 py-2 text-sm'>
              <AgentMarkdown content={payload.data.content} />
              <div className='flex flex-wrap gap-1 text-xs text-muted-foreground'>
                <span>{payload.data.metadata.usage.inputTokens ?? 0} in</span>
                <span>{payload.data.metadata.usage.outputTokens ?? 0} out</span>
                {payload.data.metadata.retryCount > 0 ? (
                  <span>{payload.data.metadata.retryCount} retries</span>
                ) : null}
                {payload.data.interrupted ? <Badge variant='destructive'>Interrupted</Badge> : null}
              </div>
            </div>
          )
        }
        if (event.type === 'tool_call') {
          const payload = agentToolCallPayloadSchema.safeParse(event.payload)
          if (!payload.success) return null
          const result = findToolResult(props.events, payload.data.toolCallId)
          const proposal = props.proposals.find(
            (candidate) => candidate.agentToolCallId === payload.data.toolCallId
          )
          const citationDisplays = result ? citationDisplaysForToolResult(result) : []
          return (
            <div key={event.agentEventId} className='space-y-3 rounded-lg border px-3 py-3 text-sm'>
              <div className='flex items-center gap-2'>
                {result === null ? (
                  <LoaderCircle className='size-4 animate-spin' />
                ) : result.isError ? (
                  <X className='size-4 text-destructive' />
                ) : (
                  <Check className='size-4 text-green-600' />
                )}
                <span className='font-medium'>{payload.data.toolName}</span>
                <Badge variant='outline' className='ml-auto'>
                  {result === null ? 'running' : result.isError ? 'error' : 'complete'}
                </Badge>
              </div>
              <details>
                <summary className='cursor-pointer text-xs text-muted-foreground'>
                  Bounded arguments
                </summary>
                <pre className='mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs'>
                  {JSON.stringify(payload.data.args, null, 2)}
                </pre>
              </details>
              {result?.error ? (
                <Alert variant='destructive'>
                  <AlertCircle />
                  <AlertTitle>{result.error.code}</AlertTitle>
                  <AlertDescription>{result.error.message}</AlertDescription>
                </Alert>
              ) : null}
              {citationDisplays.length > 0 ? (
                <div className='flex flex-wrap gap-1'>
                  {citationDisplays.map((citation) => (
                    <Badge
                      key={citation.citationId}
                      variant='secondary'
                      className='max-w-full whitespace-normal text-left'
                      title={citation.citationId}
                    >
                      {citation.title}
                      {citation.page === undefined ? '' : ` · Page ${citation.page + 1}`}
                    </Badge>
                  ))}
                </div>
              ) : null}
              {result?.result ? (
                <details>
                  <summary className='cursor-pointer text-xs text-muted-foreground'>
                    Bounded result
                  </summary>
                  <pre className='mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs'>
                    {JSON.stringify(result.result, null, 2)}
                  </pre>
                </details>
              ) : null}
              {proposal ? (
                <ProposalCard
                  proposal={proposal}
                  busy={props.busy}
                  onAction={props.onProposalAction}
                />
              ) : null}
            </div>
          )
        }
        if (event.type === 'run_interrupted') {
          return (
            <Alert key={event.agentEventId} variant='destructive'>
              <CircleStop />
              <AlertTitle>Run interrupted</AlertTitle>
              <AlertDescription>
                The durable conversation remains available to retry or continue.
              </AlertDescription>
            </Alert>
          )
        }
        if (event.type === 'compaction_summary') {
          const payload = agentCompactionSummaryPayloadSchema.safeParse(event.payload)
          if (!payload.success) return null
          return (
            <div key={event.agentEventId} className='text-center text-xs text-muted-foreground'>
              Context summarized through event {payload.data.coveredThroughSequence}; full history
              retained.
            </div>
          )
        }
        return null
      })}
      {Object.entries(props.streaming).map(([runId, content]) =>
        content.length === 0 ? null : (
          <div key={runId} className='rounded-lg border px-3 py-2 text-sm'>
            <AgentMarkdown content={content} />
            <div className='mt-2 flex items-center gap-2 text-xs text-muted-foreground'>
              <LoaderCircle className='size-3 animate-spin' /> Streaming…
            </div>
          </div>
        )
      )}
    </div>
  )
}

function ProposalCard(props: {
  proposal: MutationProposalRecord
  busy: boolean
  onAction(proposal: MutationProposalRecord, action: 'approve' | 'reject' | 'undo'): Promise<void>
}): React.JSX.Element {
  const preview = props.proposal.payload.preview
  const isPending = props.proposal.status === 'pending'
  const canUndo = props.proposal.status === 'applied' && props.proposal.kind === 'section_patch'
  return (
    <section
      className='space-y-3 rounded-md border bg-background p-3'
      data-testid={`agent-proposal-${props.proposal.proposalId}`}
    >
      <div className='flex items-center gap-2'>
        <FilePenLine className='size-4' />
        <span className='font-medium'>{preview.summary}</span>
        <Badge className='ml-auto' variant={isPending ? 'secondary' : 'outline'}>
          {props.proposal.status}
        </Badge>
      </div>
      <div className='flex flex-wrap gap-1 text-xs'>
        {preview.affectedSectionIds.map((sectionId) => (
          <Badge key={sectionId} variant='outline'>
            Section {sectionId.slice(0, 8)}
          </Badge>
        ))}
        {blockOperationLabels(props.proposal).map((label) => (
          <Badge key={label} variant='outline'>
            {label}
          </Badge>
        ))}
      </div>
      <div className='grid gap-2 sm:grid-cols-2'>
        <div>
          <p className='mb-1 text-xs font-medium text-muted-foreground'>Before</p>
          <pre className='max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs'>
            {preview.beforeText || '—'}
          </pre>
        </div>
        <div>
          <p className='mb-1 text-xs font-medium text-muted-foreground'>After</p>
          <pre className='max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs'>
            {preview.afterText || '—'}
          </pre>
        </div>
      </div>
      {preview.citedSources.length > 0 ? (
        <div className='space-y-1 text-xs'>
          <p className='font-medium'>Sources</p>
          {preview.citedSources.map((source) => (
            <p key={source.citationId} className='break-all text-muted-foreground'>
              {source.citationId} · {source.sourceBlockIds.join(', ')}
            </p>
          ))}
        </div>
      ) : null}
      <div className='flex justify-end gap-2'>
        {isPending ? (
          <>
            <Button
              variant='outline'
              size='sm'
              disabled={props.busy}
              onClick={() => void props.onAction(props.proposal, 'reject')}
            >
              <X /> Reject
            </Button>
            <Button
              size='sm'
              disabled={props.busy}
              onClick={() => void props.onAction(props.proposal, 'approve')}
            >
              <Check /> Approve
            </Button>
          </>
        ) : null}
        {canUndo ? (
          <Button
            variant='outline'
            size='sm'
            disabled={props.busy}
            onClick={() => void props.onAction(props.proposal, 'undo')}
          >
            <Undo2 /> Undo
          </Button>
        ) : null}
      </div>
    </section>
  )
}

function ScopeButton(props: {
  active: boolean
  disabled: boolean
  icon: React.ReactNode
  label: string
  onClick(): void
}): React.JSX.Element {
  return (
    <Button
      type='button'
      size='sm'
      variant={props.active ? 'secondary' : 'outline'}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.icon} {props.label}
    </Button>
  )
}

function selectionAvailable(props: {
  activeSectionId: string | null
  selection: AgentPanelSelection | null
}): boolean {
  return (
    props.activeSectionId !== null &&
    props.selection?.sectionId === props.activeSectionId &&
    props.selection.selectedBlockIds.length > 0
  )
}

function editorContextForScope(
  scope: AgentStartScope,
  activeSectionId: string | null,
  selection: AgentPanelSelection | null
) {
  if (scope === 'project') {
    return { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
  }
  if (activeSectionId === null) throw new Error('No active section is available')
  if (scope === 'section') {
    return { activeSectionId, activeBlockId: null, selectedBlockIds: [] }
  }
  if (selection?.sectionId !== activeSectionId || selection.selectedBlockIds.length === 0) {
    throw new Error('No active block selection is available')
  }
  return {
    activeSectionId,
    activeBlockId: selection.activeBlockId,
    selectedBlockIds: selection.selectedBlockIds
  }
}

function deliveryLabel(delivery: 'prompt' | 'steer' | 'follow_up'): string {
  if (delivery === 'steer') return 'Steering message'
  if (delivery === 'follow_up') return 'Follow-up message'
  return 'You'
}

function blockOperationLabels(proposal: MutationProposalRecord): string[] {
  if (proposal.payload.kind !== 'section_patch') return []
  return proposal.payload.mutation.operations.map((operation, index) => {
    if ('blockId' in operation) return `${operation.type}: ${operation.blockId}`
    if ('blockIds' in operation) return `${operation.type}: ${operation.blockIds.join(', ')}`
    return `${operation.type} ${index + 1}`
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The Agent operation failed.'
}
