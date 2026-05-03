import type { PaperLabIpc } from '../shared/ipc.js';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const ipcChannels = {
  createWorkspace: 'paperlab:createWorkspace',
  openWorkspace: 'paperlab:openWorkspace',
  listRecentWorkspaces: 'paperlab:listRecentWorkspaces',
  pickWorkspaceFolder: 'paperlab:pickWorkspaceFolder',
  pickNewWorkspacePath: 'paperlab:pickNewWorkspacePath',
  getState: 'paperlab:getState',
  createNode: 'paperlab:createNode',
  updateNode: 'paperlab:updateNode',
  deleteNode: 'paperlab:deleteNode',
  moveNode: 'paperlab:moveNode',
  setActiveMainNode: 'paperlab:setActiveMainNode',
  createNodeEdge: 'paperlab:createNodeEdge',
  updateNodeEdge: 'paperlab:updateNodeEdge',
  deleteNodeEdge: 'paperlab:deleteNodeEdge',
  updateNodeLayout: 'paperlab:updateNodeLayout',
  exportLatex: 'paperlab:exportLatex',
  getLlmSettings: 'paperlab:getLlmSettings',
  updateLlmSettings: 'paperlab:updateLlmSettings',
  createKnowledgeItem: 'paperlab:createKnowledgeItem',
  updateKnowledgeItem: 'paperlab:updateKnowledgeItem',
  deleteKnowledgeItem: 'paperlab:deleteKnowledgeItem',
  reindexKnowledgeItem: 'paperlab:reindexKnowledgeItem',
  searchKnowledge: 'paperlab:searchKnowledge',
  generateWithLlm: 'paperlab:generateWithLlm',
  cancelLlmGeneration: 'paperlab:cancelLlmGeneration',
  saveLlmGeneration: 'paperlab:saveLlmGeneration',
  llmStream: 'paperlab:llmStream'
} as const;

const api: PaperLabIpc = {
  createWorkspace: (path) => ipcRenderer.invoke(ipcChannels.createWorkspace, path),
  openWorkspace: (path) => ipcRenderer.invoke(ipcChannels.openWorkspace, path),
  listRecentWorkspaces: () => ipcRenderer.invoke(ipcChannels.listRecentWorkspaces),
  pickWorkspaceFolder: () => ipcRenderer.invoke(ipcChannels.pickWorkspaceFolder),
  pickNewWorkspacePath: () => ipcRenderer.invoke(ipcChannels.pickNewWorkspacePath),
  getState: (focusSectionId) => ipcRenderer.invoke(ipcChannels.getState, focusSectionId),
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
  createKnowledgeItem: (payload) => ipcRenderer.invoke(ipcChannels.createKnowledgeItem, payload),
  updateKnowledgeItem: (itemId, payload) =>
    ipcRenderer.invoke(ipcChannels.updateKnowledgeItem, itemId, payload),
  deleteKnowledgeItem: (itemId) => ipcRenderer.invoke(ipcChannels.deleteKnowledgeItem, itemId),
  reindexKnowledgeItem: (itemId) => ipcRenderer.invoke(ipcChannels.reindexKnowledgeItem, itemId),
  searchKnowledge: (payload) => ipcRenderer.invoke(ipcChannels.searchKnowledge, payload),
  generateWithLlm: (payload) => ipcRenderer.invoke(ipcChannels.generateWithLlm, payload),
  cancelLlmGeneration: (runId) => ipcRenderer.invoke(ipcChannels.cancelLlmGeneration, runId),
  saveLlmGeneration: (payload) => ipcRenderer.invoke(ipcChannels.saveLlmGeneration, payload),
  onLlmStream: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, message: Parameters<typeof callback>[0]) => {
      callback(message);
    };
    ipcRenderer.on(ipcChannels.llmStream, listener);
    return () => {
      ipcRenderer.removeListener(ipcChannels.llmStream, listener);
    };
  }
};

contextBridge.exposeInMainWorld('paperlab', api);
