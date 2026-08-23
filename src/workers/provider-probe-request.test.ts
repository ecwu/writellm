import { describe, expect, it, vi } from 'vitest'
import {
  providerProbeRequestSchema,
  type ProviderProbeRequest
} from '../shared/contracts/provider-probe'
import type { GoogleVertexClientFactory, GoogleVertexModels } from './google-vertex-client'
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

const imageRequest: ProviderProbeRequest = {
  ...request,
  config: {
    role: 'image',
    providerId: 'google-gemini',
    model: 'gemini-3.1-flash-image',
    timeoutMs: 30_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null,
    defaultAspectRatio: 'auto',
    defaultImageSize: '1K'
  },
  credential: 'gemini-secret'
}

const vertexImageRequest: ProviderProbeRequest = {
  ...imageRequest,
  config: {
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
}

function vertexProbeFactory(
  countTokens: GoogleVertexModels['countTokens']
): GoogleVertexClientFactory {
  return vi.fn(({ project, location }) => {
    expect({ project, location }).toEqual({ project: 'writellm-images-123', location: 'global' })
    return { countTokens, generateContent: vi.fn() }
  })
}

async function withSdkFetch<T>(fetchMock: typeof fetch, operation: () => Promise<T>): Promise<T> {
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GOOGLE_API_KEY', '')
  vi.stubEnv('GEMINI_API_KEY', '')
  try {
    return await operation()
  } finally {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  }
}

describe('provider utility probe request', () => {
  it('allows credentialless Vertex ADC probes but requires credentials for other providers', () => {
    expect(providerProbeRequestSchema.safeParse(vertexImageRequest).success).toBe(true)
    const { credential: _credential, ...credentiallessGemini } = imageRequest
    expect(providerProbeRequestSchema.safeParse(credentiallessGemini).success).toBe(false)
  })

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
      projectSessionId: null,
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

  it('tests Gemini through the official API-key-only SDK client', async () => {
    const sdkFetch = vi.fn<typeof fetch>(async (input, init) => {
      const sdkRequest = input instanceof Request ? input : new Request(input, init)
      expect(sdkRequest.url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image'
      )
      expect(sdkRequest.method).toBe('GET')
      expect(sdkRequest.headers.get('x-goog-api-key')).toBe('gemini-secret')
      return new Response(
        JSON.stringify({ name: 'models/gemini-3.1-flash-image', displayName: 'Gemini image' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    const injectedFetch = vi.fn<typeof fetch>()

    await expect(
      withSdkFetch(sdkFetch, () => runProviderProbeRequest(imageRequest, injectedFetch))
    ).resolves.toEqual({
      type: 'result',
      requestId: request.requestId,
      projectSessionId: null,
      status: 200
    })
    expect(injectedFetch).not.toHaveBeenCalled()
  })

  it('projects only the Gemini SDK HTTP status on rejection', async () => {
    const sdkFetch = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 401,
              status: 'UNAUTHENTICATED',
              message: 'PRIVATE diagnostic'
            }
          }),
          { status: 401, headers: { 'content-type': 'application/json' } }
        )
    )

    const response = await withSdkFetch(sdkFetch, () =>
      runProviderProbeRequest(imageRequest, vi.fn<typeof fetch>())
    )
    expect(response).toMatchObject({ type: 'result', status: 401 })
    expect(JSON.stringify(response)).not.toContain('PRIVATE')
    expect(JSON.stringify(response)).not.toContain('gemini-secret')
  })

  it('tests Vertex ADC project access through one non-generating countTokens request', async () => {
    const countTokens = vi.fn<GoogleVertexModels['countTokens']>(async (input) => {
      expect(input.model).toBe('gemini-3.1-flash-image')
      expect(input.contents).toBe('WriteLLM connection probe')
      expect(input.config?.abortSignal).toBeUndefined()
      return { totalTokens: 4 }
    })

    await expect(
      runProviderProbeRequest(
        vertexImageRequest,
        vi.fn<typeof fetch>(),
        undefined,
        vertexProbeFactory(countTokens)
      )
    ).resolves.toEqual({
      type: 'result',
      requestId: imageRequest.requestId,
      projectSessionId: null,
      status: 200
    })
    expect(countTokens).toHaveBeenCalledTimes(1)
  })

  it('projects only the Vertex ADC authorization status without exposing diagnostics', async () => {
    const countTokens = vi.fn<GoogleVertexModels['countTokens']>(async () => {
      throw Object.assign(new Error('PRIVATE ADC detail'), { status: 403 })
    })
    const response = await runProviderProbeRequest(
      vertexImageRequest,
      vi.fn<typeof fetch>(),
      undefined,
      vertexProbeFactory(countTokens)
    )
    expect(response).toMatchObject({ type: 'result', status: 403 })
    expect(JSON.stringify(response)).not.toContain('PRIVATE')
    expect(JSON.stringify(response)).not.toContain('ADC detail')
  })

  it.each([
    ['openai', 'gpt-image-2', 'https://api.openai.com/v1/models/gpt-image-2', 'openai-secret'],
    [
      'xai',
      'grok-imagine-image-2.0',
      'https://api.x.ai/v1/models/grok-imagine-image-2.0',
      'xai-secret'
    ]
  ] as const)(
    'tests %s image access through the SDK model lookup without generating',
    async (providerId, model, expectedUrl, credential) => {
      const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
        const sdkRequest = input instanceof Request ? input : new Request(input, init)
        expect(sdkRequest.url).toBe(expectedUrl)
        expect(sdkRequest.method).toBe('GET')
        expect(sdkRequest.headers.get('authorization')).toBe(`Bearer ${credential}`)
        return new Response(
          JSON.stringify({ id: model, object: 'model', created: 1, owned_by: providerId }),
          {
            headers: { 'content-type': 'application/json' }
          }
        )
      })
      const response = await runProviderProbeRequest(
        {
          ...imageRequest,
          config: {
            role: 'image',
            providerId,
            model,
            timeoutMs: 30_000,
            embeddingDimension: null,
            batchLimit: 1,
            fileSizeLimitMb: null,
            defaultAspectRatio: 'auto',
            defaultImageSize: '1K'
          },
          credential
        },
        fetchImplementation
      )
      expect(response).toMatchObject({ type: 'result', status: 200 })
      expect(fetchImplementation).toHaveBeenCalledTimes(1)
    }
  )

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
