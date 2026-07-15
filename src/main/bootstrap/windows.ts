import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { Logger } from 'pino'
import icon from '../../../resources/icon.png?asset'
import { APP_URL, isAllowedExternalUrl, isTrustedRendererUrl } from '../../shared/security/urls'

export function createWindow(
  developmentUrl: string | undefined,
  logger: Pick<Logger, 'info' | 'warn'>
): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  })

  try {
    mainWindow.maximize()
    logger.info(
      { event: 'app_window.default_maximize.requested' },
      'Requested the default maximized application window state'
    )
  } catch (err) {
    logger.warn(
      { event: 'app_window.default_maximize.failed', err },
      'Could not apply the default maximized application window state'
    )
  }

  mainWindow.once('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, developmentUrl)) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalUrl(url)) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  if (is.dev && developmentUrl !== undefined) {
    void mainWindow.loadURL(developmentUrl)
  } else {
    void mainWindow.loadURL(APP_URL)
  }

  return mainWindow
}
