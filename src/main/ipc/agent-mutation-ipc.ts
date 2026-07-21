import { ipcMain, type IpcMain, type WebContents } from 'electron'
import type { Logger } from 'pino'
import {
  approveMutationProposalInputSchema,
  mutationProposalActionResultSchema,
  mutationSectionChangedSchema,
  mutationSubscriptionInputSchema,
  rejectMutationProposalInputSchema,
  undoMutationProposalInputSchema,
  type MutationSectionChanged
} from '../../shared/contracts/agent-mutations'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'

export interface AgentMutationIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerAgentMutationIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: AgentMutationIpcMain
}): {
  revokeSession(projectSessionId: string): void
  unregister(): void
} {
  const ipc = options.ipc ?? ipcMain
  const subscribers = new Map<string, Map<string, WebContents>>()

  const service = (projectSessionId: string) => {
    const context = options.manager.assertMutationSession(projectSessionId)
    if (context.agentMutations === null) throw new Error('Agent mutations are unavailable')
    return context.agentMutations
  }
  const publish = (event: MutationSectionChanged): void => {
    const parsed = mutationSectionChangedSchema.parse(event)
    for (const sender of subscribers.get(parsed.projectSessionId)?.values() ?? []) {
      if (!sender.isDestroyed()) sender.send(IPC_CHANNELS.agentSectionChanged, parsed)
    }
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
      const result = mutationProposalActionResultSchema.parse(
        await service(input.projectSessionId).approve(input)
      )
      options.manager.assertActiveSession(input.projectSessionId)
      if (result.sectionChanged !== null) publish(result.sectionChanged)
      return result
    })
  })
  ipc.handle(IPC_CHANNELS.agentProposalReject, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = rejectMutationProposalInputSchema.parse(rawInput)
    return lifecycle('agent.proposal.reject', input.proposalId, () =>
      mutationProposalActionResultSchema.parse(service(input.projectSessionId).reject(input))
    )
  })
  ipc.handle(IPC_CHANNELS.agentProposalUndo, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = undoMutationProposalInputSchema.parse(rawInput)
    return lifecycle('agent.proposal.undo', input.proposalId, async () => {
      const result = mutationProposalActionResultSchema.parse(
        await service(input.projectSessionId).undo(input)
      )
      options.manager.assertActiveSession(input.projectSessionId)
      if (result.sectionChanged !== null) publish(result.sectionChanged)
      return result
    })
  })
  ipc.handle(IPC_CHANNELS.agentSubscribeMutations, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = mutationSubscriptionInputSchema.parse(rawInput)
    options.manager.assertActiveSession(input.projectSessionId)
    const leases = subscribers.get(input.projectSessionId) ?? new Map<string, WebContents>()
    leases.set(input.subscriptionId, event.sender)
    subscribers.set(input.projectSessionId, leases)
  })
  ipc.handle(IPC_CHANNELS.agentUnsubscribeMutations, (event, rawInput: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = mutationSubscriptionInputSchema.parse(rawInput)
    const leases = subscribers.get(input.projectSessionId)
    if (leases?.get(input.subscriptionId)?.id === event.sender.id) {
      leases.delete(input.subscriptionId)
      if (leases.size === 0) subscribers.delete(input.projectSessionId)
    }
  })

  return {
    revokeSession(projectSessionId) {
      subscribers.delete(projectSessionId)
    },
    unregister() {
      subscribers.clear()
      for (const channel of [
        IPC_CHANNELS.agentProposalApprove,
        IPC_CHANNELS.agentProposalReject,
        IPC_CHANNELS.agentProposalUndo,
        IPC_CHANNELS.agentSubscribeMutations,
        IPC_CHANNELS.agentUnsubscribeMutations
      ]) {
        ipc.removeHandler(channel)
      }
    }
  }
}
