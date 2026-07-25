import type {
  AgentEventRecord,
  AgentRunRecord,
  AgentSessionRecord,
  AgentStartScope
} from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { AgentApprovalMode } from '../../../../shared/contracts/agent'
import {
  AlertCircle,
  ArrowLeft,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FileText,
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
import { Textarea } from '@/components/ui/textarea'
import { Progress } from '@/components/ui/progress'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useTheme } from '@/theme-provider'
import { approveProposalAfterEditorFlush } from '../manuscript/agent-proposal-actions'
import { AgentMarkdown } from './agent-markdown'
import {
  aggregateAgentUsage,
  applyAgentTerminalEvent,
  citationDisplaysForToolResult,
  formatAgentDuration,
  findLatestPrompt,
  isSectionProposalOutdated,
  latestAgentContextUsage,
  mergeAgentEvents,
  protectTerminalAgentRuns,
  projectAgentTimeline,
  type AgentCitationDisplay,
  type AgentTimelineItem,
  type AgentToolActivity,
  toolWasStopped
} from './agent-view-model'
import { ProposalDiff } from './proposal-diff'

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
  currentRevisionIds: Readonly<Record<string, string>>
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
  const [screen, setScreen] = useState<'sessions' | 'conversation'>('sessions')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revisionTransitions, setRevisionTransitions] = useState<
    Record<string, { from: string | undefined; to: string }>
  >({})
  const activeSessionIdRef = useRef<string | null>(null)
  const terminalRunIdsRef = useRef<Set<string>>(new Set())
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
    async (
      agentSessionId: string
    ): Promise<{ runs: AgentRunRecord[]; proposals: MutationProposalRecord[] }> => {
      const [nextRuns, nextProposals, nextSessions] = await Promise.all([
        window.desktop.agent.listRuns({
          projectSessionId: props.projectSessionId,
          agentSessionId
        }),
        window.desktop.agent.listProposals({
          projectSessionId: props.projectSessionId,
          agentSessionId
        }),
        window.desktop.agent.listSessions({
          projectSessionId: props.projectSessionId
        })
      ])
      setSessions(nextSessions)
      if (activeSessionIdRef.current !== agentSessionId) {
        return { runs: nextRuns, proposals: nextProposals }
      }
      setRuns((current) => protectTerminalAgentRuns(current, nextRuns, terminalRunIdsRef.current))
      setProposals(nextProposals)
      return { runs: nextRuns, proposals: nextProposals }
    },
    [props.projectSessionId]
  )

  useEffect(() => {
    if (!props.open) return
    let disposed = false
    setScreen('sessions')
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
    let unsubscribeMutations: (() => void) | undefined
    setEvents([])
    setRuns([])
    setProposals([])
    setStreaming({})
    terminalRunIdsRef.current = new Set()
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
          const terminalRunId = rendererEvent.event.agentRunId
          if (
            terminalRunId !== null &&
            (rendererEvent.event.type === 'run_completed' ||
              rendererEvent.event.type === 'run_interrupted')
          ) {
            terminalRunIdsRef.current.add(terminalRunId)
            setRuns((current) => applyAgentTerminalEvent(current, rendererEvent.event))
            setStreaming((current) => {
              const next = { ...current }
              delete next[terminalRunId]
              return next
            })
          }
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
    void window.desktop.agent
      .subscribeMutations({ projectSessionId: props.projectSessionId }, (event) => {
        if (disposed) return
        if (event.agentSessionId === activeSessionId) {
          void refreshSessionTruth(activeSessionId).catch((cause) =>
            props.onError(errorMessage(cause))
          )
        } else {
          void refreshSessions().catch((cause) => props.onError(errorMessage(cause)))
        }
      })
      .then((release) => {
        if (disposed) release()
        else unsubscribeMutations = release
      })
      .catch((cause) => {
        if (!disposed) props.onError(errorMessage(cause))
      })
    return () => {
      disposed = true
      unsubscribe?.()
      unsubscribeMutations?.()
    }
  }, [
    activeSessionId,
    props.onError,
    props.open,
    props.projectSessionId,
    refreshSessions,
    refreshSessionTruth
  ])

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
  const hasStreamingRun = Object.keys(streaming).length > 0
  const isAgentWorking = activeRun !== null || hasStreamingRun
  const [clockNow, setClockNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isAgentWorking) return
    setClockNow(Date.now())
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [isAgentWorking])
  const usage = useMemo(() => aggregateAgentUsage(events), [events])
  const contextUsage = useMemo(() => latestAgentContextUsage(events), [events])
  const latestRun = runs[0] ?? null
  const contextLimits = activeRun?.modelLimits ?? latestRun?.modelLimits ?? null
  const contextPercent =
    contextUsage === null || contextLimits === null
      ? 0
      : Math.min(100, (contextUsage.used / contextLimits.contextWindowTokens) * 100)
  const waitingProposal = proposals.find((proposal) => proposal.status === 'pending')
  const generatingProposal = proposals.find((proposal) => proposal.status === 'generating')
  const workflowState =
    activeRun !== null
      ? 'running'
      : generatingProposal !== undefined
        ? 'generating'
        : waitingProposal !== undefined
          ? 'awaiting_review'
          : (activeSession?.workflowState ?? 'idle')
  const conversationLocked = workflowState === 'awaiting_review' || workflowState === 'generating'
  const latestPrompt = useMemo(() => findLatestPrompt(events), [events])
  const effectiveRevisionIds = useMemo(() => {
    const result = { ...props.currentRevisionIds }
    for (const [sectionId, transition] of Object.entries(revisionTransitions)) {
      if (result[sectionId] === transition.from) result[sectionId] = transition.to
    }
    return result
  }, [props.currentRevisionIds, revisionTransitions])

  const createSession = async (): Promise<AgentSessionRecord> => {
    const created = await window.desktop.agent.createSession({
      projectSessionId: props.projectSessionId,
      title: `Conversation ${sessions.length + 1}`
    })
    setSessions((current) => [created, ...current])
    setActiveSessionId(created.agentSessionId)
    setScreen('conversation')
    return created
  }

  const setApprovalMode = async (mode: AgentApprovalMode): Promise<void> => {
    if (activeSession === null || activeRun !== null) return
    setBusy(true)
    try {
      const updated = await window.desktop.agent.setApprovalMode({
        projectSessionId: props.projectSessionId,
        agentSessionId: activeSession.agentSessionId,
        mode
      })
      setSessions((current) =>
        current.map((session) =>
          session.agentSessionId === updated.agentSessionId ? updated : session
        )
      )
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      props.onError(message)
    } finally {
      setBusy(false)
    }
  }

  const openSession = (agentSessionId: string): void => {
    setActiveSessionId(agentSessionId)
    setScreen('conversation')
  }

  const startRun = async (
    content: string,
    approvedProposalId?: string,
    allowWhileBusy = false,
    skipEditorFlush = false
  ): Promise<void> => {
    const trimmed = content.trim()
    if (
      trimmed.length === 0 ||
      (!allowWhileBusy && busy) ||
      ((activeRun !== null || conversationLocked) && approvedProposalId === undefined)
    )
      return
    setBusy(true)
    setError(null)
    try {
      if (!skipEditorFlush && !(await props.flushCurrent())) {
        setError('Save the active section before starting the Agent.')
        return
      }
      const session = activeSession ?? (await createSession())
      const run = await window.desktop.agent.startRun({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId,
        prompt: trimmed,
        ...(approvedProposalId === undefined ? {} : { approvedProposalId }),
        scope,
        editorContext: editorContextForScope(
          scope,
          props.activeSectionId,
          props.selection,
          props.currentRevisionIds
        )
      })
      setRuns((current) =>
        protectTerminalAgentRuns(
          current,
          [run, ...current.filter((item) => item.agentRunId !== run.agentRunId)],
          terminalRunIdsRef.current
        )
      )
      setPrompt('')
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      props.onError(message)
    } finally {
      setBusy(false)
    }
  }

  const reconcileInactiveRun = async (agentRunId: string): Promise<boolean> => {
    if (activeSessionId === null) return false
    try {
      const truth = await refreshSessionTruth(activeSessionId)
      return (
        terminalRunIdsRef.current.has(agentRunId) ||
        truth.runs.find((run) => run.agentRunId === agentRunId)?.status !== 'running'
      )
    } catch (cause) {
      props.onError(errorMessage(cause))
      return false
    }
  }

  const stopRun = async (): Promise<void> => {
    if (activeRun === null || busy) return
    const agentRunId = activeRun.agentRunId
    setBusy(true)
    setError(null)
    try {
      await window.desktop.agent.abortRun({
        projectSessionId: props.projectSessionId,
        agentRunId
      })
      if (activeSessionId !== null) await refreshSessionTruth(activeSessionId)
    } catch (cause) {
      if (!(await reconcileInactiveRun(agentRunId))) {
        const message = errorMessage(cause)
        setError(message)
        props.onError(message)
      }
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
      if (await reconcileInactiveRun(activeRun.agentRunId)) return
      const message = errorMessage(cause)
      setError(message)
      props.onError(message)
    } finally {
      setBusy(false)
    }
  }

  const updateProposals = (...updated: MutationProposalRecord[]): void => {
    const updatedIds = new Set(updated.map((proposal) => proposal.proposalId))
    setProposals((current) => [
      ...current.filter((item) => !updatedIds.has(item.proposalId)),
      ...updated
    ])
  }

  const proposalAction = async (
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'reject' | 'undo' | 'cancel_image'
  ): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (action === 'approve' || action === 'approve_continue') {
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
        if (result.outcome === 'refresh_required') {
          updateProposals(result.previousProposal, result.proposal)
        } else {
          updateProposals(result.proposal)
          if (result.outcome === 'applied') {
            const changed = result.sectionChanged
            if (changed !== null) {
              setRevisionTransitions((current) => ({
                ...current,
                [changed.sectionId]: {
                  from: effectiveRevisionIds[changed.sectionId],
                  to: changed.sectionRevisionId
                }
              }))
            }
            await props.refreshManuscript()
          }
        }
        if (
          action === 'approve_continue' &&
          result.outcome !== 'refresh_required' &&
          (result.outcome === 'applied' || result.outcome === 'already_satisfied')
        ) {
          await refreshSessionTruth(proposal.agentSessionId)
          await startRun(
            'Verify the applied change, continue the requested writing task, and run check_draft when appropriate.',
            result.proposal.proposalId,
            true,
            true
          )
        }
      } else if (action === 'reject') {
        const result = await window.desktop.agent.rejectProposal({
          projectSessionId: props.projectSessionId,
          agentSessionId: proposal.agentSessionId,
          proposalId: proposal.proposalId,
          reason: 'Rejected by the user in the Agent panel.'
        })
        updateProposals(result.proposal)
        await refreshSessionTruth(proposal.agentSessionId)
      } else if (action === 'cancel_image') {
        await window.desktop.agent.cancelImageGeneration({
          projectSessionId: props.projectSessionId,
          agentSessionId: proposal.agentSessionId,
          proposalId: proposal.proposalId
        })
        await refreshSessionTruth(proposal.agentSessionId)
      } else {
        const result = await window.desktop.agent.undoProposal({
          projectSessionId: props.projectSessionId,
          agentSessionId: proposal.agentSessionId,
          proposalId: proposal.proposalId
        })
        updateProposals(result.proposal)
        if (result.sectionChanged !== null) {
          const changed = result.sectionChanged
          setRevisionTransitions((current) => ({
            ...current,
            [changed.sectionId]: {
              from: effectiveRevisionIds[changed.sectionId],
              to: changed.sectionRevisionId
            }
          }))
        }
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
    <aside
      className={
        props.open
          ? 'flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background'
          : 'hidden'
      }
      data-testid='agent-panel'
      aria-label='Writing agent side chat'
    >
      {screen === 'sessions' ? (
        <>
          <header className='flex min-w-0 items-start gap-3 overflow-hidden border-b px-4 py-3'>
            <div className='min-w-0 flex-1'>
              <h2 className='flex items-center gap-2 font-semibold'>
                <Bot className='size-4' /> Writing agent
              </h2>
              <p className='mt-0.5 text-xs text-muted-foreground'>
                Choose a conversation or start a new one.
              </p>
            </div>
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() => void createSession().catch((cause) => setError(errorMessage(cause)))}
            >
              <MessageSquarePlus /> New
            </Button>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Close writing agent'
              onClick={() => props.onOpenChange(false)}
            >
              <X />
            </Button>
          </header>
          <div className='min-h-0 flex-1 overflow-y-auto p-2' data-testid='agent-session-list'>
            {loading ? (
              <Marker role='status' className='px-3 py-4'>
                <MarkerIcon>
                  <LoaderCircle className='animate-spin' />
                </MarkerIcon>
                <MarkerContent>Loading conversations…</MarkerContent>
              </Marker>
            ) : sessions.length === 0 ? (
              <div className='flex min-h-64 flex-col items-center justify-center gap-3 px-6 text-center'>
                <Bot className='size-8 text-muted-foreground' />
                <p className='font-medium'>Start a writing conversation</p>
                <p className='text-sm text-muted-foreground'>
                  Agent edits stay reviewable proposals until you approve them.
                </p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void createSession().catch((cause) => setError(errorMessage(cause)))
                  }
                >
                  <MessageSquarePlus /> New conversation
                </Button>
              </div>
            ) : (
              <div className='space-y-1'>
                {sessions.map((session) => {
                  const sessionWorkflowState =
                    session.agentSessionId === activeSessionId && activeRun !== null
                      ? 'running'
                      : session.workflowState
                  return (
                    <Button
                      key={session.agentSessionId}
                      variant='ghost'
                      className='h-auto w-full min-w-0 justify-start gap-3 overflow-hidden px-3 py-3 text-left'
                      disabled={busy}
                      data-testid={`agent-session-${session.agentSessionId}`}
                      onClick={() => openSession(session.agentSessionId)}
                    >
                      <span className='flex size-8 shrink-0 items-center justify-center rounded-md bg-muted'>
                        <Bot className='size-4' />
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate font-medium'>{session.title}</span>
                        <span className='mt-0.5 block text-xs font-normal text-muted-foreground'>
                          {formatSessionUpdatedAt(session.updatedAt)}
                        </span>
                      </span>
                      {sessionWorkflowState === 'awaiting_review' ? (
                        <Badge variant='secondary' className='shrink-0'>
                          Approval needed
                        </Badge>
                      ) : sessionWorkflowState === 'generating' ? (
                        <Badge variant='secondary' className='shrink-0'>
                          <LoaderCircle className='animate-spin' /> Generating
                        </Badge>
                      ) : sessionWorkflowState === 'running' ? (
                        <Badge variant='secondary' className='shrink-0'>
                          <LoaderCircle className='animate-spin' /> Working
                        </Badge>
                      ) : !session.compatible ? (
                        <Badge variant='destructive' className='shrink-0'>
                          Read only
                        </Badge>
                      ) : session.status === 'archived' ? (
                        <Badge variant='outline' className='shrink-0'>
                          Archived
                        </Badge>
                      ) : (
                        <ChevronRight className='size-4 shrink-0 text-muted-foreground' />
                      )}
                    </Button>
                  )
                })}
              </div>
            )}
          </div>
          {error ? <AgentErrorAlert message={error} className='m-3 mt-0' /> : null}
        </>
      ) : (
        <>
          <header className='flex items-center gap-2 border-b px-3 py-2.5'>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Back to conversations'
              onClick={() => setScreen('sessions')}
            >
              <ArrowLeft />
            </Button>
            <div className='min-w-0 flex-1'>
              <h2 className='truncate text-sm font-semibold'>
                {activeSession?.title ?? 'Conversation'}
              </h2>
            </div>
            {activeSession ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={busy || activeRun !== null || conversationLocked}
                  >
                    {approvalModeLabel(activeSession.approvalMode)} <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  {(['manual', 'section_auto', 'yolo'] as const).map((mode) => (
                    <DropdownMenuItem key={mode} onSelect={() => void setApprovalMode(mode)}>
                      {activeSession.approvalMode === mode ? (
                        <Check />
                      ) : (
                        <span className='size-4' />
                      )}
                      {approvalModeLabel(mode)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='Close writing agent'
              onClick={() => props.onOpenChange(false)}
            >
              <X />
            </Button>
          </header>

          <div className='flex min-w-0 flex-wrap items-center gap-2 overflow-hidden border-b px-4 py-2 text-xs text-muted-foreground'>
            {workflowState === 'running' && activeRun ? (
              <>
                <LoaderCircle className='size-3 animate-spin' />
                <span className='shimmer'>
                  Working · {formatAgentDuration(elapsedRunMs(activeRun, clockNow))}
                </span>
                <Badge className='max-w-40' variant='outline' title={activeRun.providerId}>
                  {activeRun.providerId}
                </Badge>
                <Badge className='max-w-40' variant='outline' title={activeRun.modelId}>
                  {activeRun.modelId}
                </Badge>
              </>
            ) : workflowState === 'generating' ? (
              <>
                <LoaderCircle className='size-3 animate-spin' />
                <span>Generating image</span>
              </>
            ) : workflowState === 'awaiting_review' ? (
              <span className='text-amber-700 dark:text-amber-400'>Waiting for review</span>
            ) : (
              <span>Idle</span>
            )}
            <span className='ml-auto max-w-full truncate'>
              {usage.inputTokens.toLocaleString()} in · {usage.outputTokens.toLocaleString()} out
              {usage.retryCount > 0 ? ` · ${usage.retryCount} retries` : ''}
            </span>
            {contextLimits !== null ? (
              <div
                className='flex basis-full items-center gap-2'
                title={`${contextUsage?.used.toLocaleString() ?? 'No usage'} / ${contextLimits.contextWindowTokens.toLocaleString()} context tokens; input limit ${contextLimits.inputLimitTokens?.toLocaleString() ?? 'context-derived'}; output limit ${contextLimits.outputLimitTokens?.toLocaleString() ?? 'provider default'}; source ${contextLimits.source}; resolved ${contextLimits.resolvedAt ?? 'legacy'}`}
              >
                <Progress value={contextPercent} className='h-1.5 flex-1' />
                <span className='tabular-nums'>
                  {contextUsage?.estimated ? '~' : ''}
                  {contextUsage?.used.toLocaleString() ?? '—'} /{' '}
                  {contextLimits.contextWindowTokens.toLocaleString()}
                </span>
              </div>
            ) : null}
            {workflowState === 'awaiting_review' && waitingProposal !== undefined ? (
              <div className='basis-full text-amber-700 dark:text-amber-400'>
                Waiting for {proposalKindLabel(waitingProposal.kind)} approval
              </div>
            ) : workflowState === 'generating' ? (
              <div className='basis-full text-muted-foreground'>
                This conversation will resume after image generation finishes.
              </div>
            ) : null}
          </div>

          <div className='min-h-0 flex-1'>
            {loading ? (
              <Marker role='status' className='p-4'>
                <MarkerIcon>
                  <LoaderCircle className='animate-spin' />
                </MarkerIcon>
                <MarkerContent>Loading conversation…</MarkerContent>
              </Marker>
            ) : activeSession === null ? (
              <div className='flex min-h-64 flex-col items-center justify-center gap-3 text-center'>
                <Bot className='size-8 text-muted-foreground' />
                <p className='font-medium'>Conversation unavailable</p>
                <Button variant='outline' onClick={() => setScreen('sessions')}>
                  <ArrowLeft /> Back to conversations
                </Button>
              </div>
            ) : (
              <EventTimeline
                events={events}
                proposals={proposals}
                runs={runs}
                now={clockNow}
                streaming={streaming}
                currentRevisionIds={effectiveRevisionIds}
                onProposalAction={proposalAction}
                busy={busy}
              />
            )}
          </div>

          <div className='min-w-0 space-y-3 overflow-hidden border-t px-4 py-3'>
            {error ? <AgentErrorAlert message={error} /> : null}
            {activeRun === null && !conversationLocked ? (
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
                activeRun
                  ? 'Steer the current turn or queue a follow-up…'
                  : workflowState === 'generating'
                    ? 'Image generation is in progress…'
                    : workflowState === 'awaiting_review'
                      ? 'Review the pending proposal before continuing…'
                      : 'Ask the writing agent…'
              }
              rows={3}
              disabled={busy || conversationLocked || activeSession?.compatible === false}
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
                  <Button variant='destructive' disabled={busy} onClick={() => void stopRun()}>
                    <CircleStop /> Stop
                  </Button>
                </>
              ) : conversationLocked ? (
                <Badge variant='secondary'>
                  {workflowState === 'generating' ? 'Generating image' : 'Approval required'}
                </Badge>
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
        </>
      )}
    </aside>
  )
}

function EventTimeline(props: {
  events: AgentEventRecord[]
  proposals: MutationProposalRecord[]
  runs: AgentRunRecord[]
  now: number
  streaming: Record<string, string>
  currentRevisionIds: Readonly<Record<string, string>>
  busy: boolean
  onProposalAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'reject' | 'undo'
  ): Promise<void>
}): React.JSX.Element {
  const timeline = useMemo(
    () => projectAgentTimeline(props.events, props.proposals, props.runs, props.now),
    [props.events, props.now, props.proposals, props.runs]
  )
  const citationsById = useMemo(() => {
    const citations = new Map<string, AgentCitationDisplay>()
    for (const item of timeline) {
      if (item.type === 'activity') {
        for (const citation of item.citations) citations.set(citation.citationId, citation)
      } else if (item.type === 'proposal' && item.tool.result !== null) {
        for (const citation of citationDisplaysForToolResult(item.tool.result)) {
          citations.set(citation.citationId, citation)
        }
      }
    }
    return citations
  }, [timeline])

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller data-testid='agent-event-timeline'>
        <MessageScrollerViewport>
          <MessageScrollerContent className='gap-5 overflow-hidden px-4 py-4 pb-6'>
            {timeline.map((item, index) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                scrollAnchor={index === timeline.length - 1}
              >
                <TimelineItem
                  item={item}
                  citationsById={citationsById}
                  busy={props.busy}
                  currentRevisionIds={props.currentRevisionIds}
                  onProposalAction={props.onProposalAction}
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
                      <MessageFooter className='gap-2'>
                        <LoaderCircle className='size-3 animate-spin' />
                        <span className='shimmer'>Streaming…</span>
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
  citationsById: Map<string, AgentCitationDisplay>
  busy: boolean
  currentRevisionIds: Readonly<Record<string, string>>
  onProposalAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'reject' | 'undo'
  ): Promise<void>
}): React.JSX.Element {
  const { item } = props
  if (item.type === 'user') {
    return (
      <Message align='end'>
        <MessageContent>
          <MessageHeader>{deliveryLabel(item.payload.delivery)}</MessageHeader>
          <Bubble variant='muted' align='end'>
            <BubbleContent className='whitespace-pre-wrap'>{item.payload.content}</BubbleContent>
          </Bubble>
        </MessageContent>
      </Message>
    )
  }
  if (item.type === 'assistant') {
    return (
      <Message>
        <MessageContent>
          <Bubble variant='ghost'>
            <BubbleContent>
              <AgentMarkdown content={item.payload.content} />
            </BubbleContent>
          </Bubble>
          <MessageFooter className='flex-wrap gap-x-2 gap-y-1'>
            <span>{item.payload.metadata.usage.inputTokens ?? 0} in</span>
            <span>{item.payload.metadata.usage.outputTokens ?? 0} out</span>
            {item.payload.metadata.retryCount > 0 ? (
              <span>{item.payload.metadata.retryCount} retries</span>
            ) : null}
            {item.payload.interrupted ? <Badge variant='destructive'>Interrupted</Badge> : null}
          </MessageFooter>
        </MessageContent>
      </Message>
    )
  }
  if (item.type === 'activity') return <ActivityGroup item={item} />
  if (item.type === 'proposal') {
    return (
      <ProposalMessage
        item={item}
        citationsById={props.citationsById}
        busy={props.busy}
        currentRevisionIds={props.currentRevisionIds}
        onAction={props.onProposalAction}
      />
    )
  }
  if (item.type === 'run_interrupted') {
    if (item.terminal.outcome === 'awaiting_review') {
      return (
        <Marker role='status'>
          <MarkerIcon>
            <AlertCircle className='text-amber-600' />
          </MarkerIcon>
          <MarkerContent>
            Waiting for review · {formatAgentDuration(item.terminal.durationMs)}
          </MarkerContent>
        </Marker>
      )
    }
    return (
      <Marker role='status'>
        <MarkerIcon>
          {item.terminal.status === 'failed' ? (
            <AlertCircle className='text-destructive' />
          ) : (
            <CircleStop className='text-destructive' />
          )}
        </MarkerIcon>
        <MarkerContent>
          {terminalLabel(item.terminal.code)} · {formatAgentDuration(item.terminal.durationMs)}
        </MarkerContent>
      </Marker>
    )
  }
  if (item.type === 'run_completed') {
    if (item.terminal.outcome === 'awaiting_review') {
      return (
        <Marker role='status'>
          <MarkerIcon>
            <AlertCircle className='text-amber-600' />
          </MarkerIcon>
          <MarkerContent>
            Waiting for review · {formatAgentDuration(item.terminal.durationMs)}
          </MarkerContent>
        </Marker>
      )
    }
    return (
      <Marker role='status'>
        <MarkerIcon>
          <Check className='text-emerald-600' />
        </MarkerIcon>
        <MarkerContent>
          Run completed · {formatAgentDuration(item.terminal.durationMs)}
        </MarkerContent>
      </Marker>
    )
  }
  return (
    <Marker variant='separator'>
      <MarkerContent>
        Context summarized through event {item.payload.coveredThroughSequence}; full history
        retained.
      </MarkerContent>
    </Marker>
  )
}

function ActivityGroup(props: {
  item: Extract<AgentTimelineItem, { type: 'activity' }>
}): React.JSX.Element {
  const { item } = props
  return (
    <details
      className='group/activity min-w-0 max-w-full overflow-hidden'
      open={item.status === 'error' || item.status === 'stopped' ? true : undefined}
      data-testid='agent-activity-group'
      data-status={item.status}
    >
      <summary className='cursor-pointer list-none rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
        <Marker role='status'>
          <MarkerIcon>{activityIcon(item.status)}</MarkerIcon>
          <MarkerContent className={item.status === 'running' ? 'shimmer' : undefined}>
            {item.summary}
            {item.status === 'stopped' ? ' · Stopped' : ''}
          </MarkerContent>
          <ChevronDown className='ml-auto size-4 transition-transform group-open/activity:rotate-180' />
        </Marker>
      </summary>
      <div className='mt-3 ml-2 min-w-0 space-y-3 overflow-hidden border-l pl-4'>
        {item.tools.map((tool) => (
          <ToolActivityRow key={tool.eventId} tool={tool} stopped={item.status === 'stopped'} />
        ))}
      </div>
    </details>
  )
}

function ToolActivityRow(props: { tool: AgentToolActivity; stopped: boolean }): React.JSX.Element {
  const { tool } = props
  const citations = tool.result === null ? [] : citationDisplaysForToolResult(tool.result)
  return (
    <div
      className='min-w-0 max-w-full space-y-2 overflow-hidden text-sm'
      data-testid={`agent-tool-${tool.call.toolCallId}`}
    >
      <div className='flex min-w-0 items-center gap-2'>
        {toolResultIcon(tool, props.stopped)}
        <span className='min-w-0 flex-1 truncate font-medium'>{tool.call.toolName}</span>
        <span className='shrink-0 whitespace-nowrap text-xs text-muted-foreground'>
          {toolResultLabel(tool, props.stopped)} · {formatAgentDuration(tool.durationMs)}
        </span>
      </div>
      <details>
        <summary className='cursor-pointer text-xs text-muted-foreground'>
          Bounded arguments
        </summary>
        <pre className='mt-2 max-h-48 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md bg-muted p-2 text-xs'>
          {JSON.stringify(tool.call.args, null, 2)}
        </pre>
      </details>
      {tool.result?.error ? (
        <Alert variant='destructive'>
          <AlertCircle />
          <AlertTitle>{tool.result.error.code}</AlertTitle>
          <AlertDescription>{tool.result.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {citations.length > 0 ? <CitationAttachments citations={citations} /> : null}
      {tool.result?.result ? (
        <details>
          <summary className='cursor-pointer text-xs text-muted-foreground'>Bounded result</summary>
          <pre className='mt-2 max-h-48 max-w-full overflow-auto whitespace-pre-wrap wrap-anywhere rounded-md bg-muted p-2 text-xs'>
            {JSON.stringify(tool.result.result, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

function ProposalMessage(props: {
  item: Extract<AgentTimelineItem, { type: 'proposal' }>
  citationsById: Map<string, AgentCitationDisplay>
  busy: boolean
  currentRevisionIds: Readonly<Record<string, string>>
  onAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'reject' | 'undo' | 'cancel_image'
  ): Promise<void>
}): React.JSX.Element {
  const { resolvedTheme } = useTheme()
  const proposal = props.item.proposal
  if (proposal === null) {
    const failed = props.item.tool.result?.isError === true
    return (
      <Marker role='status'>
        <MarkerIcon>
          {failed ? <X className='text-destructive' /> : <LoaderCircle className='animate-spin' />}
        </MarkerIcon>
        <MarkerContent className={failed ? 'text-destructive' : 'shimmer'}>
          {failed ? 'Proposal could not be prepared' : 'Preparing a reviewable proposal…'}
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
    <div className='min-w-0 space-y-3 overflow-hidden'>
      <div className='flex flex-wrap gap-1 text-xs'>
        {preview.affectedSectionIds.map((sectionId) => (
          <Badge key={sectionId} className='max-w-full' variant='outline' title={sectionId}>
            Section {sectionId.slice(0, 8)}
          </Badge>
        ))}
        {blockOperationLabels(proposal).map((label) => (
          <Badge key={label} className='max-w-full' variant='outline' title={label}>
            {label}
          </Badge>
        ))}
      </div>
      <ProposalDiff
        beforeText={preview.beforeText}
        afterText={preview.afterText}
        beforeTextTruncated={preview.beforeTextTruncated}
        afterTextTruncated={preview.afterTextTruncated}
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
      <div className='flex flex-wrap justify-end gap-2'>
        {isPending ? (
          <>
            <Button
              variant='outline'
              size='sm'
              disabled={props.busy}
              onClick={() => void props.onAction(proposal, 'reject')}
            >
              <X /> Reject
            </Button>
            <Button
              variant='outline'
              size='sm'
              disabled={props.busy || isOutdated}
              onClick={() => void props.onAction(proposal, 'approve_continue')}
            >
              <Check /> Approve & Continue
            </Button>
            <Button
              size='sm'
              disabled={props.busy}
              onClick={() => void props.onAction(proposal, 'approve')}
            >
              {isOutdated ? <RotateCcw /> : <Check />}
              {isOutdated ? 'Review update' : 'Approve'}
            </Button>
          </>
        ) : null}
        {proposal.status === 'generating' ? (
          <Button
            variant='outline'
            size='sm'
            onClick={() => void props.onAction(proposal, 'cancel_image')}
          >
            <X /> Cancel generation
          </Button>
        ) : null}
      </div>
    </div>
  )
  return (
    <Message data-testid={`agent-proposal-${proposal.proposalId}`}>
      <MessageContent>
        <MessageHeader className='gap-2'>
          <FilePenLine className='size-4' />
          {isPending ? 'Review required' : 'Proposal result'}
        </MessageHeader>
        <Bubble variant='outline' className='max-w-full'>
          <BubbleContent className='w-full space-y-3'>
            <div className='flex min-w-0 flex-wrap items-center gap-2'>
              <span className='min-w-0 flex-1 wrap-anywhere font-medium'>{preview.summary}</span>
              <Badge variant={isPending ? 'secondary' : 'outline'}>
                {isOutdated ? 'outdated' : proposal.status}
              </Badge>
              {canUndo ? (
                <Button
                  variant='outline'
                  size='sm'
                  disabled={props.busy}
                  onClick={() => void props.onAction(proposal, 'undo')}
                >
                  <Undo2 /> Undo
                </Button>
              ) : null}
            </div>
            {isPending ? (
              detail
            ) : (
              <details>
                <summary className='cursor-pointer text-xs text-muted-foreground'>
                  View proposal details
                </summary>
                <div className='mt-3'>{detail}</div>
              </details>
            )}
            <MessageFooter>
              {proposal.status === 'pending' && props.item.tool.result === null
                ? 'Running'
                : toolWasStopped(props.item.tool)
                  ? 'Stopped'
                  : props.item.tool.result?.isError
                    ? 'Error'
                    : 'Complete'}{' '}
              · {formatAgentDuration(props.item.tool.durationMs)}
            </MessageFooter>
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

function activityIcon(status: 'running' | 'error' | 'complete' | 'stopped'): React.JSX.Element {
  if (status === 'running') return <LoaderCircle className='animate-spin' />
  if (status === 'error') return <AlertCircle className='text-destructive' />
  if (status === 'stopped') return <CircleStop className='text-destructive' />
  return <Check className='text-emerald-600' />
}

function toolResultIcon(tool: AgentToolActivity, stopped: boolean): React.JSX.Element {
  if ((tool.result === null && stopped) || toolWasStopped(tool))
    return <CircleStop className='size-4 text-destructive' />
  if (tool.result === null) return <LoaderCircle className='size-4 animate-spin' />
  if (tool.result.isError) return <X className='size-4 text-destructive' />
  return <Check className='size-4 text-emerald-600' />
}

function toolResultLabel(tool: AgentToolActivity, stopped: boolean): string {
  if ((tool.result === null && stopped) || toolWasStopped(tool)) return 'Stopped'
  if (tool.result === null) return 'Running'
  return tool.result.isError ? 'Error' : 'Complete'
}

function elapsedRunMs(run: AgentRunRecord | null, now: number): number {
  if (run === null) return 0
  const start = Date.parse(run.startedAt)
  const end = run.completedAt === null ? now : Date.parse(run.completedAt)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  return Math.max(0, end - start)
}

function terminalLabel(code: string): string {
  switch (code) {
    case 'provider_timeout':
      return 'Provider request timed out'
    case 'user_stopped':
      return 'Stopped by user'
    case 'project_closed':
      return 'Interrupted because project closed'
    case 'run_failed':
      return 'Run failed'
    default:
      return 'Run interrupted'
  }
}

function AgentErrorAlert(props: { message: string; className?: string }): React.JSX.Element {
  return (
    <Alert variant='destructive' className={props.className}>
      <AlertCircle />
      <AlertTitle>Agent action failed</AlertTitle>
      <AlertDescription>{props.message}</AlertDescription>
    </Alert>
  )
}

function formatSessionUpdatedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Updated recently'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
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
  selection: AgentPanelSelection | null,
  currentRevisionIds: Readonly<Record<string, string>>
) {
  if (scope === 'project') {
    return {
      activeSectionId: null,
      activeBlockId: null,
      selectedBlockIds: [],
      capturedAt: Date.now(),
      capturedRevisionId: null
    }
  }
  if (activeSectionId === null) throw new Error('No active section is available')
  const capturedRevisionId = currentRevisionIds[activeSectionId] ?? null
  if (scope === 'section') {
    return {
      activeSectionId,
      activeBlockId: null,
      selectedBlockIds: [],
      capturedAt: Date.now(),
      capturedRevisionId
    }
  }
  if (selection?.sectionId !== activeSectionId || selection.selectedBlockIds.length === 0) {
    throw new Error('No active block selection is available')
  }
  return {
    activeSectionId,
    activeBlockId: selection.activeBlockId,
    selectedBlockIds: selection.selectedBlockIds,
    capturedAt: Date.now(),
    capturedRevisionId
  }
}

function deliveryLabel(delivery: 'prompt' | 'steer' | 'follow_up'): string {
  if (delivery === 'steer') return 'Steering message'
  if (delivery === 'follow_up') return 'Follow-up message'
  return 'You'
}

function blockOperationLabels(proposal: MutationProposalRecord): string[] {
  if (proposal.payload.kind === 'generated_image_insert') {
    return [
      `generate ${proposal.payload.mutation.aspectRatio} ${proposal.payload.mutation.imageSize}`
    ]
  }
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

function approvalModeLabel(mode: AgentApprovalMode): string {
  if (mode === 'manual') return 'Manual'
  if (mode === 'section_auto') return 'Section auto'
  return 'YOLO'
}

function proposalKindLabel(kind: MutationProposalRecord['kind']): string {
  if (kind === 'brief_update') return 'Brief'
  if (kind === 'outline_patch') return 'Outline'
  if (kind === 'generated_image_insert') return 'Image'
  return 'Section'
}
