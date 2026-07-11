import { fileURLToPath } from 'node:url';
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron';

export type TrustedRendererConfig = {
  devServerUrl?: string;
  productionRendererDirectory: string;
};

type TrustedRenderer = {
  webContentsId: number;
  config: TrustedRendererConfig;
};

let trustedRenderer: TrustedRenderer | null = null;
let trustedWebContents: WebContents | null = null;

export function configureTrustedRenderer(
  window: BrowserWindow,
  config: TrustedRendererConfig
): void {
  trustedRenderer = { webContentsId: window.webContents.id, config };
  trustedWebContents = window.webContents;

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedRendererUrl(navigationUrl, config)) {
      event.preventDefault();
    }
  });

  const { session } = window.webContents;
  session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.setPermissionCheckHandler(() => false);
}

export function clearTrustedRenderer(webContents?: Pick<WebContents, 'id'>): void {
  if (!webContents || trustedRenderer?.webContentsId === webContents.id) {
    trustedRenderer = null;
    trustedWebContents = null;
  }
}

export function sendToTrustedRenderer(channel: string, ...args: unknown[]): void {
  const webContents = trustedWebContents;
  if (!webContents || webContents.isDestroyed()) {
    return;
  }
  const trust = trustedRenderer;
  if (!trust || !isTrustedRendererUrl(webContents.getURL(), trust.config)) {
    return;
  }
  webContents.send(channel, ...args);
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  const trust = trustedRenderer;
  const senderFrame = event.senderFrame;
  if (!trust || !senderFrame || event.sender.id !== trust.webContentsId || senderFrame !== event.sender.mainFrame) {
    throw new Error('IPC request was rejected because it did not originate from the trusted primary renderer.');
  }
  if (!isTrustedRendererUrl(senderFrame.url, trust.config)) {
    throw new Error('IPC request was rejected because the renderer origin is not trusted.');
  }
}

export function isTrustedRendererUrl(url: string, config: TrustedRendererConfig): boolean {
  try {
    const candidate = new URL(url);
    if (config.devServerUrl) {
      const developmentOrigin = new URL(config.devServerUrl).origin;
      if (candidate.origin === developmentOrigin) {
        return true;
      }
    }
    if (candidate.protocol !== 'file:') {
      return false;
    }
    const candidatePath = fileURLToPath(candidate);
    const rendererDirectory = normalizeDirectory(config.productionRendererDirectory);
    return candidatePath === rendererDirectory || candidatePath.startsWith(`${rendererDirectory}/`);
  } catch {
    return false;
  }
}

function normalizeDirectory(directory: string): string {
  return directory.replace(/\\/g, '/').replace(/\/+$/, '');
}
