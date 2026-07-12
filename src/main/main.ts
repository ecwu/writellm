import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, safeStorage, shell } from 'electron';
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
import { registerWritingOrientationHandlers } from './writing-orientation/handlers.js';
import { WritingOrientationRepository } from './writing-orientation/repository.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(devServerUrl);
const rendererDirectory = path.join(__dirname, '../../dist');
const isEditorRuntime =
  process.env.WRITELLM_EDITOR_RUNTIME === '1' || process.argv.includes('--writellm-editor-runtime');
if (process.env.WRITELLM_SMOKE_MARKER)
  await appendFile(process.env.WRITELLM_SMOKE_MARKER, `main-start:${isEditorRuntime}\n`);
const hasSingleInstanceLock = isEditorRuntime || app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let repository: ProjectRepository | null = null;
let appearanceRepository: AppearancePreferencesRepository | null = null;
let providerSettingsRepository: ProviderSettingsRepository | null = null;
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
      return await projectRepository.createProject(request.displayName);
    } catch {
      return safeError('The project could not be created safely.');
    }
  });
  ipcMain.handle(ipcChannels.openProjectFromDialog, async (event) => {
    if (!isExpectedSender(event)) return safeError();
    try {
      return await projectRepository.openProjectFromDialog();
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
      return await projectRepository.openRecentProject(request.recentId);
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
      return await projectRepository.relinkRecentProject(request.recentId);
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
  if (isEditorRuntime)
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
      isEditorRuntime ? { query: { 'editor-runtime': '1' } } : undefined,
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
      const appearance = await appearanceRepository.initialize();
      nativeTheme.themeSource = appearance.preferences.themeMode;
      await repository.initialize();
      await providerSettingsRepository.initialize();
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

  app.on('activate', () => {
    void ensureWindow();
  });
}
