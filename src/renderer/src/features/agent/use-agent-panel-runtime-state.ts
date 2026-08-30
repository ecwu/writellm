import {
  MAX_CONCURRENT_AGENT_RUNS,
  type AgentEventRecord,
  type AgentLiveCompactionSnapshot,
  type AgentLiveRunSnapshot,
  type AgentRendererEvent,
  type AgentRunRecord,
  type AgentSessionRecord,
  type AgentStartScope
} from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { AgentProviderCatalog } from '../../../../shared/contracts/providers'
import type { SkillsSnapshot } from '../../../../shared/contracts/skills'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  applyAgentTerminalEvent,
  mergeAgentEvents,
  protectTerminalAgentRuns
} from './agent-view-model'
import {
  errorMessage,
  sectionFollowTargetForAgentEvent,
  selectAttentionSession,
  updateSet,
  upsertSession
} from './agent-panel-logic'
import type { AgentPanelProps } from './agent-panel'

export function useAgentPanelRuntimeState(props: AgentPanelProps) {
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
  const claimQuickAction = useCallback((requestId: string): boolean => {
    if (processedQuickActionIdsRef.current.has(requestId)) return false
    processedQuickActionIdsRef.current.add(requestId)
    return true
  }, [])
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

  return {
    sessions,
    setSessions,
    activeSessionId,
    setActiveSessionId,
    events,
    setEvents,
    runs,
    setRuns,
    proposals,
    setProposals,
    streamingBySession,
    activeRunLimit,
    setActiveRunIds,
    liveRuns,
    activeCompactions,
    activeWorkCount,
    compactionConfirmOpen,
    setCompactionConfirmOpen,
    prompt,
    setPrompt,
    scopePreference,
    setScopePreference,
    reviewFeedback,
    setReviewFeedback,
    composerAddOpen,
    setComposerAddOpen,
    slashMenuDismissed,
    setSlashMenuDismissed,
    slashSelectionIndex,
    setSlashSelectionIndex,
    skillMentionDismissed,
    setSkillMentionDismissed,
    skillMentionSelectionIndex,
    setSkillMentionSelectionIndex,
    composerCaret,
    setComposerCaret,
    waitingMessagesOpen,
    setWaitingMessagesOpen,
    sessionSwitcherOpen,
    setSessionSwitcherOpen,
    detailsOpen,
    setDetailsOpen,
    taskEditorOpen,
    setTaskEditorOpen,
    continuationFailure,
    setContinuationFailure,
    titleGeneratingIds,
    setTitleGeneratingIds,
    loading,
    busy,
    setBusy,
    pendingActionIds,
    setPendingActionIds,
    error,
    setError,
    claimQuickAction,
    providerCatalog,
    setProviderCatalog,
    skillsSnapshot,
    revisionTransitions,
    setRevisionTransitions,
    activeSessionIdRef,
    composerTextareaRef,
    pendingComposerCaretRef,
    terminalRunIdsRef,
    draftStateRef,
    promptRef,
    reviewFeedbackRef,
    scopePreferenceRef,
    refreshSessionTruth
  }
}

export type AgentPanelRuntimeState = ReturnType<typeof useAgentPanelRuntimeState>
