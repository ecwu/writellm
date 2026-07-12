import type { WriteLLMIpc } from '../shared/ipc.js';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const api: WriteLLMIpc = {
  listRecentProjects: () => ipcRenderer.invoke('writellm:project:list-recent'),
  createProject: (request) => ipcRenderer.invoke('writellm:project:create', request),
  openProjectFromDialog: () => ipcRenderer.invoke('writellm:project:open-dialog'),
  openRecentProject: (request) => ipcRenderer.invoke('writellm:project:open-recent', request),
  relinkRecentProject: (request) => ipcRenderer.invoke('writellm:project:relink', request),
  removeRecentProject: (request) => ipcRenderer.invoke('writellm:project:remove-recent', request)
};

contextBridge.exposeInMainWorld('writellm', api);
