import { ipcRenderer } from 'electron'
import {
  projectLifecycleEventSchema,
  projectSessionInputSchema
} from '../shared/contracts/projects'
import { projectIpcEndpoints } from '../shared/contracts/ipc-endpoints-project'
import type { DesktopApi } from './desktop-api'
import { invokeIpcEndpoint } from './ipc-endpoint'

export const projectsApi: DesktopApi['projects'] = {
  async lifecycle() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.lifecycle)
  },
  async recent() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.recent)
  },
  async removeRecent(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.removeRecent, input)
  },
  async create(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.create, input)
  },
  async open() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.open)
  },
  async openRecent(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.openRecent, input)
  },
  async close(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.close, input)
  },
  async switch(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.switch, input)
  },
  async clone(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.clone, input)
  },
  async cancelClone(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.cancelClone, input)
  },
  async templates() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.templates)
  },
  async previewTemplate(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.previewTemplate, input)
  },
  async saveTemplate(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.saveTemplate, input)
  },
  async deleteTemplate(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.deleteTemplate, input)
  },
  async retryOpen() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.retryOpen, {})
  },
  async recoverStaleLock() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.recoverStaleLock, {})
  },
  async retryClose() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.retryClose, {})
  },
  async discardIncompleteCreate() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.discardIncompleteCreate, {})
  },
  async locateMoved() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.locateMoved, {})
  },
  async exportRecoveryDiagnostics() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.exportRecoveryDiagnostics, {})
  },
  async returnToClosed() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.returnToClosed, {})
  },
  async createSnapshot(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.createSnapshot, input)
  },
  async restoreSnapshot() {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.restoreSnapshot, {})
  },
  async exportManuscript(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.exportManuscript, input)
  },
  async cancelManuscriptExport(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.cancelManuscriptExport, input)
  },
  async versionHistoryStatus(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.versionHistoryStatus, input)
  },
  async enableVersionHistory(input) {
    return (await invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.enableVersionHistory, input))
      .checkpoint
  },
  async reinitializeVersionHistory(input) {
    return (
      await invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.reinitializeVersionHistory, input)
    ).checkpoint
  },
  async dismissVersionHistoryPrompt(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.dismissVersionHistoryPrompt, input)
  },
  async createCheckpoint(input) {
    return (await invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.createCheckpoint, input))
      .checkpoint
  },
  async listCheckpoints(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.listCheckpoints, input)
  },
  async compareCheckpointState(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.compareCheckpointState, input)
  },
  async restoreCheckpoint(input) {
    return invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.restoreCheckpoint, input)
  },
  async subscribe(input, listener) {
    const parsedInput = projectSessionInputSchema.parse(input)
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const lifecycleEvent = projectLifecycleEventSchema.parse(value)
      if (lifecycleEvent.projectSessionId === parsedInput.projectSessionId) {
        listener(lifecycleEvent)
      }
    }
    ipcRenderer.on(projectIpcEndpoints.subscribe.channel, handler)
    try {
      await invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.subscribe, parsedInput)
    } catch (err) {
      ipcRenderer.removeListener(projectIpcEndpoints.subscribe.channel, handler)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(projectIpcEndpoints.subscribe.channel, handler)
      void invokeIpcEndpoint(ipcRenderer, projectIpcEndpoints.unsubscribe, parsedInput)
    }
  }
}
