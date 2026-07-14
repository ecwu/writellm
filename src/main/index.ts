import { app, BrowserWindow, MessageChannelMain, utilityProcess } from 'electron'
import { join } from 'node:path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { registerAppProtocol, registerAppScheme } from './bootstrap/protocol'
import { createWindow } from './bootstrap/windows'
import { registerIpcHandlers } from './ipc/register-handlers'
import { createLoggerSystem } from './observability/logger'
import { cleanupLogRetention } from './observability/log-retention'
import { registerProcessErrorHandlers } from './observability/process-errors'
import { registerDiagnosticsIpc } from './observability/diagnostics-ipc'
import { LogCollector } from './observability/log-collector'
import { attachUtilityLogPort, captureUtilityStderr } from './observability/utility-logs'
import { openAppDatabase } from './app-db/connection'
import { quarantineLegacyCoreDatabase } from './app-db/legacy-core'

registerAppScheme()

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
void app
  .whenReady()
  .then(async () => {
    // Set app user model id for windows
    electronApp.setAppUserModelId('com.electron')

    // Default open or close DevTools by F12 in development
    // and ignore CommandOrControl + R in production.
    // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window)
    })

    const developmentUrl = process.env['ELECTRON_RENDERER_URL']
    const loggerSystem = await createLoggerSystem({
      appVersion: app.getVersion(),
      logDirectory: app.getPath('logs'),
      development: is.dev
    })
    const appLog = loggerSystem.createModuleLogger('app', 'lifecycle')
    let shuttingDown = false
    registerProcessErrorHandlers(app, appLog, () => shuttingDown)

    try {
      await cleanupLogRetention(loggerSystem.logDirectory, {
        activeFileName: loggerSystem.activeFileName,
        maxAgeMs: 14 * 24 * 60 * 60 * 1_000,
        maxTotalBytes: 200 * 1_024 * 1_024
      })
    } catch (err) {
      appLog.warn({ event: 'app.log_retention.failed', err }, 'Failed to clean old logs')
    }

    const appDatabaseLog = loggerSystem.createModuleLogger('db', 'app-database')
    await quarantineLegacyCoreDatabase(app.getPath('userData'), appDatabaseLog)
    const appDatabase = await openAppDatabase({
      path: join(app.getPath('userData'), 'app.sqlite'),
      applicationVersion: app.getVersion(),
      log: appDatabaseLog
    })

    registerAppProtocol(join(__dirname, '../renderer'))
    registerIpcHandlers(developmentUrl)
    let mainWindow = createWindow(developmentUrl)
    const unregisterDiagnostics = registerDiagnosticsIpc(
      loggerSystem,
      () => mainWindow,
      developmentUrl
    )
    appLog.info(
      { event: 'app.started', electronVersion: process.versions.electron },
      'Application started'
    )

    if (process.env['WRITELLM_LOGGING_FIXTURE'] === '1') {
      const workerLog = loggerSystem.createModuleLogger('worker', 'collector')
      const collector = new LogCollector((envelope) =>
        loggerSystem.createModuleLogger(
          envelope.subsystem,
          envelope.component,
          envelope.processRole
        )
      )
      const child = utilityProcess.fork(join(__dirname, 'logging-fixture.js'), [], {
        serviceName: 'writellm-logging-fixture',
        stdio: 'pipe'
      })
      const { port1, port2 } = new MessageChannelMain()
      attachUtilityLogPort(port1, collector, workerLog)
      captureUtilityStderr(child, workerLog)
      child.postMessage({ type: 'logging-port' }, [port2])
    }

    app.on('activate', () => {
      // On macOS it's common to re-create a window in the app when the
      // dock icon is clicked and there are no other windows open.
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow(developmentUrl)
      }
    })

    app.once('before-quit', () => {
      shuttingDown = true
      appDatabase.close()
      unregisterDiagnostics()
      appLog.info({ event: 'app.stopping' }, 'Application stopping')
      void loggerSystem.flush().catch((err) => {
        appLog.error({ event: 'app.log_flush.failed', err }, 'Failed to flush application logs')
      })
    })
  })
  .catch((err) => {
    process.stderr.write(
      `WriteLLM failed to initialize: ${err instanceof Error ? err.stack : String(err)}\n`
    )
    app.exit(1)
  })

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
