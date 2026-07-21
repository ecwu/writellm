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
  agentStartRunInputSchema,
  agentStartRunResultSchema,
  agentSubscriptionInputSchema
} from '../../shared/contracts/agent-ipc'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { AgentEventBroker } from '../agent/event-broker'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'

export interface AgentIpcMain extends Pick<IpcMain, 'handle' | 'removeHandler'> {}

export function registerAgentIpc(options: {
  manager: ProjectManager
  broker: AgentEventBroker
  logger: Pick<Logger, 'info' | 'error'>
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
  ipc.handle(IPC_CHANNELS.agentCreateSession, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = agentCreateSessionInputSchema.parse(raw)
    return lifecycle('agent.session.create', () =>
      agentCreateSessionResultSchema.parse(
        mutationContext(input.projectSessionId).agentSessions?.createSession(input.title)
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
      const service = mutationContext(input.projectSessionId).agentSessions
      if (service === null) throw new Error('Agent sessions are unavailable')
      const started = await service.startRun({
        agentSessionId: input.agentSessionId,
        prompt: input.prompt,
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
