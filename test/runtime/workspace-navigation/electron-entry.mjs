import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';
const here = path.dirname(fileURLToPath(import.meta.url));
await app.whenReady();
const win = new BrowserWindow({
  width: 960,
  height: 640,
  show: false,
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    plugins: false,
  },
});
await win.loadFile(path.join(here, 'fixture.html'));
win.show();
