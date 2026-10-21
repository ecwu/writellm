import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  manuscriptReplacementChangedEventSchema,
  manuscriptReplacementSubscriptionInputSchema
} from '../shared/contracts/manuscript-replacement'
import { manuscriptIpcEndpoints } from '../shared/contracts/ipc-endpoints-manuscript'
import type { DesktopApi } from './desktop-api'
import { invokeIpcEndpoint } from './ipc-endpoint'

export const manuscriptApi: DesktopApi['manuscript'] = {
  async workspace(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.workspace, input)
  },
  async references(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.references, input)
  },
  async preview(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.preview, input)
  },
  async publicationPreview(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.publicationPreview, input)
  },
  async updateBrief(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.updateBrief, input)
  },
  async createSection(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.createSection, input)
  },
  async updateSection(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.updateSection, input)
  },
  async moveSection(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.moveSection, input)
  },
  async deleteSection(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.deleteSection, input)
  },
  async search(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.search, input)
  },
  async revalidateSearch(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.revalidateSearch, input)
  },
  async createReplacementPlan(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.createReplacementPlan, input)
  },
  async replacementPage(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.replacementPage, input)
  },
  async dismissReplacementPlan(input) {
    await invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.dismissReplacementPlan, input)
  },
  async applyReplacement(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.applyReplacement, input)
  },
  async undoReplacement(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.undoReplacement, input)
  },
  async subscribeReplacementChanges(input, listener) {
    const subscription = manuscriptReplacementSubscriptionInputSchema.parse({
      ...input,
      subscriptionId: globalThis.crypto.randomUUID()
    })
    const handler = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const changed = manuscriptReplacementChangedEventSchema.parse(value)
      if (changed.projectSessionId === input.projectSessionId) listener(changed)
    }
    ipcRenderer.on(IPC_CHANNELS.manuscriptReplacementChanged, handler)
    try {
      await invokeIpcEndpoint(
        ipcRenderer,
        manuscriptIpcEndpoints.replacementSubscribe,
        subscription
      )
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.manuscriptReplacementChanged, handler)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.manuscriptReplacementChanged, handler)
      void invokeIpcEndpoint(
        ipcRenderer,
        manuscriptIpcEndpoints.replacementUnsubscribe,
        subscription
      )
    }
  },
  async listComments(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.listComments, input)
  },
  async readComment(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.readComment, input)
  },
  async createComment(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.createComment, input)
  },
  async replyComment(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.replyComment, input)
  },
  async editComment(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.editComment, input)
  },
  async resolveComment(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.resolveComment, input)
  },
  async reopenComment(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.reopenComment, input)
  },
  async deleteComment(input) {
    await invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.deleteComment, input)
  },
  async reanchorComment(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.reanchorComment, input)
  },
  async delegateComments(input) {
    return invokeIpcEndpoint(ipcRenderer, manuscriptIpcEndpoints.delegateComments, input)
  }
}
