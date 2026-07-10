import type { WriteLLMIpc } from '../shared/ipc.js';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const ipcChannels = {
  createWorkspace: 'writellm:createWorkspace',
  openWorkspace: 'writellm:openWorkspace',
  listRecentWorkspaces: 'writellm:listRecentWorkspaces',
  pickWorkspaceFolder: 'writellm:pickWorkspaceFolder',
  pickNewWorkspacePath: 'writellm:pickNewWorkspacePath',
  pickKnowledgeFiles: 'writellm:pickKnowledgeFiles',
  getState: 'writellm:getState',
  updateSectionMarkdown: 'writellm:updateSectionMarkdown',
  getGitStatus: 'writellm:getGitStatus',
  createGitCheckpoint: 'writellm:createGitCheckpoint',
  listGitHistory: 'writellm:listGitHistory',
  getSectionHistoryDetail: 'writellm:getSectionHistoryDetail',
  restoreSectionVersion: 'writellm:restoreSectionVersion',
  createNode: 'writellm:createNode',
  updateNode: 'writellm:updateNode',
  deleteNode: 'writellm:deleteNode',
  moveNode: 'writellm:moveNode',
  setActiveMainNode: 'writellm:setActiveMainNode',
  createNodeEdge: 'writellm:createNodeEdge',
  updateNodeEdge: 'writellm:updateNodeEdge',
  deleteNodeEdge: 'writellm:deleteNodeEdge',
  updateProjectBrief: 'writellm:updateProjectBrief',
  suggestProjectBrief: 'writellm:suggestProjectBrief',
  exportLatex: 'writellm:exportLatex',
  getLlmSettings: 'writellm:getLlmSettings',
  updateLlmSettings: 'writellm:updateLlmSettings',
  updateAppearanceSettings: 'writellm:updateAppearanceSettings',
  createKnowledgeItem: 'writellm:createKnowledgeItem',
  enqueueKnowledgeFiles: 'writellm:enqueueKnowledgeFiles',
  retryKnowledgeIngestJob: 'writellm:retryKnowledgeIngestJob',
  deleteKnowledgeIngestJob: 'writellm:deleteKnowledgeIngestJob',
  updateKnowledgeItem: 'writellm:updateKnowledgeItem',
  deleteKnowledgeItem: 'writellm:deleteKnowledgeItem',
  reindexKnowledgeItem: 'writellm:reindexKnowledgeItem',
  searchKnowledge: 'writellm:searchKnowledge',
  resolveKnowledgeCitation: 'writellm:resolveKnowledgeCitation',
  getKnowledgeDebugDetails: 'writellm:getKnowledgeDebugDetails',
  getCitationCoverage: 'writellm:getCitationCoverage',
  getWorkspaceAssetDataUrl: 'writellm:getWorkspaceAssetDataUrl',
  createGenerationTask: 'writellm:createGenerationTask',
  cancelGenerationTask: 'writellm:cancelGenerationTask',
  adoptGenerationTask: 'writellm:adoptGenerationTask',
  discardGenerationTask: 'writellm:discardGenerationTask',
  retryGenerationTask: 'writellm:retryGenerationTask',
  createPatchFromGenerationRound: 'writellm:createPatchFromGenerationRound',
  getWritingPatch: 'writellm:getWritingPatch',
  listWritingPatchesForSection: 'writellm:listWritingPatchesForSection',
  acceptWritingPatch: 'writellm:acceptWritingPatch',
  rejectWritingPatch: 'writellm:rejectWritingPatch',
  saveWritingPatchAsCandidate: 'writellm:saveWritingPatchAsCandidate',
  listGenerationSessions: 'writellm:listGenerationSessions',
  listGenerationRounds: 'writellm:listGenerationRounds',
  getGenerationRound: 'writellm:getGenerationRound',
  generationEvent: 'writellm:generationEvent',
  knowledgeRetrievalStream: 'writellm:knowledgeRetrievalStream',
  knowledgeIngestUpdated: 'writellm:knowledgeIngestUpdated'
} as const;

const api: WriteLLMIpc = {
  createWorkspace: (path) => ipcRenderer.invoke(ipcChannels.createWorkspace, path),
  openWorkspace: (path) => ipcRenderer.invoke(ipcChannels.openWorkspace, path),
  listRecentWorkspaces: () => ipcRenderer.invoke(ipcChannels.listRecentWorkspaces),
  pickWorkspaceFolder: () => ipcRenderer.invoke(ipcChannels.pickWorkspaceFolder),
  pickNewWorkspacePath: () => ipcRenderer.invoke(ipcChannels.pickNewWorkspacePath),
  pickKnowledgeFiles: () => ipcRenderer.invoke(ipcChannels.pickKnowledgeFiles),
  getState: (focusSectionId) => ipcRenderer.invoke(ipcChannels.getState, focusSectionId),
  updateSectionMarkdown: (sectionId, markdown) =>
    ipcRenderer.invoke(ipcChannels.updateSectionMarkdown, sectionId, markdown),
  getGitStatus: () => ipcRenderer.invoke(ipcChannels.getGitStatus),
  createGitCheckpoint: (message) => ipcRenderer.invoke(ipcChannels.createGitCheckpoint, message),
  listGitHistory: (sectionId) => ipcRenderer.invoke(ipcChannels.listGitHistory, sectionId),
  getSectionHistoryDetail: (sectionId, commitHash) =>
    ipcRenderer.invoke(ipcChannels.getSectionHistoryDetail, sectionId, commitHash),
  restoreSectionVersion: (sectionId, commitHash) =>
    ipcRenderer.invoke(ipcChannels.restoreSectionVersion, sectionId, commitHash),
  createNode: (payload) => ipcRenderer.invoke(ipcChannels.createNode, payload),
  updateNode: (nodeId, payload) => ipcRenderer.invoke(ipcChannels.updateNode, nodeId, payload),
  deleteNode: (nodeId) => ipcRenderer.invoke(ipcChannels.deleteNode, nodeId),
  moveNode: (nodeId, newParentId, index) =>
    ipcRenderer.invoke(ipcChannels.moveNode, nodeId, newParentId, index),
  setActiveMainNode: (sectionId, contentNodeId) =>
    ipcRenderer.invoke(ipcChannels.setActiveMainNode, sectionId, contentNodeId),
  createNodeEdge: (fromNodeId, toNodeId, relationType) =>
    ipcRenderer.invoke(ipcChannels.createNodeEdge, fromNodeId, toNodeId, relationType),
  updateNodeEdge: (edgeId, relationType, focusSectionId) =>
    ipcRenderer.invoke(ipcChannels.updateNodeEdge, edgeId, relationType, focusSectionId),
  deleteNodeEdge: (edgeId, focusSectionId) =>
    ipcRenderer.invoke(ipcChannels.deleteNodeEdge, edgeId, focusSectionId),
  updateProjectBrief: (payload) => ipcRenderer.invoke(ipcChannels.updateProjectBrief, payload),
  suggestProjectBrief: (payload) => ipcRenderer.invoke(ipcChannels.suggestProjectBrief, payload),
  exportLatex: (rootNodeId) => ipcRenderer.invoke(ipcChannels.exportLatex, rootNodeId),
  getLlmSettings: () => ipcRenderer.invoke(ipcChannels.getLlmSettings),
  updateLlmSettings: (payload) => ipcRenderer.invoke(ipcChannels.updateLlmSettings, payload),
  updateAppearanceSettings: (payload) =>
    ipcRenderer.invoke(ipcChannels.updateAppearanceSettings, payload),
  createKnowledgeItem: (payload) => ipcRenderer.invoke(ipcChannels.createKnowledgeItem, payload),
  enqueueKnowledgeFiles: (payload) => ipcRenderer.invoke(ipcChannels.enqueueKnowledgeFiles, payload),
  retryKnowledgeIngestJob: (jobId) => ipcRenderer.invoke(ipcChannels.retryKnowledgeIngestJob, jobId),
  deleteKnowledgeIngestJob: (jobId) => ipcRenderer.invoke(ipcChannels.deleteKnowledgeIngestJob, jobId),
  updateKnowledgeItem: (itemId, payload) =>
    ipcRenderer.invoke(ipcChannels.updateKnowledgeItem, itemId, payload),
  deleteKnowledgeItem: (itemId) => ipcRenderer.invoke(ipcChannels.deleteKnowledgeItem, itemId),
  reindexKnowledgeItem: (itemId) => ipcRenderer.invoke(ipcChannels.reindexKnowledgeItem, itemId),
  searchKnowledge: (payload) => ipcRenderer.invoke(ipcChannels.searchKnowledge, payload),
  resolveKnowledgeCitation: (payload) => ipcRenderer.invoke(ipcChannels.resolveKnowledgeCitation, payload),
  getKnowledgeDebugDetails: () => ipcRenderer.invoke(ipcChannels.getKnowledgeDebugDetails),
  getCitationCoverage: () => ipcRenderer.invoke(ipcChannels.getCitationCoverage),
  getWorkspaceAssetDataUrl: (relativePath) =>
    ipcRenderer.invoke(ipcChannels.getWorkspaceAssetDataUrl, relativePath),
  createGenerationTask: (payload) => ipcRenderer.invoke(ipcChannels.createGenerationTask, payload),
  cancelGenerationTask: (roundId) => ipcRenderer.invoke(ipcChannels.cancelGenerationTask, roundId),
  adoptGenerationTask: (payload) => ipcRenderer.invoke(ipcChannels.adoptGenerationTask, payload),
  discardGenerationTask: (roundId) => ipcRenderer.invoke(ipcChannels.discardGenerationTask, roundId),
  retryGenerationTask: (roundId) => ipcRenderer.invoke(ipcChannels.retryGenerationTask, roundId),
  createPatchFromGenerationRound: (payload) =>
    ipcRenderer.invoke(ipcChannels.createPatchFromGenerationRound, payload),
  getWritingPatch: (patchId) => ipcRenderer.invoke(ipcChannels.getWritingPatch, patchId),
  listWritingPatchesForSection: (sectionId) =>
    ipcRenderer.invoke(ipcChannels.listWritingPatchesForSection, sectionId),
  acceptWritingPatch: (payload) => ipcRenderer.invoke(ipcChannels.acceptWritingPatch, payload),
  rejectWritingPatch: (patchId) => ipcRenderer.invoke(ipcChannels.rejectWritingPatch, patchId),
  saveWritingPatchAsCandidate: (patchId) =>
    ipcRenderer.invoke(ipcChannels.saveWritingPatchAsCandidate, patchId),
  listGenerationSessions: (sectionId) => ipcRenderer.invoke(ipcChannels.listGenerationSessions, sectionId),
  listGenerationRounds: (sessionId) => ipcRenderer.invoke(ipcChannels.listGenerationRounds, sessionId),
  getGenerationRound: (roundId) => ipcRenderer.invoke(ipcChannels.getGenerationRound, roundId),
  onGenerationEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: Parameters<typeof callback>[0]) => {
      callback(message);
    };
    ipcRenderer.on(ipcChannels.generationEvent, listener);
    return () => {
      ipcRenderer.removeListener(ipcChannels.generationEvent, listener);
    };
  },
  onKnowledgeRetrievalStream: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: Parameters<typeof callback>[0]) => {
      callback(message);
    };
    ipcRenderer.on(ipcChannels.knowledgeRetrievalStream, listener);
    return () => {
      ipcRenderer.removeListener(ipcChannels.knowledgeRetrievalStream, listener);
    };
  },
  onKnowledgeIngestUpdated: (callback) => {
    const listener = () => {
      callback();
    };
    ipcRenderer.on(ipcChannels.knowledgeIngestUpdated, listener);
    return () => {
      ipcRenderer.removeListener(ipcChannels.knowledgeIngestUpdated, listener);
    };
  }
};

contextBridge.exposeInMainWorld('writellm', api);
