import {
  MAX_CONCURRENT_AGENT_RUNS,
  type AgentEventRecord,
  type AgentLiveCompactionSnapshot,
  type AgentPendingQuestion,
  type AgentLiveRunSnapshot,
  type AgentRendererEvent,
  type AgentRunRecord,
  type AgentSessionRecord,
  type AgentStartScope
} from '../../../../shared/contracts/agent-ipc'
import {
  generateImageArgsSchema,
  normalizedGenerateImageArgsSchema,
  modelSubmitSectionChangeArgsSchema,
  type MutationProposalRecord
} from '../../../../shared/contracts/agent-mutations'
import {
  agentApprovalModeSchema,
  agentCompactionSummaryPayloadSchema,
  type AgentApprovalMode
} from '../../../../shared/contracts/agent'
import {
  agentToolCallPayloadSchema,
  askUserArgsSchema,
  askUserResultSchema,
  type AskUserAnswer
} from '../../../../shared/contracts/agent-tools'
import type { AgentQuickActionRequest } from '../../../../shared/contracts/agent-quick-actions'
import type {
  AgentModelSelection,
  AgentProviderCatalog,
  AgentThinkingLevel
} from '../../../../shared/contracts/providers'
import type { InstalledSkill, SkillsSnapshot } from '../../../../shared/contracts/skills'
import {
  parseLeadingSkillMentions,
  skillMentionQueryAt,
  type LeadingSkillMention
} from '../../../../shared/skill-mentions'
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  ArrowUp,
  Bot,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDotDashed,
  CircleHelp,
  CircleMinus,
  CircleStop,
  Clock3,
  CornerDownRight,
  FileText,
  FilePenLine,
  FolderOpen,
  ListCollapse,
  MessageSquarePlus,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Settings2,
  TextCursorInput,
  Trash2,
  TriangleAlert,
  Undo2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog'
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
import { Checkbox } from '@/components/ui/checkbox'
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
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
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
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSubmit,
  QuestionnaireTitle
} from '@/components/ui/questionnaire'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useTheme } from '@/theme-provider'
import { approveProposalAfterEditorFlush } from '../manuscript/agent-proposal-actions'
import { AgentMarkdown } from './agent-markdown'
import { AgentContextUsageIndicator } from './agent-context-usage-indicator'
import { AgentModelEffortPicker } from './agent-model-effort-picker'
import { AgentModelPicker } from './agent-model-picker'
import { AgentThinkingPicker, thinkingLevelLabel } from './agent-thinking-picker'
import {
  aggregateAgentUsage,
  agentHeaderStatusLabel,
  agentThinkingVisualState,
  agentToolActivityLabel,
  agentTerminalDetail,
  agentTerminalLabel,
  agentTimelineScrollAnchorIndex,
  applyAgentTerminalEvent,
  buildWritingTaskChangeSet,
  citationDisplaysForToolResult,
  currentAgentActivitySummary,
  formatAgentDuration,
  findLatestPrompt,
  isSectionProposalOutdated,
  latestAgentContextSnapshot,
  mergeAgentEvents,
  groupAgentConversations,
  protectTerminalAgentRuns,
  projectAgentTimeline,
  type AgentActivityStatus,
  type AgentCitationDisplay,
  type AgentThinkingVisualState,
  type AgentTimelineItem,
  type AgentToolActivity,
  toolWasStopped
} from './agent-view-model'
import { AgentAttentionBeam, AgentThinkingIndicator } from './agent-motion'
import { ProposalPresentation } from './proposal-presentation'
import {
  MAX_WRITING_TASK_STEPS,
  type WritingTaskProgressState,
  type WritingTaskStepStatus,
  type WritingTaskView
} from '../../../../shared/contracts/writing-task'
import type { ChangeSetBatchResult } from '../../../../shared/contracts/agent-change-set'
import type { AnnotationRecord } from '../../../../shared/contracts/annotations'

export interface AgentPanelSelection {
  sectionId: string
  activeBlockId: string | null
  selectedBlockIds: string[]
  selectedText?: string | null
  capturedAt?: number
  capturedRevisionId?: string
}

export interface AgentPanelQuickActionRequest {
  requestId: string
  quickAction: AgentQuickActionRequest
  selection: AgentPanelSelection
}

export function AgentPanel(props: {
  open: boolean
  onOpenChange(open: boolean): void
  onOpenSettings(): void
  projectSessionId: string
  activeSectionId: string | null
  sectionTitles: Readonly<Record<string, string>>
  currentRevisionIds: Readonly<Record<string, string>>
  selection: AgentPanelSelection | null
  quickActionRequest?: AgentPanelQuickActionRequest | null
  includedAnnotations: AnnotationRecord[]
  onClearIncludedAnnotations(): void
  onQuickActionHandled?(requestId: string, started: boolean): void
  onFollowSection(sectionId: string): Promise<boolean>
  flushCurrent(): Promise<boolean>
  refreshManuscript(): Promise<void>
  onError(message: string): void
}): React.JSX.Element {
  const [sessions, setSessions] = useState<AgentSessionRecord[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [events, setEvents] = useState<AgentEventRecord[]>([])
  const [runs, setRuns] = useState<AgentRunRecord[]>([])
  const [proposals, setProposals] = useState<MutationProposalRecord[]>([])
  const [streamingBySession, setStreamingBySession] = useState<
    Record<string, Record<string, string>>
  >({})
  const [activeRunLimit, setActiveRunLimit] = useState(MAX_CONCURRENT_AGENT_RUNS)
  const [, setActiveRunIds] = useState<Set<string>>(() => new Set())
  const [liveRuns, setLiveRuns] = useState<AgentLiveRunSnapshot[]>([])
  const [activeCompactions, setActiveCompactions] = useState<AgentLiveCompactionSnapshot[]>([])
  const [activeWorkCount, setActiveWorkCount] = useState(0)
  const [compactionConfirmOpen, setCompactionConfirmOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [scopePreference, setScopePreference] = useState<'auto' | AgentStartScope>('auto')
  const [reviewFeedback, setReviewFeedback] = useState('')
  const [composerAddOpen, setComposerAddOpen] = useState(false)
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0)
  const [skillMentionDismissed, setSkillMentionDismissed] = useState(false)
  const [skillMentionSelectionIndex, setSkillMentionSelectionIndex] = useState(0)
  const [composerCaret, setComposerCaret] = useState(0)
  const [waitingMessagesOpen, setWaitingMessagesOpen] = useState(false)
  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [taskEditorOpen, setTaskEditorOpen] = useState(false)
  const [continuationFailure, setContinuationFailure] = useState<{
    kind: 'approval' | 'revision'
    proposalId: string
  } | null>(null)
  const [titleGeneratingIds, setTitleGeneratingIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const processedQuickActionIdsRef = useRef(new Set<string>())
  const [providerCatalog, setProviderCatalog] = useState<AgentProviderCatalog>({
    presets: [],
    defaultSelection: null
  })
  const [skillsSnapshot, setSkillsSnapshot] = useState<SkillsSnapshot | null>(null)
  const [revisionTransitions, setRevisionTransitions] = useState<
    Record<string, { from: string | undefined; to: string }>
  >({})
  const activeSessionIdRef = useRef<string | null>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const pendingComposerCaretRef = useRef<number | null>(null)
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
    setStreamingBySession({})
    setActiveRunIds(new Set())
    setLiveRuns([])
    setPendingActionIds(new Set())
    setWaitingMessagesOpen(false)
    setActiveCompactions([])
    setActiveWorkCount(0)
    setActiveRunLimit(MAX_CONCURRENT_AGENT_RUNS)
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
    setWaitingMessagesOpen(false)
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
      window.desktop.skills.snapshot().catch(() => null)
    ])
      .then(([, snapshot, nextSkillsSnapshot]) => {
        if (!disposed) {
          setProviderCatalog(snapshot.agentCatalog)
          if (nextSkillsSnapshot !== null) setSkillsSnapshot(nextSkillsSnapshot)
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

  useLayoutEffect(() => {
    const nextCaret = pendingComposerCaretRef.current
    if (nextCaret === null) return
    const textarea = composerTextareaRef.current
    if (textarea === null || textarea.value !== prompt) return
    pendingComposerCaretRef.current = null
    textarea.focus()
    textarea.setSelectionRange(nextCaret, nextCaret)
  }, [prompt])

  useEffect(() => {
    if (!props.open) return
    return window.desktop.skills.subscribeChanges(() => {
      void window.desktop.skills
        .snapshot()
        .then(setSkillsSnapshot)
        .catch(() => undefined)
    })
  }, [props.open])

  useEffect(() => {
    if (!props.open) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    const removeStreamingRun = (agentSessionId: string, agentRunId: string): void => {
      setStreamingBySession((current) => {
        const sessionStreaming = current[agentSessionId]
        if (sessionStreaming?.[agentRunId] === undefined) return current
        const nextSessionStreaming = { ...sessionStreaming }
        delete nextSessionStreaming[agentRunId]
        return { ...current, [agentSessionId]: nextSessionStreaming }
      })
    }
    const onActivity = (rendererEvent: AgentRendererEvent): void => {
      if (disposed) return
      const sectionId = sectionFollowTargetForAgentEvent(rendererEvent, activeSessionIdRef.current)
      if (sectionId !== null) void props.onFollowSection(sectionId)
      if (rendererEvent.kind === 'activity') {
        setActiveRunLimit(rendererEvent.snapshot.limit)
        setActiveRunIds(new Set(rendererEvent.snapshot.runs.map((run) => run.agentRunId)))
        setLiveRuns(rendererEvent.snapshot.runs)
        setActiveCompactions(rendererEvent.snapshot.compactions)
        setActiveWorkCount(rendererEvent.snapshot.activeCount)
        return
      }
      if (rendererEvent.kind === 'session') {
        setSessions((current) => upsertSession(current, rendererEvent.session))
        setTitleGeneratingIds((current) =>
          updateSet(current, rendererEvent.session.agentSessionId, rendererEvent.titleGenerating)
        )
        return
      }
      if (rendererEvent.kind === 'delta') {
        setActiveRunIds((current) => new Set(current).add(rendererEvent.agentRunId))
        setStreamingBySession((current) => {
          const sessionStreaming = current[rendererEvent.agentSessionId] ?? {}
          return {
            ...current,
            [rendererEvent.agentSessionId]: {
              ...sessionStreaming,
              [rendererEvent.agentRunId]:
                `${sessionStreaming[rendererEvent.agentRunId] ?? ''}${rendererEvent.delta}`.slice(
                  0,
                  2_097_152
                )
            }
          }
        })
        if (
          activeSessionIdRef.current === rendererEvent.agentSessionId &&
          skillRoutingPendingRef.current.delete(rendererEvent.agentRunId)
        ) {
          void refreshSessionTruth(rendererEvent.agentSessionId).catch((cause) =>
            props.onError(errorMessage(cause))
          )
        }
        return
      }
      const runId = rendererEvent.event.agentRunId
      if (runId !== null) {
        setActiveRunIds((current) => {
          const next = new Set(current)
          if (
            rendererEvent.event.type === 'run_completed' ||
            rendererEvent.event.type === 'run_interrupted'
          ) {
            next.delete(runId)
          } else {
            next.add(runId)
          }
          return next
        })
      }
      if (
        runId !== null &&
        (rendererEvent.event.type === 'assistant_message' ||
          rendererEvent.event.type === 'run_completed' ||
          rendererEvent.event.type === 'run_interrupted')
      ) {
        removeStreamingRun(rendererEvent.event.agentSessionId, runId)
      }
      if (
        rendererEvent.event.type === 'run_completed' ||
        rendererEvent.event.type === 'run_interrupted'
      ) {
        void refreshSessions().catch((cause) => props.onError(errorMessage(cause)))
      }
    }
    void window.desktop.agent
      .subscribeActivity({ projectSessionId: props.projectSessionId }, onActivity)
      .then(async (subscription) => {
        if (disposed) {
          subscription.unsubscribe()
          return
        }
        unsubscribe = subscription.unsubscribe
        setActiveRunLimit(subscription.snapshot.limit)
        setActiveRunIds(new Set(subscription.snapshot.runs.map((run) => run.agentRunId)))
        setLiveRuns(subscription.snapshot.runs)
        setActiveCompactions(subscription.snapshot.compactions)
        setActiveWorkCount(subscription.snapshot.activeCount)
        setStreamingBySession(
          Object.fromEntries(
            subscription.snapshot.runs.map((run) => [
              run.agentSessionId,
              run.partialText.length === 0 ? {} : { [run.agentRunId]: run.partialText }
            ])
          )
        )
        await subscription.activate()
      })
      .catch(() => {
        if (!disposed) props.onError('Live Agent activity is unavailable.')
      })
    return () => {
      disposed = true
      unsubscribe?.()
    }
  }, [
    props.onError,
    props.onFollowSection,
    props.open,
    props.projectSessionId,
    refreshSessions,
    refreshSessionTruth
  ])

  useEffect(() => {
    if (!props.open || activeSessionId === null) return
    let disposed = false
    let unsubscribe: (() => void) | undefined
    let unsubscribeMutations: (() => void) | undefined
    setEvents([])
    setRuns([])
    setProposals([])
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
            return
          }
          if (rendererEvent.kind === 'activity') return
          setEvents((current) => mergeAgentEvents(current, rendererEvent.event))
          const terminalRunId = rendererEvent.event.agentRunId
          if (
            terminalRunId !== null &&
            (rendererEvent.event.type === 'run_completed' ||
              rendererEvent.event.type === 'run_interrupted')
          ) {
            terminalRunIdsRef.current.add(terminalRunId)
            setRuns((current) => applyAgentTerminalEvent(current, rendererEvent.event))
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
  const activeRun = runs.find((run) => run.status === 'running') ?? null
  const liveRun = liveRuns.find((run) => run.agentRunId === activeRun?.agentRunId) ?? null
  const pendingQuestion = liveRun?.pendingQuestion ?? null
  const pendingMessages = liveRun?.pendingMessages ?? []
  const activeCompaction =
    activeCompactions.find((item) => item.agentSessionId === activeSessionId) ?? null
  const choosingSkill = activeRun?.skillSnapshot.routingStatus === 'pending'
  const streaming = activeSessionId === null ? {} : (streamingBySession[activeSessionId] ?? {})
  const hasStreamingRun = Object.keys(streaming).length > 0
  const isAgentWorking = activeRun !== null || activeCompaction !== null || hasStreamingRun
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
  const latestRun = runs[0] ?? null
  const modelSelection = activeSession?.modelSelection ?? providerCatalog.defaultSelection
  const contextSnapshot = useMemo(
    () => latestAgentContextSnapshot(events, runs, modelSelection),
    [events, modelSelection, runs]
  )
  const waitingProposal = proposals.find((proposal) => proposal.status === 'pending')
  const generatingProposal = proposals.find((proposal) => proposal.status === 'generating')
  const workflowState =
    activeRun !== null
      ? pendingQuestion === null
        ? 'running'
        : 'awaiting_input'
      : activeCompaction !== null
        ? 'compacting'
        : generatingProposal !== undefined
          ? 'generating'
          : waitingProposal !== undefined
            ? 'awaiting_review'
            : (activeSession?.workflowState ?? 'idle')
  const conversationLocked =
    workflowState === 'awaiting_review' ||
    workflowState === 'awaiting_input' ||
    workflowState === 'generating' ||
    workflowState === 'compacting'
  const scope = effectiveScope(scopePreference, selectionIsAvailable, props.activeSectionId)
  const agentCapacityReached = activeRun === null && activeWorkCount >= activeRunLimit
  const canControlTask =
    activeSession?.writingTask !== null &&
    activeSession?.writingTask !== undefined &&
    !activeSessionArchived &&
    workflowState === 'idle' &&
    !busy &&
    !agentCapacityReached
  const workingSession =
    sessions.find(
      (session) =>
        session.status === 'active' &&
        (session.workflowState === 'running' ||
          session.workflowState === 'awaiting_input' ||
          session.workflowState === 'compacting')
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
  const timeline = useMemo(
    () => projectAgentTimeline(events, proposals, runs, clockNow),
    [clockNow, events, proposals, runs]
  )
  const currentActivity = currentAgentActivitySummary(timeline, activeRun?.agentRunId ?? null)
  const thinkingVisualState = agentThinkingVisualState({
    timeline,
    runId: activeRun?.agentRunId ?? null,
    workflowState,
    choosingSkill,
    hasStreamingRun
  })
  const headerStatus = agentHeaderStatusLabel({
    archived: activeSessionArchived === true,
    workflowState,
    choosingSkill,
    currentActivity,
    hasStreamingRun,
    elapsedMs: elapsedRunMs(activeRun, clockNow)
  })

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
    setContinuationFailure(null)
    setSessionSwitcherOpen(false)
  }

  const setApprovalMode = async (mode: AgentApprovalMode): Promise<void> => {
    if (activeSessionArchived) return
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

  const compactSession = async (): Promise<void> => {
    if (activeSession === null || activeSession.workflowState !== 'idle') return
    setBusy(true)
    setError(null)
    try {
      await window.desktop.agent.compactSession({
        projectSessionId: props.projectSessionId,
        agentSessionId: activeSession.agentSessionId
      })
      setCompactionConfirmOpen(false)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const stopCompaction = async (): Promise<void> => {
    if (activeCompaction === null) return
    setBusy(true)
    setError(null)
    try {
      await window.desktop.agent.stopCompaction({
        projectSessionId: props.projectSessionId,
        agentSessionId: activeCompaction.agentSessionId,
        compactionId: activeCompaction.compactionId
      })
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const canCompact =
    activeSession?.status === 'active' &&
    activeSession.compatible &&
    workflowState === 'idle' &&
    hasManualCompactionHead(events) &&
    activeWorkCount < activeRunLimit

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
    reuseSkillFromRunId?: string,
    rejectedProposalId?: string,
    quickAction?: AgentQuickActionRequest,
    quickActionSelection?: AgentPanelSelection
  ): Promise<boolean> => {
    const trimmed = content.trim()
    const quickActionBlocked =
      quickAction === undefined
        ? null
        : activeSessionArchived
          ? 'Restore this conversation before using a quick action.'
          : busy || activeRun !== null || conversationLocked
            ? 'Finish the current Agent work or review before using a quick action.'
            : !modelReady
              ? 'Choose an Agent model before using a quick action.'
              : agentCapacityReached
                ? `All ${activeRunLimit} Agent work slots are in use. Try again when one finishes.`
                : null
    if (quickActionBlocked !== null) {
      setError(quickActionBlocked)
      return false
    }
    if (
      (trimmed.length === 0 && quickAction === undefined && approvedProposalId === undefined) ||
      activeSessionArchived ||
      (!allowWhileBusy && busy) ||
      ((activeRun !== null || conversationLocked) &&
        approvedProposalId === undefined &&
        rejectedProposalId === undefined) ||
      (!modelReady && approvedProposalId === undefined && rejectedProposalId === undefined) ||
      agentCapacityReached
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
      const includedAnnotationIds =
        quickAction === undefined &&
        approvedProposalId === undefined &&
        rejectedProposalId === undefined
          ? props.includedAnnotations.map((annotation) => annotation.annotationId)
          : []
      const run = await window.desktop.agent.startRun({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId,
        ...(quickAction === undefined
          ? approvedProposalId === undefined
            ? { prompt: trimmed }
            : {}
          : { quickAction }),
        ...(approvedProposalId === undefined ? {} : { approvedProposalId }),
        ...(rejectedProposalId === undefined ? {} : { rejectedProposalId }),
        includedAnnotationIds,
        scope: quickAction === undefined ? scope : 'selection',
        ...(reuseSkillFromRunId === undefined ? {} : { reuseSkillFromRunId }),
        editorContext: editorContextForScope(
          quickAction === undefined ? scope : 'selection',
          props.activeSectionId,
          quickActionSelection ?? props.selection,
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
      setActiveRunIds((current) => new Set(current).add(run.agentRunId))
      setPrompt('')
      if (includedAnnotationIds.length > 0) props.onClearIncludedAnnotations()
      return true
    } catch (cause) {
      const message = errorMessage(cause)
      setError(message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const startRunRef = useRef(startRun)
  startRunRef.current = startRun

  useEffect(() => {
    const request = props.quickActionRequest
    if (
      loading ||
      request === undefined ||
      request === null ||
      processedQuickActionIdsRef.current.has(request.requestId)
    )
      return
    processedQuickActionIdsRef.current.add(request.requestId)
    void startRunRef
      .current(
        '',
        undefined,
        false,
        true,
        undefined,
        undefined,
        request.quickAction,
        request.selection
      )
      .then((started) => props.onQuickActionHandled?.(request.requestId, started))
  }, [loading, props.quickActionRequest, props.onQuickActionHandled])

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

  const answerUserQuestion = async (answers: AskUserAnswer[]): Promise<void> => {
    if (activeSessionId === null || activeRun === null || pendingQuestion === null || busy) return
    const agentRunId = activeRun.agentRunId
    setBusy(true)
    setError(null)
    try {
      await window.desktop.agent.answerUserQuestion({
        projectSessionId: props.projectSessionId,
        agentSessionId: activeSessionId,
        agentRunId,
        toolCallId: pendingQuestion.toolCallId,
        answers
      })
      await refreshSessionTruth(activeSessionId)
    } catch (cause) {
      if (!(await reconcileInactiveRun(agentRunId))) setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const resumeWritingTask = async (): Promise<void> => {
    if (!canControlTask || activeSession === null || activeSession.writingTask === null) return
    setBusy(true)
    setError(null)
    try {
      if (!(await props.flushCurrent())) {
        setError('Save the active section before resuming the writing task.')
        return
      }
      const run = await window.desktop.agent.startRun({
        projectSessionId: props.projectSessionId,
        agentSessionId: activeSession.agentSessionId,
        resumeWritingTask: true,
        includedAnnotationIds: [],
        scope,
        editorContext: editorContextForScope(
          scope,
          props.activeSectionId,
          props.selection,
          props.currentRevisionIds
        )
      })
      setRuns((current) => [run, ...current.filter((item) => item.agentRunId !== run.agentRunId)])
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  const reviseWritingTask = async (input: {
    taskId: string
    expectedPlanVersion: number
    objective: string
    steps: Array<{
      stepId?: string
      title: string
      status: WritingTaskStepStatus
      statusReason: string | null
    }>
  }): Promise<void> => {
    if (!canControlTask || activeSession === null) return
    setBusy(true)
    setError(null)
    try {
      const task = await window.desktop.agent.updateWritingTask({
        projectSessionId: props.projectSessionId,
        agentSessionId: activeSession.agentSessionId,
        taskId: input.taskId,
        expectedPlanVersion: input.expectedPlanVersion,
        objective: input.objective,
        steps: input.steps.map((step) =>
          step.stepId === undefined
            ? { title: step.title, status: step.status === 'active' ? 'active' : 'pending' }
            : {
                stepId: step.stepId,
                title: step.title,
                status: step.status,
                statusReason: step.statusReason
              }
        )
      })
      setSessions((current) =>
        current.map((session) =>
          session.agentSessionId === activeSession.agentSessionId
            ? { ...session, writingTask: task }
            : session
        )
      )
      setTaskEditorOpen(false)
    } catch (cause) {
      setError(errorMessage(cause))
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

  const actOnPendingMessage = async (
    pendingMessageId: string,
    action: 'steer' | 'delete'
  ): Promise<void> => {
    if (activeRun === null || pendingActionIds.has(pendingMessageId)) return
    setPendingActionIds((current) => new Set(current).add(pendingMessageId))
    setError(null)
    try {
      const input = {
        projectSessionId: props.projectSessionId,
        agentRunId: activeRun.agentRunId,
        pendingMessageId
      }
      if (action === 'steer') await window.desktop.agent.steerPendingFollowUp(input)
      else await window.desktop.agent.deletePendingFollowUp(input)
    } catch (cause) {
      if (!(await reconcileInactiveRun(activeRun.agentRunId))) setError(errorMessage(cause))
    } finally {
      setPendingActionIds((current) => {
        const next = new Set(current)
        next.delete(pendingMessageId)
        return next
      })
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
        if (result.warnings.length > 0) {
          setError(`Review tracking warning: ${result.warnings.join(' ')}`)
        }
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
            '',
            result.proposal.proposalId,
            true,
            true,
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
        if (result.warnings.length > 0) {
          setError(`Review tracking warning: ${result.warnings.join(' ')}`)
        }
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

  const decideChangeSet = async (input: {
    taskId: string
    proposalIds: string[]
    action: 'apply' | 'reject'
    rejectReason: string | null
    createCheckpoint: boolean
  }): Promise<ChangeSetBatchResult> => {
    if (activeSession === null) throw new Error('Agent conversation is not open')
    setBusy(true)
    setError(null)
    try {
      const result = await window.desktop.agent.decideChangeSet({
        projectSessionId: props.projectSessionId,
        agentSessionId: activeSession.agentSessionId,
        taskId: input.taskId,
        commandId: crypto.randomUUID(),
        action: input.action,
        proposalIds: input.proposalIds,
        rejectReason: input.rejectReason,
        createCheckpoint: input.createCheckpoint
      })
      await refreshSessionTruth(activeSession.agentSessionId)
      if (result.review.appliedCount > 0) await props.refreshManuscript()
      return result
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
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
  const composerSettingsDisabled = busy || activeRun !== null || conversationLocked
  const composerCommands = buildComposerCommands({
    selectionAvailable: selectionIsAvailable,
    sectionAvailable: props.activeSectionId !== null,
    scopePreference
  })
  const slashQuery = slashCommandQuery(prompt)
  const slashCommands = filterComposerCommands(composerCommands, slashQuery ?? '')
  const slashSelectableCommands = slashCommands.filter((command) => !command.disabled)
  const slashCommandOpen = slashQuery !== null && !slashMenuDismissed
  const selectedSlashCommand =
    slashSelectableCommands[slashSelectionIndex % Math.max(1, slashSelectableCommands.length)] ??
    null
  const skillQuery =
    activeRun === null && !conversationLocked ? skillMentionQueryAt(prompt, composerCaret) : null
  const skillMentionCandidates = buildSkillMentionCandidates({
    installed: skillsSnapshot?.installed ?? [],
    prompt,
    query: skillQuery?.query ?? '',
    queryStart: skillQuery?.start
  })
  const skillMentionSelectableCandidates = skillMentionCandidates.filter(
    (candidate) => !candidate.disabled
  )
  const skillMentionOpen =
    skillQuery !== null && !skillMentionDismissed && !busy && activeRun === null
  const selectedSkillMention =
    skillMentionSelectableCandidates[
      skillMentionSelectionIndex % Math.max(1, skillMentionSelectableCandidates.length)
    ] ?? null
  const leadingSkillMentions = parseLeadingSkillMentions(prompt)

  const runComposerCommand = (command: ComposerCommand, clearSlash: boolean): void => {
    if (command.disabled) return
    setComposerAddOpen(false)
    setSlashMenuDismissed(true)
    if (clearSlash) setPrompt('')
    if (command.action.kind === 'scope') {
      setScopePreference(command.action.value)
    }
  }

  const insertSkillMention = (candidate: SkillMentionCandidate): void => {
    if (candidate.disabled) return
    const query = skillMentionQueryAt(prompt, composerCaret)
    if (query === null) return
    const insertion = `$${candidate.name} `
    const nextPrompt = `${prompt.slice(0, query.start)}${insertion}${prompt.slice(query.end)}`
    const nextCaret = query.start + insertion.length
    pendingComposerCaretRef.current = nextCaret
    setPrompt(nextPrompt)
    setComposerCaret(nextCaret)
    setSkillMentionDismissed(false)
    setSkillMentionSelectionIndex(0)
  }

  const focusSkillMention = (mention: { start: number; end: number }): void => {
    const textarea = composerTextareaRef.current
    if (textarea === null) return
    textarea.focus()
    textarea.setSelectionRange(mention.start, mention.end)
    setComposerCaret(mention.end)
  }

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
          className='grid min-w-0 grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2 border-b px-3 py-2'
          data-testid='agent-conversation-header'
        >
          <ConversationSwitcher
            open={sessionSwitcherOpen}
            onOpenChange={setSessionSwitcherOpen}
            sessions={sessions}
            activeSession={activeSession}
            titleGeneratingIds={titleGeneratingIds}
            busy={busy}
            status={headerStatus}
            workflowState={workflowState}
            thinkingVisualState={thinkingVisualState}
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
                {!activeSessionArchived && activeSession ? (
                  <DropdownMenuItem
                    disabled={!canCompact}
                    onSelect={() => setCompactionConfirmOpen(true)}
                  >
                    <ListCollapse /> Summarize earlier conversation
                  </DropdownMenuItem>
                ) : null}
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
              timeline={timeline}
              projectSessionId={props.projectSessionId}
              proposals={proposals}
              runs={runs}
              streaming={streaming}
              currentRevisionIds={effectiveRevisionIds}
              sectionTitles={props.sectionTitles}
              onProposalAction={proposalAction}
              onNew={beginNewConversation}
              busy={busy || activeSessionArchived}
            />
          )}
        </div>

        {activeSession?.writingTask ? (
          <WritingTaskProgressDock
            key={`${activeSession.agentSessionId}:${activeSession.writingTask.taskId}:${activeSessionArchived}`}
            task={activeSession.writingTask}
            projectSessionId={props.projectSessionId}
            proposals={proposals}
            currentRevisionIds={effectiveRevisionIds}
            sectionTitles={props.sectionTitles}
            canControl={canControlTask}
            busy={busy || activeSessionArchived}
            onEdit={() => setTaskEditorOpen(true)}
            onResume={resumeWritingTask}
            onBatch={decideChangeSet}
          />
        ) : null}

        <div
          className='flex min-w-0 shrink-0 flex-col gap-3 border-t px-4 py-3'
          data-testid='agent-composer'
        >
          {error ? (
            <AgentAttentionDock label='Agent error'>
              <AgentErrorAlert message={error} />
            </AgentAttentionDock>
          ) : null}
          {agentCapacityReached ? (
            <AgentAttentionDock label='Agent capacity reached'>
              <Marker role='status'>
                <MarkerIcon>
                  <TriangleAlert />
                </MarkerIcon>
                <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-2'>
                  <span>
                    {activeRunLimit} Agent runs are already working. Your draft is saved; wait for
                    one to finish or stop one.
                  </span>
                  {workingSession === null ? null : (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => openSession(workingSession.agentSessionId)}
                    >
                      Open working conversation
                    </Button>
                  )}
                </MarkerContent>
              </Marker>
            </AgentAttentionDock>
          ) : activeSessionArchived && activeSession ? (
            <AgentAttentionDock label='Archived conversation'>
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
            </AgentAttentionDock>
          ) : pendingQuestion !== null ? (
            <AgentAttentionDock label='Agent clarification'>
              <AgentQuestionnaireDock
                key={pendingQuestion.toolCallId}
                pending={pendingQuestion}
                busy={busy || pendingQuestion.submitting}
                onSubmit={answerUserQuestion}
                onStop={stopRun}
              />
            </AgentAttentionDock>
          ) : waitingProposal !== undefined ? (
            <AgentAttentionDock label='Proposal review'>
              <AgentAttentionBeam attentionKey={waitingProposal.proposalId} paused={busy}>
                <ReviewBar
                  proposal={waitingProposal}
                  feedback={reviewFeedback}
                  busy={busy}
                  outdated={isSectionProposalOutdated(waitingProposal, effectiveRevisionIds)}
                  onFeedbackChange={setReviewFeedback}
                  onAction={proposalAction}
                />
              </AgentAttentionBeam>
            </AgentAttentionDock>
          ) : workflowState === 'generating' ? (
            <AgentAttentionDock label='Image generation'>
              <Marker role='status'>
                <MarkerIcon>
                  <Spinner />
                </MarkerIcon>
                <MarkerContent>
                  Generating an image. Review will appear here when it is ready.
                </MarkerContent>
              </Marker>
            </AgentAttentionDock>
          ) : workflowState === 'compacting' ? (
            <AgentAttentionDock label='Conversation summary'>
              <Marker role='status'>
                <MarkerIcon>
                  <Spinner />
                </MarkerIcon>
                <MarkerContent className='flex min-w-0 flex-1 items-center justify-between gap-2'>
                  <span>Summarizing earlier conversation…</span>
                  <Button
                    variant='outline'
                    size='sm'
                    disabled={busy}
                    onClick={() => void stopCompaction()}
                  >
                    <CircleStop data-icon='inline-start' /> Stop
                  </Button>
                </MarkerContent>
              </Marker>
            </AgentAttentionDock>
          ) : continuationFailure !== null && failedContinuationProposal !== null ? (
            <AgentAttentionDock label='Continuation recovery'>
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
            </AgentAttentionDock>
          ) : !modelReady ? (
            <Button variant='outline' className='w-full' onClick={props.onOpenSettings}>
              <Settings2 data-icon='inline-start' /> Set up an Agent model
            </Button>
          ) : (
            <Field data-disabled={busy || choosingSkill || activeSession?.compatible === false}>
              <FieldLabel htmlFor='agent-message' className='sr-only'>
                Agent message
              </FieldLabel>
              <ComposerContextChips
                scopePreference={scopePreference}
                skillMentions={leadingSkillMentions}
                annotationCount={props.includedAnnotations.length}
                disabled={composerSettingsDisabled}
                onScopeClick={() => setComposerAddOpen(true)}
                onSkillClick={focusSkillMention}
                onClearAnnotations={props.onClearIncludedAnnotations}
              />
              {activeRun !== null && pendingMessages.length > 0 ? (
                <Collapsible
                  open={waitingMessagesOpen}
                  onOpenChange={setWaitingMessagesOpen}
                  aria-label='Waiting messages'
                  className='group/waiting overflow-hidden rounded-md border bg-muted/20'
                  data-testid='agent-pending-messages'
                >
                  <CollapsibleTrigger asChild>
                    <Button
                      type='button'
                      variant='ghost'
                      size='sm'
                      className='h-9 w-full justify-start rounded-none px-2 text-muted-foreground'
                    >
                      <CornerDownRight />
                      <span className='min-w-0 flex-1 truncate text-left'>
                        Waiting follow-ups · {pendingMessages.length}
                      </span>
                      <ChevronDown className='transition-transform group-data-[state=open]/waiting:rotate-180 motion-reduce:transition-none' />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <ul className='m-0 max-h-32 list-none overflow-y-auto border-t p-1'>
                      {pendingMessages.map((message) => {
                        const actionPending = pendingActionIds.has(message.pendingMessageId)
                        return (
                          <li
                            key={message.pendingMessageId}
                            className='flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-sm hover:bg-muted/60'
                          >
                            <span className='min-w-0 flex-1 truncate'>{message.content}</span>
                            <Button
                              type='button'
                              size='sm'
                              variant='ghost'
                              className='h-7 shrink-0 px-2 text-muted-foreground'
                              disabled={actionPending}
                              onClick={() =>
                                void actOnPendingMessage(message.pendingMessageId, 'steer')
                              }
                            >
                              <CornerDownRight data-icon='inline-start' /> Steer
                            </Button>
                            <Button
                              type='button'
                              size='icon-xs'
                              variant='ghost'
                              className='shrink-0 text-muted-foreground hover:text-destructive'
                              aria-label='Delete waiting message'
                              disabled={actionPending}
                              onClick={() =>
                                void actOnPendingMessage(message.pendingMessageId, 'delete')
                              }
                            >
                              <Trash2 />
                            </Button>
                          </li>
                        )
                      })}
                    </ul>
                  </CollapsibleContent>
                </Collapsible>
              ) : null}
              <Popover
                open={slashCommandOpen || skillMentionOpen}
                onOpenChange={(open) => {
                  if (!open) {
                    setSlashMenuDismissed(true)
                    setSkillMentionDismissed(true)
                  }
                }}
              >
                <PopoverAnchor asChild>
                  <InputGroup
                    data-disabled={busy || choosingSkill || activeSession?.compatible === false}
                  >
                    <InputGroupTextarea
                      ref={composerTextareaRef}
                      id='agent-message'
                      value={prompt}
                      placeholder={
                        activeRun
                          ? choosingSkill
                            ? 'Loading writing guidance…'
                            : 'Queue a follow-up…'
                          : 'Ask the writing agent…'
                      }
                      rows={2}
                      className='min-h-20 max-h-48 overflow-y-auto [field-sizing:content]'
                      disabled={busy || choosingSkill || activeSession?.compatible === false}
                      onChange={(event) => {
                        setPrompt(event.target.value)
                        setComposerCaret(event.target.selectionStart ?? event.target.value.length)
                        setSlashMenuDismissed(false)
                        setSlashSelectionIndex(0)
                        setSkillMentionDismissed(false)
                        setSkillMentionSelectionIndex(0)
                      }}
                      onSelect={(event) => {
                        setComposerCaret(event.currentTarget.selectionStart ?? prompt.length)
                      }}
                      onKeyDown={(event) => {
                        if (skillMentionOpen && !event.nativeEvent.isComposing) {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setSkillMentionDismissed(true)
                            return
                          }
                          if (
                            (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
                            skillMentionSelectableCandidates.length > 0
                          ) {
                            event.preventDefault()
                            setSkillMentionSelectionIndex((current) =>
                              event.key === 'ArrowDown'
                                ? (current + 1) % skillMentionSelectableCandidates.length
                                : (current - 1 + skillMentionSelectableCandidates.length) %
                                  skillMentionSelectableCandidates.length
                            )
                            return
                          }
                          if (
                            (event.key === 'Enter' || event.key === 'Tab') &&
                            !event.shiftKey &&
                            selectedSkillMention !== null
                          ) {
                            event.preventDefault()
                            insertSkillMention(selectedSkillMention)
                            return
                          }
                        }
                        if (slashCommandOpen && !event.nativeEvent.isComposing) {
                          if (event.key === 'Escape') {
                            event.preventDefault()
                            setSlashMenuDismissed(true)
                            return
                          }
                          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                            event.preventDefault()
                            if (slashSelectableCommands.length === 0) return
                            setSlashSelectionIndex((current) =>
                              event.key === 'ArrowDown'
                                ? (current + 1) % slashSelectableCommands.length
                                : (current - 1 + slashSelectableCommands.length) %
                                  slashSelectableCommands.length
                            )
                            return
                          }
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault()
                            if (selectedSlashCommand !== null) {
                              runComposerCommand(selectedSlashCommand, true)
                            }
                            return
                          }
                        }
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
                      <div className='flex shrink-0 items-center gap-1'>
                        <Popover open={composerAddOpen} onOpenChange={setComposerAddOpen}>
                          <PopoverTrigger asChild>
                            <InputGroupButton
                              size='icon-sm'
                              aria-label='Add context'
                              disabled={composerSettingsDisabled}
                              data-testid='agent-add-menu-trigger'
                            >
                              <Plus />
                            </InputGroupButton>
                          </PopoverTrigger>
                          <PopoverContent align='start' side='top' className='w-80 p-0'>
                            <ComposerCommandMenu
                              commands={composerCommands}
                              onSelect={(command) => runComposerCommand(command, false)}
                            />
                          </PopoverContent>
                        </Popover>
                        <ApprovalModePicker
                          value={activeSession?.approvalMode ?? 'manual'}
                          disabled={busy || activeSessionArchived}
                          onSelect={setApprovalMode}
                        />
                      </div>
                      <div className='ml-auto flex min-w-0 flex-1 items-center justify-end gap-1'>
                        <AgentContextUsageIndicator snapshot={contextSnapshot} />
                        <AgentModelEffortPicker
                          presets={availableModelPresets}
                          selection={modelSelection}
                          levels={supportedThinkingLevels}
                          effort={
                            activeSession?.thinkingLevel ??
                            providerCatalog.defaultThinkingLevel ??
                            'medium'
                          }
                          disabled={composerSettingsDisabled}
                          onModelSelect={setModelSelection}
                          onEffortSelect={setThinkingLevel}
                        />
                        {activeRun !== null ? (
                          agentComposerRunningAction(prompt) === 'follow_up' ? (
                            <InputGroupButton
                              variant='default'
                              size='icon-sm'
                              className='shrink-0 rounded-full'
                              aria-label='Queue follow-up'
                              title='Queue follow-up'
                              disabled={busy}
                              onClick={() => void queueMessage('follow_up')}
                            >
                              <ArrowUp />
                            </InputGroupButton>
                          ) : (
                            <ComposerAction
                              size='icon-sm'
                              variant='destructive'
                              className='shrink-0 rounded-full'
                              label='Stop'
                              disabled={busy}
                              onClick={() => void stopRun()}
                            >
                              <CircleStop />
                            </ComposerAction>
                          )
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
                                    latestRun?.agentRunId
                                  )
                                }
                              >
                                <RotateCcw />
                              </ComposerAction>
                            ) : null}
                            <InputGroupButton
                              variant='default'
                              size='icon-sm'
                              className='shrink-0 rounded-full'
                              aria-label='Send'
                              title='Send'
                              disabled={
                                busy ||
                                prompt.trim().length === 0 ||
                                activeSession?.compatible === false ||
                                agentCapacityReached
                              }
                              onClick={() => void startRun(prompt)}
                            >
                              <ArrowUp />
                            </InputGroupButton>
                          </>
                        )}
                      </div>
                    </InputGroupAddon>
                  </InputGroup>
                </PopoverAnchor>
                <PopoverContent
                  align='start'
                  side='top'
                  className='w-[var(--radix-popover-trigger-width)] p-0'
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  onCloseAutoFocus={(event) => event.preventDefault()}
                  data-testid={skillMentionOpen ? 'agent-skill-mention-menu' : 'agent-slash-menu'}
                >
                  {skillMentionOpen ? (
                    <SkillMentionMenu
                      candidates={skillMentionCandidates}
                      selectedId={selectedSkillMention?.skillId}
                      onSelectedIdChange={(id) => {
                        const index = skillMentionSelectableCandidates.findIndex(
                          (candidate) => candidate.skillId === id
                        )
                        if (index >= 0) setSkillMentionSelectionIndex(index)
                      }}
                      onSelect={insertSkillMention}
                    />
                  ) : (
                    <ComposerCommandMenu
                      commands={slashCommands}
                      selectedId={selectedSlashCommand?.id}
                      onSelectedIdChange={(id) => {
                        const index = slashSelectableCommands.findIndex(
                          (command) => command.id === id
                        )
                        if (index >= 0) setSlashSelectionIndex(index)
                      }}
                      onSelect={(command) => runComposerCommand(command, true)}
                    />
                  )}
                </PopoverContent>
              </Popover>
            </Field>
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
        contextSnapshot={contextSnapshot}
        availableModelPresets={availableModelPresets}
        modelSelection={modelSelection}
        thinkingLevel={
          activeSession?.thinkingLevel ?? providerCatalog.defaultThinkingLevel ?? 'medium'
        }
        supportedThinkingLevels={supportedThinkingLevels}
        modelReady={modelReady}
        busy={busy || conversationLocked || activeRun !== null}
        onModelSelect={setModelSelection}
        onThinkingSelect={setThinkingLevel}
        onApprovalModeSelect={setApprovalMode}
      />
      <WritingTaskDialog
        open={taskEditorOpen}
        onOpenChange={setTaskEditorOpen}
        task={activeSession?.writingTask ?? null}
        busy={busy}
        onSave={reviseWritingTask}
      />
      <AlertDialog open={compactionConfirmOpen} onOpenChange={setCompactionConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Summarize earlier conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              This creates an AI-generated, lossy context checkpoint for future replies. Original
              conversation events are kept and remain available in the timeline.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={() => void compactSession()}>
              {busy ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <ListCollapse data-icon='inline-start' />
              )}
              Summarize
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AgentAttentionDock(props: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section
      aria-label={props.label}
      className='min-w-0 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-200'
      data-testid='agent-attention-dock'
    >
      {props.children}
    </section>
  )
}

function AgentQuestionnaireDock(props: {
  pending: AgentPendingQuestion
  busy: boolean
  onSubmit(answers: AskUserAnswer[]): Promise<void>
  onStop(): Promise<void>
}): React.JSX.Element {
  const items = props.pending.questions.map((question) => ({
    name: question.id,
    required: true,
    choices: question.options.map((option) => ({ value: option.label }))
  }))
  const firstQuestion = props.pending.questions[0]
  if (firstQuestion === undefined) throw new Error('Agent clarification has no questions')

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (props.busy) return
    const formData = new FormData(event.currentTarget)
    const answers = props.pending.questions.flatMap((question): AskUserAnswer[] => {
      const raw = formData.get(question.id)
      if (typeof raw !== 'string' || raw.trim().length === 0) return []
      const value = raw.trim()
      return [
        {
          questionId: question.id,
          kind: question.options.some((option) => option.label === value) ? 'option' : 'custom',
          value
        }
      ]
    })
    if (answers.length !== props.pending.questions.length) return
    void props.onSubmit(answers)
  }

  return (
    <section
      className='min-w-0 rounded-lg border bg-background p-3 shadow-xs'
      aria-label='Agent clarification'
      data-testid='agent-questionnaire'
    >
      <Questionnaire
        defaultItem={firstQuestion.id}
        items={items}
        shortcuts='letters'
        onSubmit={submit}
      >
        <div className='flex min-w-0 items-center justify-between gap-3'>
          <Badge variant='secondary'>Your input is needed</Badge>
          <QuestionnaireProgress
            render={(progressProps, state) => (
              <span {...progressProps}>
                Question {state.current} of {state.total}
              </span>
            )}
          />
        </div>
        {props.pending.questions.map((question) => (
          <QuestionnaireItem key={question.id} name={question.id} required>
            <div className='flex min-w-0 flex-col gap-1'>
              <Badge variant='outline' className='w-fit max-w-full truncate'>
                {question.header}
              </Badge>
              <QuestionnaireTitle className='wrap-anywhere'>{question.question}</QuestionnaireTitle>
              <QuestionnaireDescription>
                Choose one option or type your own answer.
              </QuestionnaireDescription>
            </div>
            <QuestionnaireChoices>
              {question.options.map((option) => (
                <QuestionnaireChoice key={option.label} value={option.label} disabled={props.busy}>
                  <span className='wrap-anywhere font-medium'>{option.label}</span>
                  <QuestionnaireChoiceDescription className='wrap-anywhere'>
                    {option.description}
                  </QuestionnaireChoiceDescription>
                </QuestionnaireChoice>
              ))}
              <QuestionnaireInput
                aria-label={`Another answer for ${question.header}`}
                placeholder='Type another answer…'
                maxLength={4_096}
                disabled={props.busy}
              />
            </QuestionnaireChoices>
            <QuestionnaireError>Choose an option or enter an answer.</QuestionnaireError>
          </QuestionnaireItem>
        ))}
        <QuestionnaireActions className='grid-cols-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]'>
          <QuestionnairePrevious disabled={props.busy} />
          <Button
            type='button'
            variant='outline'
            className='col-span-2 col-start-1 row-start-2 min-h-11 justify-self-start sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:min-h-0 sm:justify-self-end'
            disabled={props.busy}
            onClick={() => void props.onStop()}
          >
            {props.busy ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <CircleStop data-icon='inline-start' />
            )}
            Stop
          </Button>
          <QuestionnaireNext className='col-start-2 sm:col-start-3' disabled={props.busy} />
          <QuestionnaireSubmit className='col-start-2 sm:col-start-3' disabled={props.busy}>
            {props.busy ? <Spinner data-icon='inline-start' /> : <Check data-icon='inline-start' />}
            Answer
          </QuestionnaireSubmit>
        </QuestionnaireActions>
      </Questionnaire>
    </section>
  )
}

type AgentSidebarWorkflowState = AgentSessionRecord['workflowState']

function ConversationStatusIcon(props: {
  workflowState: AgentSidebarWorkflowState
  thinkingVisualState: AgentThinkingVisualState
  archived?: boolean
}): React.JSX.Element {
  if (props.archived) return <Archive className='mt-1 size-4 shrink-0 text-muted-foreground' />
  if (
    props.workflowState === 'running' ||
    props.workflowState === 'compacting' ||
    props.workflowState === 'generating'
  ) {
    return <AgentThinkingIndicator state={props.thinkingVisualState} />
  }
  if (props.workflowState === 'awaiting_input') {
    return <CircleHelp className='mt-1 size-4 shrink-0 text-warning' />
  }
  if (props.workflowState === 'awaiting_review') {
    return <AlertCircle className='mt-1 size-4 shrink-0 text-warning' />
  }
  return <Bot className='mt-1 size-4 shrink-0 text-muted-foreground' />
}

function ConversationSwitcher(props: {
  open: boolean
  onOpenChange(open: boolean): void
  sessions: AgentSessionRecord[]
  activeSession: AgentSessionRecord | null
  titleGeneratingIds: ReadonlySet<string>
  busy: boolean
  status: string
  workflowState: AgentSidebarWorkflowState
  thinkingVisualState: AgentThinkingVisualState
  onNew(): void
  onOpen(agentSessionId: string): void
  onArchive(session: AgentSessionRecord): Promise<void>
  onRestore(session: AgentSessionRecord): Promise<void>
  onRegenerateTitle(session: AgentSessionRecord): Promise<void>
}): React.JSX.Element {
  const groups = groupAgentConversations(props.sessions)
  return (
    <Popover open={props.open} onOpenChange={props.onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='ghost'
          className='h-auto min-h-10 min-w-0 justify-start gap-2 px-2 py-1 text-left'
          data-testid='agent-conversation-switcher'
        >
          <ConversationStatusIcon
            workflowState={props.workflowState}
            thinkingVisualState={props.thinkingVisualState}
            archived={props.activeSession?.status === 'archived'}
          />
          <span className='min-w-0 flex-1'>
            <span className='block truncate font-semibold'>
              {props.activeSession?.title ?? 'New conversation'}
            </span>
            <span
              className='block truncate text-xs font-normal text-muted-foreground'
              data-testid='agent-status'
              role='status'
              aria-live='polite'
            >
              {props.status}
            </span>
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
              heading='Needs an answer'
              sessions={groups.needsInput}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
            <ConversationCommandGroup
              heading='Needs review'
              sessions={groups.needsReview}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
            <ConversationCommandGroup
              heading='Working'
              sessions={groups.working}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
            <ConversationCommandGroup
              heading='Recent'
              sessions={groups.recent}
              busy={props.busy}
              titleGeneratingIds={props.titleGeneratingIds}
              onOpen={props.onOpen}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
              onRegenerateTitle={props.onRegenerateTitle}
            />
            <ConversationCommandGroup
              heading='Archived'
              sessions={groups.archived}
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
            {session.workflowState === 'running' ||
            session.workflowState === 'generating' ||
            session.workflowState === 'compacting' ? (
              <Spinner />
            ) : session.workflowState === 'awaiting_input' ? (
              <CircleHelp className='text-warning' />
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

type ComposerCommand = {
  id: string
  group: 'Context'
  label: string
  description: string
  disabled: boolean
  selected: boolean
  action: { kind: 'scope'; value: 'auto' | AgentStartScope }
}

function ComposerContextChips(props: {
  scopePreference: 'auto' | AgentStartScope
  skillMentions: readonly LeadingSkillMention[]
  annotationCount: number
  disabled: boolean
  onScopeClick(): void
  onSkillClick(mention: LeadingSkillMention): void
  onClearAnnotations(): void
}): React.JSX.Element | null {
  const scopeLabel =
    props.scopePreference === 'selection'
      ? 'Selected text'
      : props.scopePreference === 'section'
        ? 'This section'
        : props.scopePreference === 'project'
          ? 'Whole manuscript'
          : null
  if (scopeLabel === null && props.skillMentions.length === 0 && props.annotationCount === 0) {
    return null
  }
  return (
    <fieldset
      className='m-0 flex min-w-0 flex-wrap items-center gap-1.5 border-0 p-0'
      data-testid='agent-composer-context-chips'
      aria-label='Prompt context'
    >
      {scopeLabel === null ? null : (
        <Button
          type='button'
          variant='secondary'
          size='xs'
          className='h-6 max-w-full rounded-full px-2 text-xs'
          disabled={props.disabled}
          onClick={props.onScopeClick}
        >
          <TextCursorInput />
          <span className='truncate'>{scopeLabel}</span>
        </Button>
      )}
      {props.skillMentions.map((mention) => (
        <Button
          key={`${mention.start}-${mention.name}`}
          type='button'
          variant='secondary'
          size='xs'
          className='h-6 max-w-full rounded-full px-2 font-mono text-xs'
          onClick={() => props.onSkillClick(mention)}
        >
          <span className='truncate'>${mention.name}</span>
        </Button>
      ))}
      {props.annotationCount > 0 ? (
        <Button
          type='button'
          variant='secondary'
          size='xs'
          className='h-6 max-w-full rounded-full px-2 text-xs'
          aria-label={`Remove ${props.annotationCount} selected annotations`}
          onClick={props.onClearAnnotations}
        >
          <span className='truncate'>{props.annotationCount} annotations</span>
          <X />
        </Button>
      ) : null}
    </fieldset>
  )
}

export function buildComposerCommands(input: {
  selectionAvailable: boolean
  sectionAvailable: boolean
  scopePreference: 'auto' | AgentStartScope
}): ComposerCommand[] {
  return [
    {
      id: 'scope-auto',
      group: 'Context',
      label: 'Auto context',
      description: 'Use selected text, this section, or the manuscript as available',
      disabled: false,
      selected: input.scopePreference === 'auto',
      action: { kind: 'scope', value: 'auto' }
    },
    {
      id: 'scope-selection',
      group: 'Context',
      label: 'Selected text',
      description: 'Use the current editor selection',
      disabled: !input.selectionAvailable,
      selected: input.scopePreference === 'selection',
      action: { kind: 'scope', value: 'selection' }
    },
    {
      id: 'scope-section',
      group: 'Context',
      label: 'This section',
      description: 'Use the active manuscript section',
      disabled: !input.sectionAvailable,
      selected: input.scopePreference === 'section',
      action: { kind: 'scope', value: 'section' }
    },
    {
      id: 'scope-project',
      group: 'Context',
      label: 'Whole manuscript',
      description: 'Let the Agent inspect the full manuscript through bounded tools',
      disabled: false,
      selected: input.scopePreference === 'project',
      action: { kind: 'scope', value: 'project' }
    }
  ]
}

export function slashCommandQuery(prompt: string): string | null {
  if (!prompt.startsWith('/') || /\s/u.test(prompt)) return null
  return prompt.slice(1)
}

export function filterComposerCommands(
  commands: readonly ComposerCommand[],
  query: string
): ComposerCommand[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized.length === 0) return [...commands]
  return commands
    .map((command, index) => ({
      command,
      index,
      score: composerCommandMatchScore(command, normalized)
    }))
    .filter((match) => match.score !== null)
    .sort((left, right) => (left.score ?? 0) - (right.score ?? 0) || left.index - right.index)
    .map((match) => match.command)
}

function composerCommandMatchScore(command: ComposerCommand, query: string): number | null {
  const label = command.label.toLocaleLowerCase()
  const description = command.description.toLocaleLowerCase()
  if (label === query) return 0
  if (label.startsWith(query)) return 1
  if (label.split(/\s+/u).some((word) => word.startsWith(query))) return 2
  if (label.includes(query)) return 3
  if (description.includes(query)) return 4
  return null
}

function ComposerCommandMenu(props: {
  commands: ComposerCommand[]
  selectedId?: string
  onSelectedIdChange?(id: string): void
  onSelect(command: ComposerCommand): void
}): React.JSX.Element {
  const groups = ['Context'] as const
  return (
    <Command value={props.selectedId} onValueChange={props.onSelectedIdChange}>
      <CommandList>
        <CommandEmpty>No matching action.</CommandEmpty>
        {groups.map((group) => {
          const commands = props.commands.filter((command) => command.group === group)
          if (commands.length === 0) return null
          return (
            <CommandGroup key={group} heading={group}>
              {commands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={command.id}
                  disabled={command.disabled}
                  onSelect={() => props.onSelect(command)}
                >
                  <ComposerCommandIcon command={command} />
                  <span className='min-w-0 flex-1'>
                    <span className='block truncate'>{command.label}</span>
                    <span className='block truncate text-xs text-muted-foreground'>
                      {command.description}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )
        })}
      </CommandList>
    </Command>
  )
}

function ComposerCommandIcon(props: { command: ComposerCommand }): React.JSX.Element {
  if (props.command.selected) return <Check />
  const action = props.command.action
  if (action.value === 'selection') return <TextCursorInput />
  if (action.value === 'section') return <FilePenLine />
  if (action.value === 'project') return <FolderOpen />
  return <Bot />
}

export interface SkillMentionCandidate {
  skillId: string
  name: string
  displayName: string
  description: string
  disabled: boolean
}

export function buildSkillMentionCandidates(input: {
  installed: readonly InstalledSkill[]
  prompt: string
  query: string
  queryStart?: number
}): SkillMentionCandidate[] {
  const mentioned = new Set(
    parseLeadingSkillMentions(input.prompt)
      .filter((mention) => mention.end <= (input.queryStart ?? input.prompt.length))
      .map((mention) => mention.name)
  )
  if (mentioned.size >= 4) return []
  const byName = new Map<string, InstalledSkill[]>()
  for (const skill of input.installed) {
    const group = byName.get(skill.name) ?? []
    group.push(skill)
    byName.set(skill.name, group)
  }
  const normalizedQuery = input.query.toLocaleLowerCase()
  return [...byName.entries()]
    .flatMap(([name, skills]): SkillMentionCandidate[] => {
      if (mentioned.has(name)) return []
      const loadable = skills.filter((skill) => skill.enabled && skill.integrityStatus === 'ready')
      if (loadable.length === 0) return []
      if (loadable.length > 1) {
        return [
          {
            skillId: `ambiguous:${name}`,
            name,
            displayName: name,
            description: `Name is shared by ${loadable.length} available Skills; resolve it in Settings.`,
            disabled: true
          }
        ]
      }
      const skill = loadable[0]
      if (skill === undefined) return []
      return [
        {
          skillId: skill.skillId,
          name: skill.name,
          displayName: skill.displayName,
          description: skill.description,
          disabled: false
        }
      ]
    })
    .map((candidate) => ({
      candidate,
      score: skillMentionMatchScore(candidate, normalizedQuery)
    }))
    .filter((match) => match.score !== null)
    .sort(
      (left, right) =>
        (left.score ?? 0) - (right.score ?? 0) ||
        left.candidate.name.localeCompare(right.candidate.name) ||
        left.candidate.skillId.localeCompare(right.candidate.skillId)
    )
    .map((match) => match.candidate)
}

function skillMentionMatchScore(candidate: SkillMentionCandidate, query: string): number | null {
  if (query.length === 0) return 0
  const name = candidate.name.toLocaleLowerCase()
  const displayName = candidate.displayName.toLocaleLowerCase()
  const description = candidate.description.toLocaleLowerCase()
  if (name === query) return 0
  if (name.startsWith(query)) return 1
  if (displayName.startsWith(query)) return 2
  if (name.includes(query) || displayName.includes(query)) return 3
  if (description.includes(query)) return 4
  return null
}

function SkillMentionMenu(props: {
  candidates: SkillMentionCandidate[]
  selectedId?: string
  onSelectedIdChange(id: string): void
  onSelect(candidate: SkillMentionCandidate): void
}): React.JSX.Element {
  return (
    <Command value={props.selectedId} onValueChange={props.onSelectedIdChange}>
      <CommandList>
        <CommandEmpty>No matching enabled Writing Skill.</CommandEmpty>
        <CommandGroup heading='Writing Skills'>
          {props.candidates.map((candidate) => (
            <CommandItem
              key={candidate.skillId}
              value={candidate.skillId}
              disabled={candidate.disabled}
              onSelect={() => props.onSelect(candidate)}
            >
              <BookOpen />
              <span className='min-w-0 flex-1'>
                <span className='flex min-w-0 items-baseline gap-2'>
                  <code className='shrink-0 text-xs'>${candidate.name}</code>
                  {candidate.displayName !== candidate.name ? (
                    <span className='truncate text-xs text-muted-foreground'>
                      {candidate.displayName}
                    </span>
                  ) : null}
                </span>
                <span className='block truncate text-xs text-muted-foreground'>
                  {candidate.description}
                </span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

function ApprovalModePicker(props: {
  value: AgentApprovalMode
  disabled: boolean
  onSelect(mode: AgentApprovalMode): void | Promise<void>
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <InputGroupButton
          variant='ghost'
          size='xs'
          className='shrink-0'
          disabled={props.disabled}
          aria-label={`Approval policy: ${approvalModeLabel(props.value)}`}
          data-testid='agent-approval-selector'
        >
          <span>{approvalModeLabel(props.value)}</span>
          <ChevronDown />
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' side='top'>
        <DropdownMenuRadioGroup
          value={props.value}
          onValueChange={(value) => void props.onSelect(agentApprovalModeSchema.parse(value))}
        >
          {(['manual', 'section_auto', 'yolo'] as const).map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode} className='items-start'>
              <span className='min-w-0 pr-4'>
                <span className='block'>{approvalModeLabel(mode)}</span>
                <span className='block text-xs text-muted-foreground'>
                  {approvalModeDescription(mode)}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
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

interface WritingTaskDraftStep {
  key: string
  stepId?: string
  title: string
  status: WritingTaskStepStatus
  statusReason: string | null
}

function WritingTaskDialog(props: {
  open: boolean
  onOpenChange(open: boolean): void
  task: WritingTaskView | null
  busy: boolean
  onSave(input: {
    taskId: string
    expectedPlanVersion: number
    objective: string
    steps: WritingTaskDraftStep[]
  }): Promise<void>
}): React.JSX.Element {
  const [objective, setObjective] = useState('')
  const [steps, setSteps] = useState<WritingTaskDraftStep[]>([])

  useEffect(() => {
    if (!props.open || props.task === null) return
    setObjective(props.task.objective)
    setSteps(
      props.task.plan.steps.map((step) => ({
        key: step.stepId,
        stepId: step.stepId,
        title: step.title,
        status: step.status,
        statusReason: step.statusReason
      }))
    )
  }, [props.open, props.task])

  const validation = writingTaskDraftValidation(objective, steps)
  const updateStep = (key: string, update: Partial<WritingTaskDraftStep>): void => {
    setSteps((current) =>
      current.map((step) => {
        if (step.key !== key) return step
        const next = { ...step, ...update }
        if (next.status !== 'blocked' && next.status !== 'skipped') next.statusReason = null
        return next
      })
    )
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className='max-h-[min(85vh,48rem)] sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Revise writing task</DialogTitle>
          <DialogDescription>
            Update collaboration steps while the conversation is idle. Manuscript and proposal
            outcomes remain authoritative.
          </DialogDescription>
        </DialogHeader>
        <div className='flex min-h-0 flex-col gap-5 overflow-y-auto px-1 py-1'>
          <Field>
            <FieldLabel htmlFor='writing-task-objective'>Objective</FieldLabel>
            <Textarea
              id='writing-task-objective'
              value={objective}
              maxLength={4_096}
              rows={3}
              disabled={props.busy}
              onChange={(event) => setObjective(event.target.value)}
            />
            <FieldDescription>
              Describe the single outcome this conversation is pursuing.
            </FieldDescription>
          </Field>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center justify-between gap-3'>
              <h3 className='text-sm font-medium'>Plan steps</h3>
              <Button
                type='button'
                size='sm'
                variant='outline'
                disabled={props.busy || steps.length >= MAX_WRITING_TASK_STEPS}
                onClick={() =>
                  setSteps((current) => [
                    ...current,
                    {
                      key: `new-${current.filter((step) => step.stepId === undefined).length + 1}`,
                      title: '',
                      status: current.some((step) => step.status === 'active')
                        ? 'pending'
                        : 'active',
                      statusReason: null
                    }
                  ])
                }
              >
                <Plus data-icon='inline-start' /> Add step
              </Button>
            </div>
            <ol className='flex flex-col gap-4'>
              {steps.map((step, index) => {
                const immutable =
                  step.stepId !== undefined &&
                  (props.task?.plan.steps.find((candidate) => candidate.stepId === step.stepId)
                    ?.status === 'completed' ||
                    props.task?.plan.steps.find((candidate) => candidate.stepId === step.stepId)
                      ?.status === 'skipped')
                const statuses = allowedUserStepStatuses(step, props.task)
                return (
                  <li key={step.key} className='grid min-w-0 gap-3 sm:grid-cols-[1fr_10rem]'>
                    <Field>
                      <FieldLabel htmlFor={`writing-task-step-${step.key}`}>
                        Step {index + 1}
                      </FieldLabel>
                      <Input
                        id={`writing-task-step-${step.key}`}
                        value={step.title}
                        maxLength={500}
                        disabled={props.busy || immutable}
                        onChange={(event) => updateStep(step.key, { title: event.target.value })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Status</FieldLabel>
                      <Select
                        value={step.status}
                        disabled={props.busy || statuses.length === 1}
                        onValueChange={(value) =>
                          updateStep(step.key, { status: value as WritingTaskStepStatus })
                        }
                      >
                        <SelectTrigger aria-label={`Status for step ${index + 1}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {statuses.map((status) => (
                            <SelectItem key={status} value={status}>
                              {writingTaskProgressLabel(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    {step.status === 'blocked' || step.status === 'skipped' ? (
                      <Field className='sm:col-span-2'>
                        <FieldLabel htmlFor={`writing-task-reason-${step.key}`}>
                          {step.status === 'blocked' ? 'Blocker' : 'Reason for skipping'}
                        </FieldLabel>
                        <Textarea
                          id={`writing-task-reason-${step.key}`}
                          value={step.statusReason ?? ''}
                          maxLength={2_000}
                          rows={2}
                          disabled={props.busy}
                          onChange={(event) =>
                            updateStep(step.key, { statusReason: event.target.value })
                          }
                        />
                      </Field>
                    ) : null}
                  </li>
                )
              })}
            </ol>
          </div>
          {validation !== null ? (
            <Alert variant='destructive'>
              <TriangleAlert />
              <AlertTitle>Plan needs attention</AlertTitle>
              <AlertDescription>{validation}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter showCloseButton>
          <Button
            disabled={props.busy || props.task === null || validation !== null}
            onClick={() => {
              if (props.task === null || validation !== null) return
              void props.onSave({
                taskId: props.task.taskId,
                expectedPlanVersion: props.task.planVersion,
                objective: objective.trim(),
                steps: steps.map((step) => ({
                  ...step,
                  title: step.title.trim(),
                  statusReason: step.statusReason?.trim() || null
                }))
              })
            }}
          >
            {props.busy ? <Spinner data-icon='inline-start' /> : <Check data-icon='inline-start' />}
            Save plan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function writingTaskDraftValidation(
  objective: string,
  steps: WritingTaskDraftStep[]
): string | null {
  if (objective.trim().length === 0) return 'Add a task objective.'
  if (steps.length === 0) return 'Add at least one plan step.'
  if (steps.some((step) => step.title.trim().length === 0)) return 'Every step needs a title.'
  if (
    steps.some(
      (step) =>
        (step.status === 'blocked' || step.status === 'skipped') &&
        (step.statusReason === null || step.statusReason.trim().length === 0)
    )
  ) {
    return 'Blocked and skipped steps need a reason.'
  }
  const activeCount = steps.filter((step) => step.status === 'active').length
  if (activeCount > 1) return 'Only one step can be active.'
  if (steps.some((step) => step.status === 'pending') && activeCount !== 1) {
    return 'Choose one active step while pending work remains.'
  }
  return null
}

function allowedUserStepStatuses(
  step: WritingTaskDraftStep,
  task: WritingTaskView | null
): WritingTaskStepStatus[] {
  if (step.stepId === undefined) return ['pending', 'active']
  const original = task?.plan.steps.find((candidate) => candidate.stepId === step.stepId)?.status
  const allowed: Record<WritingTaskStepStatus, WritingTaskStepStatus[]> = {
    pending: ['pending', 'active', 'skipped', 'blocked'],
    active: ['active', 'completed', 'skipped', 'blocked'],
    completed: ['completed'],
    skipped: ['skipped'],
    blocked: ['blocked', 'active', 'skipped']
  }
  return allowed[original ?? step.status]
}

function writingTaskProgressLabel(state: WritingTaskProgressState | WritingTaskStepStatus): string {
  const labels: Record<WritingTaskProgressState | WritingTaskStepStatus, string> = {
    pending: 'Pending',
    active: 'Active',
    completed: 'Completed',
    skipped: 'Skipped',
    blocked: 'Blocked',
    ready: 'Ready',
    in_progress: 'In progress',
    awaiting_review: 'Review',
    verified_complete: 'Verified',
    reported_complete: 'Reported',
    stopped: 'Stopped',
    failed: 'Failed',
    disagreement: 'Needs reconciliation'
  }
  return labels[state]
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
  contextSnapshot: ReturnType<typeof latestAgentContextSnapshot>
  availableModelPresets: AgentProviderCatalog['presets']
  modelSelection: AgentModelSelection | null
  thinkingLevel: AgentThinkingLevel
  supportedThinkingLevels: AgentThinkingLevel[]
  modelReady: boolean
  busy: boolean
  onModelSelect(selection: AgentModelSelection): Promise<void>
  onThinkingSelect(level: AgentThinkingLevel): Promise<void>
  onApprovalModeSelect(mode: AgentApprovalMode): Promise<void>
}): React.JSX.Element {
  const timeline = useMemo(
    () =>
      projectAgentTimeline(props.events, props.proposals, props.latestRun ? [props.latestRun] : []),
    [props.events, props.latestRun, props.proposals]
  )
  const tools = timeline.flatMap((item) =>
    item.type === 'activity'
      ? item.tools
      : item.type === 'proposal' || item.type === 'question'
        ? [item.tool]
        : []
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
          <SkillsUsedDetails run={run} />
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
            {props.contextSnapshot ? (
              <div className='grid gap-2 text-xs text-muted-foreground'>
                <div className='flex justify-between gap-3'>
                  <span>Context</span>
                  <span className='tabular-nums'>
                    {props.contextSnapshot.estimated ? '~' : ''}
                    {props.contextSnapshot.used.toLocaleString()} /{' '}
                    {props.contextSnapshot.contextWindowTokens.toLocaleString()}
                  </span>
                </div>
                <Progress value={props.contextSnapshot.percent} />
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

function SkillsUsedDetails(props: { run: AgentRunRecord | null }): React.JSX.Element {
  const snapshot = props.run?.skillSnapshot ?? null
  if (snapshot === null) {
    return (
      <section className='grid gap-3' aria-labelledby='agent-skills-used-heading'>
        <h3 id='agent-skills-used-heading' className='text-sm font-semibold'>
          Skills used
        </h3>
        <p className='text-sm text-muted-foreground'>No run has been recorded yet.</p>
      </section>
    )
  }
  const provenance = [...snapshot.skills, ...snapshot.dependencies]
  const names = new Map(provenance.map((skill) => [skill.skillId, skill.displayName] as const))
  return (
    <section className='grid gap-3' aria-labelledby='agent-skills-used-heading'>
      <div className='flex items-center justify-between gap-3'>
        <h3 id='agent-skills-used-heading' className='text-sm font-semibold'>
          Skills used
        </h3>
        <Badge variant='outline'>
          {snapshot.requestedSkills.length > 0
            ? `${snapshot.requestedSkills.length} requested · ${snapshot.skills.length} loaded`
            : `${snapshot.skills.length} loaded`}
        </Badge>
      </div>
      {snapshot.skills.length > 0 ? (
        <ol className='grid gap-1.5 text-sm'>
          {snapshot.skills.map((skill, index) => (
            <li key={skill.skillId} className='flex min-w-0 items-center gap-2'>
              <Badge variant='secondary' className='w-6 justify-center tabular-nums'>
                {index + 1}
              </Badge>
              <span className='min-w-0 flex-1 truncate'>{skill.displayName}</span>
              <Badge variant='outline' className='shrink-0'>
                {skill.invocationSource === 'user' ? 'Requested' : 'Discovered'}
              </Badge>
              <code className='shrink-0 text-xs text-muted-foreground'>
                {skill.commit.slice(0, 8)}
              </code>
            </li>
          ))}
        </ol>
      ) : (
        <p className='text-sm text-muted-foreground'>No Writing Skill was loaded.</p>
      )}
      {snapshot.dependencies.length > 0 ? (
        <div className='grid gap-1.5'>
          <p className='text-xs font-medium text-muted-foreground'>Dependencies</p>
          <ul className='grid gap-1 text-sm'>
            {snapshot.dependencies.map((skill) => (
              <li key={skill.skillId} className='flex min-w-0 items-center justify-between gap-3'>
                <span className='min-w-0 truncate'>{skill.displayName}</span>
                <code className='shrink-0 text-xs text-muted-foreground'>
                  {skill.commit.slice(0, 8)}
                </code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {snapshot.resources.length > 0 ? (
        <div className='grid gap-1.5'>
          <p className='text-xs font-medium text-muted-foreground'>Retained references</p>
          <ul className='grid gap-1 text-sm'>
            {snapshot.resources.map((resource) => (
              <li
                key={`${resource.skillId}-${resource.commit}-${resource.relativePath}`}
                className='min-w-0 truncate'
                title={resource.relativePath}
              >
                <span>{names.get(resource.skillId) ?? humanizeSkillId(resource.skillId)}</span>
                <span className='text-muted-foreground'> · {resource.relativePath}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}

const CHANGE_SET_STATUSES: MutationProposalRecord['status'][] = [
  'pending',
  'generating',
  'approved',
  'applied',
  'satisfied',
  'superseded',
  'conflicted',
  'rejected',
  'failed',
  'undone'
]

function WritingTaskProgressDock(props: {
  task: WritingTaskView
  projectSessionId: string
  proposals: MutationProposalRecord[]
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  canControl: boolean
  busy: boolean
  onEdit(): void
  onResume(): Promise<void>
  onBatch(input: {
    taskId: string
    proposalIds: string[]
    action: 'apply' | 'reject'
    rejectReason: string | null
    createCheckpoint: boolean
  }): Promise<ChangeSetBatchResult>
}): React.JSX.Element {
  const needsAttention = writingTaskNeedsAttention(props.task)
  const [open, setOpen] = useState(needsAttention)
  const proposalNavigationRef = useRef<string | null>(null)
  const summary = writingTaskDockSummary(props.task)
  const titleId = `agent-writing-task-title-${props.task.taskId}`
  const currentProgress =
    props.task.progress.steps.find(
      (progress) => progress.stepId === props.task.progress.currentStepId
    ) ?? null
  const currentStep =
    props.task.plan.steps.find((step) => step.stepId === props.task.progress.currentStepId) ?? null

  useEffect(() => {
    if (needsAttention) setOpen(true)
  }, [needsAttention])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className='group/task shrink-0 border-t bg-muted/20'
      data-testid='agent-writing-task'
      data-attention={needsAttention ? 'true' : 'false'}
    >
      <CollapsibleTrigger asChild>
        <Button
          variant='ghost'
          className='h-auto min-h-11 w-full min-w-0 justify-start rounded-none px-4 py-2 text-left'
          aria-label={summary.ariaLabel}
          data-testid='agent-writing-task-trigger'
        >
          {props.task.progress.hasDisagreement ? (
            <TriangleAlert className='shrink-0 text-destructive' />
          ) : summary.complete ? (
            <CircleCheck className='shrink-0 text-success' />
          ) : currentProgress === null ? (
            <TriangleAlert className='shrink-0 text-warning' />
          ) : (
            <WritingTaskStateIcon state={currentProgress.state} inButton />
          )}
          <span className='min-w-0 flex-1'>
            <span className='block truncate text-sm font-medium'>
              {currentStep?.title ?? props.task.objective}
            </span>
            <span className='block truncate text-xs font-normal text-muted-foreground'>
              {summary.label} · {props.task.objective}
            </span>
          </span>
          <ChevronDown className='shrink-0 transition-transform group-data-[state=open]/task:rotate-180 motion-reduce:transition-none' />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        className='border-t bg-background'
        data-testid='agent-writing-task-details'
      >
        <div className='max-h-[min(38vh,24rem)] overflow-y-auto overscroll-contain'>
          <div className='flex min-w-0 items-start gap-2 px-4 py-3'>
            <div className='min-w-0 flex-1'>
              <h3 id={titleId} className='line-clamp-3 text-sm font-medium leading-snug'>
                {props.task.objective}
              </h3>
              <Badge variant='outline' className='mt-2'>
                Plan v{props.task.planVersion}
              </Badge>
            </div>
            <div className='flex shrink-0 items-center gap-1'>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Revise writing task plan'
                disabled={!props.canControl}
                onClick={() => {
                  props.onEdit()
                }}
              >
                <Pencil />
              </Button>
              <Button
                variant='ghost'
                size='icon-sm'
                aria-label='Resume writing task'
                disabled={!props.canControl || props.task.progress.currentStepId === null}
                onClick={() => {
                  void props.onResume()
                }}
              >
                <Play />
              </Button>
            </div>
          </div>
          <div>
            <section className='px-4 pb-3' aria-label='Plan steps'>
              <ol className='flex flex-col gap-2'>
                {props.task.plan.steps.map((step, index) => {
                  const progress = props.task.progress.steps.find(
                    (candidate) => candidate.stepId === step.stepId
                  )
                  const state = progress?.state ?? step.status
                  const current = props.task.progress.currentStepId === step.stepId
                  return (
                    <li
                      key={step.stepId}
                      className='flex min-w-0 items-start gap-2 text-sm'
                      aria-current={current ? 'step' : undefined}
                    >
                      <WritingTaskStateIcon state={state} />
                      <span className='min-w-0 flex-1'>
                        <span className='sr-only'>{writingTaskProgressLabel(state)}. </span>
                        <span className='line-clamp-2'>
                          {index + 1}. {step.title}
                        </span>
                        {step.statusReason !== null ? (
                          <span className='line-clamp-2 text-xs text-muted-foreground'>
                            {step.statusReason}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  )
                })}
              </ol>
              {props.task.progress.hasDisagreement ? (
                <p className='mt-3 flex items-start gap-1.5 text-xs text-destructive'>
                  <TriangleAlert className='mt-0.5 size-3.5 shrink-0' />
                  Plan status disagrees with a run or manuscript outcome. Revise or resume to
                  reconcile it.
                </p>
              ) : null}
            </section>
            <WritingTaskChangeSetPanel
              task={props.task}
              projectSessionId={props.projectSessionId}
              proposals={props.proposals}
              currentRevisionIds={props.currentRevisionIds}
              sectionTitles={props.sectionTitles}
              busy={props.busy}
              onBatch={props.onBatch}
              onNavigate={(proposalId) => {
                proposalNavigationRef.current = proposalId
                setOpen(false)
                requestAnimationFrame(() => {
                  const target = document.querySelector<HTMLElement>(
                    `[data-testid="agent-proposal-${proposalId}"]`
                  )
                  target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  target?.focus({ preventScroll: true })
                  proposalNavigationRef.current = null
                })
              }}
              onOverlayOpenChange={() => {}}
            />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function WritingTaskStateIcon(props: {
  state: WritingTaskProgressState | WritingTaskStepStatus
  inButton?: boolean
}): React.JSX.Element {
  const size = props.inButton ? undefined : 'size-4'
  if (props.state === 'in_progress') {
    return <Spinner className={cn('shrink-0', size)} aria-hidden='true' />
  }
  if (props.state === 'completed' || props.state === 'verified_complete') {
    return <CircleCheck className={cn('shrink-0 text-success', size)} aria-hidden='true' />
  }
  if (props.state === 'reported_complete' || props.state === 'ready' || props.state === 'active') {
    return (
      <CircleDotDashed className={cn('shrink-0 text-muted-foreground', size)} aria-hidden='true' />
    )
  }
  if (props.state === 'awaiting_review' || props.state === 'blocked' || props.state === 'stopped') {
    return <AlertCircle className={cn('shrink-0 text-warning', size)} aria-hidden='true' />
  }
  if (props.state === 'failed' || props.state === 'disagreement') {
    return <TriangleAlert className={cn('shrink-0 text-destructive', size)} aria-hidden='true' />
  }
  if (props.state === 'skipped') {
    return <CircleMinus className={cn('shrink-0 text-muted-foreground', size)} aria-hidden='true' />
  }
  return <Circle className={cn('shrink-0 text-muted-foreground', size)} aria-hidden='true' />
}

export function writingTaskDockSummary(task: WritingTaskView): {
  label: string
  ariaLabel: string
  complete: boolean
} {
  const total = task.plan.steps.length
  if (task.progress.remainingCount === 0) {
    return {
      label: 'Plan complete',
      ariaLabel: 'Writing task, plan complete, open details',
      complete: true
    }
  }
  const currentIndex = task.plan.steps.findIndex(
    (step) => step.stepId === task.progress.currentStepId
  )
  if (currentIndex >= 0) {
    return {
      label: `Step ${currentIndex + 1} / ${total}`,
      ariaLabel: `Writing task, Step ${currentIndex + 1} of ${total}, open details`,
      complete: false
    }
  }
  return {
    label: 'Plan needs attention',
    ariaLabel: 'Writing task, plan needs attention, open details',
    complete: false
  }
}

export function writingTaskNeedsAttention(task: WritingTaskView): boolean {
  if (task.progress.hasDisagreement) return true
  if (task.progress.remainingCount === 0) return false
  const current = task.progress.steps.find(
    (progress) => progress.stepId === task.progress.currentStepId
  )
  if (current === undefined) return true
  return (
    current.state === 'awaiting_review' ||
    current.state === 'blocked' ||
    current.state === 'stopped' ||
    current.state === 'failed' ||
    current.state === 'disagreement'
  )
}

function WritingTaskChangeSetPanel(props: {
  task: WritingTaskView
  projectSessionId: string
  proposals: MutationProposalRecord[]
  currentRevisionIds: Readonly<Record<string, string>>
  sectionTitles: Readonly<Record<string, string>>
  busy: boolean
  onBatch(input: {
    taskId: string
    proposalIds: string[]
    action: 'apply' | 'reject'
    rejectReason: string | null
    createCheckpoint: boolean
  }): Promise<ChangeSetBatchResult>
  onNavigate(proposalId: string): void
  onOverlayOpenChange(open: boolean): void
}): React.JSX.Element | null {
  const { resolvedTheme } = useTheme()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [createCheckpoint, setCreateCheckpoint] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [result, setResult] = useState<ChangeSetBatchResult | null>(null)
  const stepTitles = useMemo(
    () => Object.fromEntries(props.task.plan.steps.map((step) => [step.stepId, step.title])),
    [props.task.plan.steps]
  )
  const changeSet = useMemo(
    () =>
      buildWritingTaskChangeSet({
        taskId: props.task.taskId,
        proposals: props.proposals,
        currentRevisionIds: props.currentRevisionIds,
        sectionTitles: props.sectionTitles,
        stepTitles
      }),
    [props.currentRevisionIds, props.proposals, props.sectionTitles, props.task.taskId, stepTitles]
  )
  if (changeSet.proposalCount === 0) return null
  const selectableIds = changeSet.groups.flatMap((group) =>
    group.entries.flatMap((entry) =>
      entry.proposal.status === 'pending' ? [entry.proposal.proposalId] : []
    )
  )
  const selectedIds = selectableIds.filter((proposalId) => selected.has(proposalId))

  const runBatch = async (action: 'apply' | 'reject'): Promise<void> => {
    if (selectedIds.length === 0) return
    const next = await props.onBatch({
      taskId: props.task.taskId,
      proposalIds: selectedIds,
      action,
      rejectReason: action === 'reject' ? rejectReason.trim() : null,
      createCheckpoint: action === 'apply' && createCheckpoint
    })
    setResult(next)
    setSelected(new Set())
    if (action === 'reject') {
      setRejectOpen(false)
      props.onOverlayOpenChange(false)
      setRejectReason('')
    }
  }

  const navigateToProposal = (proposalId: string): void => {
    props.onNavigate(proposalId)
  }

  return (
    <Collapsible className='group/change-set border-t' data-testid='agent-writing-change-set'>
      <div className='flex min-h-11 items-center gap-2 px-3 py-2'>
        <CollapsibleTrigger className='flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
          <ChevronRight className='size-4 shrink-0 transition-transform group-data-[state=open]/change-set:rotate-90' />
          <span className='min-w-0 flex-1 truncate text-sm font-medium'>Task change set</span>
          <Badge variant='outline'>{changeSet.proposalCount}</Badge>
        </CollapsibleTrigger>
        {changeSet.staleCount > 0 ? (
          <Badge variant='warning'>{changeSet.staleCount} need refresh</Badge>
        ) : null}
      </div>
      <CollapsibleContent>
        <div className='flex flex-col gap-3 px-3 pb-3'>
          {selectableIds.length > 0 ? (
            <div className='flex flex-wrap items-center gap-2 border-b pb-3'>
              <Button
                size='sm'
                disabled={props.busy || selectedIds.length === 0}
                onClick={() => void runBatch('apply')}
              >
                <Check data-icon='inline-start' /> Apply selected
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={props.busy || selectedIds.length === 0}
                onClick={() => {
                  setRejectOpen(true)
                  props.onOverlayOpenChange(true)
                }}
              >
                <X data-icon='inline-start' /> Reject selected
              </Button>
              <span className='flex items-center gap-2 text-xs text-muted-foreground'>
                <Checkbox
                  aria-label='Create history checkpoint if available'
                  checked={createCheckpoint}
                  onCheckedChange={(checked) => setCreateCheckpoint(checked === true)}
                />
                Create history checkpoint if available
              </span>
              <span className='ml-auto text-xs text-muted-foreground'>
                {selectedIds.length} selected
              </span>
            </div>
          ) : null}
          {result === null ? null : (
            <Alert variant={result.status === 'completed' ? 'default' : 'destructive'}>
              {result.status === 'completed' ? <Check /> : <TriangleAlert />}
              <AlertTitle>
                {result.status === 'completed' ? 'Batch complete' : 'Batch partially complete'}
              </AlertTitle>
              <AlertDescription>
                {result.completedCount} processed · {result.remainingCount} not attempted ·{' '}
                {result.review.appliedCount} applied · {result.review.satisfiedCount} already
                satisfied · {result.review.rejectedCount} rejected
                {result.checkpointStatus === 'created' ? ' · checkpoint created' : ''}
                {result.checkpointStatus === 'unavailable'
                  ? ' · version history was unavailable'
                  : ''}
                {result.checkpointStatus === 'failed'
                  ? ' · checkpoint failed, so no proposal was attempted'
                  : ''}
              </AlertDescription>
            </Alert>
          )}
          <fieldset className='flex flex-wrap gap-1' aria-label='Proposal outcome summary'>
            {CHANGE_SET_STATUSES.flatMap((status) => {
              const count = changeSet.statusCounts[status] ?? 0
              return count === 0
                ? []
                : [
                    <Badge
                      key={status}
                      variant={status === 'conflicted' ? 'destructive' : 'outline'}
                    >
                      {status.replace('_', ' ')} {count}
                    </Badge>
                  ]
            })}
          </fieldset>
          {changeSet.groups.map((group) => (
            <section
              key={group.key}
              className='flex min-w-0 flex-col gap-2'
              aria-label={group.label}
            >
              <h4 className='text-xs font-medium text-muted-foreground'>{group.label}</h4>
              {group.entries.map((entry) => {
                const preview = entry.proposal.payload.preview
                return (
                  <Collapsible
                    key={entry.proposal.proposalId}
                    className='group/change rounded-md border px-3 py-2'
                    data-testid={`agent-change-set-proposal-${entry.proposal.proposalId}`}
                  >
                    <div className='flex min-w-0 items-start gap-2'>
                      {entry.proposal.status === 'pending' ? (
                        <Checkbox
                          className='mt-0.5'
                          aria-label={`Select ${preview.summary}`}
                          checked={selected.has(entry.proposal.proposalId)}
                          disabled={props.busy}
                          onCheckedChange={(checked) => {
                            setSelected((current) => {
                              const next = new Set(current)
                              if (checked === true) next.add(entry.proposal.proposalId)
                              else next.delete(entry.proposal.proposalId)
                              return next
                            })
                          }}
                        />
                      ) : null}
                      <CollapsibleTrigger className='flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'>
                        <ChevronRight className='mt-0.5 size-3.5 shrink-0 transition-transform group-data-[state=open]/change:rotate-90' />
                        <span className='min-w-0 flex-1'>
                          <span className='line-clamp-2 text-xs font-medium'>
                            {preview.summary}
                          </span>
                          {entry.stepTitle === null ? null : (
                            <span className='line-clamp-1 text-xs text-muted-foreground'>
                              {entry.stepTitle}
                            </span>
                          )}
                        </span>
                      </CollapsibleTrigger>
                      <Badge variant={entry.stale ? 'warning' : 'outline'}>
                        {entry.stale ? 'refresh required' : entry.proposal.status.replace('_', ' ')}
                      </Badge>
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={() => navigateToProposal(entry.reviewProposalId)}
                      >
                        Review
                      </Button>
                    </div>
                    <CollapsibleContent className='pt-3'>
                      <ProposalPresentation
                        proposal={entry.proposal}
                        projectSessionId={props.projectSessionId}
                        sectionTitles={props.sectionTitles}
                        dark={resolvedTheme === 'dark'}
                        compact
                      />
                    </CollapsibleContent>
                  </Collapsible>
                )
              })}
            </section>
          ))}
        </div>
      </CollapsibleContent>
      <Dialog
        open={rejectOpen}
        onOpenChange={(nextOpen) => {
          setRejectOpen(nextOpen)
          props.onOverlayOpenChange(nextOpen)
          if (!nextOpen) setRejectReason('')
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject selected proposals</DialogTitle>
            <DialogDescription>
              The same bounded reason is recorded on each selected proposal. Completed decisions are
              not rolled back if a later item fails.
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor='change-set-reject-reason'>Reason</FieldLabel>
            <Textarea
              id='change-set-reject-reason'
              value={rejectReason}
              maxLength={4_096}
              onChange={(event) => setRejectReason(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => {
                setRejectOpen(false)
                props.onOverlayOpenChange(false)
                setRejectReason('')
              }}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              disabled={props.busy || rejectReason.trim().length === 0}
              onClick={() => void runBatch('reject')}
            >
              Reject {selectedIds.length}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
  )
}

function EventTimeline(props: {
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
    return (
      <Alert variant='destructive' data-testid='agent-preflight-failure'>
        <AlertCircle />
        <AlertTitle>
          {item.failure.toolName} · {item.failure.code}
        </AlertTitle>
        <AlertDescription className='flex flex-col gap-1'>
          <span>{item.failure.message}</span>
          {item.failure.paths.length > 0 ? (
            <span className='font-mono text-xs'>{item.failure.paths.join(', ')}</span>
          ) : null}
          <span className='text-xs'>
            Failed before dispatch · {formatAgentDuration(item.failure.durationMs)}
          </span>
        </AlertDescription>
      </Alert>
    )
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
      defaultOpen={
        item.status === 'running' ||
        item.status === 'partial' ||
        item.status === 'error' ||
        item.status === 'stopped'
      }
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

function humanizeSkillId(skillId: string): string {
  const name = skillId.split(':').at(-1) ?? skillId
  return name
    .split('-')
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toLocaleUpperCase()}${part.slice(1)}`)
    .join(' ')
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
      selectedText: null,
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
      selectedText: null,
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
    selectedText: selection.selectedText ?? null,
    capturedAt: selection.capturedAt ?? Date.now(),
    capturedRevisionId: selection.capturedRevisionId ?? capturedRevisionId
  }
}

function deliveryLabel(delivery: 'prompt' | 'steer' | 'follow_up' | 'clarification'): string {
  if (delivery === 'steer') return 'Steered'
  if (delivery === 'follow_up') return 'Queued'
  if (delivery === 'clarification') return 'Clarified'
  return 'You'
}

function blockOperationDisplays(
  proposal: MutationProposalRecord
): Array<{ label: string; raw: string }> {
  if (proposal.payload.kind === 'generated_image_insert') {
    const iteration = proposal.payload.mutation.iteration
    return [
      {
        label:
          iteration === null
            ? `Generate ${proposal.payload.mutation.imageSize} image`
            : iteration.disposition === 'replace'
              ? `Generate ${proposal.payload.mutation.imageSize} replacement candidate`
              : `Generate ${proposal.payload.mutation.imageSize} candidate to insert`,
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

function approvalModeLabel(mode: AgentApprovalMode): string {
  if (mode === 'manual') return 'Manual'
  if (mode === 'section_auto') return 'Write Auto'
  return 'YOLO'
}

function approvalModeDescription(mode: AgentApprovalMode): string {
  if (mode === 'manual') return 'Review every proposed manuscript change'
  if (mode === 'section_auto') return 'Apply writing changes automatically; review Brief and rules'
  return 'Apply every proposed change automatically without review'
}

export function selectAttentionSession(active: AgentSessionRecord[]): AgentSessionRecord | null {
  return (
    active.find((session) => session.workflowState === 'awaiting_input') ??
    active.find(
      (session) => session.workflowState === 'running' || session.workflowState === 'compacting'
    ) ??
    active.find(
      (session) =>
        session.workflowState === 'generating' || session.workflowState === 'awaiting_review'
    ) ??
    active[0] ??
    null
  )
}

export function hasManualCompactionHead(events: readonly AgentEventRecord[]): boolean {
  let coveredThroughSequence = 0
  for (const event of events) {
    if (event.type !== 'compaction_summary') continue
    const checkpoint = agentCompactionSummaryPayloadSchema.safeParse(event.payload)
    if (checkpoint.success) {
      coveredThroughSequence = checkpoint.data.coveredThroughSequence
    }
  }
  return (
    events.filter(
      (event) =>
        event.sequence > coveredThroughSequence &&
        (event.type === 'run_completed' || event.type === 'run_interrupted')
    ).length >= 2
  )
}

export function sectionFollowTargetForAgentEvent(
  rendererEvent: AgentRendererEvent,
  activeSessionId: string | null
): string | null {
  if (
    activeSessionId === null ||
    rendererEvent.kind !== 'durable' ||
    rendererEvent.event.agentSessionId !== activeSessionId ||
    rendererEvent.event.type !== 'tool_call'
  ) {
    return null
  }
  const call = agentToolCallPayloadSchema.safeParse(rendererEvent.event.payload)
  if (!call.success) return null
  if (call.data.toolName === 'submit_section_change') {
    const args = modelSubmitSectionChangeArgsSchema.safeParse(call.data.args)
    return args.success ? args.data.sectionId : null
  }
  if (call.data.toolName === 'generate_image') {
    const args = generateImageArgsSchema.safeParse(call.data.args)
    if (args.success) return args.data.sectionId
    const legacy = normalizedGenerateImageArgsSchema.safeParse(call.data.args)
    return legacy.success ? legacy.data.sectionId : null
  }
  return null
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

export function agentComposerRunningAction(prompt: string): 'stop' | 'follow_up' {
  return prompt.trim().length === 0 ? 'stop' : 'follow_up'
}

function sessionStatusLabel(session: AgentSessionRecord): string {
  if (session.status === 'archived') return 'Archived'
  if (
    session.workflowState === 'running' ||
    session.workflowState === 'generating' ||
    session.workflowState === 'compacting'
  )
    return 'Working'
  if (session.workflowState === 'awaiting_input') return 'Needs answer'
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
