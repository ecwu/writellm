import type {
  AgentEventRecord,
  AgentRunRecord,
  AgentSessionRecord,
  AgentStartScope
} from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { AgentApprovalMode } from '../../../../shared/contracts/agent'
import type { SkillSelection, SkillsSnapshot } from '../../../../shared/contracts/skills'
import type {
  AgentModelSelection,
  AgentProviderCatalog,
  AgentThinkingLevel
} from '../../../../shared/contracts/providers'
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CircleStop,
  FileText,
  FilePenLine,
  FolderOpen,
  MessageSquarePlus,
  MoreHorizontal,
  RotateCcw,
  Settings2,
  Send,
  TextCursorInput,
  TriangleAlert,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Field, FieldLabel } from '@/components/ui/field'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea
} from '@/components/ui/input-group'
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
import { Progress } from '@/components/ui/progress'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { useTheme } from '@/theme-provider'
import { approveProposalAfterEditorFlush } from '../manuscript/agent-proposal-actions'
import { AgentMarkdown } from './agent-markdown'
import { AgentModelPicker } from './agent-model-picker'
import { AgentThinkingPicker, thinkingLevelLabel } from './agent-thinking-picker'
import {
  aggregateAgentUsage,
  agentTerminalLabel,
  agentTimelineScrollAnchorIndex,
  applyAgentTerminalEvent,
  citationDisplaysForToolResult,
  formatAgentDuration,
  findLatestPrompt,
  isSectionProposalOutdated,
  latestAgentContextUsage,
  mergeAgentEvents,
  protectTerminalAgentRuns,
  projectAgentTimeline,
  type AgentActivityStatus,
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
  onOpenSettings(): void
  onOpenSkillSettings(): void
  projectSessionId: string
  activeSectionId: string | null
  sectionTitles: Readonly<Record<string, string>>
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
  const [scopePreference, setScopePreference] = useState<'auto' | AgentStartScope>('auto')
  const [reviewFeedback, setReviewFeedback] = useState('')
  const [skillSnapshot, setSkillSnapshot] = useState<SkillsSnapshot | null>(null)
  const [skillPickerOpen, setSkillPickerOpen] = useState(false)
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [continuationFailure, setContinuationFailure] = useState<{
    kind: 'approval' | 'revision'
    proposalId: string
  } | null>(null)
  const [titleGeneratingIds, setTitleGeneratingIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providerCatalog, setProviderCatalog] = useState<AgentProviderCatalog>({
    presets: [],
    defaultSelection: null
  })
  const [revisionTransitions, setRevisionTransitions] = useState<
    Record<string, { from: string | undefined; to: string }>
  >({})
  const activeSessionIdRef = useRef<string | null>(null)
  const terminalRunIdsRef = useRef<Set<string>>(new Set())
  const skillRoutingPendingRef = useRef<Set<string>>(new Set())
  const draftStateRef = useRef(
    new Map<
      string,
      { prompt: string; reviewFeedback: string; scopePreference: 'auto' | AgentStartScope }
    >()
  )
  const previousDraftKeyRef = useRef('new')
  const draftProjectSessionIdRef = useRef(props.projectSessionId)
  const promptRef = useRef(prompt)
  const reviewFeedbackRef = useRef(reviewFeedback)
  const scopePreferenceRef = useRef(scopePreference)
  activeSessionIdRef.current = activeSessionId
  promptRef.current = prompt
  reviewFeedbackRef.current = reviewFeedback
  scopePreferenceRef.current = scopePreference

  useEffect(() => {
    if (draftProjectSessionIdRef.current === props.projectSessionId) return
    draftProjectSessionIdRef.current = props.projectSessionId
    draftStateRef.current.clear()
    previousDraftKeyRef.current = 'new'
    setActiveSessionId(null)
    setPrompt('')
    setReviewFeedback('')
    setScopePreference('auto')
    setContinuationFailure(null)
  }, [props.projectSessionId])

  useEffect(() => {
    const nextKey = activeSessionId ?? 'new'
    const previousKey = previousDraftKeyRef.current
    if (previousKey === nextKey) return
    draftStateRef.current.set(previousKey, {
      prompt: promptRef.current,
      reviewFeedback: reviewFeedbackRef.current,
      scopePreference: scopePreferenceRef.current
    })
    const next = draftStateRef.current.get(nextKey)
    setPrompt(next?.prompt ?? '')
    setReviewFeedback(next?.reviewFeedback ?? '')
    setScopePreference(next?.scopePreference ?? 'auto')
    previousDraftKeyRef.current = nextKey
  }, [activeSessionId])

  useEffect(() => {
    skillRoutingPendingRef.current = new Set(
      runs
        .filter((run) => run.skillSnapshot.routingStatus === 'pending')
        .map((run) => run.agentRunId)
    )
  }, [runs])

  const refreshSessions = useCallback(
    async (preferAttention = false): Promise<AgentSessionRecord[]> => {
      const [active, archived] = await Promise.all([
        window.desktop.agent.listSessions({
          projectSessionId: props.projectSessionId,
          status: 'active'
        }),
        window.desktop.agent.listSessions({
          projectSessionId: props.projectSessionId,
          status: 'archived'
        })
      ])
      const next = [...active, ...archived]
      setSessions(next)
      setActiveSessionId((current) => {
        if (
          !preferAttention &&
          current !== null &&
          next.some((session) => session.agentSessionId === current)
        ) {
          return current
        }
        return selectAttentionSession(active)?.agentSessionId ?? null
      })
      return next
    },
    [props.projectSessionId]
  )

  const refreshSessionTruth = useCallback(
    async (
      agentSessionId: string
    ): Promise<{ runs: AgentRunRecord[]; proposals: MutationProposalRecord[] }> => {
      const [nextRuns, nextProposals, activeSessions, archivedSessions] = await Promise.all([
        window.desktop.agent.listRuns({
          projectSessionId: props.projectSessionId,
          agentSessionId
        }),
        window.desktop.agent.listProposals({
          projectSessionId: props.projectSessionId,
          agentSessionId
        }),
        window.desktop.agent.listSessions({
          projectSessionId: props.projectSessionId,
          status: 'active'
        }),
        window.desktop.agent.listSessions({
          projectSessionId: props.projectSessionId,
          status: 'archived'
        })
      ])
      const nextSessions = [...activeSessions, ...archivedSessions]
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
    setLoading(true)
    setError(null)
    void Promise.all([
      refreshSessions(true),
      window.desktop.providers.snapshot(),
      window.desktop.skills.snapshot()
    ])
      .then(([, snapshot, nextSkills]) => {
        if (!disposed) {
          setProviderCatalog(snapshot.agentCatalog)
          setSkillSnapshot(nextSkills)
        }
      })
      .catch(() => {
        if (disposed) return
        setError('Agent sessions could not be loaded.')
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    return () => {
      disposed = true
    }
  }, [props.open, refreshSessions])

  useEffect(() => {
    if (!props.open) return
    return window.desktop.skills.subscribeChanges(() => {
      void window.desktop.skills
        .snapshot()
        .then((next) => {
          setSkillSnapshot(next)
        })
        .catch(() => undefined)
    })
  }, [props.open])

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
    void refreshSessionTruth(activeSessionId).catch(() => {
      if (!disposed) {
        setError('The selected conversation could not be loaded.')
      }
    })
    void window.desktop.agent
      .subscribeEvents(
        { projectSessionId: props.projectSessionId, agentSessionId: activeSessionId },
        (rendererEvent) => {
          if (disposed) return
          if (rendererEvent.kind === 'session') {
            setSessions((current) => upsertSession(current, rendererEvent.session))
            setTitleGeneratingIds((current) =>
              updateSet(
                current,
                rendererEvent.session.agentSessionId,
                rendererEvent.titleGenerating
              )
            )
            return
          }
          if (rendererEvent.kind === 'delta') {
            setStreaming((current) => ({
              ...current,
              [rendererEvent.agentRunId]:
                `${current[rendererEvent.agentRunId] ?? ''}${rendererEvent.delta}`.slice(
                  0,
                  2_097_152
                )
            }))
            // Deltas only exist after skill preparation finished and generation started; refresh
            // once so the composer leaves the "Preparing writing guidance…" state without a
            // tool result or the terminal event.
            if (skillRoutingPendingRef.current.delete(rendererEvent.agentRunId)) {
              void refreshSessionTruth(activeSessionId).catch((cause) =>
                props.onError(errorMessage(cause))
              )
            }
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
            rendererEvent.event.type === 'user_message' &&
            rendererEvent.event.agentRunId !== null &&
            skillRoutingPendingRef.current.delete(rendererEvent.event.agentRunId)
          ) {
            // The linked initial user message is the first durable event guaranteed to be
            // published after skill preparation finished; tool-first runs and non-streaming
            // providers may not emit an early delta, so leave "Preparing writing guidance…" here.
            void refreshSessionTruth(activeSessionId).catch((cause) =>
              props.onError(errorMessage(cause))
            )
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
      .catch(() => {
        if (!disposed) {
          setError('Conversation event replay is unavailable.')
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

  const activeSession =
    sessions.find((session) => session.agentSessionId === activeSessionId) ?? null
  const activeSessionArchived = activeSession?.status === 'archived'
  const skillSelection: SkillSelection = activeSession?.skillSelection ?? { mode: 'auto' }
  const activeRun = runs.find((run) => run.status === 'running') ?? null
  const choosingSkill = activeRun?.skillSnapshot.routingStatus === 'pending'
  const hasStreamingRun = Object.keys(streaming).length > 0
  const isAgentWorking = activeRun !== null || hasStreamingRun
  const [clockNow, setClockNow] = useState(() => Date.now())
  useEffect(() => {
    if (!isAgentWorking) return
    setClockNow(Date.now())
    const timer = window.setInterval(() => setClockNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [isAgentWorking])
  const usage = useMemo(() => aggregateAgentUsage(events, runs), [events, runs])
  const usageDetails = [
    usage.retryCount > 0
      ? `${usage.retryCount} provider ${usage.retryCount === 1 ? 'retry' : 'retries'}.`
      : null,
    usage.skillRouteRequests > 0
      ? `Includes ${usage.skillRouteRequests} historical Writing Skill routing request${usage.skillRouteRequests === 1 ? '' : 's'}.`
      : null
  ]
    .filter((detail) => detail !== null)
    .join(' ')
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
  const scope = effectiveScope(scopePreference, selectionIsAvailable, props.activeSectionId)
  const otherWorkingSession =
    sessions.find(
      (session) =>
        session.status === 'active' &&
        session.workflowState === 'running' &&
        session.agentSessionId !== activeSessionId
    ) ?? null
  const selectedModel = useMemo(
    () =>
      resolveSelectedModel(
        providerCatalog,
        activeSession?.modelSelection ?? providerCatalog.defaultSelection
      ),
    [activeSession?.modelSelection, providerCatalog]
  )
  const modelReady =
    selectedModel?.preset.authConfigured === true &&
    selectedModel.preset.enabled &&
    selectedModel.model.enabled
  const supportedThinkingLevels = selectedModel?.model.supportedThinkingLevels ?? ['off']
  const availableModelPresets = useMemo(
    () =>
      providerCatalog.presets
        .filter((preset) => preset.enabled && preset.authConfigured)
        .map((preset) => ({
          ...preset,
          models: preset.models.filter((model) => model.enabled)
        }))
        .filter((preset) => preset.models.length > 0),
    [providerCatalog]
  )
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
      projectSessionId: props.projectSessionId
    })
    draftStateRef.current.set(created.agentSessionId, {
      prompt: promptRef.current,
      reviewFeedback: reviewFeedbackRef.current,
      scopePreference: scopePreferenceRef.current
    })
    setSessions((current) => [created, ...current])
    setActiveSessionId(created.agentSessionId)
    return created
  }

  const beginNewConversation = (): void => {
    setActiveSessionId(null)
    setEvents([])
    setRuns([])
    setProposals([])
    setStreaming({})
    setContinuationFailure(null)
    setSessionSwitcherOpen(false)
  }

  const setApprovalMode = async (mode: AgentApprovalMode): Promise<void> => {
    if (activeSessionArchived || activeRun !== null || conversationLocked) return
    setBusy(true)
    try {
      const session = activeSession ?? (await createSession())
      const updated = await window.desktop.agent.setApprovalMode({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId,
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
    } finally {
      setBusy(false)
    }
  }

  const setModelSelection = async (selection: AgentModelSelection): Promise<void> => {
    if (activeSessionArchived || activeRun !== null || conversationLocked) return
    setBusy(true)
    setError(null)
    try {
      const session = activeSession ?? (await createSession())
      const updated = await window.desktop.agent.setModelSelection({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId,
        selection
      })
      setSessions((current) =>
        current.map((session) =>
          session.agentSessionId === updated.agentSessionId ? updated : session
        )
      )
      const snapshot = await window.desktop.providers.snapshot()
      setProviderCatalog(snapshot.agentCatalog)
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
    } finally {
      setBusy(false)
    }
  }

  const setThinkingLevel = async (level: AgentThinkingLevel): Promise<void> => {
    if (activeSessionArchived || activeRun !== null || conversationLocked) return
    setBusy(true)
    setError(null)
    try {
      const session = activeSession ?? (await createSession())
      const updated = await window.desktop.agent.setThinkingLevel({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId,
        level
      })
      setSessions((current) =>
        current.map((session) =>
          session.agentSessionId === updated.agentSessionId ? updated : session
        )
      )
      setProviderCatalog((current) => ({ ...current, defaultThinkingLevel: level }))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const setSkillSelection = async (selection: SkillSelection): Promise<void> => {
    if (activeSessionArchived || activeRun !== null || conversationLocked) return
    setBusy(true)
    setError(null)
    try {
      const session = activeSession ?? (await createSession())
      const updated = await window.desktop.agent.setSkillSelection({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId,
        selection
      })
      setSessions((current) =>
        current.map((session) =>
          session.agentSessionId === updated.agentSessionId ? updated : session
        )
      )
      setSkillPickerOpen(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const openSession = (agentSessionId: string): void => {
    setActiveSessionId(agentSessionId)
    setContinuationFailure(null)
    setSessionSwitcherOpen(false)
  }

  const regenerateTitle = async (session: AgentSessionRecord): Promise<void> => {
    if (
      session.status !== 'active' ||
      session.workflowState !== 'idle' ||
      titleGeneratingIds.has(session.agentSessionId)
    )
      return
    setTitleGeneratingIds((current) => updateSet(current, session.agentSessionId, true))
    setError(null)
    try {
      const updated = await window.desktop.agent.generateSessionTitle({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId
      })
      setSessions((current) => upsertSession(current, updated))
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setTitleGeneratingIds((current) => updateSet(current, session.agentSessionId, false))
    }
  }

  const archiveSession = async (session: AgentSessionRecord): Promise<void> => {
    if (
      session.status !== 'active' ||
      session.workflowState !== 'idle' ||
      titleGeneratingIds.has(session.agentSessionId)
    )
      return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.desktop.agent.archiveSession({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId
      })
      setSessions((current) => upsertSession(current, updated))
      if (activeSessionIdRef.current === session.agentSessionId) {
        setActiveSessionId((current) =>
          current === session.agentSessionId
            ? (sessions.find(
                (candidate) =>
                  candidate.agentSessionId !== session.agentSessionId &&
                  candidate.status === 'active'
              )?.agentSessionId ?? null)
            : current
        )
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const restoreSession = async (session: AgentSessionRecord): Promise<void> => {
    if (session.status !== 'archived') return
    setBusy(true)
    setError(null)
    try {
      const updated = await window.desktop.agent.restoreSession({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId
      })
      setSessions((current) => upsertSession(current, updated))
      setActiveSessionId(updated.agentSessionId)
      setSessionSwitcherOpen(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const startRun = async (
    content: string,
    approvedProposalId?: string,
    allowWhileBusy = false,
    skipEditorFlush = false,
    _selectionOverride?: SkillSelection,
    reuseSkillFromRunId?: string,
    rejectedProposalId?: string
  ): Promise<boolean> => {
    const trimmed = content.trim()
    if (
      trimmed.length === 0 ||
      activeSessionArchived ||
      (!allowWhileBusy && busy) ||
      ((activeRun !== null || conversationLocked) &&
        approvedProposalId === undefined &&
        rejectedProposalId === undefined) ||
      (!modelReady && approvedProposalId === undefined && rejectedProposalId === undefined) ||
      otherWorkingSession !== null
    )
      return false
    setBusy(true)
    setError(null)
    try {
      if (!skipEditorFlush && !(await props.flushCurrent())) {
        setError('Save the active section before starting the Agent.')
        return false
      }
      const session = activeSession ?? (await createSession())
      const run = await window.desktop.agent.startRun({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId,
        prompt: trimmed,
        ...(approvedProposalId === undefined ? {} : { approvedProposalId }),
        ...(rejectedProposalId === undefined ? {} : { rejectedProposalId }),
        scope,
        ...(reuseSkillFromRunId === undefined ? {} : { reuseSkillFromRunId }),
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
      return true
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      return false
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
    action: 'approve' | 'approve_continue' | 'request_changes' | 'reject' | 'undo' | 'cancel_image'
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
          const continued = await startRun(
            'Continue the requested writing task. Verify the updated manuscript and run check_draft when appropriate.',
            result.proposal.proposalId,
            true,
            true,
            undefined,
            proposal.agentRunId
          )
          if (!continued) {
            setContinuationFailure({ kind: 'approval', proposalId: result.proposal.proposalId })
          } else {
            setContinuationFailure(null)
          }
        }
        await refreshSessionTruth(proposal.agentSessionId)
      } else if (action === 'request_changes' || action === 'reject') {
        const reason =
          action === 'request_changes'
            ? reviewFeedback.trim()
            : 'Rejected by the user in the Agent panel.'
        if (reason.length === 0) return
        const result = await window.desktop.agent.rejectProposal({
          projectSessionId: props.projectSessionId,
          agentSessionId: proposal.agentSessionId,
          proposalId: proposal.proposalId,
          reason,
          continueRequested: action === 'request_changes'
        })
        updateProposals(result.proposal)
        if (action === 'request_changes') {
          const continued = await startRun(
            'Revise the rejected proposal from the stored review feedback.',
            undefined,
            true,
            true,
            undefined,
            proposal.agentRunId,
            result.proposal.proposalId
          )
          if (!continued) {
            setContinuationFailure({ kind: 'revision', proposalId: result.proposal.proposalId })
          } else {
            setReviewFeedback('')
            setContinuationFailure(null)
          }
        } else {
          setReviewFeedback('')
          setContinuationFailure(null)
        }
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
    } finally {
      setBusy(false)
    }
  }

  const retryableRun = latestRun?.status === 'failed' || latestRun?.status === 'interrupted'
  const failedContinuationProposal =
    continuationFailure === null
      ? null
      : (proposals.find((proposal) => proposal.proposalId === continuationFailure.proposalId) ??
        null)

  return (
    <>
      <aside
        className={
          props.open
            ? '@container/agent flex size-full min-h-0 min-w-0 flex-col overflow-hidden bg-background'
            : 'hidden'
        }
        data-testid='agent-panel'
        aria-label='Writing agent side chat'
      >
        <header
          className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 border-b px-3 py-2.5'
          data-testid='agent-conversation-header'
        >
          <ConversationSwitcher
            open={sessionSwitcherOpen}
            onOpenChange={setSessionSwitcherOpen}
            sessions={sessions}
            activeSession={activeSession}
            titleGeneratingIds={titleGeneratingIds}
            busy={busy}
            onNew={beginNewConversation}
            onOpen={openSession}
            onArchive={archiveSession}
            onRestore={restoreSession}
            onRegenerateTitle={regenerateTitle}
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Conversation actions'
                data-testid='agent-conversation-menu'
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => setDetailsOpen(true)}>
                  <Settings2 /> Details
                </DropdownMenuItem>
                {activeSessionArchived && activeSession ? (
                  <DropdownMenuItem onSelect={() => void restoreSession(activeSession)}>
                    <ArchiveRestore /> Restore
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Close writing agent'
            onClick={() => props.onOpenChange(false)}
          >
            <X />
          </Button>
        </header>

        <div
          className='flex min-h-9 items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground'
          data-testid='agent-status'
          role='status'
        >
          {activeSessionArchived ? <Archive className='size-3.5' /> : null}
          {workflowState === 'running' ? <Spinner /> : null}
          {workflowState === 'awaiting_review' ? (
            <AlertCircle className='size-3.5 text-warning' />
          ) : null}
          <span className={workflowState === 'running' ? 'shimmer' : undefined}>
            {activeSessionArchived
              ? 'Archived · read only'
              : workflowState === 'running'
                ? choosingSkill
                  ? 'Loading writing guidance'
                  : `Working · ${formatAgentDuration(elapsedRunMs(activeRun, clockNow))}`
                : workflowState === 'generating'
                  ? 'Generating an image'
                  : workflowState === 'awaiting_review'
                    ? 'Ready for review'
                    : 'Ready'}
          </span>
        </div>

        <div className='min-h-0 flex-1'>
          {loading ? (
            <Marker role='status' className='p-4'>
              <MarkerIcon>
                <Spinner />
              </MarkerIcon>
              <MarkerContent>Loading conversation…</MarkerContent>
            </Marker>
          ) : activeSession === null ? (
            <div className='flex size-full items-center justify-center px-8 text-center text-sm text-muted-foreground'>
              Start with a request below. A conversation is created only when you send it.
            </div>
          ) : (
            <EventTimeline
              events={events}
              proposals={proposals}
              runs={runs}
              now={clockNow}
              streaming={streaming}
              currentRevisionIds={effectiveRevisionIds}
              sectionTitles={props.sectionTitles}
              onProposalAction={proposalAction}
              busy={busy || activeSessionArchived}
            />
          )}
        </div>

        <div
          className='flex min-w-0 flex-col gap-3 border-t px-4 py-3'
          data-testid='agent-composer'
        >
          {error ? <AgentErrorAlert message={error} /> : null}
          {otherWorkingSession !== null ? (
            <Marker role='status'>
              <MarkerIcon>
                <Spinner />
              </MarkerIcon>
              <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-2'>
                <span className='truncate'>Agent is working in {otherWorkingSession.title}</span>
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => openSession(otherWorkingSession.agentSessionId)}
                >
                  Open
                </Button>
              </MarkerContent>
            </Marker>
          ) : activeSessionArchived && activeSession ? (
            <Marker role='status'>
              <MarkerIcon>
                <Archive />
              </MarkerIcon>
              <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-2'>
                <span>Archived conversations are read only.</span>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={busy}
                  onClick={() => void restoreSession(activeSession)}
                >
                  <ArchiveRestore data-icon='inline-start' /> Restore
                </Button>
              </MarkerContent>
            </Marker>
          ) : waitingProposal !== undefined ? (
            <ReviewBar
              proposal={waitingProposal}
              feedback={reviewFeedback}
              busy={busy}
              outdated={isSectionProposalOutdated(waitingProposal, effectiveRevisionIds)}
              onFeedbackChange={setReviewFeedback}
              onAction={proposalAction}
            />
          ) : workflowState === 'generating' ? (
            <Marker role='status'>
              <MarkerIcon>
                <Spinner />
              </MarkerIcon>
              <MarkerContent>
                Generating an image. Review will appear here when it is ready.
              </MarkerContent>
            </Marker>
          ) : continuationFailure !== null && failedContinuationProposal !== null ? (
            <Marker role='alert'>
              <MarkerIcon>
                <AlertCircle className='text-destructive' />
              </MarkerIcon>
              <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-2'>
                <span>
                  {continuationFailure.kind === 'approval'
                    ? 'Change applied, continuation failed'
                    : 'Feedback saved, revision failed'}
                </span>
                <Button
                  variant='outline'
                  size='sm'
                  disabled={busy}
                  onClick={() => {
                    if (continuationFailure.kind === 'approval') {
                      void startRun(
                        'Continue the requested writing task from the applied manuscript.',
                        failedContinuationProposal.proposalId,
                        false,
                        true,
                        undefined,
                        failedContinuationProposal.agentRunId
                      ).then((started) => {
                        if (started) setContinuationFailure(null)
                      })
                    } else {
                      void startRun(
                        'Revise the rejected proposal from the stored review feedback.',
                        undefined,
                        false,
                        true,
                        undefined,
                        failedContinuationProposal.agentRunId,
                        failedContinuationProposal.proposalId
                      ).then((started) => {
                        if (started) setContinuationFailure(null)
                      })
                    }
                  }}
                >
                  <RotateCcw data-icon='inline-start' />
                  {continuationFailure.kind === 'approval' ? 'Continue task' : 'Retry revision'}
                </Button>
              </MarkerContent>
            </Marker>
          ) : !modelReady ? (
            <Button variant='outline' className='w-full' onClick={props.onOpenSettings}>
              <Settings2 data-icon='inline-start' /> Set up an Agent model
            </Button>
          ) : (
            <>
              <ContextScopeChip
                preference={scopePreference}
                effectiveScope={scope}
                selectionAvailable={selectionIsAvailable}
                activeSectionId={props.activeSectionId}
                sectionTitle={
                  props.activeSectionId === null
                    ? undefined
                    : props.sectionTitles[props.activeSectionId]
                }
                disabled={busy || activeRun !== null}
                onChange={setScopePreference}
              />
              <Field data-disabled={busy || choosingSkill || activeSession?.compatible === false}>
                <FieldLabel htmlFor='agent-message' className='sr-only'>
                  Agent message
                </FieldLabel>
                <InputGroup
                  data-disabled={busy || choosingSkill || activeSession?.compatible === false}
                >
                  <InputGroupTextarea
                    id='agent-message'
                    value={prompt}
                    placeholder={
                      activeRun
                        ? choosingSkill
                          ? 'Loading writing guidance…'
                          : 'Queue a follow-up…'
                        : 'Ask the writing agent…'
                    }
                    rows={3}
                    disabled={busy || choosingSkill || activeSession?.compatible === false}
                    onChange={(event) => setPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      const action = agentComposerKeyAction({
                        key: event.key,
                        shiftKey: event.shiftKey,
                        metaKey: event.metaKey,
                        ctrlKey: event.ctrlKey,
                        isComposing: event.nativeEvent.isComposing,
                        running: activeRun !== null
                      })
                      if (action === 'none' || action === 'newline') return
                      event.preventDefault()
                      if (action === 'steer') void queueMessage('steer')
                      else if (action === 'follow_up') void queueMessage('follow_up')
                      else void startRun(prompt)
                    }}
                  />
                  <InputGroupAddon align='block-end' className='justify-between gap-2'>
                    <span className='text-xs text-muted-foreground'>
                      Shift+Enter for a new line
                    </span>
                    <div className='flex items-center gap-1'>
                      {activeRun !== null ? (
                        <>
                          <div className='flex items-center'>
                            <InputGroupButton
                              size='sm'
                              aria-label='Queue follow-up'
                              disabled={busy || prompt.trim().length === 0}
                              onClick={() => void queueMessage('follow_up')}
                            >
                              <Send data-icon='inline-start' /> Queue
                            </InputGroupButton>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <InputGroupButton
                                  size='icon-sm'
                                  aria-label='Choose send behavior'
                                  disabled={busy}
                                >
                                  <ChevronDown />
                                </InputGroupButton>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align='end'>
                                <DropdownMenuItem onSelect={() => void queueMessage('follow_up')}>
                                  <Send /> Queue follow-up
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => void queueMessage('steer')}>
                                  <ChevronRight /> Steer now
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <ComposerAction
                            size='icon-sm'
                            variant='destructive'
                            label='Stop'
                            disabled={busy}
                            onClick={() => void stopRun()}
                          >
                            <CircleStop />
                          </ComposerAction>
                        </>
                      ) : (
                        <>
                          {retryableRun && latestPrompt ? (
                            <ComposerAction
                              size='icon-sm'
                              variant='outline'
                              label='Try again'
                              disabled={busy}
                              onClick={() =>
                                void startRun(
                                  latestPrompt,
                                  undefined,
                                  false,
                                  false,
                                  retrySkillSelection(latestRun),
                                  latestRun?.agentRunId
                                )
                              }
                            >
                              <RotateCcw />
                            </ComposerAction>
                          ) : null}
                          <InputGroupButton
                            size='sm'
                            aria-label='Send'
                            disabled={
                              busy ||
                              prompt.trim().length === 0 ||
                              activeSession?.compatible === false
                            }
                            onClick={() => void startRun(prompt)}
                          >
                            <Send data-icon='inline-start' /> Send
                          </InputGroupButton>
                        </>
                      )}
                    </div>
                  </InputGroupAddon>
                </InputGroup>
              </Field>
            </>
          )}
        </div>
      </aside>
      <AgentDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        session={activeSession}
        activeRun={activeRun}
        latestRun={latestRun}
        events={events}
        proposals={proposals}
        usage={usage}
        usageDetails={usageDetails}
        contextUsage={contextUsage}
        contextLimits={contextLimits}
        contextPercent={contextPercent}
        availableModelPresets={availableModelPresets}
        modelSelection={activeSession?.modelSelection ?? providerCatalog.defaultSelection}
        thinkingLevel={
          activeSession?.thinkingLevel ?? providerCatalog.defaultThinkingLevel ?? 'medium'
        }
        supportedThinkingLevels={supportedThinkingLevels}
        modelReady={modelReady}
        skillSnapshot={skillSnapshot}
        skillSelection={skillSelection}
        skillPickerOpen={skillPickerOpen}
        busy={busy || conversationLocked || activeRun !== null}
        onModelSelect={setModelSelection}
        onThinkingSelect={setThinkingLevel}
        onSkillPickerOpenChange={setSkillPickerOpen}
        onSkillSelect={setSkillSelection}
        onApprovalModeSelect={setApprovalMode}
        onOpenSettings={props.onOpenSkillSettings}
      />
    </>
  )
}

function ConversationSwitcher(props: {
  open: boolean
  onOpenChange(open: boolean): void
  sessions: AgentSessionRecord[]
  activeSession: AgentSessionRecord | null
  titleGeneratingIds: ReadonlySet<string>
  busy: boolean
  onNew(): void
  onOpen(agentSessionId: string): void
  onArchive(session: AgentSessionRecord): Promise<void>
  onRestore(session: AgentSessionRecord): Promise<void>
  onRegenerateTitle(session: AgentSessionRecord): Promise<void>
}): React.JSX.Element {
  const active = props.sessions.filter((session) => session.status === 'active')
  const archived = props.sessions.filter((session) => session.status === 'archived')
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          className='h-8 min-w-0 justify-start gap-2 px-2'
          data-testid='agent-conversation-switcher'
        >
          <Bot className='shrink-0' />
          <span className='truncate font-semibold'>
            {props.activeSession?.title ?? 'New conversation'}
          </span>
          {props.activeSession &&
          props.titleGeneratingIds.has(props.activeSession.agentSessionId) ? (
            <Spinner className='shrink-0' aria-label='Generating conversation title' />
          ) : (
            <ChevronDown className='shrink-0' />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='w-[min(24rem,calc(100vw-2rem))] p-0'>
        <Command>
          <CommandInput placeholder='Search conversations…' />
          <CommandList>
            <CommandEmpty>No matching conversation.</CommandEmpty>
            <CommandGroup>
              <CommandItem value='new conversation' onSelect={props.onNew}>
                <MessageSquarePlus /> New conversation
              </CommandItem>
            </CommandGroup>
            <ConversationCommandGroup
              heading='Active'
              sessions={active}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
            <ConversationCommandGroup
              heading='Archived'
              sessions={archived}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ConversationCommandGroup(props: {
  heading: string
  sessions: AgentSessionRecord[]
  titleGeneratingIds: ReadonlySet<string>
  busy: boolean
  onOpen(agentSessionId: string): void
  onArchive(session: AgentSessionRecord): Promise<void>
  onRestore(session: AgentSessionRecord): Promise<void>
  onRegenerateTitle(session: AgentSessionRecord): Promise<void>
}): React.JSX.Element | null {
  if (props.sessions.length === 0) return null
  return (
    <CommandGroup heading={props.heading}>
      {props.sessions.map((session) => {
        const actionBlocked =
          session.workflowState !== 'idle' || props.titleGeneratingIds.has(session.agentSessionId)
        return (
          <CommandItem
            key={session.agentSessionId}
            value={`${session.title} ${sessionStatusLabel(session)}`}
            className='gap-2'
            data-testid={`agent-session-${session.agentSessionId}`}
            onSelect={() => props.onOpen(session.agentSessionId)}
          >
            {session.workflowState === 'running' || session.workflowState === 'generating' ? (
              <Spinner />
            ) : session.workflowState === 'awaiting_review' ? (
              <AlertCircle className='text-warning' />
            ) : session.status === 'archived' ? (
              <Archive />
            ) : (
              <MessageSquarePlus />
            )}
            <span className='min-w-0 flex-1 truncate'>{session.title}</span>
            <span className='text-xs text-muted-foreground'>{sessionStatusLabel(session)}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon-xs'
                  aria-label={`Conversation actions for ${session.title}`}
                  disabled={props.busy}
                  onClick={(event) => event.stopPropagation()}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                {session.status === 'active' ? (
                  <>
                    <DropdownMenuItem
                      disabled={actionBlocked || !session.compatible}
                      onSelect={() => void props.onRegenerateTitle(session)}
                    >
                      <RotateCcw /> Regenerate title
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={actionBlocked}
                      onSelect={() => void props.onArchive(session)}
                    >
                      <Archive /> Archive
                    </DropdownMenuItem>
                  </>
                ) : (
                  <DropdownMenuItem onSelect={() => void props.onRestore(session)}>
                    <ArchiveRestore /> Restore
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </CommandItem>
        )
      })}
    </CommandGroup>
  )
}

function ContextScopeChip(props: {
  preference: 'auto' | AgentStartScope
  effectiveScope: AgentStartScope
  selectionAvailable: boolean
  activeSectionId: string | null
  sectionTitle?: string
  disabled: boolean
  onChange(value: 'auto' | AgentStartScope): void
}): React.JSX.Element {
  const effectiveLabel =
    props.effectiveScope === 'selection'
      ? 'Selected text'
      : props.effectiveScope === 'section'
        ? `This section${props.sectionTitle ? ` · ${props.sectionTitle}` : ''}`
        : 'Whole manuscript'
  const label = props.preference === 'auto' ? effectiveLabel : effectiveLabel
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='w-fit max-w-full rounded-full font-normal'
          disabled={props.disabled}
          aria-label={`Context: ${label}`}
        >
          {props.effectiveScope === 'selection' ? (
            <TextCursorInput />
          ) : props.effectiveScope === 'section' ? (
            <FilePenLine />
          ) : (
            <FolderOpen />
          )}
          <span className='truncate'>{label}</span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' side='top' className='w-72 p-0'>
        <Command>
          <CommandList>
            <CommandGroup heading='Context'>
              <CommandItem onSelect={() => props.onChange('auto')}>
                {props.preference === 'auto' ? <Check /> : <Bot />} Auto
              </CommandItem>
              <CommandItem
                disabled={!props.selectionAvailable}
                onSelect={() => props.onChange('selection')}
              >
                {props.preference === 'selection' ? <Check /> : <TextCursorInput />} Selected text
              </CommandItem>
              <CommandItem
                disabled={props.activeSectionId === null}
                onSelect={() => props.onChange('section')}
              >
                {props.preference === 'section' ? <Check /> : <FilePenLine />} This section
              </CommandItem>
              <CommandItem onSelect={() => props.onChange('project')}>
                {props.preference === 'project' ? <Check /> : <FolderOpen />} Whole manuscript
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

function ReviewBar(props: {
  proposal: MutationProposalRecord
  feedback: string
  busy: boolean
  outdated: boolean
  onFeedbackChange(value: string): void
  onAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'request_changes' | 'reject'
  ): Promise<void>
}): React.JSX.Element {
  if (props.outdated) {
    return (
      <div className='flex items-center justify-between gap-3' data-testid='agent-review-bar'>
        <p className='text-sm text-muted-foreground'>The manuscript changed after this proposal.</p>
        <Button
          disabled={props.busy}
          onClick={() => void props.onAction(props.proposal, 'approve')}
        >
          <RotateCcw data-icon='inline-start' /> Refresh proposal
        </Button>
      </div>
    )
  }
  return (
    <div className='flex min-w-0 flex-col gap-3' data-testid='agent-review-bar'>
      <Textarea
        value={props.feedback}
        rows={2}
        maxLength={4_096}
        placeholder='Describe what should change…'
        aria-label='Review feedback'
        disabled={props.busy}
        onChange={(event) => props.onFeedbackChange(event.target.value)}
      />
      <div className='flex flex-wrap items-center justify-end gap-2'>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon-sm'
              aria-label='More review actions'
              disabled={props.busy}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onSelect={() => void props.onAction(props.proposal, 'approve')}>
              <Check /> Apply only
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void props.onAction(props.proposal, 'reject')}>
              <X /> Reject proposal
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant='outline'
          disabled={props.busy || props.feedback.trim().length === 0}
          onClick={() => void props.onAction(props.proposal, 'request_changes')}
        >
          Request changes
        </Button>
        <Button
          disabled={props.busy}
          onClick={() => void props.onAction(props.proposal, 'approve_continue')}
        >
          <Check data-icon='inline-start' /> Apply & continue
        </Button>
      </div>
    </div>
  )
}

function AgentDetailsDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  session: AgentSessionRecord | null
  activeRun: AgentRunRecord | null
  latestRun: AgentRunRecord | null
  events: AgentEventRecord[]
  proposals: MutationProposalRecord[]
  usage: {
    inputTokens: number
    outputTokens: number
    retryCount: number
    skillRouteRequests: number
  }
  usageDetails: string
  contextUsage: ReturnType<typeof latestAgentContextUsage>
  contextLimits: AgentRunRecord['modelLimits'] | null
  contextPercent: number
  availableModelPresets: AgentProviderCatalog['presets']
  modelSelection: AgentModelSelection | null
  thinkingLevel: AgentThinkingLevel
  supportedThinkingLevels: AgentThinkingLevel[]
  modelReady: boolean
  skillSnapshot: SkillsSnapshot | null
  skillSelection: SkillSelection
  skillPickerOpen: boolean
  busy: boolean
  onModelSelect(selection: AgentModelSelection): Promise<void>
  onThinkingSelect(level: AgentThinkingLevel): Promise<void>
  onSkillPickerOpenChange(open: boolean): void
  onSkillSelect(selection: SkillSelection): Promise<void>
  onApprovalModeSelect(mode: AgentApprovalMode): Promise<void>
  onOpenSettings(): void
}): React.JSX.Element {
  const timeline = useMemo(
    () =>
      projectAgentTimeline(props.events, props.proposals, props.latestRun ? [props.latestRun] : []),
    [props.events, props.latestRun, props.proposals]
  )
  const tools = timeline.flatMap((item) =>
    item.type === 'activity' ? item.tools : item.type === 'proposal' ? [item.tool] : []
  )
  const readonly =
    props.busy || props.session?.status === 'archived' || props.session?.compatible === false
  const run = props.activeRun ?? props.latestRun
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[85vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Agent details</DialogTitle>
          <DialogDescription>
            Conversation settings, usage, and technical diagnostics.
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-5'>
          <section className='grid gap-3'>
            <h3 className='text-sm font-semibold'>Conversation</h3>
            <div className='flex flex-wrap items-center gap-2'>
              <AgentModelPicker
                presets={props.availableModelPresets}
                selection={props.modelSelection}
                disabled={readonly}
                onSelect={props.onModelSelect}
              />
              <AgentThinkingPicker
                levels={props.supportedThinkingLevels}
                value={props.thinkingLevel}
                disabled={readonly || !props.modelReady}
                onSelect={props.onThinkingSelect}
              />
              <SkillPicker
                open={props.skillPickerOpen}
                onOpenChange={props.onSkillPickerOpenChange}
                snapshot={props.skillSnapshot}
                selection={props.skillSelection}
                disabled={readonly}
                onSelect={(selection) => void props.onSkillSelect(selection)}
                onOpenSettings={props.onOpenSettings}
              />
            </div>
            <div className='flex flex-wrap gap-2'>
              {(['manual', 'section_auto', 'yolo'] as const).map((mode) => (
                <Button
                  key={mode}
                  variant={
                    (props.session?.approvalMode ?? 'manual') === mode ? 'secondary' : 'outline'
                  }
                  size='sm'
                  disabled={readonly}
                  onClick={() => void props.onApprovalModeSelect(mode)}
                >
                  {approvalModeLabel(mode)}
                </Button>
              ))}
            </div>
          </section>
          <section className='grid gap-3'>
            <h3 className='text-sm font-semibold'>Usage</h3>
            <dl className='grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm'>
              <dt className='text-muted-foreground'>Tokens</dt>
              <dd className='tabular-nums'>
                {props.usage.inputTokens.toLocaleString()} in ·{' '}
                {props.usage.outputTokens.toLocaleString()} out
              </dd>
              <dt className='text-muted-foreground'>Retries</dt>
              <dd>{props.usage.retryCount}</dd>
              <dt className='text-muted-foreground'>Run time</dt>
              <dd>{run ? formatAgentDuration(elapsedRunMs(run, Date.now())) : '—'}</dd>
              <dt className='text-muted-foreground'>Model</dt>
              <dd className='max-w-64 truncate'>
                {run ? `${run.providerLabel} · ${run.modelLabel}` : '—'}
              </dd>
              <dt className='text-muted-foreground'>Thinking</dt>
              <dd>{run ? thinkingLevelLabel(run.thinkingLevel) : '—'}</dd>
              <dt className='text-muted-foreground'>Error code</dt>
              <dd>{run?.errorCode ?? '—'}</dd>
            </dl>
            {props.contextLimits ? (
              <div className='grid gap-2 text-xs text-muted-foreground'>
                <div className='flex justify-between gap-3'>
                  <span>Context</span>
                  <span className='tabular-nums'>
                    {props.contextUsage?.estimated ? '~' : ''}
                    {props.contextUsage?.used.toLocaleString() ?? '—'} /{' '}
                    {props.contextLimits.contextWindowTokens.toLocaleString()}
                  </span>
                </div>
                <Progress value={props.contextPercent} />
              </div>
            ) : null}
            {props.usageDetails ? (
              <p className='text-xs text-muted-foreground'>{props.usageDetails}</p>
            ) : null}
          </section>
          <section className='grid gap-3'>
            <h3 className='text-sm font-semibold'>Technical activity</h3>
            {tools.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                No tool activity in this conversation.
              </p>
            ) : (
              <div className='grid gap-4'>
                {tools.map((tool) => (
                  <ToolActivityRow key={tool.eventId} tool={tool} stopped={toolWasStopped(tool)} />
                ))}
              </div>
            )}
            {props.events
              .filter((event) => event.type === 'assistant_message')
              .slice(-1)
              .map((event) => (
                <BoundedJsonDetails
                  key={event.agentEventId}
                  label='Provider metadata'
                  value={event.payload.metadata}
                />
              ))}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EventTimeline(props: {
  events: AgentEventRecord[]
  proposals: MutationProposalRecord[]
  runs: AgentRunRecord[]
  now: number
  streaming: Record<string, string>
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  busy: boolean
  onProposalAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'request_changes' | 'reject' | 'undo' | 'cancel_image'
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
  const scrollAnchorIndex = agentTimelineScrollAnchorIndex(timeline)

  return (
    <MessageScrollerProvider autoScroll>
      <MessageScroller data-testid='agent-event-timeline'>
        <MessageScrollerViewport>
          <MessageScrollerContent className='gap-5 overflow-hidden px-4 py-4 pb-6'>
            {timeline.map((item, index) => (
              <MessageScrollerItem
                key={item.id}
                messageId={item.id}
                scrollAnchor={
                  Object.keys(props.streaming).length === 0 && index === scrollAnchorIndex
                }
              >
                <TimelineItem
                  item={item}
                  proposals={props.proposals}
                  runs={props.runs}
                  citationsById={citationsById}
                  busy={props.busy}
                  currentRevisionIds={props.currentRevisionIds}
                  sectionTitles={props.sectionTitles}
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
                        <Spinner />
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
  proposals: MutationProposalRecord[]
  runs: AgentRunRecord[]
  citationsById: Map<string, AgentCitationDisplay>
  busy: boolean
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  onProposalAction(
    proposal: MutationProposalRecord,
    action: 'approve' | 'approve_continue' | 'request_changes' | 'reject' | 'undo' | 'cancel_image'
  ): Promise<void>
}): React.JSX.Element {
  const { item } = props
  if (item.type === 'user') {
    return (
      <Message align='end'>
        <MessageContent>
          <MessageHeader>
            {item.payload.presentation?.kind === 'review_feedback'
              ? 'Requested changes'
              : deliveryLabel(item.payload.delivery)}
          </MessageHeader>
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
        </MessageContent>
      </Message>
    )
  }
  if (item.type === 'activity') return <ActivityGroup item={item} />
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
        citationsById={props.citationsById}
        busy={props.busy}
        currentRevisionIds={props.currentRevisionIds}
        sectionTitles={props.sectionTitles}
        onAction={props.onProposalAction}
      />
    )
  }
  if (item.type === 'run_interrupted') {
    if (item.terminal.outcome === 'awaiting_review') return <span className='hidden' />
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
          {item.terminal.code === 'user_stopped'
            ? 'Stopped'
            : agentTerminalLabel(item.terminal.code)}
        </MarkerContent>
      </Marker>
    )
  }
  if (item.type === 'run_completed') return <span className='hidden' />
  return (
    <Marker variant='separator'>
      <MarkerContent>Earlier conversation summarized</MarkerContent>
    </Marker>
  )
}

function ActivityGroup(props: {
  item: Extract<AgentTimelineItem, { type: 'activity' }>
}): React.JSX.Element {
  const { item } = props
  return (
    <Collapsible
      className='group/activity min-w-0 max-w-full overflow-hidden'
      defaultOpen={
        item.status === 'partial' || item.status === 'error' || item.status === 'stopped'
      }
      data-testid='agent-activity-group'
      data-status={item.status}
    >
      <CollapsibleTrigger className='w-full cursor-pointer rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
        <Marker role='status'>
          <MarkerIcon>{activityIcon(item.status)}</MarkerIcon>
          <MarkerContent className={item.status === 'running' ? 'shimmer' : undefined}>
            {item.summary}
            {item.failedCount > 0 ? (
              <Badge
                className='ml-2 align-middle'
                variant={item.status === 'partial' ? 'warning' : 'destructive'}
              >
                {item.failedCount} of {item.tools.length} failed
              </Badge>
            ) : null}
            {item.status === 'stopped' ? ' · Stopped' : ''}
          </MarkerContent>
          <ChevronDown className='ml-auto transition-transform group-data-[state=open]/activity:rotate-180' />
        </Marker>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className='mt-3 ml-2 flex min-w-0 flex-col gap-3 overflow-hidden border-l pl-4'>
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

function ToolActivityRow(props: { tool: AgentToolActivity; stopped: boolean }): React.JSX.Element {
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
          <AlertDescription>{tool.result.error.message}</AlertDescription>
        </Alert>
      ) : null}
      {citations.length > 0 ? <CitationAttachments citations={citations} /> : null}
      {tool.result?.result ? (
        <BoundedJsonDetails label='Bounded result' value={tool.result.result} />
      ) : null}
    </div>
  )
}

function BoundedJsonDetails(props: { label: string; value: unknown }): React.JSX.Element {
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
    return (
      <Marker role='status'>
        <MarkerIcon>{failed ? <X className='text-destructive' /> : <Spinner />}</MarkerIcon>
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
    <Message data-testid={`agent-proposal-${proposal.proposalId}`}>
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
  if (status === 'running') return <Spinner />
  if (status === 'partial')
    return <TriangleAlert className='text-warning-foreground dark:text-warning' />
  if (status === 'error') return <AlertCircle className='text-destructive' />
  if (status === 'stopped') return <CircleStop className='text-destructive' />
  return <Check className='text-success' />
}

function toolResultIcon(tool: AgentToolActivity, stopped: boolean): React.JSX.Element {
  if ((tool.result === null && stopped) || toolWasStopped(tool))
    return <CircleStop className='text-destructive' />
  if (tool.result === null) return <Spinner />
  if (tool.result.isError) return <X className='text-destructive' />
  return <Check className='text-success' />
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

function AgentErrorAlert(props: { message: string; className?: string }): React.JSX.Element {
  return (
    <Alert variant='destructive' className={props.className}>
      <AlertCircle />
      <AlertTitle>Agent action failed</AlertTitle>
      <AlertDescription>{props.message}</AlertDescription>
    </Alert>
  )
}

function ComposerAction({
  label,
  ...props
}: Omit<React.ComponentProps<typeof InputGroupButton>, 'aria-label'> & {
  label: string
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className='inline-flex'>
          <InputGroupButton aria-label={label} {...props} />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function SkillPicker({
  open,
  onOpenChange,
  snapshot,
  selection,
  disabled,
  onSelect,
  onOpenSettings
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  snapshot: SkillsSnapshot | null
  selection: SkillSelection
  disabled: boolean
  onSelect: (selection: SkillSelection) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const available =
    snapshot?.installed.filter((skill) => skill.enabled && skill.integrityStatus === 'ready') ?? []
  const explicit =
    selection.mode === 'explicit'
      ? (available.find((skill) => skill.skillId === selection.skillId) ?? null)
      : null
  const label =
    selection.mode === 'auto'
      ? 'Skill: Auto'
      : selection.mode === 'none'
        ? 'No skill'
        : (explicit?.displayName ?? 'Selected skill')
  return (
    <div className='flex items-center gap-1'>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <InputGroupButton
            size='sm'
            variant='outline'
            disabled={disabled}
            aria-label='Choose writing skill'
          >
            <Bot data-icon='inline-start' />
            <span className='max-w-32 truncate'>{label}</span>
          </InputGroupButton>
        </PopoverTrigger>
        <PopoverContent align='start' side='top' className='w-80 p-0'>
          <Command>
            <CommandList>
              <CommandEmpty>No matching writing skill.</CommandEmpty>
              <CommandGroup heading='Mode'>
                <CommandItem value='skill-auto' onSelect={() => onSelect({ mode: 'auto' })}>
                  {selection.mode === 'auto' ? <Check /> : <Bot />}
                  Auto
                </CommandItem>
                <CommandItem value='skill-none' onSelect={() => onSelect({ mode: 'none' })}>
                  {selection.mode === 'none' ? <Check /> : <X />}
                  No skill
                </CommandItem>
              </CommandGroup>
              <CommandGroup heading='Installed'>
                {available.map((skill) => (
                  <CommandItem
                    key={skill.skillId}
                    value={`${skill.displayName} ${skill.description}`}
                    onSelect={() => onSelect({ mode: 'explicit', skillId: skill.skillId })}
                  >
                    {selection.mode === 'explicit' && selection.skillId === skill.skillId ? (
                      <Check />
                    ) : (
                      <FileText />
                    )}
                    <span className='min-w-0 flex-1 truncate'>{skill.displayName}</span>
                    <span className='text-xs text-muted-foreground'>
                      {skill.commit.slice(0, 8)}
                    </span>
                  </CommandItem>
                ))}
                {available.length === 0 ? (
                  <CommandItem
                    value='open-writing-skills-settings'
                    onSelect={() => {
                      onOpenChange(false)
                      onOpenSettings()
                    }}
                  >
                    <Settings2 /> Open Writing Skills settings
                  </CommandItem>
                ) : null}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selection.mode === 'explicit' ? (
        <InputGroupButton
          size='icon-xs'
          variant='ghost'
          aria-label='Remove selected writing skill'
          onClick={() => onSelect({ mode: 'auto' })}
        >
          <X />
        </InputGroupButton>
      ) : null}
    </div>
  )
}

function upsertSession(
  sessions: AgentSessionRecord[],
  updated: AgentSessionRecord
): AgentSessionRecord[] {
  return sessions.some((session) => session.agentSessionId === updated.agentSessionId)
    ? sessions.map((session) =>
        session.agentSessionId === updated.agentSessionId ? updated : session
      )
    : [updated, ...sessions]
}

function updateSet(current: Set<string>, value: string, included: boolean): Set<string> {
  const next = new Set(current)
  if (included) next.add(value)
  else next.delete(value)
  return next
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
  if (delivery === 'steer') return 'Steered'
  if (delivery === 'follow_up') return 'Queued'
  return 'You'
}

function blockOperationDisplays(
  proposal: MutationProposalRecord
): Array<{ label: string; raw: string }> {
  if (proposal.payload.kind === 'generated_image_insert') {
    return [
      {
        label: `Generate ${proposal.payload.mutation.imageSize} image`,
        raw: JSON.stringify(proposal.payload.mutation)
      }
    ]
  }
  if (proposal.payload.kind !== 'section_patch') return []
  return proposal.payload.mutation.operations.map((operation) => {
    let label: string
    switch (operation.type) {
      case 'insertBlocks':
        label = `Insert ${blockCountLabel(operation.blocks.length)}`
        break
      case 'updateBlock':
        label = 'Update 1 block'
        break
      case 'removeBlocks':
        label = `Remove ${blockCountLabel(operation.blockIds.length)}`
        break
      case 'replaceBlocks':
        label = `Replace ${blockCountLabel(operation.blockIds.length)}`
        break
      case 'moveBlocks':
        label = `Move ${blockCountLabel(operation.blockIds.length)}`
        break
    }
    return { label, raw: JSON.stringify(operation) }
  })
}

function blockCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'block' : 'blocks'}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The Agent operation failed.'
}

function retrySkillSelection(run: AgentRunRecord | null): SkillSelection {
  if (run === null) return { mode: 'auto' }
  if (run.skillSnapshot.primary !== null) {
    return { mode: 'explicit', skillId: run.skillSnapshot.primary.skillId }
  }
  return run.skillSnapshot.mode === 'none' ? { mode: 'none' } : { mode: 'auto' }
}

function approvalModeLabel(mode: AgentApprovalMode): string {
  if (mode === 'manual') return 'Review every change'
  if (mode === 'section_auto') return 'Apply section edits automatically'
  return 'Apply all eligible edits automatically'
}

export function selectAttentionSession(active: AgentSessionRecord[]): AgentSessionRecord | null {
  return (
    active.find((session) => session.workflowState === 'running') ??
    active.find(
      (session) =>
        session.workflowState === 'generating' || session.workflowState === 'awaiting_review'
    ) ??
    active[0] ??
    null
  )
}

export function effectiveScope(
  preference: 'auto' | AgentStartScope,
  selectionIsAvailable: boolean,
  activeSectionId: string | null
): AgentStartScope {
  if (preference === 'selection') {
    if (selectionIsAvailable) return 'selection'
    return activeSectionId === null ? 'project' : 'section'
  }
  if (preference === 'section') return activeSectionId === null ? 'project' : 'section'
  if (preference === 'project') return 'project'
  if (selectionIsAvailable) return 'selection'
  return activeSectionId === null ? 'project' : 'section'
}

export function agentComposerKeyAction(input: {
  key: string
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  isComposing: boolean
  running: boolean
}): 'none' | 'newline' | 'send' | 'follow_up' | 'steer' {
  if (input.key !== 'Enter' || input.isComposing) return 'none'
  if (input.shiftKey) return 'newline'
  if (!input.running) return 'send'
  return input.metaKey || input.ctrlKey ? 'steer' : 'follow_up'
}

function sessionStatusLabel(session: AgentSessionRecord): string {
  if (session.status === 'archived') return 'Archived'
  if (session.workflowState === 'running' || session.workflowState === 'generating')
    return 'Working'
  if (session.workflowState === 'awaiting_review') return 'Review'
  return 'Ready'
}

function resolveSelectedModel(
  catalog: AgentProviderCatalog,
  selection: AgentModelSelection | null
): {
  preset: AgentProviderCatalog['presets'][number]
  model: AgentProviderCatalog['presets'][number]['models'][number]
} | null {
  if (selection === null) return null
  const preset = catalog.presets.find((item) => item.presetId === selection.presetId)
  const model = preset?.models.find((item) => item.id === selection.modelId)
  return preset === undefined || model === undefined ? null : { preset, model }
}
