import type { WriteLLMIpc } from '../shared/ipc.js';

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const api: WriteLLMIpc = {
  getRuntimeInfo: () => ipcRenderer.invoke('writellm:runtime-info')
};

contextBridge.exposeInMainWorld('writellm', api);
