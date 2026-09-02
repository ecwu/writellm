import { ipcRenderer } from 'electron'
import {
  accentPreferenceSchema,
  appInfoSchema,
  appQuitResultSchema,
  citationDisplayModeSchema,
  onboardingStateSchema,
  setAccentPreferenceInputSchema,
  setCitationDisplayModeInputSchema,
  setDefaultAgentApprovalModeInputSchema,
  setOnboardingStateInputSchema,
  setThemePreferenceInputSchema,
  themePreferenceSchema
} from '../shared/contracts/app'
import { agentApprovalModeSchema } from '../shared/contracts/agent'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  createPublicationPresetInputSchema,
  publicationPresetIdInputSchema,
  publicationPresetSnapshotSchema,
  updatePublicationPresetInputSchema
} from '../shared/contracts/publication-presets'
import type { DesktopApi } from './desktop-api'

export const appApi: DesktopApi['app'] = {
  async quit() {
    appQuitResultSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.appQuit))
  },
  async getInfo() {
    return appInfoSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.appGetInfo))
  },
  async getThemePreference() {
    return themePreferenceSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.appGetThemePreference))
  },
  async setThemePreference(input) {
    return themePreferenceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.appSetThemePreference,
        setThemePreferenceInputSchema.parse(input)
      )
    )
  },
  async getAccentPreference() {
    return accentPreferenceSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.appGetAccentPreference)
    )
  },
  async setAccentPreference(input) {
    return accentPreferenceSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.appSetAccentPreference,
        setAccentPreferenceInputSchema.parse(input)
      )
    )
  },
  async getCitationDisplayMode() {
    return citationDisplayModeSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.appGetCitationDisplayMode)
    )
  },
  async setCitationDisplayMode(input) {
    return citationDisplayModeSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.appSetCitationDisplayMode,
        setCitationDisplayModeInputSchema.parse(input)
      )
    )
  },
  async getDefaultAgentApprovalMode() {
    return agentApprovalModeSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.appGetDefaultAgentApprovalMode)
    )
  },
  async setDefaultAgentApprovalMode(input) {
    return agentApprovalModeSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.appSetDefaultAgentApprovalMode,
        setDefaultAgentApprovalModeInputSchema.parse(input)
      )
    )
  },
  async getOnboardingState() {
    return onboardingStateSchema.parse(await ipcRenderer.invoke(IPC_CHANNELS.appGetOnboardingState))
  },
  async setOnboardingState(input) {
    return onboardingStateSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.appSetOnboardingState,
        setOnboardingStateInputSchema.parse(input)
      )
    )
  },
  async publicationPresets() {
    return publicationPresetSnapshotSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.publicationPresetsSnapshot)
    )
  },
  async createPublicationPreset(input) {
    return publicationPresetSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.publicationPresetsCreate,
        createPublicationPresetInputSchema.parse(input)
      )
    )
  },
  async updatePublicationPreset(input) {
    return publicationPresetSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.publicationPresetsUpdate,
        updatePublicationPresetInputSchema.parse(input)
      )
    )
  },
  async deletePublicationPreset(input) {
    return publicationPresetSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.publicationPresetsDelete,
        publicationPresetIdInputSchema.parse(input)
      )
    )
  },
  async setDefaultPublicationPreset(input) {
    return publicationPresetSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.publicationPresetsSetDefault,
        publicationPresetIdInputSchema.parse(input)
      )
    )
  }
}
