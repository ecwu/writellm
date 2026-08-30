import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  agentCustomPresetInputSchema,
  agentAuthFlowInputSchema,
  agentAuthInteractionEventSchema,
  agentAuthPromptResponseSchema,
  agentManualModelInputSchema,
  agentManualModelRemoveInputSchema,
  agentModelEnabledInputSchema,
  agentModelSelectionSchema,
  agentProviderEnabledInputSchema,
  agentPresetInputSchema,
  agentPresetCredentialInputSchema,
  agentPresetLoginInputSchema,
  providerConnectionTestResultSchema,
  imageProviderSelectionInputSchema,
  providerRoleInputSchema,
  providerSaveInputSchema,
  providerSettingsSnapshotSchema
} from '../shared/contracts/providers'
import type { DesktopApi } from './desktop-api'

export const providersApi: DesktopApi['providers'] = {
  async snapshot() {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.providersSnapshot)
    )
  },
  async save(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.providersSave, providerSaveInputSchema.parse(input))
    )
  },
  async remove(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.providersRemove, providerRoleInputSchema.parse(input))
    )
  },
  async testConnection(input) {
    return providerConnectionTestResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersTestConnection,
        providerRoleInputSchema.parse(input)
      )
    )
  },
  async setActiveImage(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersSetActiveImage,
        imageProviderSelectionInputSchema.parse(input)
      )
    )
  },
  async saveAgentPreset(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersSaveAgentPreset,
        agentCustomPresetInputSchema.parse(input)
      )
    )
  },
  async removeAgentPreset(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersRemoveAgentPreset,
        agentPresetInputSchema.parse(input)
      )
    )
  },
  async refreshAgentPreset(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersRefreshAgentPreset,
        agentPresetInputSchema.parse(input)
      )
    )
  },
  async setAgentDefault(selection) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersSetAgentDefault,
        agentModelSelectionSchema.nullable().parse(selection)
      )
    )
  },
  async setAgentCredential(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersSetAgentCredential,
        agentPresetCredentialInputSchema.parse(input)
      )
    )
  },
  async clearAgentCredential(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersClearAgentCredential,
        agentPresetInputSchema.parse(input)
      )
    )
  },
  async setAgentProviderEnabled(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersSetAgentProviderEnabled,
        agentProviderEnabledInputSchema.parse(input)
      )
    )
  },
  async setAgentModelEnabled(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersSetAgentModelEnabled,
        agentModelEnabledInputSchema.parse(input)
      )
    )
  },
  async saveAgentManualModel(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersSaveAgentManualModel,
        agentManualModelInputSchema.parse(input)
      )
    )
  },
  async removeAgentManualModel(input) {
    return providerSettingsSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.providersRemoveAgentManualModel,
        agentManualModelRemoveInputSchema.parse(input)
      )
    )
  },
  async loginAgentPreset(input, listener) {
    const parsedInput = agentPresetLoginInputSchema.parse(input)
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const parsed = agentAuthInteractionEventSchema.parse(value)
      if (parsed.flowId === parsedInput.flowId) listener(parsed)
    }
    ipcRenderer.on(IPC_CHANNELS.providersAgentAuthEvent, handler)
    try {
      return providerSettingsSnapshotSchema.parse(
        await ipcRenderer.invoke(IPC_CHANNELS.providersLoginAgentPreset, parsedInput)
      )
    } finally {
      ipcRenderer.removeListener(IPC_CHANNELS.providersAgentAuthEvent, handler)
    }
  },
  async respondAgentAuth(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.providersRespondAgentAuth,
      agentAuthPromptResponseSchema.parse(input)
    )
  },
  async cancelAgentAuth(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.providersCancelAgentAuth,
      agentAuthFlowInputSchema.parse(input)
    )
  }
}
