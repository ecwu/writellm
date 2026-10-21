import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  editorFlushRequestSchema,
  editorFlushSubscriptionInputSchema,
  editorSessionInputSchema
} from '../shared/contracts/manuscript'
import { editorIpcEndpoints } from '../shared/contracts/ipc-endpoints-editor'
import type { DesktopApi } from './desktop-api'
import { invokeIpcEndpoint } from './ipc-endpoint'

export const editorApi: DesktopApi['editor'] = {
  async open(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.open, input)
  },
  async loadSection(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.loadSection, input)
  },
  async setActiveSection(input) {
    await invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.setActiveSection, input)
  },
  async saveSectionDocument(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.saveSectionDocument, input)
  },
  async createImportPlan(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.createImportPlan, input)
  },
  async applyImportPlan(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.applyImportPlan, input)
  },
  async cancelImportPlan(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.cancelImportPlan, input)
  },
  async exportNativeJson(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.exportNativeJson, input)
  },
  async exportMarkdown(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.exportMarkdown, input)
  },
  async uploadAsset(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.uploadAsset, input)
  },
  async resolveAsset(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.resolveAsset, input)
  },
  async listAssets(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.listAssets, input)
  },
  async deleteAsset(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.deleteAsset, input)
  },
  async finalFlushSave(input) {
    return invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.finalFlushSave, input)
  },
  async acknowledgeFlush(input) {
    await invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.acknowledgeFlush, input)
  },
  async subscribeFlush(input, listener) {
    const session = editorSessionInputSchema.parse(input)
    const parsed = editorFlushSubscriptionInputSchema.parse({
      ...session,
      subscriptionId: globalThis.crypto.randomUUID()
    })
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const request = editorFlushRequestSchema.parse(value)
      if (request.projectSessionId === session.projectSessionId) listener(request)
    }
    ipcRenderer.on(IPC_CHANNELS.editorFlushRequest, handler)
    try {
      await invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.subscribeFlush, parsed)
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.editorFlushRequest, handler)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.editorFlushRequest, handler)
      void invokeIpcEndpoint(ipcRenderer, editorIpcEndpoints.unsubscribeFlush, parsed)
    }
  }
}
