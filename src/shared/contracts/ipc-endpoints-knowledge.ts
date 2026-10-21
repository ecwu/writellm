import { z } from 'zod'
import { IPC_CHANNELS } from './channels'
import {
  knowledgeCitationCoveragePageInputSchema,
  knowledgeCitationCoveragePageResultSchema,
  knowledgeEmbeddingRefreshInputSchema,
  knowledgeImportPathsInputSchema,
  knowledgeIndexStatusSchema,
  knowledgeItemActionInputSchema,
  knowledgeListInputSchema,
  knowledgeListResultSchema,
  parsedKnowledgeAssetInputSchema,
  parsedKnowledgeAssetSchema,
  parsedKnowledgeBlockPageInputSchema,
  parsedKnowledgeBlockPageSchema,
  parsedKnowledgeMarkdownInputSchema,
  parsedKnowledgeMarkdownSchema,
  parsedKnowledgeMetadataSchema
} from './knowledge'
import {
  knowledgeMappingPageInputSchema,
  knowledgeMappingPageSchema,
  pdfPreviewInputSchema,
  pdfPreviewReleaseInputSchema,
  pdfPreviewResultSchema
} from './knowledge-mapping'
import {
  citationExpansionInputSchema,
  citationExpansionResultSchema,
  knowledgeSearchInputSchema,
  knowledgeSearchResultSchema,
  readableCitationResolutionInputSchema,
  readableCitationResolutionResultSchema
} from './search'
import {
  bibliographyChooseInputSchema,
  bibliographyConfirmImportInputSchema,
  bibliographyConfirmImportResultSchema,
  bibliographyExportInputSchema,
  bibliographyExportResultSchema,
  bibliographyImportAttachmentsPageInputSchema,
  bibliographyImportAttachmentsPageSchema,
  bibliographyImportPlanSchema,
  bibliographyPrepareImportInputSchema,
  bibliographySnapshotInputSchema,
  bibliographySnapshotResultSchema,
  formattedReferenceSnapshotInputSchema,
  formattedReferenceSnapshotSchema,
  legacyCitationConversionApplyInputSchema,
  legacyCitationConversionApplyResultSchema,
  legacyCitationConversionPlanInputSchema,
  legacyCitationConversionPlanSchema,
  referenceCustomStyleInputSchema,
  referenceListInputSchema,
  referenceListResultSchema,
  referenceSearchInputSchema,
  referenceSearchResultSchema,
  referenceSettingsInputSchema,
  referenceSettingsSchema
} from './references'
import {
  defineIpcEndpoint,
  type IpcEndpointApi,
  type IpcEndpointInput,
  type IpcEndpointOutput
} from './ipc-endpoints'

const undefinedOutput = z.undefined()

/** Knowledge and references use one table while keeping dialog and file conversion explicit. */
export const knowledgeIpcEndpoints = {
  listReferences: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceList,
    input: referenceListInputSchema,
    output: referenceListResultSchema,
    session: 'active'
  }),
  searchReferences: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceSearch,
    input: referenceSearchInputSchema,
    output: referenceSearchResultSchema,
    session: 'active'
  }),
  bibliographySnapshot: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceBibliographySnapshot,
    input: bibliographySnapshotInputSchema,
    output: bibliographySnapshotResultSchema,
    session: 'active'
  }),
  chooseBibliography: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceChooseBibliography,
    input: bibliographyChooseInputSchema,
    output: bibliographySnapshotResultSchema,
    session: 'mutation'
  }),
  refreshBibliography: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceRefreshBibliography,
    input: bibliographySnapshotInputSchema,
    output: bibliographySnapshotResultSchema,
    session: 'active'
  }),
  prepareReferenceImport: defineIpcEndpoint({
    channel: IPC_CHANNELS.referencePrepareImport,
    input: bibliographyPrepareImportInputSchema,
    output: bibliographyImportPlanSchema,
    session: 'mutation'
  }),
  referenceImportAttachmentsPage: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceImportAttachmentsPage,
    input: bibliographyImportAttachmentsPageInputSchema,
    output: bibliographyImportAttachmentsPageSchema,
    session: 'active'
  }),
  confirmReferenceImport: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceConfirmImport,
    input: bibliographyConfirmImportInputSchema,
    output: bibliographyConfirmImportResultSchema,
    session: 'mutation'
  }),
  exportBibliography: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceExportBibliography,
    input: bibliographyExportInputSchema,
    output: bibliographyExportResultSchema,
    session: 'active'
  }),
  planLegacyCitationConversion: defineIpcEndpoint({
    channel: IPC_CHANNELS.referencePlanLegacyConversion,
    input: legacyCitationConversionPlanInputSchema,
    output: legacyCitationConversionPlanSchema,
    session: 'active'
  }),
  applyLegacyCitationConversion: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceApplyLegacyConversion,
    input: legacyCitationConversionApplyInputSchema,
    output: legacyCitationConversionApplyResultSchema,
    // The handler maps a revoked session to a durable stale-plan result and safe error cause.
    session: 'none'
  }),
  referenceSettings: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceGetSettings,
    input: bibliographySnapshotInputSchema,
    output: referenceSettingsSchema,
    session: 'active'
  }),
  setReferenceSettings: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceSetSettings,
    input: referenceSettingsInputSchema,
    output: referenceSettingsSchema,
    session: 'mutation'
  }),
  chooseCustomReferenceStyle: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceChooseCustomStyle,
    input: referenceCustomStyleInputSchema,
    output: referenceSettingsSchema,
    session: 'mutation'
  }),
  formatReferences: defineIpcEndpoint({
    channel: IPC_CHANNELS.referenceFormatSnapshot,
    input: formattedReferenceSnapshotInputSchema,
    output: formattedReferenceSnapshotSchema,
    session: 'active'
  }),
  list: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeList,
    input: knowledgeListInputSchema,
    output: knowledgeListResultSchema,
    session: 'active'
  }),
  indexStatus: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeIndexStatus,
    input: knowledgeListInputSchema,
    output: knowledgeIndexStatusSchema,
    session: 'active'
  }),
  citationCoveragePage: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeCitationCoveragePage,
    input: knowledgeCitationCoveragePageInputSchema,
    output: knowledgeCitationCoveragePageResultSchema,
    session: 'active'
  }),
  chooseAndImport: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeChooseAndImport,
    input: knowledgeListInputSchema,
    output: knowledgeListResultSchema,
    session: 'mutation'
  }),
  importDropped: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeImportDropped,
    input: knowledgeImportPathsInputSchema,
    output: knowledgeListResultSchema,
    session: 'mutation'
  }),
  cancel: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeCancel,
    input: knowledgeItemActionInputSchema,
    output: knowledgeListResultSchema,
    session: 'mutation'
  }),
  delete: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeDelete,
    input: knowledgeItemActionInputSchema,
    output: knowledgeListResultSchema,
    session: 'mutation'
  }),
  reveal: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeReveal,
    input: knowledgeItemActionInputSchema,
    output: undefinedOutput,
    session: 'active'
  }),
  openOriginal: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeOpenOriginal,
    input: knowledgeItemActionInputSchema,
    output: undefinedOutput,
    session: 'active'
  }),
  startParse: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeStartParse,
    input: knowledgeItemActionInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  cancelParse: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeCancelParse,
    input: knowledgeItemActionInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  refreshEmbeddings: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeRefreshEmbeddings,
    input: knowledgeEmbeddingRefreshInputSchema,
    output: undefinedOutput,
    session: 'mutation'
  }),
  createPdfPreview: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeCreatePdfPreview,
    input: pdfPreviewInputSchema,
    output: pdfPreviewResultSchema,
    session: 'active'
  }),
  releasePdfPreview: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeReleasePdfPreview,
    input: pdfPreviewReleaseInputSchema,
    output: undefinedOutput,
    session: 'active'
  }),
  mappingPage: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeMappingPage,
    input: knowledgeMappingPageInputSchema,
    output: knowledgeMappingPageSchema,
    session: 'active'
  }),
  parsedMetadata: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeParsedMetadata,
    input: knowledgeItemActionInputSchema,
    output: parsedKnowledgeMetadataSchema,
    session: 'active'
  }),
  parsedBlocks: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeParsedBlocks,
    input: parsedKnowledgeBlockPageInputSchema,
    output: parsedKnowledgeBlockPageSchema,
    session: 'active'
  }),
  parsedMarkdown: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeParsedMarkdown,
    input: parsedKnowledgeMarkdownInputSchema,
    output: parsedKnowledgeMarkdownSchema,
    session: 'active'
  }),
  parsedAsset: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeParsedAsset,
    input: parsedKnowledgeAssetInputSchema,
    output: parsedKnowledgeAssetSchema,
    session: 'active'
  }),
  search: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeSearch,
    input: knowledgeSearchInputSchema,
    output: knowledgeSearchResultSchema,
    session: 'active'
  }),
  expandCitations: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeExpandCitations,
    input: citationExpansionInputSchema,
    output: citationExpansionResultSchema,
    session: 'active'
  }),
  resolveReadableCitation: defineIpcEndpoint({
    channel: IPC_CHANNELS.knowledgeResolveReadableCitation,
    input: readableCitationResolutionInputSchema,
    output: readableCitationResolutionResultSchema,
    session: 'active'
  })
} as const

type KnowledgeEndpointApi = IpcEndpointApi<typeof knowledgeIpcEndpoints>

export type KnowledgeIpcApi = Omit<KnowledgeEndpointApi, 'importDropped'> & {
  importDropped(input: {
    projectSessionId: string
    files: File[]
  }): Promise<IpcEndpointOutput<typeof knowledgeIpcEndpoints.importDropped>>
}

export type KnowledgeImportIpcInput = IpcEndpointInput<typeof knowledgeIpcEndpoints.importDropped>
