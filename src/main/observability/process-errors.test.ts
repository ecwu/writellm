import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { App } from 'electron'
import type { Logger } from 'pino'
import { registerProcessErrorHandlers } from './process-errors'

describe('registerProcessErrorHandlers', () => {
  it('records process-gone lifecycle events and unregisters listeners', () => {
    const app = new EventEmitter() as App
    const error = vi.fn()
    const log = { error, fatal: vi.fn(), flush: vi.fn() } as unknown as Logger
    const unregister = registerProcessErrorHandlers(app, log)

    app.emit(
      'child-process-gone',
      {},
      {
        type: 'Utility',
        reason: 'crashed',
        exitCode: 1,
        serviceName: 'fixture'
      }
    )
    app.emit('render-process-gone', {}, { id: 7 }, { reason: 'oom', exitCode: 9 })

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'worker.process_gone', reason: 'crashed' }),
      'Child process exited unexpectedly'
    )
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'app.renderer_process_gone', reason: 'oom' }),
      'Renderer process exited unexpectedly'
    )

    unregister()
    expect(app.listenerCount('child-process-gone')).toBe(0)
    expect(app.listenerCount('render-process-gone')).toBe(0)
  })

  it('does not report expected child termination during shutdown', () => {
    const app = new EventEmitter() as App
    const error = vi.fn()
    const log = { error, fatal: vi.fn(), flush: vi.fn() } as unknown as Logger
    const unregister = registerProcessErrorHandlers(app, log, () => true)

    app.emit(
      'child-process-gone',
      {},
      {
        type: 'Utility',
        reason: 'killed',
        exitCode: 15,
        serviceName: 'fixture'
      }
    )
    app.emit('render-process-gone', {}, { id: 7 }, { reason: 'killed', exitCode: 15 })
    expect(error).not.toHaveBeenCalled()
    unregister()
  })

  it('logs the original fatal error and exits after flushing', () => {
    const app = new EventEmitter() as App
    const err = new Error('fatal fixture')
    const fatal = vi.fn()
    const flush = vi.fn((callback: () => void) => callback())
    const exit = vi.fn()
    const log = { error: vi.fn(), fatal, flush } as unknown as Logger
    const unregister = registerProcessErrorHandlers(app, log, () => false, exit)

    ;(process as EventEmitter).emit('uncaughtException', err, 'uncaughtException')
    expect(fatal).toHaveBeenCalledWith(
      { event: 'app.uncaught_exception', err },
      'Uncaught exception'
    )
    expect(flush).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
    unregister()
  })
})
