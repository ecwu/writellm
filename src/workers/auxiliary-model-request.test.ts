import { describe, expect, it, vi } from 'vitest'
import type { AuxiliaryUtilityRequest } from '../shared/contracts/model-runtime'
import { runAuxiliaryModelRequest } from './auxiliary-model-request'

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
})
