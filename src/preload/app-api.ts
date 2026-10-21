import { ipcRenderer } from 'electron'
import { appIpcEndpoints } from '../shared/contracts/ipc-endpoints'
import type { DesktopApi } from './desktop-api'
import { invokeIpcEndpoint } from './ipc-endpoint'

export const appApi: DesktopApi['app'] = {
  async quit() {
    await invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.quit)
  },
  async getInfo() {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.getInfo)
  },
  async getThemePreference() {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.getThemePreference)
  },
  async setThemePreference(input) {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.setThemePreference, input)
  },
  async getAccentPreference() {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.getAccentPreference)
  },
  async setAccentPreference(input) {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.setAccentPreference, input)
  },
  async getCitationDisplayMode() {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.getCitationDisplayMode)
  },
  async setCitationDisplayMode(input) {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.setCitationDisplayMode, input)
  },
  async getDefaultAgentApprovalMode() {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.getDefaultAgentApprovalMode)
  },
  async setDefaultAgentApprovalMode(input) {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.setDefaultAgentApprovalMode, input)
  },
  async getOnboardingState() {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.getOnboardingState)
  },
  async setOnboardingState(input) {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.setOnboardingState, input)
  },
  async publicationPresets() {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.publicationPresets)
  },
  async createPublicationPreset(input) {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.createPublicationPreset, input)
  },
  async updatePublicationPreset(input) {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.updatePublicationPreset, input)
  },
  async deletePublicationPreset(input) {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.deletePublicationPreset, input)
  },
  async setDefaultPublicationPreset(input) {
    return invokeIpcEndpoint(ipcRenderer, appIpcEndpoints.setDefaultPublicationPreset, input)
  }
}
