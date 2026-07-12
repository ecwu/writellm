import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron';
import { appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ipcChannels, type CreateProjectRequest, type RecentProjectRequest } from '../shared/ipc.js';
import { isRecord } from '../shared/project.js';
import { ProjectRepository } from './project/project-repository.js';
import { appearanceChannels } from '../shared/appearance.js';
import { AppearancePreferencesRepository } from './appearance/appearance-preferences.js';
import { WritingOrientationRepository } from './writing-orientation/repository.js';
import { registerWritingOrientationHandlers } from './writing-orientation/handlers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(devServerUrl);
const rendererDirectory = path.join(__dirname, '../../dist');
const hasSingleInstanceLock = app.requestSingleInstanceLock();

let mainWindow: BrowserWindow | null = null;
let repository: ProjectRepository | null = null;
let appearanceRepository: AppearancePreferencesRepository | null = null;
let handlersRegistered = false;
const writingOrientationRepository = new WritingOrientationRepository();

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
  return isRecord(value) && typeof value.recentId === 'string' && value.recentId.length > 0 && value.recentId.length <= 128;
}

function registerIpcHandlers(): void {
  if (handlersRegistered || !repository) return;
  handlersRegistered = true;
  ipcMain.handle(ipcChannels.listRecentProjects, async (event) => {
    if (!isExpectedSender(event)) return safeError();
    try { return await repository!.listRecentProjects(); } catch { return safeError('Recent projects could not be loaded.'); }
  });
  ipcMain.handle(ipcChannels.createProject, async (event, request: unknown) => {
    if (!isExpectedSender(event)) return safeError();
    if (!isCreateRequest(request)) return { status: 'error', error: { code: 'INVALID_PROJECT_NAME', message: 'Project name is invalid.' } };
    try { return await repository!.createProject(request.displayName); } catch { return safeError('The project could not be created safely.'); }
  });
  ipcMain.handle(ipcChannels.openProjectFromDialog, async (event) => {
    if (!isExpectedSender(event)) return safeError();
    try { return await repository!.openProjectFromDialog(); } catch { return safeError('The project could not be opened.'); }
  });
  ipcMain.handle(ipcChannels.openRecentProject, async (event, request: unknown) => {
    if (!isExpectedSender(event)) return safeError();
    if (!isRecentRequest(request)) return { status: 'error', error: { code: 'RECENT_NOT_FOUND', message: 'That recent project record is not available.' } };
    try { return await repository!.openRecentProject(request.recentId); } catch { return safeError('The recent project could not be opened.'); }
  });
  ipcMain.handle(ipcChannels.relinkRecentProject, async (event, request: unknown) => {
    if (!isExpectedSender(event)) return safeError();
    if (!isRecentRequest(request)) return { status: 'error', error: { code: 'RECENT_NOT_FOUND', message: 'That recent project record is not available.' } };
    try { return await repository!.relinkRecentProject(request.recentId); } catch { return safeError('The recent project could not be relinked.'); }
  });
  ipcMain.handle(ipcChannels.removeRecentProject, async (event, request: unknown) => {
    if (!isExpectedSender(event)) return safeError();
    if (!isRecentRequest(request)) return { status: 'error', error: { code: 'RECENT_NOT_FOUND', message: 'That recent project record is not available.' } };
    try { return await repository!.removeRecentProject(request.recentId); } catch { return safeError('The recent project record could not be removed.'); }
  });
  ipcMain.handle(appearanceChannels.get, (event) => isExpectedSender(event) && appearanceRepository ? appearanceRepository.get() : { status: 'error', error: { code: 'STORAGE_READ_FAILED', message: 'Appearance preferences are unavailable.' } });
  ipcMain.handle(appearanceChannels.update, async (event, value: unknown) => {
    if (!isExpectedSender(event) || !appearanceRepository) return { status: 'error', error: { code: 'STORAGE_WRITE_FAILED', message: 'Appearance preferences are unavailable.' } };
    const result = await appearanceRepository.update(value);
    if (result.status === 'updated') nativeTheme.themeSource = result.preferences.themeMode;
    return result;
  });
  registerWritingOrientationHandlers({ ipcMain, projects: repository, repository: writingOrientationRepository, isExpectedSender });
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
      webviewTag: false
    }
  });
  mainWindow = window;
  window.on('closed', () => { if (mainWindow === window) mainWindow = null; });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  if (isDevelopment) await window.loadURL(devServerUrl!);
  else await window.loadFile(path.join(rendererDirectory, 'index.html'));
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => { markLifecycle('second-instance'); void ensureWindow(); });
  app.whenReady().then(async () => {
    repository = new ProjectRepository({ userDataPath: app.getPath('userData'), dialog });
    appearanceRepository = new AppearancePreferencesRepository(app.getPath('userData'));
    const appearance = await appearanceRepository.initialize();
    nativeTheme.themeSource = appearance.preferences.themeMode;
    await repository.initialize();
    registerIpcHandlers();
    await ensureWindow();
    markLifecycle('ready');
    if (process.env.WRITELLM_SMOKE === '1' && process.env.WRITELLM_SMOKE_HOLD !== '1') setTimeout(() => app.quit(), 250);
  }).catch((error: unknown) => {
    console.error('WriteLLM v2 failed to start.', error);
    app.quit();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('activate', () => { void ensureWindow(); });
}
