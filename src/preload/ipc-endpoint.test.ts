import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineIpcEndpoint } from '../shared/contracts/ipc-endpoints'
import { invokeIpcEndpoint } from './ipc-endpoint'

describe('typed IPC endpoint invocation', () => {
  it('validates input before invoking and validates the returned value', async () => {
    const invoke = vi.fn(async (_channel: string, input: unknown) => ({ value: input }))
    const endpoint = defineIpcEndpoint({
      channel: 'test:invoke',
      input: z.object({ value: z.string().min(1) }).strict(),
      output: z.object({ value: z.object({ value: z.string() }).strict() }).strict(),
      session: 'none'
    })

    await expect(invokeIpcEndpoint({ invoke }, endpoint, { value: 'ok' })).resolves.toEqual({
      value: { value: 'ok' }
    })
    expect(invoke).toHaveBeenCalledWith(endpoint.channel, { value: 'ok' })
    await expect(invokeIpcEndpoint({ invoke }, endpoint, { value: '' })).rejects.toThrow()
    expect(invoke).toHaveBeenCalledOnce()
  })

  it('omits the undefined argument for inputless endpoints', async () => {
    const invoke = vi.fn(async (...args: unknown[]) => ({ accepted: args.length === 1 }))
    const endpoint = defineIpcEndpoint({
      channel: 'test:empty',
      input: z.undefined(),
      output: z.object({ accepted: z.literal(true) }).strict(),
      session: 'none'
    })

    await expect(invokeIpcEndpoint({ invoke }, endpoint)).resolves.toEqual({ accepted: true })
    expect(invoke).toHaveBeenCalledWith(endpoint.channel)
  })
})
