import { describe, expect, it, vi } from 'vitest'
import type { AuxiliaryUtilityRequest } from '../shared/contracts/model-runtime'
import { runAuxiliaryModelRequest } from './auxiliary-model-request'
import type { GoogleVertexClientFactory, GoogleVertexModels } from './google-vertex-client'

const embeddingRequest: Extract<AuxiliaryUtilityRequest, { operation: 'embedding' }> = {
  operation: 'embedding',
  requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc201',
  config: {
    role: 'embedding',
    providerId: 'openai-compatible',
    baseUrl: 'https://embedding.example.test/v1',
    model: 'embed-model',
    modelRevision: 'embed-rev-1',
    timeoutMs: 5_000,
    embeddingDimension: 3,
    batchLimit: 2,
    fileSizeLimitMb: null
  },
  credential: 'embedding-secret',
  input: { values: ['one', 'two', 'three'] }
}

const rerankRequest: Extract<AuxiliaryUtilityRequest, { operation: 'rerank' }> = {
  operation: 'rerank',
  requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc202',
  config: {
    role: 'rerank',
    providerId: 'cohere-compatible',
    baseUrl: 'https://rerank.example.test/v2',
    model: 'rerank-model',
    modelRevision: 'rerank-rev-1',
    timeoutMs: 5_000,
    embeddingDimension: null,
    batchLimit: 100,
    fileSizeLimitMb: null
  },
  credential: 'rerank-secret',
  input: { query: 'query', documents: ['zero', 'one', 'two'], topN: 2 }
}

const imageRequest: Extract<AuxiliaryUtilityRequest, { operation: 'image' }> = {
  operation: 'image',
  requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc203',
  projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc204',
  config: {
    role: 'image',
    providerId: 'google-gemini',
    model: 'gemini-3.1-flash-image',
    timeoutMs: 5_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null,
    defaultAspectRatio: 'auto',
    defaultImageSize: '1K'
  },
  credential: 'gemini-secret',
  input: { prompt: 'A calm technical illustration', aspectRatio: '16:9', imageSize: '2K' }
}

const vertexImageRequest: Extract<AuxiliaryUtilityRequest, { operation: 'image' }> = {
  ...imageRequest,
  config: {
    role: 'image',
    providerId: 'google-vertex',
    projectId: 'writellm-images-123',
    location: 'global',
    model: 'gemini-3.1-flash-image',
    timeoutMs: 5_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null,
    defaultAspectRatio: 'auto',
    defaultImageSize: '1K'
  }
}

function vertexFactory(
  generateContent: GoogleVertexModels['generateContent']
): GoogleVertexClientFactory {
  return vi.fn(({ project, location }) => {
    expect({ project, location }).toEqual({ project: 'writellm-images-123', location: 'global' })
    return { generateContent, countTokens: vi.fn() }
  })
}

function interactionResponse(
  content: Array<Record<string, unknown>>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: 'interaction-1',
    created: '2026-07-23T00:00:00Z',
    updated: '2026-07-23T00:00:01Z',
    status: 'completed',
    model: 'gemini-3.1-flash-image',
    steps: [{ type: 'model_output', content }],
    usage: { total_input_tokens: 12, total_output_tokens: 34 },
    ...overrides
  }
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

describe('runAuxiliaryModelRequest', () => {
  it('uses AI SDK batching, retries 429 responses, and returns only vectors plus metadata', async () => {
    let call = 0
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      call += 1
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer embedding-secret')
      if (call === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'rate limited', type: 'rate_limit' } }),
          {
            status: 429,
            headers: { 'content-type': 'application/json', 'retry-after': '0' }
          }
        )
      }
      const body = JSON.parse(String(init?.body)) as { input: string[] }
      return new Response(
        JSON.stringify({
          data: body.input.map((_value, index) => ({ embedding: [index, index + 1, index + 2] })),
          usage: { prompt_tokens: body.input.length }
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-request-id': `embedding-${call}` }
        }
      )
    })
    const response = await runAuxiliaryModelRequest(embeddingRequest, fetchMock)

    expect(response).toMatchObject({
      type: 'embedding-result',
      result: {
        embeddings: [
          [0, 1, 2],
          [1, 2, 3],
          [0, 1, 2]
        ],
        metadata: {
          retryCount: 1,
          responseIds: ['embedding-2', 'embedding-3'],
          providerModelId: 'embed-model'
        }
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(response)).not.toContain('embedding-secret')
    expect(JSON.stringify(response)).not.toContain('one')
  })

  it('uses AI SDK rerank and returns indices/scores without document bodies', async () => {
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer rerank-secret')
      return new Response(
        JSON.stringify({
          id: 'rerank-response',
          results: [
            { index: 2, relevance_score: 0.9 },
            { index: 0, relevance_score: 0.7 }
          ],
          meta: {}
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })
    const response = await runAuxiliaryModelRequest(rerankRequest, fetchMock)

    expect(response).toMatchObject({
      type: 'rerank-result',
      result: {
        ranking: [
          { originalIndex: 2, score: 0.9 },
          { originalIndex: 0, score: 0.7 }
        ],
        metadata: { responseIds: ['rerank-response'], retryCount: 0 }
      }
    })
    expect(JSON.stringify(response)).not.toContain('zero')
    expect(JSON.stringify(response)).not.toContain('rerank-secret')
  })

  it('rejects malformed vectors instead of accepting the wrong dimension', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ data: [{ embedding: [1, 2] }], usage: { prompt_tokens: 1 } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    )
    await expect(
      runAuxiliaryModelRequest(
        {
          ...embeddingRequest,
          input: { values: ['one'] },
          config: { ...embeddingRequest.config, batchLimit: 1 }
        },
        fetchMock
      )
    ).rejects.toThrow('dimension')
  })

  it('serializes the official Gemini Interactions image request and returns one bounded PNG', async () => {
    const data = Buffer.from('generated-png').toString('base64')
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const sdkRequest = input instanceof Request ? input : new Request(input, init)
      expect(sdkRequest.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
      expect(sdkRequest.headers.get('x-goog-api-key')).toBe('gemini-secret')
      expect(sdkRequest.headers.get('content-type')).toContain('application/json')
      expect(sdkRequest.headers.get('x-goog-api-client')).toMatch(
        /^google-genai-sdk\/\d+\.\d+\.\d+(?:\s|$)/
      )
      expect(JSON.parse(await sdkRequest.clone().text())).toEqual({
        model: 'gemini-3.1-flash-image',
        input: imageRequest.input.prompt,
        response_format: {
          type: 'image',
          mime_type: 'image/jpeg',
          aspect_ratio: '16:9',
          image_size: '2K'
        }
      })
      return new Response(
        JSON.stringify(interactionResponse([{ type: 'image', mime_type: 'image/png', data }])),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    })

    await expect(
      withSdkFetch(fetchMock, () => runAuxiliaryModelRequest(imageRequest))
    ).resolves.toMatchObject({
      type: 'image-result',
      result: {
        dataBase64: data,
        mimeType: 'image/png',
        effectiveImageSize: '2K',
        metadata: {
          responseIds: ['interaction-1'],
          retryCount: 0,
          usage: { inputTokens: 12, outputTokens: 34 }
        }
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses one fixed Vertex ADC client request and returns one inline image', async () => {
    const data = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from('vertex-fixture')
    ]).toString('base64')
    const generateContent = vi.fn<GoogleVertexModels['generateContent']>(async (input) => {
      expect(input.model).toBe('gemini-3.1-flash-image')
      expect(input.contents).toBe(vertexImageRequest.input.prompt)
      expect(input.config.abortSignal).toBeInstanceOf(AbortSignal)
      expect({ ...input.config, abortSignal: undefined }).toEqual({
        abortSignal: undefined,
        candidateCount: 1,
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: { aspectRatio: '16:9', imageSize: '2K' }
      })
      return {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [{ text: 'Generated image.' }, { inlineData: { mimeType: 'image/png', data } }]
            }
          }
        ],
        responseId: 'vertex-response-1',
        usageMetadata: {
          promptTokenCount: 11,
          candidatesTokenCount: 22,
          cachedContentTokenCount: 3
        }
      }
    })

    await expect(
      runAuxiliaryModelRequest(
        vertexImageRequest,
        vi.fn<typeof fetch>(),
        undefined,
        vertexFactory(generateContent)
      )
    ).resolves.toMatchObject({
      type: 'image-result',
      result: {
        dataBase64: data,
        mimeType: 'image/png',
        effectiveImageSize: '2K',
        metadata: {
          providerModelId: 'gemini-3.1-flash-image',
          responseIds: ['vertex-response-1'],
          retryCount: 0,
          usage: { inputTokens: 11, outputTokens: 22, cacheReadTokens: 3 }
        }
      }
    })
    expect(generateContent).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(generateContent.mock.calls)).not.toContain('credential')
  })

  it('accepts a multi-megabyte Vertex inline PNG without overflowing the validator stack', async () => {
    const bytes = Buffer.alloc(6_000_000)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes)
    const data = bytes.toString('base64')
    expect(data).toHaveLength(8_000_000)
    const generateContent = vi.fn<GoogleVertexModels['generateContent']>(async () => ({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data } }] } }]
    }))

    const response = await runAuxiliaryModelRequest(
      vertexImageRequest,
      vi.fn<typeof fetch>(),
      undefined,
      vertexFactory(generateContent)
    )

    expect(response).toMatchObject({
      type: 'image-result',
      result: { mimeType: 'image/png', effectiveImageSize: '2K' }
    })
    expect(response.type === 'image-result' ? response.result.dataBase64.length : 0).toBe(
      data.length
    )
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('omits auto aspect ratio and downgrades Nano Banana 2K to 1K on Vertex', async () => {
    const data = Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff]),
      Buffer.from('vertex-jpeg')
    ]).toString('base64')
    const generateContent = vi.fn<GoogleVertexModels['generateContent']>(async (input) => {
      expect(input.config.imageConfig).toEqual({ imageSize: '1K' })
      return {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data } }] } }]
      }
    })
    await expect(
      runAuxiliaryModelRequest(
        {
          ...vertexImageRequest,
          config: { ...vertexImageRequest.config, model: 'gemini-2.5-flash-image' },
          input: { ...vertexImageRequest.input, aspectRatio: 'auto', imageSize: '2K' }
        },
        vi.fn<typeof fetch>(),
        undefined,
        vertexFactory(generateContent)
      )
    ).resolves.toMatchObject({
      type: 'image-result',
      result: { mimeType: 'image/jpeg', effectiveImageSize: '1K' }
    })
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('projects only bounded Vertex SDK diagnostics without a retry or private response text', async () => {
    const generateContent = vi.fn<GoogleVertexModels['generateContent']>(async () => {
      throw Object.assign(new Error('PRIVATE authorization detail'), {
        status: 403,
        code: 'PERMISSION_DENIED'
      })
    })
    const pending = runAuxiliaryModelRequest(
      vertexImageRequest,
      vi.fn<typeof fetch>(),
      undefined,
      vertexFactory(generateContent)
    )
    await expect(pending).rejects.toMatchObject({ status: 403, providerCode: 'PERMISSION_DENIED' })
    await expect(pending).rejects.not.toThrow('PRIVATE')
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it.each([
    [{ candidates: [] }, 'one candidate'],
    [
      {
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: '%%%bad%%%' } }]
            }
          }
        ]
      },
      'malformed image data'
    ]
  ])('rejects unsafe Vertex image response %#', async (payload, message) => {
    const generateContent = vi.fn<GoogleVertexModels['generateContent']>(async () => payload)
    await expect(
      runAuxiliaryModelRequest(
        vertexImageRequest,
        vi.fn<typeof fetch>(),
        undefined,
        vertexFactory(generateContent)
      )
    ).rejects.toThrow(message)
  })

  it('cancels one Vertex request without retrying', async () => {
    const controller = new AbortController()
    const generateContent = vi.fn<GoogleVertexModels['generateContent']>(
      (input) =>
        new Promise((_resolve, reject) => {
          input.config.abortSignal.addEventListener(
            'abort',
            () => reject(input.config.abortSignal.reason),
            { once: true }
          )
        })
    )
    const pending = runAuxiliaryModelRequest(
      vertexImageRequest,
      vi.fn<typeof fetch>(),
      controller.signal,
      vertexFactory(generateContent)
    )
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it.each(['gemini-3.1-flash-image', 'gemini-3-pro-image'] as const)(
    'omits an auto aspect ratio and preserves selectable 1K/2K sizes for %s',
    async (model) => {
      const data = Buffer.from(`generated-${model}`).toString('base64')
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const sdkRequest = input instanceof Request ? input : new Request(input, init)
        expect(JSON.parse(await sdkRequest.clone().text())).toEqual({
          model,
          input: imageRequest.input.prompt,
          response_format: {
            type: 'image',
            mime_type: 'image/jpeg',
            image_size: '1K'
          }
        })
        return new Response(
          JSON.stringify(interactionResponse([{ type: 'image', mime_type: 'image/png', data }])),
          {
            headers: { 'content-type': 'application/json' }
          }
        )
      })

      await expect(
        withSdkFetch(fetchMock, () =>
          runAuxiliaryModelRequest({
            ...imageRequest,
            config: { ...imageRequest.config, model, modelRevision: model },
            input: { ...imageRequest.input, aspectRatio: 'auto', imageSize: '1K' }
          })
        )
      ).resolves.toMatchObject({
        type: 'image-result',
        result: { dataBase64: data, mimeType: 'image/png', effectiveImageSize: '1K' }
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it.each(['gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image'] as const)(
    'downgrades unsupported 2K to an explicit 1K request for %s',
    async (model) => {
      const data = Buffer.from(`generated-${model}`).toString('base64')
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const sdkRequest = input instanceof Request ? input : new Request(input, init)
        expect(JSON.parse(await sdkRequest.clone().text())).toEqual({
          model,
          input: imageRequest.input.prompt,
          response_format: {
            type: 'image',
            mime_type: 'image/jpeg',
            aspect_ratio: '1:1',
            image_size: '1K'
          }
        })
        return new Response(
          JSON.stringify(interactionResponse([{ type: 'image', mime_type: 'image/png', data }])),
          {
            headers: { 'content-type': 'application/json' }
          }
        )
      })

      await expect(
        withSdkFetch(fetchMock, () =>
          runAuxiliaryModelRequest({
            ...imageRequest,
            config: { ...imageRequest.config, model, modelRevision: model },
            input: { ...imageRequest.input, aspectRatio: '1:1', imageSize: '2K' }
          })
        )
      ).resolves.toMatchObject({
        type: 'image-result',
        result: { dataBase64: data, mimeType: 'image/png', effectiveImageSize: '1K' }
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('accepts a valid PNG response even though JPEG was requested', async () => {
    const data = Buffer.from('generated-png').toString('base64')
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const sdkRequest = input instanceof Request ? input : new Request(input, init)
      expect(sdkRequest.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
      return new Response(
        JSON.stringify(interactionResponse([{ type: 'image', mime_type: 'image/png', data }])),
        { headers: { 'content-type': 'application/json' } }
      )
    })

    await expect(
      withSdkFetch(fetchMock, () => runAuxiliaryModelRequest(imageRequest))
    ).resolves.toMatchObject({
      type: 'image-result',
      result: { dataBase64: data, mimeType: 'image/png', effectiveImageSize: '2K' }
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['1:1', '1K', '1024x1024', '1K'],
    ['1:1', '2K', '2048x2048', '2K'],
    ['16:9', '1K', '1280x720', '1K'],
    ['16:9', '2K', '2048x1152', '2K'],
    ['auto', '2K', 'auto', null]
  ] as const)(
    'serializes OpenAI gpt-image-2 %s %s as size %s',
    async (aspectRatio, imageSize, expectedSize, effectiveImageSize) => {
      const data = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.from('fixture')
      ]).toString('base64')
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const sdkRequest = input instanceof Request ? input : new Request(input, init)
        expect(sdkRequest.url).toBe('https://api.openai.com/v1/images/generations')
        expect(sdkRequest.headers.get('authorization')).toBe('Bearer openai-secret')
        expect(JSON.parse(await sdkRequest.clone().text())).toEqual({
          model: 'gpt-image-2',
          prompt: imageRequest.input.prompt,
          n: 1,
          quality: 'auto',
          output_format: 'png',
          size: expectedSize
        })
        return new Response(
          JSON.stringify({
            created: 1,
            data: [{ b64_json: data }],
            usage: { input_tokens: 12, output_tokens: 34, total_tokens: 46 }
          }),
          {
            headers: {
              'content-type': 'application/json',
              'x-request-id': 'openai-request-1'
            }
          }
        )
      })

      const response = await runAuxiliaryModelRequest(
        {
          ...imageRequest,
          config: {
            role: 'image',
            providerId: 'openai',
            model: 'gpt-image-2',
            timeoutMs: 5_000,
            embeddingDimension: null,
            batchLimit: 1,
            fileSizeLimitMb: null,
            defaultAspectRatio: 'auto',
            defaultImageSize: '1K'
          },
          credential: 'openai-secret',
          input: { ...imageRequest.input, aspectRatio, imageSize }
        },
        fetchMock
      )
      expect(response).toMatchObject({
        type: 'image-result',
        result: {
          dataBase64: data,
          mimeType: 'image/png',
          effectiveImageSize,
          metadata: {
            usage: { inputTokens: 12, outputTokens: 34 },
            responseIds: ['openai-request-1'],
            retryCount: 0
          }
        }
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('serializes xAI image generation with base64, aspect ratio, and lowercase resolution', async () => {
    const data = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('fixture')]).toString(
      'base64'
    )
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const sdkRequest = input instanceof Request ? input : new Request(input, init)
      expect(sdkRequest.url).toBe('https://api.x.ai/v1/images/generations')
      expect(sdkRequest.headers.get('authorization')).toBe('Bearer xai-secret')
      expect(JSON.parse(await sdkRequest.clone().text())).toEqual({
        model: 'grok-imagine-image-2.0',
        prompt: imageRequest.input.prompt,
        n: 1,
        response_format: 'b64_json',
        aspect_ratio: '16:9',
        resolution: '2k'
      })
      return new Response(JSON.stringify({ created: 1, data: [{ b64_json: data }] }), {
        headers: { 'content-type': 'application/json', 'x-request-id': 'xai-request-1' }
      })
    })

    await expect(
      runAuxiliaryModelRequest(
        {
          ...imageRequest,
          config: {
            role: 'image',
            providerId: 'xai',
            model: 'grok-imagine-image-2.0',
            timeoutMs: 5_000,
            embeddingDimension: null,
            batchLimit: 1,
            fileSizeLimitMb: null,
            defaultAspectRatio: 'auto',
            defaultImageSize: '1K'
          },
          credential: 'xai-secret'
        },
        fetchMock
      )
    ).resolves.toMatchObject({
      type: 'image-result',
      result: {
        dataBase64: data,
        mimeType: 'image/jpeg',
        effectiveImageSize: '2K',
        metadata: { responseIds: ['xai-request-1'], retryCount: 0 }
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'openai',
      'gpt-image-2',
      { error: { code: 'moderation_blocked', message: 'PRIVATE moderation detail' } },
      400,
      'MODERATION_BLOCKED'
    ],
    [
      'xai',
      'grok-imagine-image-2.0',
      { error: { code: 'rate_limit_exceeded', message: 'PRIVATE quota detail' } },
      429,
      'RATE_LIMIT_EXCEEDED'
    ]
  ] as const)(
    'projects safe %s SDK errors without retries or private response text',
    async (providerId, model, body, status, providerCode) => {
      const fetchMock = vi.fn<typeof fetch>(
        async () =>
          new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': 'application/json' }
          })
      )
      const pending = runAuxiliaryModelRequest(
        {
          ...imageRequest,
          config: {
            role: 'image',
            providerId,
            model,
            timeoutMs: 5_000,
            embeddingDimension: null,
            batchLimit: 1,
            fileSizeLimitMb: null,
            defaultAspectRatio: 'auto',
            defaultImageSize: '1K'
          },
          credential: `${providerId}-secret`
        },
        fetchMock
      )
      await expect(pending).rejects.toMatchObject({ status, providerCode })
      await expect(pending).rejects.not.toThrow('PRIVATE')
      expect(fetchMock).toHaveBeenCalledTimes(1)
    }
  )

  it('rejects malformed xAI base64 before projecting bytes to Main', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ data: [{ b64_json: '%%%bad%%%' }] }), {
          headers: { 'content-type': 'application/json' }
        })
    )
    await expect(
      runAuxiliaryModelRequest(
        {
          ...imageRequest,
          config: {
            role: 'image',
            providerId: 'xai',
            model: 'grok-imagine-image-2.0',
            timeoutMs: 5_000,
            embeddingDimension: null,
            batchLimit: 1,
            fileSizeLimitMb: null,
            defaultAspectRatio: 'auto',
            defaultImageSize: '1K'
          }
        },
        fetchMock
      )
    ).rejects.toThrow('malformed image data')
  })

  it('cancels an OpenAI image request without an SDK retry', async () => {
    const controller = new AbortController()
    let markStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const fetchMock = vi.fn<typeof fetch>(
      async (input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const sdkRequest = input instanceof Request ? input : new Request(input, init)
          markStarted?.()
          sdkRequest.signal.addEventListener('abort', () => reject(sdkRequest.signal.reason), {
            once: true
          })
        })
    )
    const pending = runAuxiliaryModelRequest(
      {
        ...imageRequest,
        config: {
          role: 'image',
          providerId: 'openai',
          model: 'gpt-image-2',
          timeoutMs: 5_000,
          embeddingDimension: null,
          batchLimit: 1,
          fileSizeLimitMb: null,
          defaultAspectRatio: 'auto',
          defaultImageSize: '1K'
        }
      },
      fetchMock,
      controller.signal
    )
    await started
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    [[], 'did not contain'],
    [[{ type: 'image', mime_type: 'image/webp', data: 'YWJj' }], 'unsupported image MIME'],
    [[{ type: 'image', mime_type: 'image/png', data: '%%%bad%%%' }], 'malformed image data']
  ])('rejects unsafe or malformed Gemini image responses %#', async (content, message) => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify(interactionResponse(content as Array<Record<string, unknown>>)),
          {
            headers: { 'content-type': 'application/json' }
          }
        )
    )
    await expect(
      withSdkFetch(fetchMock, () => runAuxiliaryModelRequest(imageRequest))
    ).rejects.toThrow(message)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('preserves only bounded Gemini HTTP diagnostics without exposing the response message', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              status: 'INVALID_ARGUMENT',
              message: 'PRIVATE provider diagnostic that must not cross the worker boundary',
              details: [{ reason: 'API_KEY_INVALID' }]
            }
          }),
          { status: 400 }
        )
    )

    await withSdkFetch(fetchMock, async () => {
      try {
        await runAuxiliaryModelRequest(imageRequest)
        throw new Error('Expected Gemini request to fail')
      } catch (error) {
        expect(error).toMatchObject({
          status: 400,
          providerCode: 'API_KEY_INVALID',
          message: 'Gemini image request failed with HTTP 400 (API_KEY_INVALID)'
        })
        expect((error as Error).cause).toBeInstanceOf(Error)
        expect(String(error)).not.toContain('PRIVATE')
        expect(String(error)).not.toContain(imageRequest.input.prompt)
        expect(String(error)).not.toContain(imageRequest.credential)
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('propagates cancellation without retrying or returning image bytes', async () => {
    const controller = new AbortController()
    let markFetchStarted: (() => void) | undefined
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve
    })
    const fetchMock = vi.fn<typeof fetch>(
      async (input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const sdkRequest = input instanceof Request ? input : new Request(input, init)
          markFetchStarted?.()
          if (sdkRequest.signal.aborted) {
            reject(sdkRequest.signal.reason)
            return
          }
          sdkRequest.signal.addEventListener('abort', () => reject(sdkRequest.signal.reason), {
            once: true
          })
        })
    )
    await expect(
      withSdkFetch(fetchMock, async () => {
        const pending = runAuxiliaryModelRequest(imageRequest, fetch, controller.signal)
        await fetchStarted
        controller.abort(new Error('cancelled'))
        return pending
      })
    ).rejects.toThrow('cancelled')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('times out one Gemini call without retrying', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async (input, init) =>
        new Promise<Response>((_resolve, reject) => {
          const sdkRequest = input instanceof Request ? input : new Request(input, init)
          if (sdkRequest.signal.aborted) {
            reject(new Error('timed out'))
            return
          }
          sdkRequest.signal.addEventListener('abort', () => reject(new Error('timed out')), {
            once: true
          })
        })
    )
    await expect(
      withSdkFetch(fetchMock, () =>
        runAuxiliaryModelRequest({
          ...imageRequest,
          config: { ...imageRequest.config, timeoutMs: 5 }
        })
      )
    ).rejects.toThrow('timed out')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
