import { BrowserWindow, shell } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import type { Logger } from 'pino'
import icon from '../../../resources/icon.png?asset'
import { APP_URL, isAllowedExternalUrl, isTrustedRendererUrl } from '../../shared/security/urls'
import { isSilentWindowPresentation, type WindowPresentation } from './window-presentation'

export function createWindow(
  developmentUrl: string | undefined,
  logger: Pick<Logger, 'info' | 'warn'>,
  presentation: WindowPresentation = 'interactive'
): BrowserWindow {
  const silent = isSilentWindowPresentation(presentation)
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    ...(silent ? { skipTaskbar: true } : {}),
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      ...(silent ? { backgroundThrottling: false } : {})
    }
  })

  logger.info(
    {
      event: 'app_window.presentation.configured',
      presentation,
      visible: !silent,
      backgroundThrottling: !silent
    },
    'Configured application window presentation'
  )

  if (silent) {
    logger.info(
      { event: 'app_window.default_maximize.skipped', presentation },
      'Skipped default maximization for a hidden E2E application window'
    )
  } else {
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
  }

  if (!silent) {
    mainWindow.once('ready-to-show', () => mainWindow.show())
  }

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
