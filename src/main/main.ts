import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  net,
  protocol,
  safeStorage,
  shell,
} from 'electron';
import { appearanceChannels } from '../shared/appearance.js';
import {
  type CreateProjectRequest,
  ipcChannels,
  type RecentProjectRequest,
} from '../shared/ipc.js';
import { isRecord } from '../shared/project.js';
import { AppearancePreferencesRepository } from './appearance/appearance-preferences.js';
import { registerChapterHandlers } from './project/chapter-handlers.js';
import { ChapterRepository } from './project/chapter-repository.js';
import { MarkdownExportService } from './project/markdown-export.js';
import { ProjectRepository } from './project/project-repository.js';
import { registerProviderSettingsHandlers } from './provider-settings/handlers.js';
import { ProviderSettingsRepository } from './provider-settings/repository.js';
import { ElectronSecretProtector } from './provider-settings/secret-protector.js';
import { uploadFileWithProgress } from './sources/electron-file-upload.js';
import { registerSourceHandlers } from './sources/handlers.js';
import { SourceImportService } from './sources/import-service.js';
import { registerSourceMediaProtocol } from './sources/media-protocol.js';
import { MinerUAdapter } from './sources/mineru-adapter.js';
import { SourceReferenceReader } from './sources/reference-reader.js';
import { SourceRemovalService } from './sources/removal-service.js';
import { SourceServiceCredentials } from './sources/service-credentials.js';
import { registerSourceServiceHandlers } from './sources/service-handlers.js';
import { type SourceHttpRequest, validateSourceService } from './sources/service-validator.js';
import { SourceEvents } from './sources/source-events.js';
import { SourcePipeline } from './sources/source-pipeline.js';
import { SourceRepository } from './sources/source-repository.js';
import { SourceRuntime } from './sources/source-runtime.js';
import { registerWritingOrientationHandlers } from './writing-orientation/handlers.js';
import { WritingOrientationRepository } from './writing-orientation/repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(devServerUrl);
const rendererDirectory = path.join(__dirname, '../../dist');
const isEditorRuntime =
  process.env.WRITELLM_EDITOR_RUNTIME === '1' || process.argv.includes('--writellm-editor-runtime');
const isWorkspaceNavigationRuntime =
  process.env.WRITELLM_WORKSPACE_NAVIGATION_RUNTIME === '1' ||
  process.argv.includes('--writellm-workspace-navigation-runtime');
const runtimeKind = isEditorRuntime
  ? 'editor'
  : isWorkspaceNavigationRuntime
    ? 'workspace-navigation'
    : 'app';
const electronFetch: SourceHttpRequest = (input, init) => net.fetch(input, init);
if (process.env.WRITELLM_SMOKE_MARKER) {
  await appendFile(process.env.WRITELLM_SMOKE_MARKER, `main-start:${isEditorRuntime}\n`);
  await appendFile(process.env.WRITELLM_SMOKE_MARKER, `runtime-kind:${runtimeKind}\n`);
}
const hasSingleInstanceLock =
  isEditorRuntime || isWorkspaceNavigationRuntime || app.requestSingleInstanceLock();
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'writellm-source',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

let mainWindow: BrowserWindow | null = null;
let repository: ProjectRepository | null = null;
let appearanceRepository: AppearancePreferencesRepository | null = null;
let providerSettingsRepository: ProviderSettingsRepository | null = null;
let sourceServiceCredentials: SourceServiceCredentials | null = null;
let sourceRuntime: SourceRuntime | null = null;
let quitAfterSourceShutdown = false;
let sourceRepository: SourceRepository | null = null;
let sourceImports: SourceImportService | null = null;
let sourcePipeline: SourcePipeline | null = null;
let sourceRemoval: SourceRemovalService | null = null;
const sourceEvents = new SourceEvents();
let handlersRegistered = false;
const writingOrientationRepository = new WritingOrientationRepository();
const chapterRepository = new ChapterRepository();

function markLifecycle(value: string): void {
  const marker = process.env.WRITELLM_SMOKE_MARKER;
  if (marker) void appendFile(marker, `${value}\n`).catch(() => undefined);
}

function safeError(message = 'The project operation could not be completed.') {
  return { status: 'error' as const, error: { code: 'STORAGE_READ_FAILED' as const, message } };
}

function isExpectedSender(event: Electron.IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}

function isCreateRequest(value: unknown): value is CreateProjectRequest {
  return isRecord(value) && typeof value.displayName === 'string';
}

function isRecentRequest(value: unknown): value is RecentProjectRequest {
  return (
    isRecord(value) &&
    typeof value.recentId === 'string' &&
    value.recentId.length > 0 &&
    value.recentId.length <= 128
  );
}

async function activateSourceRuntime(): Promise<void> {
  const session = repository?.getActiveProjectSession();
  if (session && sourceRepository) {
    sourceRepository.setJobRepository(null);
    const { catalogRevision } = await sourceRepository.list(session, { limit: 1 });
    sourceEvents.activate(session.sessionId, catalogRevision);
  }
  await sourceRuntime?.activate();
}

function registerIpcHandlers(): void {
  if (handlersRegistered || !repository) return;
  const projectRepository = repository;
  handlersRegistered = true;
  ipcMain.handle(ipcChannels.listRecentProjects, async (event) => {
    if (!isExpectedSender(event)) return safeError();
    try {
      return await projectRepository.listRecentProjects();
    } catch {
      return safeError('Recent projects could not be loaded.');
    }
  });
  ipcMain.handle(ipcChannels.createProject, async (event, request: unknown) => {
    if (!isExpectedSender(event)) return safeError();
    if (!isCreateRequest(request))
      return {
        status: 'error',
        error: { code: 'INVALID_PROJECT_NAME', message: 'Project name is invalid.' },
      };
    try {
      const result = await projectRepository.createProject(request.displayName);
      if (result.status === 'created') await activateSourceRuntime();
      return result;
    } catch {
      return safeError('The project could not be created safely.');
    }
  });
  ipcMain.handle(ipcChannels.openProjectFromDialog, async (event) => {
    if (!isExpectedSender(event)) return safeError();
    try {
      const result = await projectRepository.openProjectFromDialog();
      if (result.status === 'opened') await activateSourceRuntime();
      return result;
    } catch {
      return safeError('The project could not be opened.');
    }
  });
  ipcMain.handle(ipcChannels.openRecentProject, async (event, request: unknown) => {
    if (!isExpectedSender(event)) return safeError();
    if (!isRecentRequest(request))
      return {
        status: 'error',
        error: {
          code: 'RECENT_NOT_FOUND',
          message: 'That recent project record is not available.',
        },
      };
    try {
      const result = await projectRepository.openRecentProject(request.recentId);
      if (result.status === 'opened') await activateSourceRuntime();
      return result;
    } catch {
      return safeError('The recent project could not be opened.');
    }
  });
  ipcMain.handle(ipcChannels.relinkRecentProject, async (event, request: unknown) => {
    if (!isExpectedSender(event)) return safeError();
    if (!isRecentRequest(request))
      return {
        status: 'error',
        error: {
          code: 'RECENT_NOT_FOUND',
          message: 'That recent project record is not available.',
        },
      };
    try {
      const result = await projectRepository.relinkRecentProject(request.recentId);
      if (result.status === 'opened') await activateSourceRuntime();
      return result;
    } catch {
      return safeError('The recent project could not be relinked.');
    }
  });
  ipcMain.handle(ipcChannels.removeRecentProject, async (event, request: unknown) => {
    if (!isExpectedSender(event)) return safeError();
    if (!isRecentRequest(request))
      return {
        status: 'error',
        error: {
          code: 'RECENT_NOT_FOUND',
          message: 'That recent project record is not available.',
        },
      };
    try {
      return await projectRepository.removeRecentProject(request.recentId);
    } catch {
      return safeError('The recent project record could not be removed.');
    }
  });
  ipcMain.handle(appearanceChannels.get, (event) =>
    isExpectedSender(event) && appearanceRepository
      ? appearanceRepository.get()
      : {
          status: 'error',
          error: {
            code: 'APPEARANCE_PREFERENCES_CORRUPT',
            message: 'Appearance preferences are unavailable.',
          },
        },
  );
  ipcMain.handle(appearanceChannels.update, async (event, value: unknown) => {
    if (!isExpectedSender(event) || !appearanceRepository)
      return {
        status: 'error',
        error: {
          code: 'APPEARANCE_STORAGE_UNAVAILABLE',
          message: 'Appearance preferences are unavailable.',
        },
      };
    const result = await appearanceRepository.update(value);
    if (result.status === 'updated') nativeTheme.themeSource = result.preferences.themeMode;
    return result;
  });
  registerWritingOrientationHandlers({
    ipcMain,
    projects: repository,
    repository: writingOrientationRepository,
    isExpectedSender,
  });
  registerChapterHandlers({
    ipcMain,
    projects: repository,
    repository: chapterRepository,
    markdown: new MarkdownExportService(dialog),
    isExpectedSender,
  });
  if (providerSettingsRepository)
    registerProviderSettingsHandlers({
      ipcMain,
      repository: providerSettingsRepository,
      isExpectedSender,
    });
  if (sourceServiceCredentials)
    registerSourceServiceHandlers({
      ipcMain,
      repository: sourceServiceCredentials,
      isExpectedSender,
      validate: (provider, credential, signal) =>
        validateSourceService(provider, credential, signal, electronFetch),
    });
  if (sourceRepository && sourceImports && sourcePipeline && sourceRemoval) {
    const pipeline = sourcePipeline;
    const removal = sourceRemoval;
    registerSourceHandlers({
      ipcMain,
      getActiveSession: () => repository?.getActiveProjectSession() ?? null,
      repository: sourceRepository,
      imports: sourceImports,
      events: sourceEvents,
      isExpectedSender,
      retrySource: (session, input) => {
        const jobs = sourceRuntime?.getJobRepository();
        if (!jobs) throw new Error('SOURCE_RUNTIME_INACTIVE');
        return pipeline.retrySource(session, input.sourceId, input.expectedSourceRevision, jobs);
      },
      removeSource: (session, input) => removal.remove(session, input),
    });
  }
}

async function ensureWindow(): Promise<void> {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
    return;
  }

  const preloadPath = path.join(__dirname, '../preload/preload.cjs');
  if (!existsSync(preloadPath)) throw new Error('Preload file is missing.');
  const window = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'WriteLLM v2',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  if (isEditorRuntime || isWorkspaceNavigationRuntime)
    window.webContents.on('console-message', (_event, _level, message) =>
      console.error(`Editor runtime console: ${message}`),
    );
  mainWindow = window;
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (isDevelopment) await window.loadURL(devServerUrl!);
  else
    await window.loadFile(
      path.join(rendererDirectory, 'index.html'),
      isEditorRuntime
        ? { query: { 'editor-runtime': '1' } }
        : isWorkspaceNavigationRuntime
          ? { query: { 'workspace-navigation-runtime': '1' } }
          : undefined,
    );
  if (isEditorRuntime) {
    const mounted = await window.webContents.executeJavaScript(
      `new Promise(resolve=>{const deadline=Date.now()+8000;const check=()=>{if(document.querySelector('[data-testid="blocknote-editor"] [contenteditable="true"]'))resolve(true);else if(Date.now()>deadline)resolve(false);else setTimeout(check,50)};check()})`,
    );
    if (!mounted) {
      const detail = await window.webContents.executeJavaScript(
        `JSON.stringify({href:location.href,body:document.body.innerHTML.slice(0,1000)})`,
      );
      throw new Error(`Compiled BlockNote editor did not mount: ${detail}`);
    }
    const marker = process.env.WRITELLM_SMOKE_MARKER;
    if (marker) await appendFile(marker, 'editor-mounted\n');
  }
  if (isWorkspaceNavigationRuntime) {
    const verified = (await window.webContents.executeJavaScript(
      `new Promise(resolve=>{const deadline=Date.now()+8000;let stage='shell';const fail=()=>resolve({ok:false,stage,buttons:[...document.querySelectorAll('button')].map(button=>({label:button.getAttribute('aria-label'),pressed:button.getAttribute('aria-pressed'),text:button.textContent?.trim()})),body:document.body.textContent?.slice(0,500)});const waitFor=(condition,next)=>{if(condition())next();else if(Date.now()>deadline)fail();else setTimeout(()=>waitFor(condition,next),25)};waitFor(()=>Boolean(document.querySelector('.workspace-navigation-shell')),()=>{const section=document.querySelector('input');stage='knowledge-base';document.querySelector('button[aria-label="Knowledge Base"]')?.click();waitFor(()=>document.querySelector('button[aria-label="Knowledge Base"]')?.getAttribute('aria-pressed')==='true',()=>{stage='sections';document.querySelector('button[aria-label="Sections"]')?.click();waitFor(()=>document.querySelector('button[aria-label="Sections"]')?.getAttribute('aria-pressed')==='true',()=>{const persistent=document.querySelector('input')===section;const viewport=document.querySelector('main[aria-label="Runtime section detail"] [data-slot="scroll-area-viewport"]');const overflow=Boolean(viewport&&viewport.scrollHeight>viewport.clientHeight);if(viewport)viewport.scrollTop=64;const scrolled=Boolean(viewport&&viewport.scrollTop>0);stage='settings';document.querySelector('button[aria-label="Settings"]')?.click();waitFor(()=>Boolean(document.querySelector('main[aria-label="Application settings"]')),()=>resolve({ok:persistent&&overflow&&scrolled,stage:!persistent?'owner-identity':!overflow?'scroll-overflow':!scrolled?'scroll-position':'complete'}));});});});})`,
    )) as { ok: boolean; stage: string };
    if (!verified.ok)
      throw new Error(
        `Compiled workspace navigation runtime did not preserve owner identity or open Settings: ${JSON.stringify(verified)}`,
      );
    const marker = process.env.WRITELLM_SMOKE_MARKER;
    if (marker) await appendFile(marker, 'workspace-navigation-mounted\n');
  }
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    markLifecycle('second-instance');
    void ensureWindow();
  });
  app
    .whenReady()
    .then(async () => {
      repository = new ProjectRepository({ userDataPath: app.getPath('userData'), dialog });
      appearanceRepository = new AppearancePreferencesRepository(app.getPath('userData'));
      providerSettingsRepository = new ProviderSettingsRepository(
        app.getPath('userData'),
        new ElectronSecretProtector(safeStorage),
      );
      sourceServiceCredentials = new SourceServiceCredentials(
        path.join(app.getPath('userData'), 'source-services'),
        {
          available: async () => safeStorage.isEncryptionAvailable(),
          protect: async (value) => safeStorage.encryptString(value).toString('base64'),
          unprotect: async (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
        },
      );
      sourceRuntime = new SourceRuntime(() => repository?.getActiveProjectSession() ?? null);
      sourceRepository = new SourceRepository({
        isCurrentSession: (session) =>
          repository?.getActiveProjectSession()?.sessionId === session.sessionId,
      });
      sourceImports = new SourceImportService({
        dialog,
        repository: sourceRepository,
        events: sourceEvents,
        getActiveSession: () => repository?.getActiveProjectSession() ?? null,
        onJobQueued: () => sourceRuntime?.wake(),
        enqueueJob: (job) => {
          if (!sourceRuntime) throw new Error('SOURCE_RUNTIME_INACTIVE');
          return sourceRuntime.enqueue(job);
        },
      });
      const pipeline = new SourcePipeline({
        credentials: sourceServiceCredentials,
        repository: sourceRepository,
        events: sourceEvents,
        getActiveSession: () => repository?.getActiveProjectSession() ?? null,
        request: electronFetch,
        mineru: (credential) =>
          new MinerUAdapter(credential, electronFetch, uploadFileWithProgress),
        wake: () => sourceRuntime?.wake(),
      });
      sourcePipeline = pipeline;
      sourceRuntime.setRecoveryHandler((session, jobs) => pipeline.reconcile(session, jobs));
      sourceRemoval = new SourceRemovalService({
        repository: sourceRepository,
        references: new SourceReferenceReader(),
        events: sourceEvents,
        activeJobCount: (sourceId) => sourceRuntime?.activeJobCount(sourceId) ?? 0,
        supersedeSource: (sourceId) =>
          sourceRuntime?.supersedeSource(sourceId) ?? Promise.resolve(),
      });
      sourceRuntime.setProcessor(async (job, signal, jobs) => {
        try {
          await pipeline.process(job, signal, jobs);
        } finally {
          setTimeout(() => sourceRuntime?.wake(), 0);
        }
      });
      sourceRuntime.setBatchProcessor(async (jobsToProcess, signal, jobs) => {
        try {
          await pipeline.processBatch(jobsToProcess, signal, jobs);
        } finally {
          setTimeout(() => sourceRuntime?.wake(), 0);
        }
      });
      const appearance = await appearanceRepository.initialize();
      nativeTheme.themeSource = appearance.preferences.themeMode;
      await repository.initialize();
      await providerSettingsRepository.initialize();
      await sourceServiceCredentials.initialize();
      registerSourceMediaProtocol({
        protocol,
        repository: sourceRepository,
        getActiveSession: () => repository?.getActiveProjectSession() ?? null,
      });
      registerIpcHandlers();
      await ensureWindow();
      markLifecycle('ready');
      if (process.env.WRITELLM_SMOKE === '1' && process.env.WRITELLM_SMOKE_HOLD !== '1')
        setTimeout(() => app.quit(), 250);
    })
    .catch((error: unknown) => {
      console.error('WriteLLM v2 failed to start.', error);
      app.quit();
    });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('before-quit', (event) => {
    if (!sourceRuntime || quitAfterSourceShutdown) return;
    event.preventDefault();
    quitAfterSourceShutdown = true;
    void sourceRuntime.shutdown().finally(() => app.exit(0));
  });

  app.on('activate', () => {
    void ensureWindow();
  });
}
