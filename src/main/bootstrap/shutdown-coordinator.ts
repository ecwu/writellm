import type { Logger } from 'pino'
import type { ProjectLifecycleSnapshot } from '../../shared/contracts/projects'

interface BeforeQuitEvent {
  preventDefault(): void
}

export interface ShutdownCoordinatorOptions {
  projectManager: {
    snapshot(): ProjectLifecycleSnapshot
    close(): Promise<ProjectLifecycleSnapshot>
  }
  unregisterProjectIpc(): void
  unregisterAppIpc(): void
  unregisterDiagnostics(): void
  closeAppDatabase(): void
  flushLogs(): Promise<void>
  quit(): void
  logger: Pick<Logger, 'info' | 'error'>
}

export interface ShutdownCoordinator {
  handleBeforeQuit(event: BeforeQuitEvent): void
}

export function createShutdownCoordinator(
  options: ShutdownCoordinatorOptions
): ShutdownCoordinator {
  let shutdownStarted = false
  let allowFinalQuit = false

  const attempt = async (event: string, operation: () => void | Promise<void>): Promise<void> => {
    try {
      await operation()
    } catch (err) {
      options.logger.error({ event, err }, 'Application shutdown step failed')
    }
  }

  const shutdown = async (): Promise<void> => {
    if (options.projectManager.snapshot().state === 'open') {
      await attempt('app.shutdown.project_close_failed', async () => {
        await options.projectManager.close()
      })
    }
    await attempt('app.shutdown.project_ipc_unregister_failed', options.unregisterProjectIpc)
    await attempt('app.shutdown.app_ipc_unregister_failed', options.unregisterAppIpc)
    await attempt('app.shutdown.diagnostics_unregister_failed', options.unregisterDiagnostics)
    await attempt('app.shutdown.database_close_failed', options.closeAppDatabase)
    options.logger.info({ event: 'app.stopping' }, 'Application stopping')
    await attempt('app.shutdown.log_flush_failed', options.flushLogs)
  }

  return {
    handleBeforeQuit(event) {
      if (allowFinalQuit) return

      event.preventDefault()
      if (shutdownStarted) return
      shutdownStarted = true

      void shutdown().finally(() => {
        allowFinalQuit = true
        options.quit()
      })
    }
  }
}
