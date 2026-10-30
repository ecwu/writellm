import { reportIpcFailure } from '../observability/ipc-context'
import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import type { AgentUserMessagePayload } from '../../shared/contracts/agent'
import {
  agentEventPageSchema,
  agentProjectActivitySnapshotSchema,
  agentProjectActivitySubscriptionInputSchema,
  agentSubscriptionInputSchema
} from '../../shared/contracts/agent-ipc'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { agentIpcEndpoints } from '../../shared/contracts/ipc-endpoints-agent'
import type { AgentEventBroker } from '../agent/event-broker'
import {
  buildApprovalContinuationPrompt,
  buildQuickActionPrompt,
  buildRejectedProposalRevisionPrompt,
  buildWritingTaskResumePrompt
} from '../agent/prompts/task-prompts'
import { quickActionDefinition } from '../../shared/contracts/agent-quick-actions'
import { validateQuickActionSelection } from '../agent/quick-actions'
import type { ProjectManager } from '../project/project-manager'
import {
  clampResolvedAgentThinkingLevel,
  type AgentProviderCatalogService
} from '../providers/agent-provider-catalog'
import type { ProviderService } from '../providers/provider-service'
import { authorizeSender } from './authorize-sender'
import { createEndpointRegistrar } from './endpoint'

export interface AgentIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerAgentIpc(options: {
  manager: ProjectManager
  broker: AgentEventBroker
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  catalog: Pick<
    AgentProviderCatalogService,
    'snapshot' | 'resolve' | 'setDefaultSelection' | 'getLastThinkingLevel' | 'setLastThinkingLevel'
  >
  imageCatalog: Pick<ProviderService, 'resolveImageSelection'>
  developmentUrl?: string
  ipc?: AgentIpcMain
}): { revokeSession(projectSessionId: string): void; unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const handle = createEndpointRegistrar(ipc, {
    developmentUrl: options.developmentUrl,
    manager: options.manager
  })
  const readService = (projectSessionId: string) =>
    options.manager.assertActiveSession(projectSessionId).agentSessions
  /** Log one Agent operation, including session rejections from the endpoint boundary. */
  const lifecycle =
    (event: string) =>
    async <T>(_input: unknown, run: () => Promise<T>): Promise<T> => {
      const startedAt = Date.now()
      try {
        const result = await run()
        options.logger.info(
          { event: `${event}.completed`, durationMs: Date.now() - startedAt },
          'Agent IPC operation completed'
        )
        return result
      } catch (err) {
        reportIpcFailure(
          options.logger,
          { event: `${event}.failed`, err, durationMs: Date.now() - startedAt },
          'Agent IPC operation failed'
        )
        throw err
      }
    }

  handle(agentIpcEndpoints.listSessions, (input, context) => {
    return context.agentSessions.listSessions(input.status)
  })
  handle(agentIpcEndpoints.getSession, (input, context) => {
    return context.agentSessions.getSession(input.agentSessionId)
  })
  handle(
    agentIpcEndpoints.forkConversation,
    (input, context) => {
      return context.agentSessions.forkConversation(input)
    },
    { around: lifecycle('agent.session.fork') }
  )
  handle(
    agentIpcEndpoints.createSession,
    async (input) => {
      const selection = input.modelSelection ?? (await options.catalog.snapshot()).defaultSelection
      const thinkingLevel =
        selection === null
          ? 'off'
          : clampResolvedAgentThinkingLevel(
              await options.catalog.resolve(selection),
              await options.catalog.getLastThinkingLevel()
            )
      // Catalog reads await, so revalidate the session before creating Agent state.
      return options.manager
        .assertMutationSession(input.projectSessionId)
        .agentSessions.createSession(input.title, undefined, selection, thinkingLevel)
    },
    { around: lifecycle('agent.session.create') }
  )
  handle(
    agentIpcEndpoints.generateSessionTitle,
    async (input, context) => {
      const service = context.agentSessions
      return await service.generateSessionTitle(input.agentSessionId)
    },
    { around: lifecycle('agent.session.generate_title') }
  )
  handle(
    agentIpcEndpoints.archiveSession,
    (input, context) => {
      return context.agentSessions.archiveSession(input.agentSessionId)
    },
    { around: lifecycle('agent.session.archive') }
  )
  handle(
    agentIpcEndpoints.restoreSession,
    (input, context) => {
      return context.agentSessions.restoreSession(input.agentSessionId)
    },
    { around: lifecycle('agent.session.restore') }
  )
  handle(
    agentIpcEndpoints.setModelSelection,
    async (input) => {
      const catalog = options.catalog
      const resolved = await catalog.resolve(input.selection)
      // The catalog read awaits, so revalidate the session before reading Agent state.
      const service = options.manager.assertMutationSession(input.projectSessionId).agentSessions
      const current = service
        .listSessions()
        .find((session) => session.agentSessionId === input.agentSessionId)
      if (current === undefined) throw new Error('Agent session does not exist')
      const requestedLevel =
        current.modelSelection === null
          ? await catalog.getLastThinkingLevel()
          : current.thinkingLevel
      const thinkingLevel = clampResolvedAgentThinkingLevel(resolved, requestedLevel)
      const result = service.setModelSelection(input.agentSessionId, input.selection, thinkingLevel)
      await catalog.setDefaultSelection(input.selection)
      return result
    },
    { around: lifecycle('agent.session.set_model_selection') }
  )
  handle(
    agentIpcEndpoints.setImageModelSelection,
    async (input) => {
      if (input.selection !== null)
        await options.imageCatalog.resolveImageSelection(input.selection)
      // The catalog read awaits, so revalidate the session before writing Agent state.
      return options.manager
        .assertMutationSession(input.projectSessionId)
        .agentSessions.setImageModelSelection(input.agentSessionId, input.selection)
    },
    { around: lifecycle('agent.session.set_image_model_selection') }
  )
  handle(
    agentIpcEndpoints.setThinkingLevel,
    async (input, context) => {
      const catalog = options.catalog
      const service = context.agentSessions
      const session = service
        .listSessions()
        .find((candidate) => candidate.agentSessionId === input.agentSessionId)
      if (session === undefined) throw new Error('Agent session does not exist')
      if (session.modelSelection === null) throw new Error('Choose an Agent model first')
      const resolved = await catalog.resolve(session.modelSelection)
      if (clampResolvedAgentThinkingLevel(resolved, input.level) !== input.level) {
        throw new Error('Selected Thinking level is unavailable for this Agent model')
      }
      const result = service.setThinkingLevel(input.agentSessionId, input.level)
      await catalog.setLastThinkingLevel(input.level)
      return result
    },
    { around: lifecycle('agent.session.set_thinking_level') }
  )
  handle(
    agentIpcEndpoints.setApprovalMode,
    (input, context) => {
      return context.agentSessions.setApprovalMode(input.agentSessionId, input.mode)
    },
    { around: lifecycle('agent.session.set_approval_mode') }
  )
  handle(
    agentIpcEndpoints.setInteractionMode,
    (input, context) => {
      return context.agentSessions.setInteractionMode(input.agentSessionId, input.mode)
    },
    { around: lifecycle('agent.session.set_interaction_mode') }
  )
  handle(
    agentIpcEndpoints.updateWritingTask,
    (input, context) => {
      const session = context.agentSessions
        .listSessions()
        .find((candidate) => candidate.agentSessionId === input.agentSessionId)
      if (session?.workflowState !== 'idle') {
        throw new Error('Stop or finish Agent work before revising the plan')
      }
      const view = context.writingTasks.updateByUser(input)
      if (view === null) throw new Error('Writing task is unavailable after the update')
      return view
    },
    { around: lifecycle('agent.writing_task.user_update') }
  )
  handle(agentIpcEndpoints.listEvents, (input, context) => {
    return context.agentSessions.listEventPage(
      input.agentSessionId,
      input.afterSequence,
      input.limit
    )
  })
  handle(agentIpcEndpoints.listRuns, (input, context) => {
    return context.agentSessions.listRuns(input.agentSessionId, input.limit)
  })
  handle(agentIpcEndpoints.listProposals, (input, context) =>
    context.agentMutations.list(input.agentSessionId)
  )
  handle(
    agentIpcEndpoints.editLastMessageAndRestart,
    async (input, context) => {
      const service = context.agentSessions
      const started = await service.editLastMessageAndRestart(input)
      options.manager.assertActiveSession(input.projectSessionId)
      return { run: service.requireRun(started.agentRunId) }
    },
    { around: lifecycle('agent.message.edit') }
  )
  handle(
    agentIpcEndpoints.startRun,
    async (input, context) => {
      const service = context.agentSessions
      const session = service
        .listSessions()
        .find((candidate) => candidate.agentSessionId === input.agentSessionId)
      if (session === undefined) throw new Error('Agent session does not exist')
      let prompt: string
      let presentation: AgentUserMessagePayload['presentation']
      let interactionMode = session.interactionMode ?? 'write'
      if (input.quickAction !== undefined) {
        if (interactionMode !== 'write') {
          throw new Error('Selection quick actions require Write mode')
        }
        const selection = validateQuickActionSelection(
          context.manuscript,
          input.editorContext,
          options.logger
        )
        const definition = quickActionDefinition(input.quickAction.action)
        prompt = buildQuickActionPrompt({
          quickAction: input.quickAction,
          selectedText: selection.selectedText
        })
        presentation = {
          kind: 'quick_action',
          action: input.quickAction.action,
          label: definition.label,
          selectedText: selection.selectedText,
          displayInstruction: input.quickAction.customInstruction ?? null
        }
        options.logger.info(
          {
            event: 'agent.run.quick_action_authorized',
            agentSessionId: input.agentSessionId,
            sectionId: input.editorContext.activeSectionId,
            sectionRevisionId: selection.revisionId,
            action: input.quickAction.action,
            selectedBlockCount: input.editorContext.selectedBlockIds.length,
            selectedTextLength: selection.selectedText.length
          },
          'Authorized Agent selection quick action'
        )
      } else {
        if (input.resumeWritingTask === true) {
          if (interactionMode !== 'write') {
            throw new Error('Writing task resume requires Write mode')
          }
          const correlation = context.writingTasks.activeCorrelation(input.agentSessionId)
          if (correlation === null) throw new Error('Writing task has no active step to resume')
          prompt = buildWritingTaskResumePrompt(correlation)
          options.logger.info(
            {
              event: 'agent.writing_task.resume_authorized',
              agentSessionId: input.agentSessionId,
              writingTaskId: correlation.taskId,
              writingTaskStepId: correlation.stepId
            },
            'Authorized Agent writing task resume'
          )
        } else {
          if (input.approvedProposalId === undefined) {
            if (input.prompt === undefined) throw new Error('Agent prompt is required')
            prompt = input.prompt
          } else {
            prompt = ''
          }
        }
      }
      if (input.approvedProposalId !== undefined) {
        const proposal = context.agentMutations
          .list(input.agentSessionId)
          .find((candidate) => candidate.proposalId === input.approvedProposalId)
        if (proposal === undefined || !['applied', 'satisfied'].includes(proposal.status)) {
          throw new Error('Approved proposal continuation is not authorized')
        }
        const blocker = context.agentMutations
          .list(input.agentSessionId)
          .find((candidate) => ['pending', 'generating'].includes(candidate.status))
        if (blocker !== undefined) {
          throw new Error(
            blocker.status === 'generating'
              ? 'Agent conversation is waiting for image generation'
              : 'Agent conversation is waiting for review'
          )
        }
        await service.recordApprovalDecision({
          agentSessionId: input.agentSessionId,
          agentRunId: proposal.agentRunId,
          proposalId: proposal.proposalId,
          decision: 'approved',
          continueRequested: true
        })
        const sourceRun = service.requireRun(proposal.agentRunId)
        if ((sourceRun.interactionMode ?? 'write') !== 'write') {
          throw new Error('Proposal continuation requires an originating Write run')
        }
        interactionMode = sourceRun.interactionMode ?? 'write'
        prompt = buildApprovalContinuationPrompt(proposal)
        presentation = { kind: 'approval_continuation' }
        options.logger.info(
          {
            event: 'agent.run.review_continuation_authorized',
            agentSessionId: input.agentSessionId,
            proposalId: proposal.proposalId,
            sourceRunId: proposal.agentRunId,
            decision: 'approved'
          },
          'Authorized Agent review continuation'
        )
      } else if (input.rejectedProposalId !== undefined) {
        const proposal = context.agentMutations
          .list(input.agentSessionId)
          .find((candidate) => candidate.proposalId === input.rejectedProposalId)
        if (
          proposal === undefined ||
          proposal.status !== 'rejected' ||
          proposal.rejectedReason === null
        ) {
          throw new Error('Rejected proposal revision is not authorized')
        }
        const blocker = context.agentMutations
          .list(input.agentSessionId)
          .find((candidate) => ['pending', 'generating'].includes(candidate.status))
        if (blocker !== undefined) {
          throw new Error(
            blocker.status === 'generating'
              ? 'Agent conversation is waiting for image generation'
              : 'Agent conversation is waiting for review'
          )
        }
        const sourceRun = service.requireRun(proposal.agentRunId)
        if ((sourceRun.interactionMode ?? 'write') !== 'write') {
          throw new Error('Proposal revision requires an originating Write run')
        }
        interactionMode = sourceRun.interactionMode ?? 'write'
        prompt = buildRejectedProposalRevisionPrompt(proposal)
        presentation = {
          kind: 'review_feedback',
          displayContent: proposal.rejectedReason
        }
        options.logger.info(
          {
            event: 'agent.run.review_continuation_authorized',
            agentSessionId: input.agentSessionId,
            proposalId: proposal.proposalId,
            sourceRunId: proposal.agentRunId,
            decision: 'rejected'
          },
          'Authorized Agent review continuation'
        )
      }
      const started = await service.startRun({
        agentSessionId: input.agentSessionId,
        prompt,
        attachmentIds: input.attachmentIds,
        editorContext: input.editorContext,
        presentation,
        interactionMode
      })
      return { run: service.requireRun(started.agentRunId) }
    },
    { around: lifecycle('agent.run.start') }
  )
  handle(
    agentIpcEndpoints.steerRun,
    (input, context) => {
      return context.agentSessions.steer(input.agentRunId, input.content, input.attachmentIds)
    },
    { around: lifecycle('agent.run.steer') }
  )
  handle(
    agentIpcEndpoints.followUpRun,
    (input, context) => {
      return context.agentSessions.followUp(input.agentRunId, input.content, input.attachmentIds)
    },
    { around: lifecycle('agent.run.follow_up') }
  )
  handle(
    agentIpcEndpoints.steerPendingFollowUp,
    (input, context) => {
      return context.agentSessions.steerPendingFollowUp(input.agentRunId, input.pendingMessageId)
    },
    { around: lifecycle('agent.run.pending_follow_up_steer') }
  )
  handle(
    agentIpcEndpoints.deletePendingFollowUp,
    (input, context) => {
      return context.agentSessions.deletePendingFollowUp(input.agentRunId, input.pendingMessageId)
    },
    { around: lifecycle('agent.run.pending_follow_up_delete') }
  )
  handle(
    agentIpcEndpoints.abortRun,
    (input, context) => {
      return context.agentSessions.abort(input.agentRunId)
    },
    { around: lifecycle('agent.run.abort') }
  )
  handle(
    agentIpcEndpoints.answerUserQuestion,
    async (input, context) => {
      const service = context.agentSessions
      await service.answerUserQuestion(input)
      return {}
    },
    { around: lifecycle('agent.question.answer') }
  )
  handle(
    agentIpcEndpoints.compactSession,
    async (input, context) => {
      const service = context.agentSessions
      return await service.compactSession(input.agentSessionId)
    },
    { around: lifecycle('agent.compaction.start') }
  )
  handle(
    agentIpcEndpoints.stopCompaction,
    async (input, context) => {
      const service = context.agentSessions
      await service.stopCompaction(input.agentSessionId, input.compactionId)
      return {}
    },
    { around: lifecycle('agent.compaction.stop') }
  )
  ipc.handle(IPC_CHANNELS.agentSubscribeEvents, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSubscriptionInputSchema.parse(raw)
    const service = readService(input.projectSessionId)
    options.broker.subscribe({
      sender: event.sender,
      projectSessionId: input.projectSessionId,
      agentSessionId: input.agentSessionId,
      subscriptionId: input.subscriptionId
    })
    try {
      return agentEventPageSchema.parse(
        service.listEventPage(input.agentSessionId, input.afterSequence)
      )
    } catch (err) {
      options.broker.unsubscribe(event.sender.id, input.subscriptionId)
      throw err
    }
  })
  ipc.handle(IPC_CHANNELS.agentCompleteReplay, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSubscriptionInputSchema.parse(raw)
    options.manager.assertActiveSession(input.projectSessionId)
    options.broker.completeReplay(event.sender.id, input.subscriptionId)
  })
  ipc.handle(IPC_CHANNELS.agentUnsubscribeEvents, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSubscriptionInputSchema.parse(raw)
    options.broker.unsubscribe(event.sender.id, input.subscriptionId)
  })
  ipc.handle(IPC_CHANNELS.agentSubscribeActivity, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentProjectActivitySubscriptionInputSchema.parse(raw)
    const service = readService(input.projectSessionId)
    options.broker.subscribeActivity({
      sender: event.sender,
      projectSessionId: input.projectSessionId,
      subscriptionId: input.subscriptionId
    })
    try {
      return agentProjectActivitySnapshotSchema.parse(service.projectActivitySnapshot())
    } catch (err) {
      options.broker.unsubscribe(event.sender.id, input.subscriptionId)
      throw err
    }
  })
  ipc.handle(IPC_CHANNELS.agentCompleteActivitySnapshot, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentProjectActivitySubscriptionInputSchema.parse(raw)
    options.manager.assertActiveSession(input.projectSessionId)
    options.broker.completeActivitySnapshot(event.sender.id, input.subscriptionId)
  })
  ipc.handle(IPC_CHANNELS.agentUnsubscribeActivity, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentProjectActivitySubscriptionInputSchema.parse(raw)
    options.broker.unsubscribe(event.sender.id, input.subscriptionId)
  })

  const channels = [
    IPC_CHANNELS.agentListSessions,
    IPC_CHANNELS.agentGetSession,
    IPC_CHANNELS.agentForkConversation,
    IPC_CHANNELS.agentCreateSession,
    IPC_CHANNELS.agentGenerateSessionTitle,
    IPC_CHANNELS.agentArchiveSession,
    IPC_CHANNELS.agentRestoreSession,
    IPC_CHANNELS.agentSetApprovalMode,
    IPC_CHANNELS.agentSetInteractionMode,
    IPC_CHANNELS.agentSetModelSelection,
    IPC_CHANNELS.agentSetThinkingLevel,
    IPC_CHANNELS.agentUpdateWritingTask,
    IPC_CHANNELS.agentListEvents,
    IPC_CHANNELS.agentListRuns,
    IPC_CHANNELS.agentListProposals,
    IPC_CHANNELS.agentStartRun,
    IPC_CHANNELS.agentEditLastMessage,
    IPC_CHANNELS.agentSteerRun,
    IPC_CHANNELS.agentFollowUpRun,
    IPC_CHANNELS.agentSteerPendingFollowUp,
    IPC_CHANNELS.agentDeletePendingFollowUp,
    IPC_CHANNELS.agentAbortRun,
    IPC_CHANNELS.agentAnswerUserQuestion,
    IPC_CHANNELS.agentCompactSession,
    IPC_CHANNELS.agentStopCompaction,
    IPC_CHANNELS.agentSubscribeEvents,
    IPC_CHANNELS.agentCompleteReplay,
    IPC_CHANNELS.agentUnsubscribeEvents,
    IPC_CHANNELS.agentSubscribeActivity,
    IPC_CHANNELS.agentCompleteActivitySnapshot,
    IPC_CHANNELS.agentUnsubscribeActivity
  ]
  return {
    revokeSession(projectSessionId) {
      options.broker.revokeSession(projectSessionId)
    },
    unregister() {
      options.broker.clear()
      for (const channel of channels) ipc.removeHandler(channel)
    }
  }
}
