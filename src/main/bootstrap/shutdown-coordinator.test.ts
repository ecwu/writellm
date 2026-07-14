import { describe, expect, it, vi } from 'vitest'
import { createShutdownCoordinator } from './shutdown-coordinator'

function setup(options: { projectState?: 'closed' | 'open'; closeRejects?: boolean } = {}) {
  const calls: string[] = []
  const logger = {
    info: vi.fn(() => calls.push('log')),
    error: vi.fn()
  }
  const projectManager = {
    snapshot: vi.fn(() => ({
      state: options.projectState ?? 'open',
      activeProject:
        (options.projectState ?? 'open') === 'open'
          ? {
              projectId: '00000000-0000-4000-8000-000000000001',
              projectSessionId: '00000000-0000-4000-8000-000000000002',
              displayName: 'Project'
            }
          : null
    })),
    close: vi.fn(async () => {
      calls.push('project.close')
      if (options.closeRejects) throw new Error('close failed')
      return { state: 'closed' as const, activeProject: null }
    })
  }
  const coordinator = createShutdownCoordinator({
    projectManager,
    unregisterProjectIpc: () => calls.push('project.ipc'),
    unregisterAppIpc: () => calls.push('app.ipc'),
    unregisterDiagnostics: () => calls.push('diagnostics'),
    closeAppDatabase: () => calls.push('database'),
    flushLogs: async () => {
      calls.push('flush')
    },
    quit: () => calls.push('quit'),
    logger
  })
  return { calls, coordinator, logger, projectManager }
}

const settleShutdown = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('shutdown coordinator', () => {
  it('prevents the first quit and closes resources in order before reissuing quit', async () => {
    const { calls, coordinator } = setup()
    const firstEvent = { preventDefault: vi.fn() }

    coordinator.handleBeforeQuit(firstEvent)
    await settleShutdown()

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(calls).toEqual([
      'project.close',
      'project.ipc',
      'app.ipc',
      'diagnostics',
      'database',
      'log',
      'flush',
      'quit'
    ])

    const finalEvent = { preventDefault: vi.fn() }
    coordinator.handleBeforeQuit(finalEvent)
    expect(finalEvent.preventDefault).not.toHaveBeenCalled()
    expect(calls.filter((call) => call === 'quit')).toHaveLength(1)
  })

  it('logs the original close error and continues shutdown', async () => {
    const { calls, coordinator, logger } = setup({ closeRejects: true })

    coordinator.handleBeforeQuit({ preventDefault: vi.fn() })
    await settleShutdown()

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'app.shutdown.project_close_failed',
        err: expect.any(Error)
      }),
      'Application shutdown step failed'
    )
    expect(calls.slice(1)).toEqual([
      'project.ipc',
      'app.ipc',
      'diagnostics',
      'database',
      'log',
      'flush',
      'quit'
    ])
  })
})
