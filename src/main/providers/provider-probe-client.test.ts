import { EventEmitter } from 'node:events'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { ProviderProbeClient } from './provider-probe-client'

const config: ProviderConfig = {
  role: 'agent',
  providerId: 'openai-compatible',
  baseUrl: 'https://api.example.test/v1',
  model: 'writer',
  modelRevision: 'writer-rev-1',
  timeoutMs: 30_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null
}

class FakeUtilityProcess extends EventEmitter {
  readonly kill = vi.fn(() => true)
  readonly postMessage = vi.fn((request: { requestId: string }) => {
    queueMicrotask(() => {
      this.emit('message', {
        type: 'result',
        requestId: request.requestId,
        status: 204
      })
    })
  })
}

describe('ProviderProbeClient', () => {
  it('uses a short-lived utility process and returns only normalized status', async () => {
    const child = new FakeUtilityProcess()
    const factory = { fork: vi.fn(() => child) }
    const client = new ProviderProbeClient(
      '/private/provider-probe.js',
      pino({ level: 'silent' }),
      factory as never
    )

    const response = await client.probe(config, 'process-secret', new AbortController().signal)

    expect(response).toEqual({ status: 204 })
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ config, credential: 'process-secret' })
    )
    expect(JSON.stringify(response)).not.toContain('process-secret')
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('revokes a running utility process when the request is aborted', async () => {
    const child = new FakeUtilityProcess()
    child.postMessage.mockImplementation(() => undefined)
    const client = new ProviderProbeClient(
      '/private/provider-probe.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never
    )
    const controller = new AbortController()
    const pending = client.probe(config, 'process-secret', controller.signal)

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.kill).toHaveBeenCalledOnce()
  })
})
