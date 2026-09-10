import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  autocompleteRequestIdentitySchema,
  autocompleteCancelSchema,
  autocompleteChangeSchema,
  autocompleteRequestSchema,
  autocompleteResultSchema,
  autocompleteSelectionSchema,
  autocompleteStyleSchema,
  autocompleteSessionInputSchema,
  autocompleteSessionSchema,
  autocompleteSettingsSchema,
  autocompleteToggleInputSchema,
  type AutocompleteApi
} from '../shared/contracts/autocomplete'
export const autocompleteApi: AutocompleteApi = {
  async settings() {
    return autocompleteSettingsSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.autocompleteSettings)
    )
  },
  async select(input) {
    return autocompleteSettingsSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.autocompleteSelect,
        autocompleteSelectionSchema.nullable().parse(input)
      )
    )
  },
  async setStyle(input) {
    return autocompleteSettingsSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.autocompleteStyle, autocompleteStyleSchema.parse(input))
    )
  },
  async session(input) {
    return autocompleteSessionSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.autocompleteSession,
        autocompleteSessionInputSchema.parse(input)
      )
    )
  },
  async toggle(input) {
    return autocompleteSessionSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.autocompleteToggle,
        autocompleteToggleInputSchema.parse(input)
      )
    )
  },
  async complete(input) {
    return autocompleteResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.autocompleteComplete,
        autocompleteRequestSchema.parse(input)
      )
    )
  },
  async cancel(input) {
    await ipcRenderer.invoke(IPC_CHANNELS.autocompleteCancel, autocompleteCancelSchema.parse(input))
  },
  async accepted(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.autocompleteAccepted,
      autocompleteRequestIdentitySchema.parse(input)
    )
  },
  subscribeChanges(listener) {
    const handler = (_event: Electron.IpcRendererEvent, raw: unknown): void =>
      listener(autocompleteChangeSchema.parse(raw))
    ipcRenderer.on(IPC_CHANNELS.autocompleteChanged, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.autocompleteChanged, handler)
  }
}
