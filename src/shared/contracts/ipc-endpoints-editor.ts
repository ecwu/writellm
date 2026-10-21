import { z } from 'zod'
import { IPC_CHANNELS } from './channels'
import {
  editorFlushAckInputSchema,
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
} from './manuscript'
import {
  manuscriptImportApplyInputSchema,
  manuscriptImportApplyResultSchema,
  manuscriptImportCancelInputSchema,
  manuscriptImportCancelResultSchema,
  manuscriptImportPlanRequestSchema,
  manuscriptImportPlanResultSchema
} from './manuscript-import'
import {
  deleteManuscriptAssetInputSchema,
  deleteManuscriptAssetResultSchema,
  manuscriptAssetWorkspaceInputSchema,
  manuscriptAssetWorkspacePageSchema
} from './manuscript-assets'
import { defineIpcEndpoint, type IpcEndpointApi, type IpcEndpointInput } from './ipc-endpoints'
import type { EditorFlushRequest } from './manuscript'

/** Typed editor IPC boundaries. Flush lifecycle channels keep explicit subscription semantics. */
export const editorIpcEndpoints = {
  open: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorOpen,
    input: editorSessionInputSchema,
    output: openEditorResultSchema,
    session: 'active'
  }),
  loadSection: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorLoadSection,
    input: loadSectionInputSchema,
    output: editorSectionSchema,
    session: 'active'
  }),
  setActiveSection: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorSetActiveSection,
    input: loadSectionInputSchema,
    output: z.undefined(),
    session: 'active'
  }),
  saveSectionDocument: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorSaveSectionDocument,
    input: saveSectionDocumentInputSchema,
    output: saveSectionDocumentResponseSchema,
    session: 'mutation'
  }),
  createImportPlan: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorCreateImportPlan,
    input: manuscriptImportPlanRequestSchema,
    output: manuscriptImportPlanResultSchema,
    session: 'mutation'
  }),
  applyImportPlan: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorApplyImportPlan,
    input: manuscriptImportApplyInputSchema,
    output: manuscriptImportApplyResultSchema,
    session: 'mutation'
  }),
  cancelImportPlan: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorCancelImportPlan,
    input: manuscriptImportCancelInputSchema,
    output: manuscriptImportCancelResultSchema,
    session: 'active'
  }),
  exportNativeJson: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorExportNativeJson,
    input: exportNativeJsonInputSchema,
    output: exportResultSchema,
    session: 'active'
  }),
  exportMarkdown: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorExportMarkdown,
    input: exportMarkdownInputSchema,
    output: exportResultSchema,
    session: 'active'
  }),
  uploadAsset: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorUploadAsset,
    input: uploadManuscriptAssetInputSchema,
    output: manuscriptAssetResultSchema,
    session: 'mutation'
  }),
  resolveAsset: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorResolveAsset,
    input: manuscriptAssetPreviewInputSchema,
    output: manuscriptAssetPreviewResultSchema,
    // The handler converts a revoked session into the typed session-revoked result.
    session: 'none'
  }),
  listAssets: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorListAssets,
    input: manuscriptAssetWorkspaceInputSchema,
    output: manuscriptAssetWorkspacePageSchema,
    session: 'active'
  }),
  deleteAsset: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorDeleteAsset,
    input: deleteManuscriptAssetInputSchema,
    output: deleteManuscriptAssetResultSchema,
    session: 'mutation'
  }),
  subscribeFlush: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorSubscribeFlush,
    input: editorFlushSubscriptionInputSchema,
    output: z.undefined(),
    session: 'active'
  }),
  unsubscribeFlush: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorUnsubscribeFlush,
    input: editorFlushSubscriptionInputSchema,
    output: z.undefined(),
    session: 'none'
  }),
  finalFlushSave: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorFinalFlushSave,
    input: finalFlushSaveInputSchema,
    output: saveSectionDocumentResponseSchema,
    session: 'none'
  }),
  acknowledgeFlush: defineIpcEndpoint({
    channel: IPC_CHANNELS.editorFlushAck,
    input: editorFlushAckInputSchema,
    output: z.undefined(),
    session: 'none'
  })
} as const

type EditorEndpointApi = IpcEndpointApi<typeof editorIpcEndpoints>

export type EditorIpcApi = Omit<EditorEndpointApi, 'subscribeFlush' | 'unsubscribeFlush'> & {
  subscribeFlush(
    input: IpcEndpointInput<typeof editorIpcEndpoints.open>,
    listener: (request: EditorFlushRequest) => void
  ): Promise<() => void>
}
