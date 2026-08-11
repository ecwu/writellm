import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import {
  approveMutationProposalInputSchema,
  approveMutationProposalResultSchema,
  cancelImageGenerationInputSchema,
  cancelImageGenerationResultSchema,
  mutationProposalActionResultSchema,
  mutationSubscriptionInputSchema,
  rejectMutationProposalInputSchema,
  undoMutationProposalInputSchema
} from '../../shared/contracts/agent-mutations'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'
import type { MutationEventBroker } from '../agent/mutation-event-broker'

export interface AgentMutationIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerAgentMutationIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'error'>
  broker?: MutationEventBroker
  developmentUrl?: string
  ipc?: AgentMutationIpcMain
}): {
  revokeSession(projectSessionId: string): void
  unregister(): void
} {
  const ipc = options.ipc ?? ipcMain
  const service = (projectSessionId: string) => {
    const context = options.manager.assertMutationSession(projectSessionId)
    if (context.agentMutations === null) throw new Error('Agent mutations are unavailable')
    return context.agentMutations
  }
  const recordDecision = async (input: {
    projectSessionId: string
    agentSessionId: string
    agentRunId: string
    proposalId: string
    decision: 'approved' | 'rejected'
  }): Promise<void> => {
    const sessions = options.manager.assertActiveSession(input.projectSessionId).agentSessions
    await sessions?.recordApprovalDecision({
      agentSessionId: input.agentSessionId,
      agentRunId: input.agentRunId,
      proposalId: input.proposalId,
      decision: input.decision,
      continueRequested: false
    })
  }
  const lifecycle = async <T>(
    event: string,
    proposalId: string,
    operation: () => Promise<T> | T
  ): Promise<T> => {
    const startedAt = Date.now()
    try {
      const result = await operation()
      options.logger.info(
        { event: `${event}.completed`, proposalId, durationMs: Date.now() - startedAt },
        'Agent mutation IPC operation completed'
      )
      return result
    } catch (err) {
      options.logger.error(
        { event: `${event}.failed`, err, proposalId, durationMs: Date.now() - startedAt },
        'Agent mutation IPC operation failed'
      )
      throw err
    }
  }

  ipc.handle(IPC_CHANNELS.agentProposalApprove, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = approveMutationProposalInputSchema.parse(rawInput)
    return lifecycle('agent.proposal.approve', input.proposalId, async () => {
      const result = approveMutationProposalResultSchema.parse(
        await service(input.projectSessionId).approve(input)
      )
      options.manager.assertActiveSession(input.projectSessionId)
      await recordDecision({
        ...input,
        agentRunId: result.proposal.agentRunId,
        decision: 'approved'
      })
      return result
    })
  })
  ipc.handle(IPC_CHANNELS.agentProposalReject, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = rejectMutationProposalInputSchema.parse(rawInput)
    return lifecycle('agent.proposal.reject', input.proposalId, async () => {
      const result = mutationProposalActionResultSchema.parse(
        service(input.projectSessionId).reject(input)
      )
      await recordDecision({
        ...input,
        agentRunId: result.proposal.agentRunId,
        decision: 'rejected'
      })
      return result
    })
  })
  ipc.handle(IPC_CHANNELS.agentProposalUndo, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = undoMutationProposalInputSchema.parse(rawInput)
    return lifecycle('agent.proposal.undo', input.proposalId, async () => {
      const result = mutationProposalActionResultSchema.parse(
        await service(input.projectSessionId).undo(input)
      )
      options.manager.assertActiveSession(input.projectSessionId)
      return result
    })
  })
  ipc.handle(IPC_CHANNELS.agentCancelImageGeneration, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = cancelImageGenerationInputSchema.parse(rawInput)
    return cancelImageGenerationResultSchema.parse({
      cancelled: service(input.projectSessionId).cancelImageGeneration(
        input.agentSessionId,
        input.proposalId
      )
    })
  })
  ipc.handle(IPC_CHANNELS.agentSubscribeMutations, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = mutationSubscriptionInputSchema.parse(rawInput)
    options.manager.assertActiveSession(input.projectSessionId)
    options.broker?.subscribe(input.projectSessionId, input.subscriptionId, event.sender)
  })
  ipc.handle(IPC_CHANNELS.agentUnsubscribeMutations, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = mutationSubscriptionInputSchema.parse(rawInput)
    options.broker?.unsubscribe(input.projectSessionId, input.subscriptionId, event.sender.id)
  })

  return {
    revokeSession(projectSessionId) {
      options.broker?.revokeSession(projectSessionId)
    },
    unregister() {
      options.broker?.clear()
      for (const channel of [
        IPC_CHANNELS.agentProposalApprove,
        IPC_CHANNELS.agentProposalReject,
        IPC_CHANNELS.agentProposalUndo,
        IPC_CHANNELS.agentCancelImageGeneration,
        IPC_CHANNELS.agentSubscribeMutations,
        IPC_CHANNELS.agentUnsubscribeMutations
      ]) {
        ipc.removeHandler(channel)
      }
    }
  }
}
