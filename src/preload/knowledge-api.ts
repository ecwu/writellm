import { ipcRenderer, webUtils } from 'electron'
import { knowledgeIpcEndpoints } from '../shared/contracts/ipc-endpoints-knowledge'
import type { DesktopApi } from './desktop-api'
import { invokeIpcEndpoint } from './ipc-endpoint'

export const knowledgeApi: DesktopApi['knowledge'] = {
  async listReferences(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.listReferences, input)
  },
  async searchReferences(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.searchReferences, input)
  },
  async bibliographySnapshot(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.bibliographySnapshot, input)
  },
  async chooseBibliography(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.chooseBibliography, input)
  },
  async refreshBibliography(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.refreshBibliography, input)
  },
  async prepareReferenceImport(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.prepareReferenceImport, input)
  },
  async referenceImportAttachmentsPage(input) {
    return invokeIpcEndpoint(
      ipcRenderer,
      knowledgeIpcEndpoints.referenceImportAttachmentsPage,
      input
    )
  },
  async confirmReferenceImport(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.confirmReferenceImport, input)
  },
  async exportBibliography(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.exportBibliography, input)
  },
  async planLegacyCitationConversion(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.planLegacyCitationConversion, input)
  },
  async applyLegacyCitationConversion(input) {
    return invokeIpcEndpoint(
      ipcRenderer,
      knowledgeIpcEndpoints.applyLegacyCitationConversion,
      input
    )
  },
  async referenceSettings(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.referenceSettings, input)
  },
  async setReferenceSettings(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.setReferenceSettings, input)
  },
  async chooseCustomReferenceStyle(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.chooseCustomReferenceStyle, input)
  },
  async formatReferences(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.formatReferences, input)
  },
  async list(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.list, input)
  },
  async indexStatus(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.indexStatus, input)
  },
  async citationCoveragePage(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.citationCoveragePage, input)
  },
  async chooseAndImport(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.chooseAndImport, input)
  },
  async importDropped(input) {
    const paths = input.files.map((file) => webUtils.getPathForFile(file)).filter(Boolean)
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.importDropped, {
      projectSessionId: input.projectSessionId,
      paths
    })
  },
  async cancel(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.cancel, input)
  },
  async delete(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.delete, input)
  },
  async reveal(input) {
    await invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.reveal, input)
  },
  async openOriginal(input) {
    await invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.openOriginal, input)
  },
  async startParse(input) {
    await invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.startParse, input)
  },
  async cancelParse(input) {
    await invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.cancelParse, input)
  },
  async refreshEmbeddings(input) {
    await invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.refreshEmbeddings, input)
  },
  async createPdfPreview(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.createPdfPreview, input)
  },
  async releasePdfPreview(input) {
    await invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.releasePdfPreview, input)
  },
  async mappingPage(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.mappingPage, input)
  },
  async parsedMetadata(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.parsedMetadata, input)
  },
  async parsedBlocks(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.parsedBlocks, input)
  },
  async parsedMarkdown(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.parsedMarkdown, input)
  },
  async parsedAsset(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.parsedAsset, input)
  },
  async search(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.search, input)
  },
  async expandCitations(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.expandCitations, input)
  },
  async resolveReadableCitation(input) {
    return invokeIpcEndpoint(ipcRenderer, knowledgeIpcEndpoints.resolveReadableCitation, input)
  }
}
