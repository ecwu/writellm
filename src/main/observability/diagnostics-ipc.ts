import { dialog, ipcMain, shell, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { Logger } from 'pino'
import {
  diagnosticsLevelInputSchema,
  diagnosticsSnapshotSchema,
  rendererErrorReportSchema
} from '../../shared/contracts/diagnostics'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { LoggerSystem } from './logger'
import { authorizeSender } from '../ipc/authorize-sender'

export function registerDiagnosticsIpc(
  loggerSystem: LoggerSystem,
  getWindow: () => BrowserWindow | null,
  developmentUrl?: string
): () => void {
  const log = loggerSystem.createModuleLogger('ipc', 'diagnostics')

  ipcMain.handle(IPC_CHANNELS.diagnosticsSnapshot, (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return diagnosticsSnapshotSchema.parse(loggerSystem.ringBuffer.snapshot())
  })
  ipcMain.on(IPC_CHANNELS.diagnosticsReportRendererError, (event, input: unknown) => {
    try {
      authorizeSender(event.senderFrame, developmentUrl)
      const report = rendererErrorReportSchema.parse(input)
      const err = new Error(report.message)
      if (report.stack !== undefined) err.stack = report.stack
      log.error(
        {
          event: report.event,
          err,
          source: report.source,
          line: report.line,
          column: report.column
        },
        'Renderer reported an error'
      )
    } catch (err) {
      log.warn(
        { event: 'ipc.renderer_error_report.rejected', err },
        'Rejected renderer error report'
      )
    }
  })
  ipcMain.handle(IPC_CHANNELS.diagnosticsSetLevel, (event, input: unknown) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const change = diagnosticsLevelInputSchema.parse(input)
    loggerSystem.setSubsystemLevel(change.subsystem, change.level, change.durationMs)
    log.info({ event: 'app.log_level.changed', ...change }, 'Subsystem log level changed')
  })
  ipcMain.handle(IPC_CHANNELS.diagnosticsOpenLogs, async (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    const errorMessage = await shell.openPath(loggerSystem.logDirectory)
    if (errorMessage !== '') {
      const err = new Error(errorMessage)
      log.error({ event: 'app.logs_directory.open_failed', err }, 'Failed to open logs directory')
      throw err
    }
  })
  ipcMain.handle(IPC_CHANNELS.diagnosticsExport, async (event) => {
    authorizeSender(event.senderFrame, developmentUrl)
    return exportDiagnosticsBundle(loggerSystem, getWindow, log)
  })

  let unsubscribe = (): void => undefined
  unsubscribe = loggerSystem.ringBuffer.subscribe((entry) => {
    const window = getWindow()
    if (window !== null && !window.isDestroyed()) {
      try {
        window.webContents.send(IPC_CHANNELS.diagnosticsEvent, entry)
      } catch (err) {
        unsubscribe()
        log.warn(
          { event: 'ipc.diagnostics_subscription.failed', err },
          'Stopped diagnostics subscription after send failure'
        )
      }
    }
  })

  return () => {
    unsubscribe()
    for (const channel of [
      IPC_CHANNELS.diagnosticsSnapshot,
      IPC_CHANNELS.diagnosticsSetLevel,
      IPC_CHANNELS.diagnosticsOpenLogs,
      IPC_CHANNELS.diagnosticsExport
    ]) {
      ipcMain.removeHandler(channel)
    }
    ipcMain.removeAllListeners(IPC_CHANNELS.diagnosticsReportRendererError)
  }
}

export async function exportDiagnosticsBundle(
  loggerSystem: LoggerSystem,
  getWindow: () => BrowserWindow | null,
  log: Pick<Logger, 'error'> = loggerSystem.createModuleLogger('ipc', 'diagnostics')
): Promise<{ exported: boolean }> {
  const owner = getWindow()
  const options = {
    defaultPath: 'writellm-diagnostics.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  }
  const result =
    owner === null
      ? await dialog.showSaveDialog(options)
      : await dialog.showSaveDialog(owner, options)
  if (result.canceled || result.filePath === undefined) return { exported: false }

  try {
    await writeFile(
      result.filePath,
      JSON.stringify(
        { exportedAt: new Date().toISOString(), logs: loggerSystem.ringBuffer.snapshot() },
        null,
        2
      ),
      { encoding: 'utf8', mode: 0o600 }
    )
    return { exported: true }
  } catch (err) {
    log.error({ event: 'app.diagnostics_export.failed', err }, 'Failed to export diagnostics')
    throw new Error('Failed to export diagnostics', { cause: err })
  }
}
