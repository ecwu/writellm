import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { AskUserAnswer } from '../../../../shared/contracts/agent-tools'
import type { AgentQuickActionRequest } from '../../../../shared/contracts/agent-quick-actions'
import { parseLeadingSkillMentions, skillMentionQueryAt } from '../../../../shared/skill-mentions'
import { useEffect, useMemo, useRef, useState } from 'react'
import { approveProposalAfterEditorFlush } from '../manuscript/agent-proposal-actions'
import { elapsedRunMs } from './agent-event-timeline'
import {
  aggregateAgentUsage,
  agentHeaderStatusLabel,
  agentThinkingVisualState,
  latestAgentContextSnapshot,
  protectTerminalAgentRuns,
  projectAgentPresentation
} from './agent-view-model'
import type { WritingTaskStepStatus } from '../../../../shared/contracts/writing-task'
import type { ChangeSetBatchResult } from '../../../../shared/contracts/agent-change-set'
import {
  buildComposerCommands,
  buildSlashCommands,
  buildSkillMentionCandidates,
  editorContextForScope,
  effectiveScope,
  errorMessage,
  filterComposerCommands,
  resolveSelectedModel,
  selectionAvailable,
  slashCommandQuery,
  type AgentPanelSelection,
  type ComposerCommand,
  type SkillMentionCandidate
} from './agent-panel-logic'
import type { AgentPanelProps } from './agent-panel'
import { useAgentPanelRuntimeState } from './use-agent-panel-runtime-state'
import { useAgentPanelSessionActions } from './use-agent-panel-session-actions'

export function useAgentPanelController(props: AgentPanelProps) {
  const runtime = useAgentPanelRuntimeState(props)
  const {
    sessions,
    setSessions,
    activeSessionId,
    events,
    runs,
    setRuns,
    proposals,
    setProposals,
    streamingBySession,
    liveRuns,
    activeCompactions,
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
    loading,
    busy,
    setBusy,
    pendingActionIds,
    setPendingActionIds,
    error,
    setError,
    claimQuickAction,
    providerCatalog,
    skillsSnapshot,
    revisionTransitions,
    setRevisionTransitions,
    composerTextareaRef,
    pendingComposerCaretRef,
    terminalRunIdsRef,
    refreshSessionTruth
  } = runtime

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
  const canControlTask =
    activeSession?.writingTask !== null &&
    activeSession?.writingTask !== undefined &&
    !activeSessionArchived &&
    workflowState === 'idle' &&
    !busy &&
    (activeSession?.interactionMode ?? 'write') === 'write'
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
  const effectiveRevisionIds = useMemo(() => {
    const result = { ...props.currentRevisionIds }
    for (const [sectionId, transition] of Object.entries(revisionTransitions)) {
      if (result[sectionId] === transition.from) result[sectionId] = transition.to
    }
    return result
  }, [props.currentRevisionIds, revisionTransitions])
  const presentation = useMemo(
    () =>
      projectAgentPresentation({
        events,
        proposals,
        runs,
        streaming,
        activeRunId: activeRun?.agentRunId ?? null,
        currentRevisionIds: effectiveRevisionIds,
        now: clockNow
      }),
    [clockNow, events, proposals, runs, streaming, activeRun?.agentRunId, effectiveRevisionIds]
  )
  const thinkingVisualState = agentThinkingVisualState({
    currentVisual: presentation.currentVisual,
    workflowState,
    choosingSkill,
    hasStreamingRun
  })
  const headerStatus = agentHeaderStatusLabel({
    archived: activeSessionArchived === true,
    workflowState,
    choosingSkill,
    currentActivity: presentation.currentActivity,
    hasStreamingRun,
    elapsedMs: elapsedRunMs(activeRun, clockNow)
  })

  const {
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
  } = useAgentPanelSessionActions({
    props,
    runtime,
    activeSession,
    activeRun,
    activeCompaction,
    activeSessionArchived,
    conversationLocked,
    workflowState
  })

  const startRun = async (
    content: string,
    approvedProposalId?: string,
    allowWhileBusy = false,
    skipEditorFlush = false,
    _reuseSkillFromRunId?: string,
    rejectedProposalId?: string,
    quickAction?: AgentQuickActionRequest,
    quickActionSelection?: AgentPanelSelection
  ): Promise<boolean> => {
    const trimmed = content.trim()
    const quickActionBlocked =
      quickAction === undefined
        ? null
        : (activeSession?.interactionMode ?? 'write') !== 'write'
          ? 'Switch to Write mode before using a quick action.'
          : activeSessionArchived
            ? 'Restore this conversation before using a quick action.'
            : busy || activeRun !== null || conversationLocked
              ? 'Finish the current Agent work or review before using a quick action.'
              : !modelReady
                ? 'Choose an Agent model before using a quick action.'
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
      (!modelReady && approvedProposalId === undefined && rejectedProposalId === undefined)
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
        ...(quickAction === undefined
          ? approvedProposalId === undefined
            ? { prompt: trimmed }
            : {}
          : { quickAction }),
        ...(approvedProposalId === undefined ? {} : { approvedProposalId }),
        ...(rejectedProposalId === undefined ? {} : { rejectedProposalId }),
        scope: quickAction === undefined ? scope : 'selection',
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
  const startRunRef = useRef(startRun)
  startRunRef.current = startRun

  useEffect(() => {
    const request = props.quickActionRequest
    if (
      loading ||
      request === undefined ||
      request === null ||
      !claimQuickAction(request.requestId)
    )
      return
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
  }, [claimQuickAction, loading, props.quickActionRequest, props.onQuickActionHandled])

  useEffect(() => {
    const request = props.promptRequest
    if (
      loading ||
      request === undefined ||
      request === null ||
      !claimQuickAction(request.requestId)
    )
      return
    void startRunRef
      .current(request.prompt, undefined, false, true)
      .then((started) => props.onPromptHandled?.(request.requestId, started))
  }, [claimQuickAction, loading, props.promptRequest, props.onPromptHandled])

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

  const failedContinuationProposal =
    continuationFailure === null
      ? null
      : (proposals.find((proposal) => proposal.proposalId === continuationFailure.proposalId) ??
        null)
  const composerSettingsDisabled = busy || activeRun !== null || conversationLocked
  const interactionModeSwitchDisabled =
    busy || activeSessionArchived || activeRun !== null || activeCompaction !== null
  const composerCommands = buildComposerCommands({
    selectionAvailable: selectionIsAvailable,
    sectionAvailable: props.activeSectionId !== null,
    scopePreference
  })
  const slashCommandCatalog = buildSlashCommands({
    selectionAvailable: selectionIsAvailable,
    sectionAvailable: props.activeSectionId !== null,
    scopePreference,
    canCompact
  })
  const slashQuery = slashCommandQuery(prompt)
  const slashCommands = filterComposerCommands(slashCommandCatalog, slashQuery ?? '')
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
    } else {
      void compactSession()
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

  return {
    props,
    sessions,
    events,
    runs,
    proposals,
    compactionConfirmOpen,
    setCompactionConfirmOpen,
    prompt,
    setPrompt,
    scopePreference,
    reviewFeedback,
    setReviewFeedback,
    composerAddOpen,
    setComposerAddOpen,
    setSlashMenuDismissed,
    setSlashSelectionIndex,
    setSkillMentionDismissed,
    setSkillMentionSelectionIndex,
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
    loading,
    busy,
    pendingActionIds,
    error,
    providerCatalog,
    composerTextareaRef,
    activeSession,
    activeSessionArchived,
    activeRun,
    pendingQuestion,
    pendingMessages,
    choosingSkill,
    streaming,
    usage,
    usageDetails,
    latestRun,
    modelSelection,
    contextSnapshot,
    waitingProposal,
    workflowState,
    conversationLocked,
    canControlTask,
    modelReady,
    supportedThinkingLevels,
    availableModelPresets,
    effectiveRevisionIds,
    presentation,
    thinkingVisualState,
    headerStatus,
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
    restoreSession,
    startRun,
    stopRun,
    answerUserQuestion,
    resumeWritingTask,
    reviseWritingTask,
    queueMessage,
    actOnPendingMessage,
    proposalAction,
    decideChangeSet,
    failedContinuationProposal,
    composerSettingsDisabled,
    interactionModeSwitchDisabled,
    composerCommands,
    slashCommands,
    slashSelectableCommands,
    slashCommandOpen,
    selectedSlashCommand,
    skillMentionCandidates,
    skillMentionSelectableCandidates,
    skillMentionOpen,
    selectedSkillMention,
    leadingSkillMentions,
    runComposerCommand,
    insertSkillMention,
    focusSkillMention
  }
}

export type AgentPanelController = ReturnType<typeof useAgentPanelController>
