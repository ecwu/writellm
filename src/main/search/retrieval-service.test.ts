import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { IndexCandidate, VectorGenerationContract } from '../../shared/contracts/indexing'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { IndexClient } from './index-client'
import { embeddingContractSha256 } from './embedding-contract'
import { reciprocalRankFusion, RetrievalService } from './retrieval-service'

const embeddingConfig: ProviderConfig = {
  role: 'embedding',
  providerId: 'openai-compatible',
  baseUrl: 'https://embedding.example.test/v1',
  model: 'embedding-v1',
  modelRevision: 'embedding-rev-1',
  timeoutMs: 10_000,
  embeddingDimension: 3,
  batchLimit: 16,
  fileSizeLimitMb: null
}
const rerankConfig: ProviderConfig = {
  role: 'rerank',
  providerId: 'cohere-compatible',
  baseUrl: 'https://rerank.example.test/v2',
  model: 'rerank-v1',
  modelRevision: 'rerank-rev-1',
  timeoutMs: 10_000,
  embeddingDimension: null,
  batchLimit: 50,
  fileSizeLimitMb: null
}

describe('RetrievalService', () => {
  it('uses deterministic reciprocal-rank fusion and bounded reranking without losing provenance', async () => {
    const a = candidate('a', 'alpha source')
    const b = candidate('b', 'beta source')
    const c = candidate('c', 'gamma source')
    const client = {
      retrievalState: vi.fn(async () => ({
        activeIndexGenerationId: 'generation-active',
        activeEmbeddingContract: contract()
      })),
      ftsCandidates: vi.fn(async () => [a, b]),
      queryVectors: vi.fn(async () => [b, c]),
      expandCitations: vi.fn(async () => [b])
    } as unknown as IndexClient
    const rerank = vi.fn(async () => ({
      ranking: [
        { originalIndex: 1, score: 0.9 },
        { originalIndex: 0, score: 0.8 }
      ],
      metadata: metadata(rerankConfig.model)
    }))
    const service = new RetrievalService({
      projectId: randomUUID(),
      client,
      getEmbeddingProvider: async () => embeddingConfig,
      embedQuery: async () => [1, 0, 0],
      getRerankProvider: async () => rerankConfig,
      rerank,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    const result = await service.search(
      {
        projectSessionId: randomUUID(),
        query: 'source',
        filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] },
        limits: { fts: 10, vector: 10, fused: 3, results: 2 },
        rerank: true
      },
      new AbortController().signal
    )
    expect(result).toMatchObject({
      mode: 'hybrid',
      rerankStatus: 'applied',
      hits: [
        { chunkId: a.chunkId, sourceBlockIds: a.sourceBlockIds },
        { chunkId: b.chunkId, sourceBlockIds: b.sourceBlockIds }
      ]
    })
    expect(result.hits).toHaveLength(2)
    expect(rerank).toHaveBeenCalledWith(
      'source',
      expect.any(Array),
      2,
      expect.any(String),
      expect.any(AbortSignal)
    )
    await expect(
      service.expand([b.citationId], new AbortController().signal)
    ).resolves.toMatchObject([{ citationId: b.citationId, text: b.text }])
  })

  it('falls back to deterministic bounded FTS results when vector and rerank contracts are unavailable', async () => {
    const a = candidate('a', 'alpha')
    const b = candidate('b', 'beta')
    const client = {
      retrievalState: async () => ({
        activeIndexGenerationId: 'generation-active',
        activeEmbeddingContract: { ...contract(), contractSha256: '0'.repeat(64) }
      }),
      ftsCandidates: async () => [b, a]
    } as unknown as IndexClient
    const warn = vi.fn()
    const getRerankProvider = vi.fn<() => Promise<ProviderConfig>>(async () => {
      throw new Error('rerank provider is not configured')
    })
    const rerank = vi.fn(async () => {
      throw new Error('rerank provider unavailable')
    })
    const service = new RetrievalService({
      projectId: randomUUID(),
      client,
      getEmbeddingProvider: async () => embeddingConfig,
      embedQuery: async () => {
        throw new Error('must not run')
      },
      getRerankProvider,
      rerank,
      log: { info: vi.fn(), warn, error: vi.fn() }
    })
    const result = await service.search(
      {
        projectSessionId: randomUUID(),
        query: 'fallback',
        filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] },
        limits: { fts: 2, vector: 2, fused: 2, results: 1 },
        rerank: true
      },
      new AbortController().signal
    )
    expect(result).toMatchObject({
      mode: 'fts',
      rerankStatus: 'not-configured',
      hits: [{ chunkId: b.chunkId }]
    })
    expect(result.hits).toHaveLength(1)
    expect(warn).toHaveBeenCalledTimes(2)

    getRerankProvider.mockResolvedValueOnce(rerankConfig)
    await expect(
      service.search(
        {
          projectSessionId: randomUUID(),
          query: 'fallback',
          filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] },
          limits: { fts: 2, vector: 2, fused: 2, results: 1 },
          rerank: true
        },
        new AbortController().signal
      )
    ).resolves.toMatchObject({ mode: 'fts', rerankStatus: 'unavailable' })
    expect(rerank).toHaveBeenCalledOnce()
  })

  it('breaks RRF ties by stable chunk ID', () => {
    expect(reciprocalRankFusion(['chunk-b'], ['chunk-a'], 2).map((value) => value.chunkId)).toEqual(
      ['chunk-a', 'chunk-b']
    )
  })

  it('restarts both channels when the source changes during vector search', async () => {
    const oldCandidate = candidate('a', 'previous source')
    const newCandidate = candidate('b', 'current source')
    const retrievalState = vi
      .fn()
      .mockResolvedValueOnce({
        activeIndexGenerationId: 'generation-active',
        activeEmbeddingContract: contract()
      })
      .mockResolvedValueOnce({
        activeIndexGenerationId: 'generation-replacement',
        activeEmbeddingContract: null
      })
    const ftsCandidates = vi
      .fn()
      .mockResolvedValueOnce([oldCandidate])
      .mockResolvedValueOnce([newCandidate])
    const queryVectors = vi.fn(async () => null)
    const service = new RetrievalService({
      projectId: randomUUID(),
      client: { retrievalState, ftsCandidates, queryVectors } as unknown as IndexClient,
      getEmbeddingProvider: async () => embeddingConfig,
      embedQuery: async () => [1, 0, 0],
      getRerankProvider: async () => rerankConfig,
      rerank: vi.fn(),
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    const signal = new AbortController().signal
    const filters = { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] }
    await expect(
      service.search(
        {
          projectSessionId: randomUUID(),
          query: 'source',
          filters,
          limits: { fts: 10, vector: 10, fused: 10, results: 10 },
          rerank: false
        },
        signal
      )
    ).resolves.toMatchObject({
      mode: 'fts',
      hits: [{ chunkId: newCandidate.chunkId }]
    })
    expect(retrievalState).toHaveBeenCalledTimes(2)
    expect(ftsCandidates).toHaveBeenNthCalledWith(
      1,
      'generation-active',
      'source',
      10,
      filters,
      signal,
      undefined
    )
    expect(ftsCandidates).toHaveBeenNthCalledWith(
      2,
      'generation-replacement',
      'source',
      10,
      filters,
      signal,
      undefined
    )
    expect(queryVectors).toHaveBeenCalledExactlyOnceWith(
      'generation-active',
      contract().embeddingGenerationId,
      [1, 0, 0],
      10,
      filters,
      signal
    )
  })

  it.each(['rerank', 'vector'] as const)(
    'discards old hits if the source changes during a %s provider call',
    async (operation) => {
      const oldCandidate = candidate('a', 'previous source')
      const newCandidate = candidate('b', 'current source')
      let activeGeneration = 'generation-active'
      const retrievalState = vi.fn(async () => ({
        activeIndexGenerationId: activeGeneration,
        activeEmbeddingContract:
          operation === 'vector' && activeGeneration === 'generation-active' ? contract() : null
      }))
      const ftsCandidates = vi.fn(async (generationId: string) => [
        generationId === 'generation-active' ? oldCandidate : newCandidate
      ])
      const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      const service = new RetrievalService({
        projectId: randomUUID(),
        client: { retrievalState, ftsCandidates } as unknown as IndexClient,
        getEmbeddingProvider: async () => embeddingConfig,
        embedQuery: async () => {
          activeGeneration = 'generation-replacement'
          throw new Error('Vector provider unavailable')
        },
        getRerankProvider: async () => rerankConfig,
        rerank: async () => {
          activeGeneration = 'generation-replacement'
          return {
            ranking: [{ originalIndex: 0, score: 0.9 }],
            metadata: metadata(rerankConfig.model)
          }
        },
        log
      })

      const result = await service.search(
        {
          projectSessionId: randomUUID(),
          query: 'source',
          filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] },
          limits: { fts: 10, vector: 10, fused: 10, results: 10 },
          rerank: operation === 'rerank'
        },
        new AbortController().signal
      )

      expect(result.hits.map((hit) => hit.chunkId)).toEqual([newCandidate.chunkId])
      expect(ftsCandidates.mock.calls.map(([generationId]) => generationId)).toEqual([
        'generation-active',
        'generation-replacement'
      ])
      expect(log.info).toHaveBeenCalledOnce()
    }
  )

  it('reports skipped reranking when there are no candidates', async () => {
    const client = {
      retrievalState: vi.fn(async () => ({
        activeIndexGenerationId: 'generation-active',
        activeEmbeddingContract: null
      })),
      ftsCandidates: vi.fn(async () => []),
      expandCitations: vi.fn(async () => [])
    } as unknown as IndexClient
    const getRerankProvider = vi.fn(async () => rerankConfig)
    const rerank = vi.fn(async () => {
      throw new Error('rerank must not run without candidates')
    })
    const service = new RetrievalService({
      projectId: randomUUID(),
      client,
      getEmbeddingProvider: async () => embeddingConfig,
      embedQuery: async () => [1, 0, 0],
      getRerankProvider,
      rerank,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })

    await expect(
      service.search(
        {
          projectSessionId: randomUUID(),
          query: '没有结果',
          filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] },
          limits: { fts: 2, vector: 2, fused: 2, results: 1 },
          rerank: true
        },
        new AbortController().signal
      )
    ).resolves.toMatchObject({
      mode: 'fts',
      rerankStatus: 'skipped-no-candidates',
      hits: []
    })
    expect(getRerankProvider).not.toHaveBeenCalled()
    expect(rerank).not.toHaveBeenCalled()
  })
})

function contract(): VectorGenerationContract {
  return {
    embeddingGenerationId: 'embedding-active',
    indexGenerationId: 'generation-active',
    providerId: embeddingConfig.providerId,
    modelId: embeddingConfig.model,
    modelRevision: embeddingConfig.model,
    dimension: embeddingConfig.embeddingDimension as number,
    metric: 'cosine',
    normalization: 'l2',
    chunkerVersion: 1,
    contractSha256: embeddingContractSha256(embeddingConfig),
    contentFingerprint: 'f'.repeat(64)
  }
}

function candidate(seed: string, text: string): IndexCandidate {
  const hash = seed.repeat(40).slice(0, 40)
  return {
    citationId: `citation-${hash}`,
    chunkId: `chunk-${hash}`,
    knowledgeItemId: randomUUID(),
    parseRevisionId: randomUUID(),
    title: `${seed} source`,
    extension: 'pdf',
    text,
    page: 2,
    headingPath: ['Heading'],
    sourceBlockIds: [`kb_${seed.repeat(32).slice(0, 32)}`],
    assetRefs: ['images/source.png'],
    sources: [
      {
        blockId: `kb_${seed.repeat(32).slice(0, 32)}`,
        blockType: 'paragraph',
        page: 2,
        bbox: [0, 0, 1, 1],
        assetRefs: ['images/source.png'],
        providerBlockId: null,
        segmentStart: 0,
        segmentEnd: text.length
      }
    ]
  }
}

function metadata(model: string) {
  return {
    usage: {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      estimatedCostUsdMicros: null
    },
    responseIds: [],
    retryCount: 0,
    providerModelId: model
  }
}
