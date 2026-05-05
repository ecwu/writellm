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
  updateNodeLayout: 'writellm:updateNodeLayout',
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
  getWorkspaceAssetDataUrl: 'writellm:getWorkspaceAssetDataUrl',
  generateWithLlm: 'writellm:generateWithLlm',
  cancelLlmGeneration: 'writellm:cancelLlmGeneration',
  saveLlmGeneration: 'writellm:saveLlmGeneration',
  applySectionLlmEdit: 'writellm:applySectionLlmEdit',
  llmStream: 'writellm:llmStream',
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
  updateNodeLayout: (payload) => ipcRenderer.invoke(ipcChannels.updateNodeLayout, payload),
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
  getWorkspaceAssetDataUrl: (relativePath) =>
    ipcRenderer.invoke(ipcChannels.getWorkspaceAssetDataUrl, relativePath),
  generateWithLlm: (payload) => ipcRenderer.invoke(ipcChannels.generateWithLlm, payload),
  cancelLlmGeneration: (runId) => ipcRenderer.invoke(ipcChannels.cancelLlmGeneration, runId),
  saveLlmGeneration: (payload) => ipcRenderer.invoke(ipcChannels.saveLlmGeneration, payload),
  applySectionLlmEdit: (payload) => ipcRenderer.invoke(ipcChannels.applySectionLlmEdit, payload),
  onLlmStream: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: Parameters<typeof callback>[0]) => {
      callback(message);
    };
    ipcRenderer.on(ipcChannels.llmStream, listener);
    return () => {
      ipcRenderer.removeListener(ipcChannels.llmStream, listener);
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
