import type { App } from 'electron'
import type { Logger } from 'pino'

export function registerProcessErrorHandlers(
  app: App,
  log: Logger,
  isShuttingDown: () => boolean = () => false,
  exit: (code: number) => void = (code) => app.exit(code)
): () => void {
  let fatalExitStarted = false
  const flushAndExit = (): void => {
    if (fatalExitStarted) return
    fatalExitStarted = true
    const timeout = setTimeout(() => exit(1), 1_000)
    timeout.unref()
    log.flush(() => {
      clearTimeout(timeout)
      exit(1)
    })
  }
  const onUncaughtException = (err: Error): void => {
    log.fatal({ event: 'app.uncaught_exception', err }, 'Uncaught exception')
    flushAndExit()
  }
  const onUnhandledRejection = (reason: unknown): void => {
    const err =
      reason instanceof Error ? reason : new Error('Unhandled rejection', { cause: reason })
    log.fatal({ event: 'app.unhandled_rejection', err }, 'Unhandled rejection')
    flushAndExit()
  }
  const onChildProcessGone = (_event: Electron.Event, details: Electron.Details): void => {
    if (isShuttingDown() && (details.reason === 'killed' || details.reason === 'clean-exit')) return
    log.error(
      {
        event: 'worker.process_gone',
        processType: details.type,
        reason: details.reason,
        exitCode: details.exitCode,
        serviceName: details.serviceName
      },
      'Child process exited unexpectedly'
    )
  }
  const onRenderProcessGone = (
    _event: Electron.Event,
    webContents: Electron.WebContents,
    details: Electron.RenderProcessGoneDetails
  ): void => {
    if (isShuttingDown() && (details.reason === 'killed' || details.reason === 'clean-exit')) return
    log.error(
      {
        event: 'app.renderer_process_gone',
        webContentsId: webContents.id,
        reason: details.reason,
        exitCode: details.exitCode
      },
      'Renderer process exited unexpectedly'
    )
  }

  process.on('uncaughtException', onUncaughtException)
  process.on('unhandledRejection', onUnhandledRejection)
  app.on('child-process-gone', onChildProcessGone)
  app.on('render-process-gone', onRenderProcessGone)

  return () => {
    process.off('uncaughtException', onUncaughtException)
    process.off('unhandledRejection', onUnhandledRejection)
    app.off('child-process-gone', onChildProcessGone)
    app.off('render-process-gone', onRenderProcessGone)
  }
}
