import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import {
  agentCreateSessionInputSchema,
  agentCreateSessionResultSchema,
  agentEventPageInputSchema,
  agentEventPageSchema,
  agentListProposalsResultSchema,
  agentListRunsInputSchema,
  agentListRunsResultSchema,
  agentListSessionsResultSchema,
  agentProjectInputSchema,
  agentQueueInputSchema,
  agentRunInputSchema,
  agentSetApprovalModeInputSchema,
  agentSetApprovalModeResultSchema,
  agentSetModelSelectionInputSchema,
  agentSetModelSelectionResultSchema,
  agentStartRunInputSchema,
  agentStartRunResultSchema,
  agentSubscriptionInputSchema
} from '../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../shared/contracts/agent-mutations'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { AgentEventBroker } from '../agent/event-broker'
import type { ProjectManager } from '../project/project-manager'
import type { AgentProviderCatalogService } from '../providers/agent-provider-catalog'
import { authorizeSender } from './authorize-sender'

export interface AgentIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerAgentIpc(options: {
  manager: ProjectManager
  broker: AgentEventBroker
  logger: Pick<Logger, 'info' | 'error'>
  catalog?: Pick<AgentProviderCatalogService, 'snapshot' | 'resolve' | 'setDefaultSelection'>
  developmentUrl?: string
  ipc?: AgentIpcMain
}): { revokeSession(projectSessionId: string): void; unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const readService = (projectSessionId: string) => {
    const context = options.manager.assertActiveSession(projectSessionId)
    if (context.agentSessions === null) throw new Error('Agent sessions are unavailable')
    return context.agentSessions
  }
  const mutationContext = (projectSessionId: string) => {
    const context = options.manager.assertMutationSession(projectSessionId)
    if (context.agentSessions === null) throw new Error('Agent sessions are unavailable')
    return context
  }
  const lifecycle = async <T>(event: string, operation: () => T | Promise<T>): Promise<T> => {
    const startedAt = Date.now()
    try {
      const result = await operation()
      options.logger.info(
        { event: `${event}.completed`, durationMs: Date.now() - startedAt },
        'Agent IPC operation completed'
      )
      return result
    } catch (err) {
      options.logger.error(
        { event: `${event}.failed`, err, durationMs: Date.now() - startedAt },
        'Agent IPC operation failed'
      )
      throw err
    }
  }

  ipc.handle(IPC_CHANNELS.agentListSessions, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentProjectInputSchema.parse(raw)
    return agentListSessionsResultSchema.parse(readService(input.projectSessionId).listSessions())
  })
  ipc.handle(IPC_CHANNELS.agentCreateSession, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentCreateSessionInputSchema.parse(raw)
    return lifecycle('agent.session.create', async () => {
      const selection =
        input.modelSelection ??
        (options.catalog === undefined ? null : (await options.catalog.snapshot()).defaultSelection)
      if (selection !== null) await options.catalog?.resolve(selection)
      return agentCreateSessionResultSchema.parse(
        mutationContext(input.projectSessionId).agentSessions?.createSession(
          input.title,
          undefined,
          selection
        )
      )
    })
  })
  ipc.handle(IPC_CHANNELS.agentSetModelSelection, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSetModelSelectionInputSchema.parse(raw)
    return lifecycle('agent.session.set_model_selection', async () => {
      if (options.catalog === undefined) throw new Error('Agent provider catalog is unavailable')
      await options.catalog.resolve(input.selection)
      const result = agentSetModelSelectionResultSchema.parse(
        mutationContext(input.projectSessionId).agentSessions?.setModelSelection(
          input.agentSessionId,
          input.selection
        )
      )
      await options.catalog.setDefaultSelection(input.selection)
      return result
    })
  })
  ipc.handle(IPC_CHANNELS.agentSetApprovalMode, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentSetApprovalModeInputSchema.parse(raw)
    return lifecycle('agent.session.set_approval_mode', () =>
      agentSetApprovalModeResultSchema.parse(
        mutationContext(input.projectSessionId).agentSessions?.setApprovalMode(
          input.agentSessionId,
          input.mode
        )
      )
    )
  })
  ipc.handle(IPC_CHANNELS.agentListEvents, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentEventPageInputSchema.parse(raw)
    return agentEventPageSchema.parse(
      readService(input.projectSessionId).listEventPage(
        input.agentSessionId,
        input.afterSequence,
        input.limit
      )
    )
  })
  ipc.handle(IPC_CHANNELS.agentListRuns, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentListRunsInputSchema.parse(raw)
    return agentListRunsResultSchema.parse(
      readService(input.projectSessionId).listRuns(input.agentSessionId, input.limit)
    )
  })
  ipc.handle(IPC_CHANNELS.agentListProposals, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentListRunsInputSchema.omit({ limit: true }).parse(raw)
    const context = options.manager.assertActiveSession(input.projectSessionId)
    if (context.agentMutations === null) throw new Error('Agent proposals are unavailable')
    return agentListProposalsResultSchema.parse(context.agentMutations.list(input.agentSessionId))
  })
  ipc.handle(IPC_CHANNELS.agentStartRun, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentStartRunInputSchema.parse(raw)
    return lifecycle('agent.run.start', async () => {
      const context = mutationContext(input.projectSessionId)
      const service = context.agentSessions
      if (service === null) throw new Error('Agent sessions are unavailable')
      let prompt = input.prompt
      if (input.approvedProposalId !== undefined) {
        if (context.agentMutations === null) throw new Error('Agent proposals are unavailable')
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
        prompt = approvalContinuationPrompt(proposal, input.prompt)
      }
      const started = await service.startRun({
        agentSessionId: input.agentSessionId,
        prompt,
        editorContext: input.editorContext
      })
      return agentStartRunResultSchema.parse({ run: service.requireRun(started.agentRunId) })
    })
  })
  ipc.handle(IPC_CHANNELS.agentSteerRun, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentQueueInputSchema.parse(raw)
    return lifecycle('agent.run.steer', () =>
      mutationContext(input.projectSessionId).agentSessions?.steer(input.agentRunId, input.content)
    )
  })
  ipc.handle(IPC_CHANNELS.agentFollowUpRun, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentQueueInputSchema.parse(raw)
    return lifecycle('agent.run.follow_up', () =>
      mutationContext(input.projectSessionId).agentSessions?.followUp(
        input.agentRunId,
        input.content
      )
    )
  })
  ipc.handle(IPC_CHANNELS.agentAbortRun, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentRunInputSchema.parse(raw)
    return lifecycle('agent.run.abort', () =>
      mutationContext(input.projectSessionId).agentSessions?.abort(input.agentRunId)
    )
  })
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

  const channels = [
    IPC_CHANNELS.agentListSessions,
    IPC_CHANNELS.agentCreateSession,
    IPC_CHANNELS.agentSetApprovalMode,
    IPC_CHANNELS.agentSetModelSelection,
    IPC_CHANNELS.agentListEvents,
    IPC_CHANNELS.agentListRuns,
    IPC_CHANNELS.agentListProposals,
    IPC_CHANNELS.agentStartRun,
    IPC_CHANNELS.agentSteerRun,
    IPC_CHANNELS.agentFollowUpRun,
    IPC_CHANNELS.agentAbortRun,
    IPC_CHANNELS.agentSubscribeEvents,
    IPC_CHANNELS.agentCompleteReplay,
    IPC_CHANNELS.agentUnsubscribeEvents
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

function approvalContinuationPrompt(
  proposal: MutationProposalRecord,
  requestedContinuation: string
): string {
  const subject =
    proposal.kind === 'brief_update'
      ? 'Brief update'
      : proposal.kind === 'outline_patch'
        ? 'Outline update'
        : proposal.kind === 'generated_image_insert'
          ? 'generated image'
          : 'section update'
  const result =
    proposal.status === 'satisfied'
      ? `The user approved the proposed ${subject}; the current manuscript already satisfies it.`
      : `The user approved the proposed ${subject}, and it is now applied.`
  return `${result} Treat the resulting manuscript state as authoritative. ${requestedContinuation.trim()}`
}
