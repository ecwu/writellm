import { ipcMain, type IpcMain } from 'electron'
import type { Logger } from 'pino'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  notebookChatClearInputSchema,
  notebookChatCommandResultSchema,
  notebookChatSetModelInputSchema,
  notebookChatSetThinkingLevelInputSchema,
  notebookChatSetSourcesInputSchema,
  notebookChatSnapshotInputSchema,
  notebookChatSnapshotSchema,
  notebookChatStartTurnInputSchema,
  notebookChatStartTurnResultSchema,
  notebookChatStopTurnInputSchema,
  notebookChatSubscribeInputSchema,
  notebookChatSubscribeResultSchema,
  notebookChatUnsubscribeInputSchema
} from '../../shared/contracts/notebook'
import type { KnowledgeChatEventBroker } from '../knowledge/knowledge-chat-event-broker'
import type { ProjectManager } from '../project/project-manager'
import { authorizeSender } from './authorize-sender'

export function registerNotebookChatIpc(options: {
  manager: ProjectManager
  broker: KnowledgeChatEventBroker
  logger: Pick<Logger, 'info' | 'error'>
  developmentUrl?: string
  ipc?: Pick<IpcMain, 'handle' | 'removeHandler'>
}): { revokeSession(projectSessionId: string): void; unregister(): void } {
  const ipc = options.ipc ?? ipcMain
  const service = (projectSessionId: string) => {
    const context = options.manager.assertActiveSession(projectSessionId)
    if (context.knowledgeChat === null) throw new Error('Notebook chat is unavailable')
    return context.knowledgeChat
  }
  const lifecycle = async <T>(event: string, operation: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now()
    try {
      const result = await operation()
      options.logger.info(
        { event: `${event}.completed`, durationMs: Date.now() - startedAt },
        'Notebook IPC operation completed'
      )
      return result
    } catch (err) {
      options.logger.error(
        { event: `${event}.failed`, err, durationMs: Date.now() - startedAt },
        'Notebook IPC operation failed'
      )
      throw new Error(safeNotebookError(err), { cause: err })
    }
  }

  ipc.handle(IPC_CHANNELS.notebookChatSnapshot, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = notebookChatSnapshotInputSchema.parse(raw)
    return lifecycle('knowledge.notebook.snapshot', async () =>
      notebookChatSnapshotSchema.parse(await service(input.projectSessionId).snapshot())
    )
  })
  ipc.handle(IPC_CHANNELS.notebookChatStartTurn, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = notebookChatStartTurnInputSchema.parse(raw)
    return lifecycle('knowledge.notebook.start_turn', async () =>
      notebookChatStartTurnResultSchema.parse(
        await service(input.projectSessionId).startTurn(input.content)
      )
    )
  })
  ipc.handle(IPC_CHANNELS.notebookChatStopTurn, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = notebookChatStopTurnInputSchema.parse(raw)
    return lifecycle('knowledge.notebook.stop_turn', async () =>
      notebookChatCommandResultSchema.parse(await service(input.projectSessionId).stopTurn())
    )
  })
  ipc.handle(IPC_CHANNELS.notebookChatClear, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = notebookChatClearInputSchema.parse(raw)
    return lifecycle('knowledge.notebook.clear', async () =>
      notebookChatCommandResultSchema.parse(await service(input.projectSessionId).clear())
    )
  })
  ipc.handle(IPC_CHANNELS.notebookChatSetSources, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = notebookChatSetSourcesInputSchema.parse(raw)
    return lifecycle('knowledge.notebook.set_sources', async () =>
      notebookChatCommandResultSchema.parse(
        await service(input.projectSessionId).setSources(input.sourceScope)
      )
    )
  })
  ipc.handle(IPC_CHANNELS.notebookChatSetModel, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = notebookChatSetModelInputSchema.parse(raw)
    return lifecycle('knowledge.notebook.set_model', async () =>
      notebookChatCommandResultSchema.parse(
        await service(input.projectSessionId).setModel(input.modelSelection)
      )
    )
  })
  ipc.handle(IPC_CHANNELS.notebookChatSetThinkingLevel, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = notebookChatSetThinkingLevelInputSchema.parse(raw)
    return lifecycle('knowledge.notebook.set_thinking_level', async () =>
      notebookChatCommandResultSchema.parse(
        await service(input.projectSessionId).setThinkingLevel(input.level)
      )
    )
  })
  ipc.handle(IPC_CHANNELS.notebookChatSubscribe, async (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = notebookChatSubscribeInputSchema.parse(raw)
    options.broker.subscribe(event.sender, input.projectSessionId)
    try {
      return notebookChatSubscribeResultSchema.parse({
        snapshot: await service(input.projectSessionId).snapshot()
      })
    } catch (err) {
      options.broker.unsubscribe(event.sender.id, input.projectSessionId)
      options.logger.error(
        {
          event: 'knowledge.notebook.subscribe.failed',
          err,
          projectSessionId: input.projectSessionId,
          senderId: event.sender.id
        },
        'Notebook subscription failed'
      )
      throw new Error('Notebook could not connect', { cause: err })
    }
  })
  ipc.handle(IPC_CHANNELS.notebookChatUnsubscribe, (event, raw: unknown) => {
    authorizeSender(event.senderFrame, options.developmentUrl)
    const input = notebookChatUnsubscribeInputSchema.parse(raw)
    options.broker.unsubscribe(event.sender.id, input.projectSessionId)
  })

  return {
    revokeSession(projectSessionId) {
      options.broker.revokeSession(projectSessionId)
    },
    unregister() {
      for (const channel of [
        IPC_CHANNELS.notebookChatSnapshot,
        IPC_CHANNELS.notebookChatStartTurn,
        IPC_CHANNELS.notebookChatStopTurn,
        IPC_CHANNELS.notebookChatClear,
        IPC_CHANNELS.notebookChatSetSources,
        IPC_CHANNELS.notebookChatSetModel,
        IPC_CHANNELS.notebookChatSetThinkingLevel,
        IPC_CHANNELS.notebookChatSubscribe,
        IPC_CHANNELS.notebookChatUnsubscribe
      ]) {
        ipc.removeHandler(channel)
      }
      options.broker.clear()
    }
  }
}

function safeNotebookError(error: unknown): string {
  if (!(error instanceof Error)) return 'Notebook operation failed'
  if (
    error.message.startsWith('Notebook ') ||
    error.message.startsWith('A Notebook ') ||
    error.message.startsWith('Select ') ||
    error.message.startsWith('Only currently indexed') ||
    error.message.startsWith('Stop the active') ||
    error.message.startsWith('Configure and select') ||
    error.message.startsWith('Up to ')
  ) {
    return error.message.slice(0, 1_000)
  }
  return 'Notebook operation failed'
}
