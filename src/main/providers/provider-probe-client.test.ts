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

const vertexConfig: ProviderConfig = {
  role: 'image',
  providerId: 'google-vertex',
  projectId: 'writellm-images-123',
  location: 'global',
  model: 'gemini-3.1-flash-image',
  timeoutMs: 30_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null,
  defaultAspectRatio: 'auto',
  defaultImageSize: '1K'
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
  it('keeps a persistent worker and returns only normalized status', async () => {
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
    await client.probe(config, 'process-secret', new AbortController().signal)
    expect(factory.fork).toHaveBeenCalledOnce()
    expect(child.kill).not.toHaveBeenCalled()
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
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('sends no credential field for an ambient Vertex ADC probe', async () => {
    const child = new FakeUtilityProcess()
    const client = new ProviderProbeClient(
      '/private/provider-probe.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never
    )

    await expect(
      client.probe(vertexConfig, undefined, new AbortController().signal)
    ).resolves.toEqual({
      status: 204
    })
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ config: vertexConfig })
    )
    expect(child.postMessage.mock.calls[0]?.[0]).not.toHaveProperty('credential')
  })
})
