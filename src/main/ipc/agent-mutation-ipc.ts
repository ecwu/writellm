import { reportIpcFailure } from '../observability/ipc-context'
import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import { mutationSubscriptionInputSchema } from '../../shared/contracts/agent-mutations'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import { agentIpcEndpoints } from '../../shared/contracts/ipc-endpoints-agent'
import type { ProjectContext } from '../project/project-context'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'
import { createEndpointRegistrar } from './endpoint'
import type { MutationEventBroker } from '../agent/mutation-event-broker'

export interface AgentMutationIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerAgentMutationIpc(options: {
  manager: ProjectManager
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  broker?: MutationEventBroker
  developmentUrl?: string
  ipc?: AgentMutationIpcMain
}): {
  revokeSession(projectSessionId: string): void
  unregister(): void
} {
  const ipc = options.ipc ?? ipcMain
  const handle = createEndpointRegistrar(ipc, {
    developmentUrl: options.developmentUrl,
    manager: options.manager
  })
  const assertWritableSession = (context: ProjectContext, agentSessionId: string): void => {
    const sessions = context.agentSessions
    if (
      !sessions.listSessions('active').some((session) => session.agentSessionId === agentSessionId)
    ) {
      const archived = sessions
        .listSessions('archived')
        .some((session) => session.agentSessionId === agentSessionId)
      throw new Error(archived ? 'Agent session is archived' : 'Agent session does not exist')
    }
  }
  const recordDecision = async (input: {
    projectSessionId: string
    agentSessionId: string
    agentRunId: string
    proposalId: string
    decision: 'approved' | 'rejected'
    continueRequested?: boolean
  }): Promise<void> => {
    const sessions = options.manager.assertActiveSession(input.projectSessionId).agentSessions
    await sessions?.recordApprovalDecision({
      agentSessionId: input.agentSessionId,
      agentRunId: input.agentRunId,
      proposalId: input.proposalId,
      decision: input.decision,
      continueRequested: input.continueRequested ?? false
    })
  }
  /** Log one proposal operation, including session rejections from the endpoint boundary. */
  const lifecycle =
    (event: string, operationId: (input: { proposalId?: string; commandId?: string }) => string) =>
    async <T>(input: { proposalId?: string; commandId?: string }, run: () => Promise<T>) => {
      const proposalId = operationId(input)
      const startedAt = Date.now()
      try {
        const result = await run()
        options.logger.info(
          { event: `${event}.completed`, proposalId, durationMs: Date.now() - startedAt },
          'Agent mutation IPC operation completed'
        )
        return result
      } catch (err) {
        reportIpcFailure(
          options.logger,
          { event: `${event}.failed`, err, proposalId, durationMs: Date.now() - startedAt },
          'Agent mutation IPC operation failed'
        )
        throw err
      }
    }
  const byProposal = (input: { proposalId?: string }) => input.proposalId ?? ''
  const byCommand = (input: { commandId?: string }) => input.commandId ?? ''

  handle(
    agentIpcEndpoints.approveProposal,
    async (input, context) => {
      assertWritableSession(context, input.agentSessionId)
      const result = await context.agentMutations.approve(input)
      options.manager.assertActiveSession(input.projectSessionId)
      await recordDecision({
        ...input,
        agentRunId: result.proposal.agentRunId,
        decision: 'approved'
      })
      return result
    },
    { around: lifecycle('agent.proposal.approve', byProposal) }
  )
  handle(
    agentIpcEndpoints.rejectProposal,
    async (input, context) => {
      assertWritableSession(context, input.agentSessionId)
      const result = context.agentMutations.reject(input)
      await recordDecision({
        ...input,
        agentRunId: result.proposal.agentRunId,
        decision: 'rejected',
        continueRequested: input.continueRequested
      })
      return result
    },
    { around: lifecycle('agent.proposal.reject', byProposal) }
  )
  handle(
    agentIpcEndpoints.undoProposal,
    async (input, context) => {
      assertWritableSession(context, input.agentSessionId)
      const result = await context.agentMutations.undo(input)
      options.manager.assertActiveSession(input.projectSessionId)
      return result
    },
    { around: lifecycle('agent.proposal.undo', byProposal) }
  )
  handle(
    agentIpcEndpoints.decideChangeSet,
    async (input, context) => {
      assertWritableSession(context, input.agentSessionId)
      return context.agentChangeSets.execute(input, async () => {
        const state = await options.manager.versionHistoryState(input.projectSessionId)
        if (state !== 'ready') return 'unavailable'
        await options.manager.createCheckpoint(input.projectSessionId, {
          name: `Before Agent change set ${new Date().toISOString()}`,
          note: 'Automatic checkpoint before applying selected Agent proposals.'
        })
        return 'created'
      })
    },
    { around: lifecycle('agent.change_set.batch', byCommand) }
  )
  handle(agentIpcEndpoints.cancelImageGeneration, (input, context) => {
    assertWritableSession(context, input.agentSessionId)
    return {
      cancelled: context.agentMutations.cancelImageGeneration(
        input.agentSessionId,
        input.proposalId
      )
    }
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
        IPC_CHANNELS.agentChangeSetBatch,
        IPC_CHANNELS.agentCancelImageGeneration,
        IPC_CHANNELS.agentSubscribeMutations,
        IPC_CHANNELS.agentUnsubscribeMutations
      ]) {
        ipc.removeHandler(channel)
      }
    }
  }
}
