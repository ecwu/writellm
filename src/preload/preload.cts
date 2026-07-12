import type { WriteLLMIpc } from '../shared/ipc.js';
import type { AppearanceIpc } from '../shared/appearance.js';

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
const appearanceApi: AppearanceIpc = {
  getAppearancePreferences: () => ipcRenderer.invoke('writellm:appearance:get'),
  updateAppearancePreferences: (value) => ipcRenderer.invoke('writellm:appearance:update', value)
};
contextBridge.exposeInMainWorld('writellmAppearance', appearanceApi);
