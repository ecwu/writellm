import { describe, expect, it } from 'vitest'
import { rerankResultSchema } from './model-runtime'

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
})
