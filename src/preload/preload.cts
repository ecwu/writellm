import type { AppearanceIpc } from '../shared/appearance.js';
import type { ChapterApi } from '../shared/chapters.js';
import type { WriteLLMIpc } from '../shared/ipc.js';
import type { ProviderSettingsIpc } from '../shared/provider-settings.js';
import type {
  SourceCandidateStatus,
  SourceEvent,
  SourceServicesApi,
  SourceState,
  SourceSummary,
  SourcesApi,
} from '../shared/sources.js';
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

const sourceStates: readonly SourceState[] = [
  'queued',
  'parsing',
  'indexing',
  'available',
  'partial',
  'failed',
];
const sourceStages: readonly SourceSummary['progress']['stage'][] = [
  'queued',
  'parsing',
  'indexing',
];
const candidateStatuses: readonly SourceCandidateStatus[] = [
  'queued',
  'possible-duplicate',
  'duplicate-confirmed',
  'accepted',
  'canceled',
  'failed',
];
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length &&
  Object.keys(value).every((key) => keys.includes(key));
const count = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const boundedText = (value: unknown, max: number) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  [...value].every((character) => {
    const code = character.charCodeAt(0);
    return code > 31 && code !== 127;
  });

function parseSourceSummary(value: unknown): SourceSummary | null {
  if (!record(value)) return null;
  const keys = [
    'sourceId',
    'revision',
    'displayName',
    'sizeBytes',
    'importedAt',
    'state',
    'progress',
    'eligibility',
    'retrying',
    'retryable',
  ];
  if (
    !exact(value, keys) ||
    !boundedText(value.sourceId, 128) ||
    !count(value.revision) ||
    !boundedText(value.displayName, 255) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    (value.sizeBytes as number) < 1 ||
    typeof value.importedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.importedAt)) ||
    !sourceStates.includes(value.state as SourceState) ||
    typeof value.retrying !== 'boolean' ||
    typeof value.retryable !== 'boolean' ||
    !record(value.progress) ||
    !exact(value.progress, ['completed', 'total', 'stage']) ||
    !count(value.progress.completed) ||
    !count(value.progress.total) ||
    (value.progress.completed as number) > (value.progress.total as number) ||
    !sourceStages.includes(value.progress.stage as SourceSummary['progress']['stage']) ||
    !record(value.eligibility) ||
    !exact(value.eligibility, ['indexed', 'eligible', 'failed']) ||
    !count(value.eligibility.indexed) ||
    !count(value.eligibility.eligible) ||
    !count(value.eligibility.failed) ||
    (value.eligibility.indexed as number) > (value.eligibility.eligible as number) ||
    (value.eligibility.failed as number) >
      (value.eligibility.eligible as number) - (value.eligibility.indexed as number)
  )
    return null;
  return value as SourceSummary;
}

function parseSourceEvent(value: unknown): SourceEvent | null {
  if (
    !record(value) ||
    !count(value.sequence) ||
    (value.sequence as number) < 1 ||
    !count(value.catalogRevision)
  )
    return null;
  const base = ['sequence', 'catalogRevision', 'type'];
  if (value.type === 'source-upserted' || value.type === 'source-removed') {
    if (!exact(value, [...base, 'source'])) return null;
    const source = parseSourceSummary(value.source);
    return source ? ({ ...value, source } as SourceEvent) : null;
  }
  if (value.type === 'candidate-updated') {
    if (
      !exact(value, [...base, 'candidateId', 'candidateStatus']) ||
      !boundedText(value.candidateId, 128) ||
      !candidateStatuses.includes(value.candidateStatus as SourceCandidateStatus)
    )
      return null;
    return value as SourceEvent;
  }
  return value.type === 'resync-required' && exact(value, base) ? (value as SourceEvent) : null;
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
