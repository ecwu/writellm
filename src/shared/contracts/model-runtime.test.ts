import { describe, expect, it } from 'vitest'
import { auxiliaryUtilityRequestSchema, rerankResultSchema } from './model-runtime'

const metadata = {
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    estimatedCostUsdMicros: null
  },
  responseIds: ['response-1'],
  retryCount: 0,
  providerModelId: 'rerank-1'
}

describe('model runtime response contracts', () => {
  it('rejects duplicate rerank indices at the protocol boundary', () => {
    expect(
      rerankResultSchema.safeParse({
        ranking: [
          { originalIndex: 0, score: 1 },
          { originalIndex: 0, score: 0.5 }
        ],
        metadata
      }).success
    ).toBe(false)
  })

  it('allows credentialless Vertex ADC image requests but not credentialless API-key sources', () => {
    const request = {
      operation: 'image',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc203',
      projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc204',
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
      },
      input: { prompt: 'A calm diagram', aspectRatio: 'auto', imageSize: '1K' }
    }
    expect(auxiliaryUtilityRequestSchema.safeParse(request).success).toBe(true)
    expect(
      auxiliaryUtilityRequestSchema.safeParse({
        ...request,
        config: {
          ...request.config,
          providerId: 'google-gemini',
          projectId: undefined,
          location: undefined
        }
      }).success
    ).toBe(false)
  })
})
