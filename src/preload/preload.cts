import type { PaperLabIpc } from '../shared/ipc.js';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const ipcChannels = {
  createWorkspace: 'paperlab:createWorkspace',
  openWorkspace: 'paperlab:openWorkspace',
  getState: 'paperlab:getState',
  createContainer: 'paperlab:createContainer',
  updateContainer: 'paperlab:updateContainer',
  deleteContainer: 'paperlab:deleteContainer',
  moveContainer: 'paperlab:moveContainer',
  createSourceNote: 'paperlab:createSourceNote',
  createAuthorText: 'paperlab:createAuthorText',
  deleteArtifact: 'paperlab:deleteArtifact',
  updateArtifactContent: 'paperlab:updateArtifactContent',
  updateAuthorTextContent: 'paperlab:updateAuthorTextContent',
  setActiveAuthorText: 'paperlab:setActiveAuthorText',
  createReviewComment: 'paperlab:createReviewComment',
  updateReviewCommentStatus: 'paperlab:updateReviewCommentStatus',
  createProcessEdge: 'paperlab:createProcessEdge',
  updateProcessEdge: 'paperlab:updateProcessEdge',
  updateCanvasNodeLayout: 'paperlab:updateCanvasNodeLayout',
  exportLatex: 'paperlab:exportLatex',
  getLlmSettings: 'paperlab:getLlmSettings',
  updateLlmSettings: 'paperlab:updateLlmSettings',
  generateWithLlm: 'paperlab:generateWithLlm',
  cancelLlmGeneration: 'paperlab:cancelLlmGeneration',
  saveLlmGeneration: 'paperlab:saveLlmGeneration',
  llmStream: 'paperlab:llmStream'
} as const;

const api: PaperLabIpc = {
  createWorkspace: (path) => ipcRenderer.invoke(ipcChannels.createWorkspace, path),
  openWorkspace: (path) => ipcRenderer.invoke(ipcChannels.openWorkspace, path),
  getState: (focusContainerId) => ipcRenderer.invoke(ipcChannels.getState, focusContainerId),
  createContainer: (parentId, payload) =>
    ipcRenderer.invoke(ipcChannels.createContainer, parentId, payload),
  updateContainer: (containerId, payload) =>
    ipcRenderer.invoke(ipcChannels.updateContainer, containerId, payload),
  deleteContainer: (containerId) => ipcRenderer.invoke(ipcChannels.deleteContainer, containerId),
  moveContainer: (containerId, newParentId, index) =>
    ipcRenderer.invoke(ipcChannels.moveContainer, containerId, newParentId, index),
  createSourceNote: (containerId, payload) =>
    ipcRenderer.invoke(ipcChannels.createSourceNote, containerId, payload),
  createAuthorText: (containerId, content, createdFromArtifactId) =>
    ipcRenderer.invoke(ipcChannels.createAuthorText, containerId, content, createdFromArtifactId),
  deleteArtifact: (artifactId) => ipcRenderer.invoke(ipcChannels.deleteArtifact, artifactId),
  updateArtifactContent: (artifactId, content) =>
    ipcRenderer.invoke(ipcChannels.updateArtifactContent, artifactId, content),
  updateAuthorTextContent: (authorTextId, content) =>
    ipcRenderer.invoke(ipcChannels.updateAuthorTextContent, authorTextId, content),
  setActiveAuthorText: (containerId, authorTextId) =>
    ipcRenderer.invoke(ipcChannels.setActiveAuthorText, containerId, authorTextId),
  createReviewComment: (authorTextId, range, payload) =>
    ipcRenderer.invoke(ipcChannels.createReviewComment, authorTextId, range, payload),
  updateReviewCommentStatus: (commentId, status) =>
    ipcRenderer.invoke(ipcChannels.updateReviewCommentStatus, commentId, status),
  createProcessEdge: (fromArtifactId, toArtifactId, relationType) =>
    ipcRenderer.invoke(ipcChannels.createProcessEdge, fromArtifactId, toArtifactId, relationType),
  updateProcessEdge: (edgeId, relationType) =>
    ipcRenderer.invoke(ipcChannels.updateProcessEdge, edgeId, relationType),
  updateCanvasNodeLayout: (payload) =>
    ipcRenderer.invoke(ipcChannels.updateCanvasNodeLayout, payload),
  exportLatex: (rootContainerId) => ipcRenderer.invoke(ipcChannels.exportLatex, rootContainerId),
  getLlmSettings: () => ipcRenderer.invoke(ipcChannels.getLlmSettings),
  updateLlmSettings: (payload) => ipcRenderer.invoke(ipcChannels.updateLlmSettings, payload),
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
