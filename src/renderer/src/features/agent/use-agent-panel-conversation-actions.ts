import type {
  AgentEventRecord,
  AgentRunRecord,
  AgentSessionRecord
} from '../../../../shared/contracts/agent-ipc'
import { agentUserMessagePayloadSchema } from '../../../../shared/contracts/agent'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { AgentStartScope } from '../../../../shared/contracts/agent-ipc'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { editorContextForScope, errorMessage } from './agent-panel-logic'
import type { AgentPanelProps } from './agent-panel'
import { reportRendererOperationError } from '../../diagnostics'

type RefreshSessionTruth = (
  agentSessionId: string
) => Promise<{ runs: AgentRunRecord[]; proposals: MutationProposalRecord[] }>

export function useAgentPanelConversationActions(input: {
  props: AgentPanelProps
  activeSession: AgentSessionRecord | null
  activeSessionId: string | null
  replayedSessionId: string | null
  events: AgentEventRecord[]
  activeSessionArchived: boolean
  scope: AgentStartScope
  loading: boolean
  busy: boolean
  setBusy: Dispatch<SetStateAction<boolean>>
  setError: Dispatch<SetStateAction<string | null>>
  setSessions: Dispatch<SetStateAction<AgentSessionRecord[]>>
  refreshSessionTruth: RefreshSessionTruth
  activeSessionIdRef: { current: string | null }
  composerTextareaRef: { current: HTMLTextAreaElement | null }
  openSession(agentSessionId: string): void
}) {
  const {
    props,
    activeSession,
    activeSessionId,
    replayedSessionId,
    events,
    activeSessionArchived,
    scope,
    loading,
    busy,
    setBusy,
    setError,
    setSessions,
    refreshSessionTruth,
    activeSessionIdRef,
    composerTextareaRef,
    openSession
  } = input
  const [forkBusy, setForkBusy] = useState(false)
  const forkInFlight = useRef(false)
  const forkOperationRef = useRef<string | null>(null)
  const forkRequests = useRef(new Map<string, string>())
  const editOperationRef = useRef<string | null>(null)
  const [forkFocus, setForkFocus] = useState<string | null>(null)
  const [sourceTarget, setSourceTarget] = useState<{ sessionId: string; eventId: string } | null>(
    null
  )
  const projectRef = useRef(props.projectSessionId)
  projectRef.current = props.projectSessionId

  useEffect(() => {
    if (!forkFocus || activeSessionId !== forkFocus || loading || busy) return
    const frame = requestAnimationFrame(() => {
      composerTextareaRef.current?.focus()
      setForkFocus(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [forkFocus, activeSessionId, loading, busy, composerTextareaRef])

  useEffect(() => {
    if (
      !sourceTarget ||
      activeSessionId !== sourceTarget.sessionId ||
      replayedSessionId !== sourceTarget.sessionId ||
      loading
    )
      return
    const frame = requestAnimationFrame(() => {
      const element = document.querySelector(
        `[data-event-id="${CSS.escape(sourceTarget.eventId)}"]`
      )
      if (element) {
        element.scrollIntoView({ block: 'center' })
        setSourceTarget(null)
      } else {
        setError('来源消息已被替换，当前显示来源会话。分支历史保持不变。')
        setSourceTarget(null)
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [sourceTarget, activeSessionId, replayedSessionId, loading, setError])

  const forkConversation = async (targetEventId: string): Promise<void> => {
    if (activeSessionId === null || forkInFlight.current) return
    const sourceSessionId = activeSessionId
    const projectSessionId = props.projectSessionId
    const key = `${projectSessionId}:${sourceSessionId}:${targetEventId}`
    const requestId = forkRequests.current.get(key) ?? crypto.randomUUID()
    const operationId = crypto.randomUUID()
    forkRequests.current.set(key, requestId)
    forkInFlight.current = true
    forkOperationRef.current = operationId
    setForkBusy(true)
    setError(null)
    try {
      const created = await window.desktop.agent.forkConversation({
        projectSessionId,
        sourceSessionId,
        targetEventId,
        requestId
      })
      if (projectRef.current !== projectSessionId) return
      forkRequests.current.delete(key)
      setSessions((current) => [
        created,
        ...current.filter((session) => session.agentSessionId !== created.agentSessionId)
      ])
      if (activeSessionIdRef.current === sourceSessionId) {
        openSession(created.agentSessionId)
        setForkFocus(created.agentSessionId)
      }
    } catch (cause) {
      reportRendererOperationError(cause, 'agent-panel.operation')
      if (projectRef.current === projectSessionId && activeSessionIdRef.current === sourceSessionId)
        setError(errorMessage(cause))
    } finally {
      if (forkOperationRef.current === operationId) {
        forkOperationRef.current = null
        forkInFlight.current = false
        setForkBusy(false)
      }
    }
  }

  const openForkSource = async (): Promise<void> => {
    if (!activeSession?.fork) return
    const projectSessionId = props.projectSessionId
    const activeSessionIdAtStart = activeSession.agentSessionId
    const source = activeSession.fork
    try {
      const session = await window.desktop.agent.getSession({
        projectSessionId,
        agentSessionId: source.sourceSessionId
      })
      if (
        projectRef.current !== projectSessionId ||
        activeSessionIdRef.current !== activeSessionIdAtStart
      )
        return
      setSessions((current) => [
        session,
        ...current.filter((item) => item.agentSessionId !== session.agentSessionId)
      ])
      setSourceTarget({ sessionId: source.sourceSessionId, eventId: source.targetEventId })
      openSession(source.sourceSessionId)
    } catch (cause) {
      reportRendererOperationError(cause, 'agent-panel.operation')
      if (
        projectRef.current === projectSessionId &&
        activeSessionIdRef.current === activeSessionIdAtStart
      )
        setError(errorMessage(cause))
    }
  }

  const editLastMessageAndRestart = async (
    targetEventId: string,
    content: string
  ): Promise<boolean> => {
    const edit = activeSession?.messageEdit
    if (
      activeSession === null ||
      busy ||
      activeSessionArchived ||
      edit == null ||
      edit.targetEventId !== targetEventId ||
      edit.reason !== null
    )
      return false
    const projectSessionId = props.projectSessionId
    const sessionId = activeSession.agentSessionId
    const operationId = crypto.randomUUID()
    editOperationRef.current = operationId
    const isCurrentOperation = (): boolean =>
      editOperationRef.current === operationId &&
      projectRef.current === projectSessionId &&
      activeSessionIdRef.current === sessionId
    setBusy(true)
    setError(null)
    try {
      if (!(await props.flushCurrent())) {
        if (isCurrentOperation()) setError('Save the active section before restarting the Agent.')
        return false
      }
      await window.desktop.agent.editLastMessageAndRestart({
        projectSessionId,
        agentSessionId: sessionId,
        targetEventId,
        expectedThroughSequence: edit.throughSequence,
        content,
        attachmentIds: agentUserMessagePayloadSchema.parse(
          events.find((event) => event.agentEventId === targetEventId)?.payload
        ).attachmentIds,
        editorContext: editorContextForScope(
          scope,
          props.activeSectionId,
          props.selection,
          props.currentRevisionIds
        )
      })
      await refreshSessionTruth(sessionId)
      return isCurrentOperation()
    } catch (cause) {
      reportRendererOperationError(cause, 'agent-panel.operation')
      if (isCurrentOperation()) setError(errorMessage(cause))
      return false
    } finally {
      if (editOperationRef.current === operationId) {
        editOperationRef.current = null
        if (projectRef.current === projectSessionId && activeSessionIdRef.current === sessionId)
          setBusy(false)
      }
    }
  }

  return {
    forkConversation,
    forkBusy,
    openForkSource,
    messageEdit: activeSession?.messageEdit ?? null,
    editLastMessageAndRestart
  }
}
