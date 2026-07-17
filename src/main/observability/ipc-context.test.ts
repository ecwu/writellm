import { PassThrough } from 'node:stream'
import type { IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { currentLogContext } from './log-context'
import { withIpcLogging } from './ipc-context'

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
  const ipc = withIpcLogging({
    handle: (channel: string, listener: Listener) => {
      handlers.set(channel, listener)
    },
    removeHandler
  })
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
