import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import { manuscriptWorkspaceSchema } from '../shared/contracts/manuscript'
import { updateWritingRulesIpcInputSchema } from '../shared/contracts/writing-rules-ipc'
import type { DesktopApi } from './desktop-api'

export const writingRulesApi: DesktopApi['writingRules'] = {
  async update(input) {
    return manuscriptWorkspaceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.writingRulesUpdate,
        updateWritingRulesIpcInputSchema.parse(input)
      )
    )
  }
}
