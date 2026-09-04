import { ipcRenderer, webUtils } from 'electron'
import { IPC_CHANNELS } from '../shared/contracts/channels'
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
} from '../shared/contracts/knowledge'
import {
  knowledgeMappingPageInputSchema,
  knowledgeMappingPageSchema,
  pdfPreviewInputSchema,
  pdfPreviewReleaseInputSchema,
  pdfPreviewResultSchema
} from '../shared/contracts/knowledge-mapping'
import {
  citationExpansionInputSchema,
  citationExpansionResultSchema,
  knowledgeSearchInputSchema,
  knowledgeSearchResultSchema,
  readableCitationResolutionInputSchema,
  readableCitationResolutionResultSchema
} from '../shared/contracts/search'
import {
  bibliographyChooseInputSchema,
  bibliographyPrepareImportInputSchema,
  bibliographyImportPlanSchema,
  bibliographyImportAttachmentsPageInputSchema,
  bibliographyImportAttachmentsPageSchema,
  bibliographyConfirmImportInputSchema,
  bibliographyConfirmImportResultSchema,
  bibliographyExportInputSchema,
  bibliographyExportResultSchema,
  legacyCitationConversionPlanInputSchema,
  legacyCitationConversionPlanSchema,
  legacyCitationConversionApplyInputSchema,
  legacyCitationConversionApplyResultSchema,
  bibliographySnapshotInputSchema,
  bibliographySnapshotResultSchema,
  formattedReferenceSnapshotInputSchema,
  formattedReferenceSnapshotSchema,
  referenceListInputSchema,
  referenceListResultSchema,
  referenceSearchInputSchema,
  referenceSearchResultSchema,
  referenceSettingsInputSchema,
  referenceCustomStyleInputSchema,
  referenceSettingsSchema
} from '../shared/contracts/references'
import type { DesktopApi } from './desktop-api'

export const knowledgeApi: DesktopApi['knowledge'] = {
  async listReferences(input) {
    return referenceListResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.referenceList, referenceListInputSchema.parse(input))
    )
  },
  async searchReferences(input) {
    return referenceSearchResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceSearch,
        referenceSearchInputSchema.parse(input)
      )
    )
  },
  async bibliographySnapshot(input) {
    return bibliographySnapshotResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceBibliographySnapshot,
        bibliographySnapshotInputSchema.parse(input)
      )
    )
  },
  async chooseBibliography(input) {
    return bibliographySnapshotResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceChooseBibliography,
        bibliographyChooseInputSchema.parse(input)
      )
    )
  },
  async refreshBibliography(input) {
    return bibliographySnapshotResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceRefreshBibliography,
        bibliographySnapshotInputSchema.parse(input)
      )
    )
  },
  async prepareReferenceImport(input) {
    return bibliographyImportPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referencePrepareImport,
        bibliographyPrepareImportInputSchema.parse(input)
      )
    )
  },
  async referenceImportAttachmentsPage(input) {
    return bibliographyImportAttachmentsPageSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceImportAttachmentsPage,
        bibliographyImportAttachmentsPageInputSchema.parse(input)
      )
    )
  },
  async confirmReferenceImport(input) {
    return bibliographyConfirmImportResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceConfirmImport,
        bibliographyConfirmImportInputSchema.parse(input)
      )
    )
  },
  async exportBibliography(input) {
    return bibliographyExportResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceExportBibliography,
        bibliographyExportInputSchema.parse(input)
      )
    )
  },
  async planLegacyCitationConversion(input) {
    return legacyCitationConversionPlanSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referencePlanLegacyConversion,
        legacyCitationConversionPlanInputSchema.parse(input)
      )
    )
  },
  async applyLegacyCitationConversion(input) {
    return legacyCitationConversionApplyResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceApplyLegacyConversion,
        legacyCitationConversionApplyInputSchema.parse(input)
      )
    )
  },
  async referenceSettings(input) {
    return referenceSettingsSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceGetSettings,
        bibliographySnapshotInputSchema.parse(input)
      )
    )
  },
  async setReferenceSettings(input) {
    return referenceSettingsSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceSetSettings,
        referenceSettingsInputSchema.parse(input)
      )
    )
  },
  async chooseCustomReferenceStyle(input) {
    return referenceSettingsSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceChooseCustomStyle,
        referenceCustomStyleInputSchema.parse(input)
      )
    )
  },
  async formatReferences(input) {
    return formattedReferenceSnapshotSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.referenceFormatSnapshot,
        formattedReferenceSnapshotInputSchema.parse(input)
      )
    )
  },
  async list(input) {
    return knowledgeListResultSchema.parse(
      await ipcRenderer.invoke(IPC_CHANNELS.knowledgeList, knowledgeListInputSchema.parse(input))
    )
  },
  async indexStatus(input) {
    return knowledgeIndexStatusSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeIndexStatus,
        knowledgeListInputSchema.parse(input)
      )
    )
  },
  async citationCoveragePage(input) {
    return knowledgeCitationCoveragePageResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeCitationCoveragePage,
        knowledgeCitationCoveragePageInputSchema.parse(input)
      )
    )
  },
  async chooseAndImport(input) {
    return knowledgeListResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeChooseAndImport,
        knowledgeListInputSchema.parse(input)
      )
    )
  },
  async importDropped(input) {
    const paths = input.files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)
    return knowledgeListResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeImportDropped,
        knowledgeImportPathsInputSchema.parse({
          projectSessionId: input.projectSessionId,
          paths
        })
      )
    )
  },
  async cancel(input) {
    return knowledgeListResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeCancel,
        knowledgeItemActionInputSchema.parse(input)
      )
    )
  },
  async delete(input) {
    return knowledgeListResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeDelete,
        knowledgeItemActionInputSchema.parse(input)
      )
    )
  },
  async reveal(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.knowledgeReveal,
      knowledgeItemActionInputSchema.parse(input)
    )
  },
  async openOriginal(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.knowledgeOpenOriginal,
      knowledgeItemActionInputSchema.parse(input)
    )
  },
  async startParse(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.knowledgeStartParse,
      knowledgeItemActionInputSchema.parse(input)
    )
  },
  async cancelParse(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.knowledgeCancelParse,
      knowledgeItemActionInputSchema.parse(input)
    )
  },
  async refreshEmbeddings(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.knowledgeRefreshEmbeddings,
      knowledgeEmbeddingRefreshInputSchema.parse(input)
    )
  },
  async createPdfPreview(input) {
    return pdfPreviewResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeCreatePdfPreview,
        pdfPreviewInputSchema.parse(input)
      )
    )
  },
  async releasePdfPreview(input) {
    await ipcRenderer.invoke(
      IPC_CHANNELS.knowledgeReleasePdfPreview,
      pdfPreviewReleaseInputSchema.parse(input)
    )
  },
  async mappingPage(input) {
    return knowledgeMappingPageSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeMappingPage,
        knowledgeMappingPageInputSchema.parse(input)
      )
    )
  },
  async parsedMetadata(input) {
    return parsedKnowledgeMetadataSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeParsedMetadata,
        knowledgeItemActionInputSchema.parse(input)
      )
    )
  },
  async parsedBlocks(input) {
    return parsedKnowledgeBlockPageSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeParsedBlocks,
        parsedKnowledgeBlockPageInputSchema.parse(input)
      )
    )
  },
  async parsedMarkdown(input) {
    return parsedKnowledgeMarkdownSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeParsedMarkdown,
        parsedKnowledgeMarkdownInputSchema.parse(input)
      )
    )
  },
  async parsedAsset(input) {
    return parsedKnowledgeAssetSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeParsedAsset,
        parsedKnowledgeAssetInputSchema.parse(input)
      )
    )
  },
  async search(input) {
    return knowledgeSearchResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeSearch,
        knowledgeSearchInputSchema.parse(input)
      )
    )
  },
  async expandCitations(input) {
    return citationExpansionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeExpandCitations,
        citationExpansionInputSchema.parse(input)
      )
    )
  },
  async resolveReadableCitation(input) {
    return readableCitationResolutionResultSchema.parse(
      await ipcRenderer.invoke(
        IPC_CHANNELS.knowledgeResolveReadableCitation,
        readableCitationResolutionInputSchema.parse(input)
      )
    )
  }
}
