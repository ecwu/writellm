import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ipcChannels, type RuntimeInfo } from '../shared/ipc.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const devServerUrl = process.env.VITE_DEV_SERVER_URL;
const isDevelopment = Boolean(devServerUrl);
const rendererDirectory = path.join(__dirname, '../../dist');

function registerIpcHandlers(): void {
  ipcMain.handle(ipcChannels.getRuntimeInfo, (): RuntimeInfo => ({
    appName: app.getName(),
    appVersion: app.getVersion(),
    platform: process.platform,
    isPackaged: app.isPackaged
  }));
}

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, '../preload/preload.cjs');
  if (!existsSync(preloadPath)) {
    throw new Error(`Preload file not found: ${preloadPath}`);
  }

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

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  if (isDevelopment) {
    await window.loadURL(devServerUrl!);
    return;
  }

  await window.loadFile(path.join(rendererDirectory, 'index.html'));
}

app.whenReady().then(() => {
  registerIpcHandlers();
  return createWindow();
}).catch((error: unknown) => {
  console.error('WriteLLM v2 failed to start.', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
