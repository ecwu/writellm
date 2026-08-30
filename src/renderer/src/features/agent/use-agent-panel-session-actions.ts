import type { AgentApprovalMode, AgentInteractionMode } from '../../../../shared/contracts/agent'
import type {
  AgentModelSelection,
  AgentThinkingLevel
} from '../../../../shared/contracts/providers'
import {
  errorMessage,
  hasManualCompactionHead,
  updateSet,
  upsertSession
} from './agent-panel-logic'
import type {
  AgentLiveCompactionSnapshot,
  AgentRunRecord,
  AgentSessionRecord
} from '../../../../shared/contracts/agent-ipc'
import type { AgentPanelProps } from './agent-panel'
import type { AgentPanelRuntimeState } from './use-agent-panel-runtime-state'

export function useAgentPanelSessionActions(input: {
  props: AgentPanelProps
  runtime: AgentPanelRuntimeState
  activeSession: AgentSessionRecord | null
  activeRun: AgentRunRecord | null
  activeCompaction: AgentLiveCompactionSnapshot | null
  activeSessionArchived: boolean
  conversationLocked: boolean
  workflowState: AgentSessionRecord['workflowState']
}) {
  const {
    props,
    activeSession,
    activeRun,
    activeCompaction,
    activeSessionArchived,
    conversationLocked,
    workflowState
  } = input
  const {
    activeRunLimit,
    activeWorkCount,
    activeSessionIdRef,
    draftStateRef,
    events,
    promptRef,
    reviewFeedbackRef,
    scopePreferenceRef,
    sessions,
    setActiveSessionId,
    setBusy,
    setCompactionConfirmOpen,
    setContinuationFailure,
    setError,
    setEvents,
    setProposals,
    setProviderCatalog,
    setRuns,
    setSessionSwitcherOpen,
    setSessions,
    setTitleGeneratingIds,
    titleGeneratingIds
  } = input.runtime

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
    void window.desktop.providers
      .snapshot()
      .then((snapshot) => setProviderCatalog(snapshot.agentCatalog))
      .catch((cause) => setError(errorMessage(cause)))
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

  const setInteractionMode = async (mode: AgentInteractionMode): Promise<void> => {
    if (activeSessionArchived || activeRun !== null || activeCompaction !== null) return
    setBusy(true)
    setError(null)
    try {
      const session = activeSession ?? (await createSession())
      const updated = await window.desktop.agent.setInteractionMode({
        projectSessionId: props.projectSessionId,
        agentSessionId: session.agentSessionId,
        mode
      })
      setSessions((current) => upsertSession(current, updated))
    } catch (cause) {
      setError(errorMessage(cause))
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

  return {
    createSession,
    beginNewConversation,
    setApprovalMode,
    setInteractionMode,
    setModelSelection,
    setThinkingLevel,
    openSession,
    regenerateTitle,
    archiveSession,
    compactSession,
    stopCompaction,
    canCompact,
    restoreSession
  }
}
