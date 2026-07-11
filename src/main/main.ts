import { app, BrowserWindow } from 'electron';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './ipcHandlers.js';
import { clearTrustedRenderer, configureTrustedRenderer } from './security.js';
import { shutdownActiveWorkspace } from './workspace.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isDev = process.env.VITE_DEV_SERVER_URL !== undefined;

registerIpcHandlers();

async function createWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, '../preload/preload.cjs');
  const productionRendererDirectory = path.join(__dirname, '../../dist');
  if (!existsSync(preloadPath)) {
    console.error(`Preload file not found: ${preloadPath}`);
  }

  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: 'writellm',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false
    }
  });

  configureTrustedRenderer(window, {
    devServerUrl: isDev ? process.env.VITE_DEV_SERVER_URL : undefined,
    productionRendererDirectory
  });
  window.on('closed', () => clearTrustedRenderer(window.webContents));

  window.webContents.on('console-message', (_event, level, _message, line, sourceId) => {
    console.warn(`[renderer:${level}] console payload suppressed (${sourceId}:${line})`);
  });

  if (isDev) {
    await window.loadURL(process.env.VITE_DEV_SERVER_URL!);
  } else {
    await window.loadFile(path.join(productionRendererDirectory, 'index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

let shutdownInProgress = false;

app.on('before-quit', (event) => {
  if (shutdownInProgress) {
    return;
  }
  shutdownInProgress = true;
  event.preventDefault();
  void shutdownActiveWorkspace().finally(() => app.exit(0));
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
