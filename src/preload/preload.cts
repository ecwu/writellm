import type { AppearanceIpc } from '../shared/appearance.js';
import type { ChapterApi } from '../shared/chapters.js';
import type { WriteLLMIpc } from '../shared/ipc.js';
import type { ProviderSettingsIpc } from '../shared/provider-settings.js';
import type { WritingOrientationApi } from '../shared/writing-orientation.js';

const orientationChannels = {
  load: 'writellm:writing-orientation:load',
  save: 'writellm:writing-orientation:save',
  deleteOutlineItem: 'writellm:writing-orientation:delete-outline-item',
} as const;
const chapterChannels = {
  openForOutlineItem: 'writellm:chapters:open-for-outline-item',
  load: 'writellm:chapters:load',
  save: 'writellm:chapters:save',
  previewMarkdownExport: 'writellm:chapters:preview-markdown-export',
  exportMarkdown: 'writellm:chapters:export-markdown',
} as const;

const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron');

const api: WriteLLMIpc = {
  listRecentProjects: () => ipcRenderer.invoke('writellm:project:list-recent'),
  createProject: (request) => ipcRenderer.invoke('writellm:project:create', request),
  openProjectFromDialog: () => ipcRenderer.invoke('writellm:project:open-dialog'),
  openRecentProject: (request) => ipcRenderer.invoke('writellm:project:open-recent', request),
  relinkRecentProject: (request) => ipcRenderer.invoke('writellm:project:relink', request),
  removeRecentProject: (request) => ipcRenderer.invoke('writellm:project:remove-recent', request),
};

contextBridge.exposeInMainWorld('writellm', api);
const appearanceApi: AppearanceIpc = {
  getAppearancePreferences: () => ipcRenderer.invoke('writellm:appearance:get'),
  updateAppearancePreferences: (value) => ipcRenderer.invoke('writellm:appearance:update', value),
};
contextBridge.exposeInMainWorld('writellmAppearance', appearanceApi);
const writingOrientationApi: WritingOrientationApi = {
  load: () => ipcRenderer.invoke(orientationChannels.load),
  save: (input) => ipcRenderer.invoke(orientationChannels.save, input),
  deleteOutlineItem: (input) => ipcRenderer.invoke(orientationChannels.deleteOutlineItem, input),
};
contextBridge.exposeInMainWorld('writellmWritingOrientation', writingOrientationApi);
const chapterApi: ChapterApi = {
  openForOutlineItem: (input) => ipcRenderer.invoke(chapterChannels.openForOutlineItem, input),
  load: (input) => ipcRenderer.invoke(chapterChannels.load, input),
  save: (input) => ipcRenderer.invoke(chapterChannels.save, input),
  previewMarkdownExport: (input) =>
    ipcRenderer.invoke(chapterChannels.previewMarkdownExport, input),
  exportMarkdown: (input) => ipcRenderer.invoke(chapterChannels.exportMarkdown, input),
};
contextBridge.exposeInMainWorld('writellmChapters', chapterApi);
const providerSettingsApi: ProviderSettingsIpc = {
  getProviderSummary: () => ipcRenderer.invoke('writellm:provider-settings:get'),
  saveProviderSettings: (input) => ipcRenderer.invoke('writellm:provider-settings:save', input),
  replaceProviderSecret: (input) =>
    ipcRenderer.invoke('writellm:provider-settings:replace-secret', input),
  removeProviderSecret: (input) =>
    ipcRenderer.invoke('writellm:provider-settings:remove-secret', input),
  validateProvider: (input) => ipcRenderer.invoke('writellm:provider-settings:validate', input),
};
contextBridge.exposeInMainWorld('writellmProviderSettings', providerSettingsApi);
