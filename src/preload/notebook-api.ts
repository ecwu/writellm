import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  notebookChatClearInputSchema,
  notebookChatCommandResultSchema,
  notebookChatEventSchema,
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
} from '../shared/contracts/notebook'
import type { DesktopApi } from './desktop-api'

export const notebookApi: DesktopApi['notebook'] = {
  async snapshot(input) {
    return notebookChatSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.notebookChatSnapshot,
        notebookChatSnapshotInputSchema.parse(input)
      )
    )
  },
  async startTurn(input) {
    return notebookChatStartTurnResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.notebookChatStartTurn,
        notebookChatStartTurnInputSchema.parse(input)
      )
    )
  },
  async stopTurn(input) {
    return notebookChatCommandResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.notebookChatStopTurn,
        notebookChatStopTurnInputSchema.parse(input)
      )
    )
  },
  async clear(input) {
    return notebookChatCommandResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.notebookChatClear,
        notebookChatClearInputSchema.parse(input)
      )
    )
  },
  async setSources(input) {
    return notebookChatCommandResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.notebookChatSetSources,
        notebookChatSetSourcesInputSchema.parse(input)
      )
    )
  },
  async setModel(input) {
    return notebookChatCommandResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.notebookChatSetModel,
        notebookChatSetModelInputSchema.parse(input)
      )
    )
  },
  async setThinkingLevel(input) {
    return notebookChatCommandResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.notebookChatSetThinkingLevel,
        notebookChatSetThinkingLevelInputSchema.parse(input)
      )
    )
  },
  async subscribe(input, listener) {
    const parsedInput = notebookChatSubscribeInputSchema.parse(input)
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const notebookEvent = notebookChatEventSchema.parse(value)
      if (notebookEvent.projectSessionId === parsedInput.projectSessionId) {
        listener(notebookEvent)
      }
    }
    ipcRenderer.on(IPC_CHANNELS.notebookChatEvent, handler)
    try {
      const result = notebookChatSubscribeResultSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.notebookChatSubscribe, parsedInput)
      )
      return {
        snapshot: result.snapshot,
        unsubscribe: () => {
          ipcRenderer.removeListener(IPC_CHANNELS.notebookChatEvent, handler)
          void ipcRenderer.invoke(
            IPC_CHANNELS.notebookChatUnsubscribe,
            notebookChatUnsubscribeInputSchema.parse(parsedInput)
          )
        }
      }
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.notebookChatEvent, handler)
      throw err
    }
  }
}
