import type { AppearanceIpc } from '../shared/appearance.js';
import type { ChapterApi } from '../shared/chapters.js';
import type { WriteLLMIpc } from '../shared/ipc.js';
import type { ProviderSettingsIpc } from '../shared/provider-settings.js';
import type { SourceEvent, SourceServicesApi, SourcesApi } from '../shared/sources.js';
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

function parseSourceEvent(value: unknown): SourceEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(event.sequence) ||
    (event.sequence as number) < 1 ||
    !Number.isSafeInteger(event.catalogRevision) ||
    (event.catalogRevision as number) < 0 ||
    !['source-upserted', 'source-removed', 'candidate-updated', 'resync-required'].includes(
      String(event.type),
    ) ||
    Object.keys(event).some(
      (key) =>
        ![
          'sequence',
          'catalogRevision',
          'type',
          'source',
          'candidateId',
          'candidateStatus',
        ].includes(key),
    )
  )
    return null;
  return event as SourceEvent;
}

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
const sourcesApi: SourcesApi = {
  listSources: (input) => ipcRenderer.invoke('writellm:sources:list', input),
  importSourcesFromDialog: (input) => ipcRenderer.invoke('writellm:sources:import-dialog', input),
  getSource: (input) => ipcRenderer.invoke('writellm:sources:get', input),
  retrySource: (input) => ipcRenderer.invoke('writellm:sources:retry', input),
  removeSource: (input) => ipcRenderer.invoke('writellm:sources:remove', input),
  subscribeSourceEvents: (input, listener) => {
    const receive = (_event: Electron.IpcRendererEvent, value: unknown) => {
      const parsed = parseSourceEvent(value);
      if (parsed) listener(parsed);
    };
    ipcRenderer.on('writellm:sources:events', receive);
    void ipcRenderer.invoke('writellm:sources:events', input).catch(() => undefined);
    return () => ipcRenderer.removeListener('writellm:sources:events', receive);
  },
};
contextBridge.exposeInMainWorld('writellmSources', sourcesApi);
const sourceServicesApi: SourceServicesApi = {
  getServiceStatus: () => ipcRenderer.invoke('writellm:source-services:get'),
  saveMinerUCredential: (input) =>
    ipcRenderer.invoke('writellm:source-services:mineru-save', input),
  removeMinerUCredential: (input) =>
    ipcRenderer.invoke('writellm:source-services:mineru-remove', input),
  validateMinerUCredential: (input) =>
    ipcRenderer.invoke('writellm:source-services:mineru-validate', input),
  saveSiliconFlowCredential: (input) =>
    ipcRenderer.invoke('writellm:source-services:siliconflow-save', input),
  removeSiliconFlowCredential: (input) =>
    ipcRenderer.invoke('writellm:source-services:siliconflow-remove', input),
  validateSiliconFlowCredential: (input) =>
    ipcRenderer.invoke('writellm:source-services:siliconflow-validate', input),
};
contextBridge.exposeInMainWorld('writellmSourceServices', sourceServicesApi);
