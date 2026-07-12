import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const dir = path.dirname(fileURLToPath(import.meta.url));
await app.whenReady();
const window = new BrowserWindow({
  show: false,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
});
await window.loadFile(path.join(dir, 'fixture.html'));
await window.webContents.executeJavaScript(
  "Boolean(document.querySelector('[contenteditable=true]'))",
);
app.quit();
