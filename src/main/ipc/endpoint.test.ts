import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'
import { defineIpcEndpoint } from '../../shared/contracts/ipc-endpoints'
import { registerIpcEndpoint, type TypedIpcMain } from './endpoint'

function harness() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const ipc: TypedIpcMain = {
    handle(channel, listener) {
      handlers.set(channel, listener)
    },
    removeHandler(channel) {
      handlers.delete(channel)
    }
  }
  const event = {
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  return { event, handlers, ipc }
}

describe('typed IPC endpoint registration', () => {
  it('authorizes, parses, and validates a request and response', async () => {
    const { event, handlers, ipc } = harness()
    const endpoint = defineIpcEndpoint({
      channel: 'test:typed',
      input: z.object({ value: z.number().int() }).strict(),
      output: z.object({ doubled: z.number().int() }).strict(),
      session: 'none'
    })
    const handle = vi.fn(({ value }: { value: number }) => ({ doubled: value * 2 }))

    const unregister = registerIpcEndpoint(ipc, endpoint, {
      developmentUrl: 'http://localhost:5173',
      handle
    })

    expect(handlers.get(endpoint.channel)?.(event, { value: 4 })).toEqual({ doubled: 8 })
    expect(handle).toHaveBeenCalledWith({ value: 4 }, event)

    expect(() => handlers.get(endpoint.channel)?.(event, { value: '4' })).toThrow()
    expect(handle).toHaveBeenCalledOnce()
    unregister()
    expect(handlers.has(endpoint.channel)).toBe(false)
  })

  it('rejects an untrusted sender before the handler runs', async () => {
    const { handlers, ipc } = harness()
    const endpoint = defineIpcEndpoint({
      channel: 'test:sender',
      input: z.undefined(),
      output: z.object({ accepted: z.literal(true) }).strict(),
      session: 'none'
    })
    const handle = vi.fn(() => ({ accepted: true as const }))
    registerIpcEndpoint(ipc, endpoint, {
      developmentUrl: 'http://localhost:5173',
      handle
    })

    const untrusted = {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
    expect(() => handlers.get(endpoint.channel)?.(untrusted)).toThrow('Unauthorized IPC sender')
    expect(handle).not.toHaveBeenCalled()
  })

  it('enforces the declared project session capability before the handler', async () => {
    const { event, handlers, ipc } = harness()
    const endpoint = defineIpcEndpoint({
      channel: 'test:mutation',
      input: z.object({ projectSessionId: z.uuid(), value: z.string() }).strict(),
      output: z.object({ accepted: z.literal(true) }).strict(),
      session: 'mutation'
    })
    const manager = {
      assertActiveSession: vi.fn(),
      assertMutationSession: vi.fn()
    }
    const handle = vi.fn(() => ({ accepted: true as const }))
    registerIpcEndpoint(ipc, endpoint, {
      developmentUrl: 'http://localhost:5173',
      manager,
      handle
    })

    const projectSessionId = '00000000-0000-4000-8000-000000000001'
    expect(handlers.get(endpoint.channel)?.(event, { projectSessionId, value: 'ok' })).toEqual({
      accepted: true
    })
    expect(manager.assertMutationSession).toHaveBeenCalledWith(projectSessionId)
    expect(manager.assertActiveSession).not.toHaveBeenCalled()
  })
})
