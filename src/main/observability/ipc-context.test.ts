import { createLoggerSystem } from './logger'
import { PassThrough } from 'node:stream'
import type { IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { currentLogContext } from './log-context'
import { withIpcLogging, reportIpcFailure } from './ipc-context'

type Listener = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

function harness() {
  const destination = new PassThrough()
  const output: string[] = []
  destination.on('data', (chunk) => output.push(chunk.toString()))
  const logger = pino({ level: 'info', mixin: currentLogContext }, destination)
  const records = () =>
    output
      .join('')
      .trim()
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

  const handlers = new Map<string, Listener>()
  const removeHandler = vi.fn()
  const ipc = withIpcLogging(
    {
      handle: (channel: string, listener: Listener) => {
        handlers.set(channel, listener)
      },
      removeHandler
    },
    logger
  )
  const event = {} as IpcMainInvokeEvent
  return { event, handlers, ipc, logger, records, removeHandler }
}

describe('withIpcLogging', () => {
  it('attaches a request-scoped log context to every handler invocation', async () => {
    const { event, handlers, ipc, logger, records } = harness()
    const projectSessionId = '11111111-1111-4111-8111-111111111111'
    ipc.handle('test:invoke', async (_event, input: unknown) => {
      await Promise.resolve()
      logger.info({ event: 'test.inside' }, 'Inside handler')
      return input
    })

    const result = await handlers.get('test:invoke')?.(event, { projectSessionId })

    expect(result).toEqual({ projectSessionId })
    expect(records()).toHaveLength(1)
    expect(records()[0]).toMatchObject({
      event: 'test.inside',
      projectSessionId,
      requestId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })
    expect(currentLogContext()).toEqual({})
  })

  it('does not leak correlation between sequential invocations', async () => {
    const { event, handlers, ipc, logger, records } = harness()
    ipc.handle('test:invoke', async (_event) => {
      await Promise.resolve()
      logger.info({ event: 'test.inside' }, 'Inside handler')
    })

    await handlers.get('test:invoke')?.(event, {
      projectSessionId: '11111111-1111-4111-8111-111111111111'
    })
    await handlers.get('test:invoke')?.(event, {})

    const [first, second] = records()
    expect(records()).toHaveLength(2)
    expect(first?.requestId).toEqual(expect.any(String))
    expect(second?.requestId).toEqual(expect.any(String))
    expect(second?.requestId).not.toBe(first?.requestId)
    expect(second).not.toHaveProperty('projectSessionId')
    expect(currentLogContext()).toEqual({})
  })

  it('delegates non-handle members to the wrapped ipc implementation', () => {
    const { ipc, removeHandler } = harness()

    ipc.removeHandler('test:invoke')

    expect(removeHandler).toHaveBeenCalledWith('test:invoke')
  })
})

it.each(['sync', 'async'] as const)(
  'reports a previously unhandled %s IPC failure with its original cause and context',
  async (mode) => {
    const log = { warn: vi.fn(), error: vi.fn() }
    let invoke!: Listener
    const ipc = withIpcLogging(
      {
        handle: (_channel, listener) => {
          invoke = listener
        },
        removeHandler: vi.fn()
      },
      log
    )
    const cause = new Error('Disk unavailable')
    const error = new Error('Read failed', { cause })
    ipc.handle(
      'test:failure',
      mode === 'sync'
        ? () => {
            throw error
          }
        : async () => {
            await Promise.resolve()
            throw error
          }
    )
    const event = {} as IpcMainInvokeEvent
    if (mode === 'sync') expect(() => invoke(event, {})).toThrow(error)
    else await expect(invoke(event, {})).rejects.toBe(error)
    expect(log.error).toHaveBeenCalledOnce()
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error, channel: 'test:failure' }),
      expect.any(String)
    )
    expect(error.cause).toBe(cause)
  }
)

it('retains the original failure when its logging channel throws', () => {
  let invoke!: Listener
  const failure = new Error('Operation failed')
  const ipc = withIpcLogging(
    {
      handle: (_channel, listener) => {
        invoke = listener
      },
      removeHandler: vi.fn()
    },
    {
      warn: vi.fn(),
      error: () => {
        throw new Error('Logger closed')
      }
    }
  )
  ipc.handle('test:failure', () => {
    throw failure
  })
  expect(() => invoke({} as IpcMainInvokeEvent)).toThrow(failure)
})

it('logs a service failure once per invocation and redacts private input for unhandled failures', async () => {
  const destination = new PassThrough()
  const output: string[] = []
  destination.on('data', (chunk) => output.push(chunk.toString()))
  const system = await createLoggerSystem({
    appVersion: 'test',
    development: false,
    logDirectory: '/tmp/writellm-ipc-errors',
    destination
  })
  const service = system.createModuleLogger('manuscript', 'persistence')
  const boundary = system.createModuleLogger('ipc', 'operations')
  const handlers = new Map<string, Listener>()
  const ipc = withIpcLogging(
    {
      handle: (channel, listener) => {
        handlers.set(channel, listener)
      },
      removeHandler: vi.fn()
    },
    boundary
  )
  const failure = new Error('Persistence failed')
  ipc.handle('test:owned', () => {
    service.error({ event: 'manuscript.save.failed', err: failure }, 'Save failed')
    const publicError = new Error('Save could not finish', { cause: failure })
    reportIpcFailure(boundary, { event: 'test.handler.failed', err: publicError }, 'Handler failed')
    throw publicError
  })
  for (let index = 0; index < 2; index += 1)
    expect(() => handlers.get('test:owned')?.({} as IpcMainInvokeEvent)).toThrow(
      'Save could not finish'
    )
  const body = 'Private manuscript text without a recognizable label'
  const cause = new Error('API_KEY=secret')
  const unhandled = new Error(`Failed to save ${body}`, { cause })
  ipc.handle('test:unowned', async () => {
    throw unhandled
  })
  await expect(
    handlers.get('test:unowned')?.({} as IpcMainInvokeEvent, {
      projectSessionId: body,
      document: body
    })
  ).rejects.toBe(unhandled)
  await system.flush()
  const records = output
    .join('')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(records).toHaveLength(3)
  expect(records.slice(0, 2).map((record) => record.event)).toEqual([
    'manuscript.save.failed',
    'manuscript.save.failed'
  ])
  expect(records[2]).toMatchObject({ event: 'ipc.operation.failed', requestId: expect.any(String) })
  expect(records[2]).not.toHaveProperty('projectSessionId')
  expect(output.join('')).not.toContain(body)
  expect(output.join('')).not.toContain('API_KEY=secret')
  expect(unhandled.cause).toBe(cause)
})

it('attempts the original report even when an exception blocks cause inspection', () => {
  let invoke!: Listener
  const original = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('Prototype unavailable')
      },
      getOwnPropertyDescriptor() {
        throw new Error('Descriptor unavailable')
      }
    }
  )
  const log = { warn: vi.fn(), error: vi.fn() }
  const ipc = withIpcLogging(
    {
      handle: (_channel, listener) => {
        invoke = listener
      },
      removeHandler: vi.fn()
    },
    log
  )
  ipc.handle('test:hostile', () => {
    throw original
  })
  let caught: unknown
  try {
    invoke({} as IpcMainInvokeEvent)
  } catch (err) {
    caught = err
  }
  expect(caught === original).toBe(true)
  expect(log.error).toHaveBeenCalledOnce()
  expect(log.error.mock.calls[0]?.[0].err === original).toBe(true)
})

it('logs expected rejections, including wrapped ones, at warn with the original error', async () => {
  class SessionClosed extends Error {}
  const log = { warn: vi.fn(), error: vi.fn() }
  const handlers = new Map<string, Listener>()
  const ipc = withIpcLogging(
    {
      handle: (channel, listener) => {
        handlers.set(channel, listener)
      },
      removeHandler: vi.fn()
    },
    log,
    { isExpectedRejection: (err) => err instanceof SessionClosed }
  )
  const closed = new SessionClosed('Project session is not active')
  const wrapped = new Error('Save could not finish', { cause: closed })
  const unexpected = new Error('Disk unavailable')
  ipc.handle('test:closed', async () => {
    throw closed
  })
  ipc.handle('test:owned', () => {
    reportIpcFailure(log, { event: 'test.handler.failed', err: wrapped }, 'Handler failed')
    throw wrapped
  })
  ipc.handle('test:unexpected', async () => {
    throw unexpected
  })
  const event = {} as IpcMainInvokeEvent
  await expect(handlers.get('test:closed')?.(event, {})).rejects.toBe(closed)
  expect(() => handlers.get('test:owned')?.(event, {})).toThrow(wrapped)
  await expect(handlers.get('test:unexpected')?.(event, {})).rejects.toBe(unexpected)
  expect(log.warn.mock.calls.map(([fields]) => fields)).toEqual([
    expect.objectContaining({ event: 'ipc.operation.failed', err: closed, channel: 'test:closed' }),
    expect.objectContaining({ event: 'test.handler.failed', err: wrapped })
  ])
  expect(log.error).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ err: unexpected, channel: 'test:unexpected' }),
    expect.any(String)
  )
})

it('reports at error level when the expected-rejection check itself throws', () => {
  const log = { warn: vi.fn(), error: vi.fn() }
  let invoke!: Listener
  const ipc = withIpcLogging(
    {
      handle: (_channel, listener) => {
        invoke = listener
      },
      removeHandler: vi.fn()
    },
    log,
    {
      isExpectedRejection: () => {
        throw new Error('Prototype unavailable')
      }
    }
  )
  const failure = new Error('Operation failed')
  ipc.handle('test:failure', () => {
    throw failure
  })
  expect(() => invoke({} as IpcMainInvokeEvent)).toThrow(failure)
  expect(log.warn).not.toHaveBeenCalled()
  expect(log.error).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ err: failure }),
    expect.any(String)
  )
})

it('keeps safe IDs and short request strings readable while redacting longer private text', async () => {
  const destination = new PassThrough()
  const output: string[] = []
  destination.on('data', (chunk) => output.push(chunk.toString()))
  const system = await createLoggerSystem({
    appVersion: 'test',
    development: false,
    logDirectory: '/tmp/writellm-ipc-short-strings',
    destination
  })
  let invoke!: Listener
  const ipc = withIpcLogging(
    {
      handle: (_channel, listener) => {
        invoke = listener
      },
      removeHandler: vi.fn()
    },
    system.createModuleLogger('ipc', 'operations')
  )
  const sectionId = '22222222-2222-4222-8222-222222222222'
  const failure = new Error(`Find "e" in section ${sectionId} failed near Private draft sentence`)
  ipc.handle('test:find', async () => {
    throw failure
  })
  await expect(
    invoke({} as IpcMainInvokeEvent, {
      sectionId,
      query: 'e',
      context: 'Private draft sentence'
    })
  ).rejects.toBe(failure)
  await system.flush()
  const [record] = output
    .join('')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(record.err.message).toBe(`Find "e" in section ${sectionId} failed near [REDACTED]`)
})
