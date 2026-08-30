import { ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
import {
  editorFlushAckInputSchema,
  editorFlushRequestSchema,
  editorFlushSubscriptionInputSchema,
  editorSectionSchema,
  editorSessionInputSchema,
  exportMarkdownInputSchema,
  exportNativeJsonInputSchema,
  exportResultSchema,
  finalFlushSaveInputSchema,
  loadSectionInputSchema,
  manuscriptAssetPreviewInputSchema,
  manuscriptAssetPreviewResultSchema,
  manuscriptAssetResultSchema,
  openEditorResultSchema,
  saveSectionDocumentInputSchema,
  saveSectionDocumentResponseSchema,
  uploadManuscriptAssetInputSchema
} from '../shared/contracts/manuscript'
import {
  manuscriptImportApplyInputSchema,
  manuscriptImportApplyResultSchema,
  manuscriptImportCancelInputSchema,
  manuscriptImportCancelResultSchema,
  manuscriptImportPlanRequestSchema,
  manuscriptImportPlanResultSchema
} from '../shared/contracts/manuscript-import'
import {
  deleteManuscriptAssetInputSchema,
  deleteManuscriptAssetResultSchema,
  manuscriptAssetWorkspaceInputSchema,
  manuscriptAssetWorkspacePageSchema
} from '../shared/contracts/manuscript-assets'
import type { DesktopApi } from './desktop-api'

export const editorApi: DesktopApi['editor'] = {
  async open(input) {
    return openEditorResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.editorOpen, editorSessionInputSchema.parse(input))
    )
  },
  async loadSection(input) {
    return editorSectionSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.editorLoadSection, loadSectionInputSchema.parse(input))
    )
  },
  async setActiveSection(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.editorSetActiveSection,
      loadSectionInputSchema.parse(input)
    )
  },
  async saveSectionDocument(input) {
    return saveSectionDocumentResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorSaveSectionDocument,
        saveSectionDocumentInputSchema.parse(input)
      )
    )
  },
  async createImportPlan(input) {
    return manuscriptImportPlanResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorCreateImportPlan,
        manuscriptImportPlanRequestSchema.parse(input)
      )
    )
  },
  async applyImportPlan(input) {
    return manuscriptImportApplyResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorApplyImportPlan,
        manuscriptImportApplyInputSchema.parse(input)
      )
    )
  },
  async cancelImportPlan(input) {
    return manuscriptImportCancelResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorCancelImportPlan,
        manuscriptImportCancelInputSchema.parse(input)
      )
    )
  },
  async exportNativeJson(input) {
    return exportResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorExportNativeJson,
        exportNativeJsonInputSchema.parse(input)
      )
    )
  },
  async exportMarkdown(input) {
    return exportResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorExportMarkdown,
        exportMarkdownInputSchema.parse(input)
      )
    )
  },
  async uploadAsset(input) {
    return manuscriptAssetResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorUploadAsset,
        uploadManuscriptAssetInputSchema.parse(input)
      )
    )
  },
  async resolveAsset(input) {
    return manuscriptAssetPreviewResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorResolveAsset,
        manuscriptAssetPreviewInputSchema.parse(input)
      )
    )
  },
  async listAssets(input) {
    return manuscriptAssetWorkspacePageSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorListAssets,
        manuscriptAssetWorkspaceInputSchema.parse(input)
      )
    )
  },
  async deleteAsset(input) {
    return deleteManuscriptAssetResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorDeleteAsset,
        deleteManuscriptAssetInputSchema.parse(input)
      )
    )
  },
  async finalFlushSave(input) {
    return saveSectionDocumentResponseSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.editorFinalFlushSave,
        finalFlushSaveInputSchema.parse(input)
      )
    )
  },
  async acknowledgeFlush(input) {
    await ipcRenderer.invoke(IPC_CHANNELS.editorFlushAck, editorFlushAckInputSchema.parse(input))
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
      await ipcRenderer.invoke(IPC_CHANNELS.editorSubscribeFlush, parsed)
    } catch (err) {
      ipcRenderer.removeListener(IPC_CHANNELS.editorFlushRequest, handler)
      throw err
    }
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.editorFlushRequest, handler)
      void ipcRenderer.invoke(IPC_CHANNELS.editorUnsubscribeFlush, parsed)
    }
  }
}
