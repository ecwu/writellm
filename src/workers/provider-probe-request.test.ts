import { describe, expect, it, vi } from 'vitest'
import type { ProviderProbeRequest } from '../shared/contracts/provider-probe'
import { runProviderProbeRequest } from './provider-probe-request'

const request: ProviderProbeRequest = {
  requestId: '11111111-1111-4111-8111-111111111111',
  config: {
    role: 'agent',
    providerId: 'openai-compatible',
    baseUrl: 'https://api.example.test/v1',
    model: 'writer',
    modelRevision: 'writer-rev-1',
    timeoutMs: 30_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null
  },
  credential: 'utility-secret'
}

describe('provider utility probe request', () => {
  it('preserves a versioned base path and sends the credential only as authorization', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      expect(String(input)).toBe('https://api.example.test/v1/models')
      expect(init?.headers).toEqual({
        Authorization: 'Bearer utility-secret',
        Accept: 'application/json'
      })
      return new Response('{}', { status: 200 })
    })

    await expect(runProviderProbeRequest(request, fetchImplementation)).resolves.toEqual({
      type: 'result',
      requestId: request.requestId,
      status: 200
    })
  })

  it('returns only MinerU authentication codes from the bounded response body', async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      expect(String(input)).toBe('https://mineru.net/api/v4/extract/task/__writellm_probe__')
      return new Response(JSON.stringify({ code: 'A0202', data: { token: 'must-not-return' } }), {
        status: 200
      })
    })
    const response = await runProviderProbeRequest(
      {
        ...request,
        config: {
          role: 'mineru',
          providerId: 'mineru',
          baseUrl: 'https://mineru.net',
          model: 'vlm',
          modelRevision: 'vlm-rev-1',
          timeoutMs: 120_000,
          embeddingDimension: null,
          batchLimit: 200,
          fileSizeLimitMb: 200
        }
      },
      fetchImplementation
    )

    expect(response).toMatchObject({ type: 'result', status: 200, providerCode: 'A0202' })
    expect(JSON.stringify(response)).not.toContain('must-not-return')
    expect(JSON.stringify(response)).not.toContain('utility-secret')
  })

  it('serializes a diagnostic error without the credential', async () => {
    const response = await runProviderProbeRequest(request, async () => {
      throw new Error('offline')
    })

    expect(response).toMatchObject({
      type: 'error',
      requestId: request.requestId,
      error: { name: 'Error', message: 'offline' }
    })
    expect(JSON.stringify(response)).not.toContain('utility-secret')
  })
})
