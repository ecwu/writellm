import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { INDEX_CHUNKER_VERSION } from '../../shared/contracts/indexing'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { JobHandlerContext } from '../jobs/scheduler/job-handler-registry'
import type { ProjectDatabase } from '../project/project-database'
import type { IndexClient } from './index-client'
import { GENERATION_BUILD_DEBOUNCE_MS, ProjectIndexService } from './index-service'

const knowledgeItemId = randomUUID()
const parseRevisionId = randomUUID()
const normalizationRunId = randomUUID()
const manifestSha256 = 'a'.repeat(64)
const projectId = randomUUID()
const projectRoot = '/private/tmp/writellm-index-service'

const config: ProviderConfig = {
  role: 'embedding',
  providerId: 'openai-compatible',
  baseUrl: 'https://embedding.example.test/v1',
  model: 'embedding-v1',
  modelRevision: 'embedding-rev-1',
  timeoutMs: 10_000,
  embeddingDimension: 3,
  batchLimit: 2,
  fileSizeLimitMb: null
}

describe('ProjectIndexService embeddings', () => {
  it('coalesces a burst of item-import rebuild requests into one durable debounced build', async () => {
    vi.useFakeTimers()
    try {
      const queued: Array<{
        type: string
        payload: Record<string, unknown>
        deduplicationKey?: string
      }> = []
      const activeKeys = new Set<string>()
      const jobs = {
        enqueue: (input: (typeof queued)[number]) => {
          if (input.deduplicationKey !== undefined && activeKeys.has(input.deduplicationKey)) return
          if (input.deduplicationKey !== undefined) activeKeys.add(input.deduplicationKey)
          queued.push(input)
        }
      }
      const service = new ProjectIndexService({
        projectRoot,
        projectId,
        database: {
          immediate: (operation: (database: unknown) => unknown) =>
            operation({ prepare: () => ({ all: () => [] }) })
        } as unknown as ProjectDatabase,
        jobs: jobs as never,
        client: {} as IndexClient,
        getEmbeddingProvider: async () => config,
        embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      })

      // The production upsert path (KnowledgeNormalizationService) enqueues one
      // `rebuild_index` request per published parse revision; the job store's
      // deduplication key coalesces a burst into a single durable rebuild.
      for (let index = 0; index < 10; index += 1) {
        jobs.enqueue({
          type: 'rebuild_index',
          payload: { generationId: 'requested' },
          deduplicationKey: 'index-rebuild:pending'
        })
      }

      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        type: 'rebuild_index',
        payload: { generationId: 'requested' },
        deduplicationKey: 'index-rebuild:pending'
      })

      const pending = service.handleRefresh(context('rebuild_index', { generationId: 'requested' }))
      await vi.advanceTimersByTimeAsync(GENERATION_BUILD_DEBOUNCE_MS)
      await pending
      expect(queued.filter((job) => job.type === 'build_index_generation')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for the generation-build debounce window before materializing a burst', async () => {
    vi.useFakeTimers()
    try {
      const queued: Array<{ type: string; payload: Record<string, unknown> }> = []
      const service = new ProjectIndexService({
        projectRoot,
        projectId,
        database: {
          immediate: (operation: (database: unknown) => unknown) =>
            operation({ prepare: () => ({ all: () => [] }) })
        } as unknown as ProjectDatabase,
        jobs: { enqueue: (input: (typeof queued)[number]) => queued.push(input) } as never,
        client: {} as IndexClient,
        getEmbeddingProvider: async () => config,
        embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      })
      const pending = service.handleRefresh(context('rebuild_index', { generationId: 'requested' }))
      await vi.advanceTimersByTimeAsync(GENERATION_BUILD_DEBOUNCE_MS - 1)
      expect(queued).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(1)
      await pending
      expect(queued[0]?.type).toBe('build_index_generation')
    } finally {
      vi.useRealTimers()
    }
  })

  it('publishes an immutable embedding generation and avoids gateway calls for cached vectors', async () => {
    const queued: Array<{ type: string; payload: Record<string, unknown> }> = []
    const beginVectors = vi.fn(async () => false)
    const upsertVectors = vi.fn(async () => undefined)
    const activateVectors = vi.fn(async () => undefined)
    const client = {
      build: vi.fn(async () => ({
        type: 'built',
        requestId: randomUUID(),
        generationId,
        sourceSetSha256: 'b'.repeat(64),
        chunkSetSha256: 'c'.repeat(64),
        chunkCount: 2,
        sourceCount: 1
      })),
      activate: vi.fn(async (generationId: string) => ({
        type: 'activated',
        requestId: randomUUID(),
        generationId,
        snapshot: {
          schemaVersion: 3,
          activeGenerationId: generationId,
          generationCount: 1,
          chunkCount: 2,
          sourceCount: 1,
          activeSourceSetSha256: 'b'.repeat(64)
        }
      })),
      beginVectors,
      embeddingInputs: vi.fn(async () => ({
        type: 'embedding-inputs',
        requestId: randomUUID(),
        total: 2,
        values: [
          {
            chunkId: 'chunk-cached',
            text: 'cached text',
            contentSha256: 'c'.repeat(64),
            cachedVector: [1, 0, 0]
          },
          { chunkId: 'chunk-new', text: 'new text', contentSha256: 'd'.repeat(64) }
        ]
      })),
      upsertVectors,
      activateVectors
    } as unknown as IndexClient
    const database = {
      immediate: (operation: (database: { prepare: () => { all: () => unknown[] } }) => unknown) =>
        operation({
          prepare: () => ({
            all: () => [
              {
                knowledge_item_id: knowledgeItemId,
                display_name: 'Fixture',
                extension: 'pdf',
                parse_revision_id: parseRevisionId,
                normalization_run_id: normalizationRunId,
                relative_path: '.writellm/normalized/run',
                manifest_sha256: manifestSha256
              }
            ]
          })
        })
    } as unknown as ProjectDatabase
    const embedBatch = vi.fn(async () => ({
      embeddings: [[0, 1, 0]],
      metadata: {
        usage: {
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          estimatedCostUsdMicros: null
        },
        responseIds: [],
        retryCount: 0,
        providerModelId: config.model
      }
    }))
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database,
      jobs: {
        enqueue: (input: { type: string; payload: Record<string, unknown> }) => queued.push(input)
      } as never,
      client,
      getEmbeddingProvider: async () => config,
      embedBatch,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    const generationId = expectedIndexGeneration()
    await service.handleBuild(context('build_index_generation', { generationId }))
    const embeddingGenerationId = queued.find((job) => job.type === 'build_embedding_generation')
      ?.payload['generationId']
    expect(typeof embeddingGenerationId).toBe('string')
    await service.handleEmbedding(
      context('build_embedding_generation', { generationId: embeddingGenerationId })
    )

    expect(beginVectors).toHaveBeenCalledOnce()
    expect(embedBatch).toHaveBeenCalledWith(
      ['new text'],
      expect.objectContaining({ operationId: embeddingGenerationId }),
      expect.any(AbortSignal)
    )
    expect(upsertVectors).toHaveBeenCalledTimes(2)
    expect(activateVectors).toHaveBeenCalledWith(
      embeddingGenerationId,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(AbortSignal)
    )
  })
})

function expectedIndexGeneration(): string {
  const sourceSet = sha256(
    Buffer.from(
      JSON.stringify({
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [
          {
            knowledgeItemId,
            extension: 'pdf',
            parseRevisionId,
            normalizationRunId,
            manifestSha256
          }
        ]
      })
    )
  )
  return `generation-${sha256(Buffer.from(`${INDEX_CHUNKER_VERSION}\0${sourceSet}`)).slice(0, 40)}`
}

function context(type: string, payload: Record<string, unknown>): JobHandlerContext {
  return {
    job: { jobId: randomUUID(), type, payload, createdAt: new Date().toISOString() },
    signal: new AbortController().signal,
    reportProgress: vi.fn()
  } as unknown as JobHandlerContext
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
