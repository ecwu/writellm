import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { INDEX_CHUNKER_VERSION } from '../../shared/contracts/indexing'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { generationIdFor, hashSourceSet } from '../../shared/index-generation'
import type { JobHandlerContext } from '../jobs/scheduler/job-handler-registry'
import type { ProjectDatabase } from '../project/project-database'
import { createEmbeddingGenerationContract, embeddingContractSha256 } from './embedding-contract'
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
  it('projects only safe source identity from the active current text generation', async () => {
    const activeGenerationId = vi
      .fn()
      .mockResolvedValueOnce(expectedIndexGeneration())
      .mockResolvedValueOnce('generation-stale')
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database: projectDatabaseWithSource(),
      jobs: { enqueue: vi.fn() } as never,
      client: {
        initialize: vi.fn(async () => expectedIndexGeneration()),
        activeGenerationId
      } as unknown as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    await service.initialize()

    const snapshot = await service.currentIndexedSources(new AbortController().signal)

    expect(snapshot).toEqual({
      state: 'ready',
      generationId: expectedIndexGeneration(),
      sources: [{ knowledgeItemId, displayName: 'Fixture', extension: 'pdf' }]
    })
    expect(JSON.stringify(snapshot)).not.toContain('relative_path')
    expect(JSON.stringify(snapshot)).not.toContain('/private/')
    await expect(service.currentIndexedSources(new AbortController().signal)).resolves.toEqual({
      state: 'preparing'
    })
  })

  it('reports whether the active index matches the current parsed source generation', async () => {
    let currentRevision = parseRevisionId
    const activeGenerationId = vi
      .fn()
      .mockResolvedValueOnce(expectedIndexGeneration())
      .mockResolvedValueOnce('generation-stale')
      .mockImplementationOnce(async () => {
        currentRevision = randomUUID()
        return expectedIndexGeneration()
      })
    const client = {
      initialize: vi.fn(async () => 'generation-stale'),
      activeGenerationId
    }
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database: projectDatabaseWithSource(() => currentRevision),
      jobs: { enqueue: vi.fn() } as never,
      client: client as unknown as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })

    await service.initialize()
    await expect(service.isCurrentGenerationIndexed()).resolves.toBe(true)
    await expect(service.isCurrentGenerationIndexed()).resolves.toBe(false)
    await expect(service.isCurrentGenerationIndexed()).resolves.toBe(false)
  })

  it('queues the latest source generation if a parse changes during worker startup', async () => {
    const nextRevision = randomUUID()
    let currentRevision = parseRevisionId
    const enqueue = vi.fn()
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database: projectDatabaseWithSource(() => currentRevision),
      jobs: { enqueue } as never,
      client: {
        initialize: vi.fn(async () => {
          currentRevision = nextRevision
          return expectedIndexGeneration()
        })
      } as unknown as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    await service.initialize()

    expect(enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'build_index_generation',
        payload: { generationId: expectedIndexGeneration(nextRevision) }
      })
    )
    expect(service.isRetrievalAvailable()).toBe(false)
  })

  it('restores readiness when the queued build succeeds after worker startup fails', async () => {
    const generationId = expectedIndexGeneration()
    const enqueue = vi.fn()
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database: projectDatabaseWithSource(),
      jobs: { enqueue } as never,
      client: {
        initialize: vi.fn(async () => {
          throw new Error('Index worker failed to start')
        }),
        build: vi.fn(async () => undefined),
        activate: vi.fn(async () => ({
          snapshot: { activeGenerationId: generationId, chunkCount: 1, sourceCount: 1 }
        }))
      } as unknown as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    await service.initialize()
    expect(service.readiness()).toBe('unavailable')
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'build_index_generation',
        payload: { generationId }
      })
    )
    expect(service.isRetrievalAvailable()).toBe(false)

    await service.handleBuild(context('build_index_generation', { generationId }))
    expect(service.readiness()).toBe('available')
    expect(service.isRetrievalAvailable()).toBe(true)
  })

  it('queues recovery when a replacement worker opens without the current index', async () => {
    const generationId = expectedIndexGeneration()
    const enqueue = vi.fn()
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database: projectDatabaseWithSource(),
      jobs: { enqueue } as never,
      client: {
        initialize: vi.fn(async () => generationId),
        close: vi.fn(async () => undefined)
      } as unknown as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    await service.initialize()
    enqueue.mockClear()

    service.handleWorkerRestart(generationId)
    expect(enqueue).not.toHaveBeenCalled()
    expect(service.isRetrievalAvailable()).toBe(true)

    service.handleWorkerRestart(null)
    expect(enqueue).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        type: 'build_index_generation',
        payload: { generationId },
        deduplicationKey: `index-build:${generationId}`
      })
    )
    expect(service.isRetrievalAvailable()).toBe(false)

    await service.close()
    service.handleWorkerRestart(null)
    expect(enqueue).toHaveBeenCalledOnce()
  })

  it('coalesces a burst of rebuild requests with a durable earliest claim time', async () => {
    vi.useFakeTimers()
    try {
      const queued: Array<{
        type: string
        payload: Record<string, unknown>
        deduplicationKey?: string
        runAfter?: Date
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

      const requestedAt = Date.now()
      for (let index = 0; index < 10; index += 1) service.requestRebuild()

      expect(queued).toHaveLength(1)
      expect(queued[0]).toMatchObject({
        type: 'rebuild_index',
        payload: {},
        runAfter: new Date(requestedAt + GENERATION_BUILD_DEBOUNCE_MS),
        deduplicationKey: 'index-rebuild:pending'
      })

      vi.setSystemTime(requestedAt + GENERATION_BUILD_DEBOUNCE_MS)
      await service.handleRefresh(context('rebuild_index', {}))
      expect(queued.filter((job) => job.type === 'build_index_generation')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the delay for legacy refresh jobs and schedules item removals immediately', async () => {
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
      await service.handleRefresh(context('remove_index_item', { knowledgeItemId }))
      expect(queued[0]?.type).toBe('build_index_generation')
      queued.length = 0

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

  it('queues the canonical worker generation for source IDs in SQLite sort order', async () => {
    const enqueue = vi.fn()
    const rows = [
      'B0000000-0000-4000-8000-000000000002',
      'a0000000-0000-4000-8000-000000000001'
    ].map((id) => ({
      knowledge_item_id: id,
      display_name: 'Fixture',
      extension: 'pdf',
      parse_revision_id: '10000000-0000-4000-8000-000000000001',
      normalization_run_id: '20000000-0000-4000-8000-000000000001',
      relative_path: 'knowledge/normalized/fixture',
      manifest_sha256: 'f'.repeat(64)
    }))
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database: {
        immediate: (operation: (database: unknown) => unknown) =>
          operation({ prepare: () => ({ all: () => rows }) })
      } as unknown as ProjectDatabase,
      jobs: { enqueue } as never,
      client: {} as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })

    await service.handleRefresh(context('rebuild_index', {}))
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'build_index_generation',
        payload: { generationId: 'generation-v2-8a33c51149ad9f71148bf6653485abd6d84c600c' }
      })
    )
  })

  it('publishes an immutable embedding generation and avoids gateway calls for cached vectors', async () => {
    const queued: Array<{ type: string; payload: Record<string, unknown> }> = []
    const beginVectors = vi.fn(async () => ({ alreadyActive: false, clearedCount: null }))
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
      embeddingContractSha256(config),
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

  it('admits only one of two concurrent manual embedding refreshes', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const enqueue = vi
      .fn()
      .mockReturnValueOnce({ created: true })
      .mockReturnValueOnce({ created: false })
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database: projectDatabaseWithSource(),
      jobs: { enqueue } as never,
      client: {
        activeGenerationId: vi.fn(async () => expectedIndexGeneration())
      } as unknown as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log
    })
    const results = await Promise.allSettled([
      service.requestEmbeddingRefresh(knowledgeItemId),
      service.requestEmbeddingRefresh()
    ])
    expect(results[0]).toEqual({ status: 'fulfilled', value: undefined })
    expect(results[1]).toEqual({
      status: 'rejected',
      reason: new Error('An embedding generation is already queued or running')
    })
    expect(enqueue).toHaveBeenNthCalledWith(1, {
      type: 'build_embedding_generation',
      payload: {
        generationId: expect.stringMatching(/^embedding-refresh-[0-9a-f-]{36}$/),
        refreshScope: 'item',
        knowledgeItemId,
        target: {
          indexGenerationId: expectedIndexGeneration(),
          contractSha256: embeddingContractSha256(config)
        }
      },
      deduplicationKey: 'embedding-refresh:active',
      deduplicateByType: true,
      maxAttempts: 8
    })
    expect(log.info).toHaveBeenCalledOnce()
  })

  it('rejects an embedding refresh if the source set changes while inspecting the worker', async () => {
    const enqueue = vi.fn()
    const nextRevision = randomUUID()
    let currentRevision = parseRevisionId
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database: projectDatabaseWithSource(() => currentRevision),
      jobs: { enqueue } as never,
      client: {
        activeGenerationId: vi.fn(async () => {
          currentRevision = nextRevision
          return expectedIndexGeneration()
        })
      } as unknown as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })

    await expect(service.requestEmbeddingRefresh(knowledgeItemId)).rejects.toThrow(
      'The knowledge search index is still being prepared'
    )
    expect(enqueue).not.toHaveBeenCalled()
  })

  it.each(['source', 'provider'] as const)(
    'retires an embedding refresh if its saved %s changes',
    async (changed) => {
      const enqueue = vi.fn()
      const beginVectors = vi.fn()
      const nextRevision = changed === 'source' ? randomUUID() : parseRevisionId
      let currentRevision = parseRevisionId
      const currentConfig: ProviderConfig =
        changed === 'provider' ? { ...config, modelRevision: 'embedding-rev-2' } : config
      const service = new ProjectIndexService({
        projectRoot,
        projectId,
        database: projectDatabaseWithSource(() => currentRevision),
        jobs: { enqueue } as never,
        client: { beginVectors } as unknown as IndexClient,
        getEmbeddingProvider: async () => {
          currentRevision = nextRevision
          return currentConfig
        },
        embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
      })
      const refresh = context('build_embedding_generation', {
        generationId: 'embedding-refresh-saved',
        refreshScope: 'all',
        target: {
          indexGenerationId: expectedIndexGeneration(),
          contractSha256: embeddingContractSha256(config)
        }
      })

      await service.handleEmbedding(refresh)

      expect(beginVectors).not.toHaveBeenCalled()
      expect(refresh.reportProgress).toHaveBeenCalledWith({ stage: 'superseded' })
      const currentIndexId = expectedIndexGeneration(nextRevision)
      const { embeddingGenerationId } = createEmbeddingGenerationContract(currentConfig, {
        generationId: currentIndexId,
        contentFingerprint: 'a'.repeat(64)
      })
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining(
          changed === 'source'
            ? { type: 'build_index_generation', payload: { generationId: currentIndexId } }
            : {
                type: 'build_embedding_generation',
                payload: { generationId: embeddingGenerationId }
              }
        )
      )
    }
  )

  it('bypasses the selected item cache and atomically activates a fresh embedding generation', async () => {
    const embeddingGenerationId = `embedding-refresh-${randomUUID()}`
    const beginVectors = vi.fn(async () => ({ alreadyActive: false, clearedCount: 1 }))
    const upsertVectors = vi.fn(async () => undefined)
    const activateVectors = vi.fn(async () => undefined)
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
      database: projectDatabaseWithSource(),
      jobs: { enqueue: vi.fn() } as never,
      client: {
        beginVectors,
        embeddingInputs: vi.fn(async () => ({
          type: 'embedding-inputs',
          requestId: randomUUID(),
          total: 1,
          values: [
            {
              chunkId: 'chunk-refreshed',
              text: 'refresh me',
              contentSha256: 'd'.repeat(64)
            }
          ]
        })),
        upsertVectors,
        activateVectors
      } as unknown as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })

    await service.handleEmbedding(
      context('build_embedding_generation', {
        generationId: embeddingGenerationId,
        refreshScope: 'item',
        knowledgeItemId
      })
    )

    expect(beginVectors).toHaveBeenCalledWith(
      expect.objectContaining({ embeddingGenerationId }),
      expect.any(AbortSignal),
      { scope: 'item', knowledgeItemId }
    )
    expect(embedBatch).toHaveBeenCalledWith(
      ['refresh me'],
      embeddingContractSha256(config),
      { operationId: embeddingGenerationId, jobId: expect.any(String) },
      expect.any(AbortSignal)
    )
    expect(activateVectors).toHaveBeenCalledWith(
      embeddingGenerationId,
      expect.stringMatching(/^[a-f0-9]{64}$/),
      expect.any(AbortSignal)
    )
  })

  it('queues the current text index if a source changes during vector build', async () => {
    const enqueue = vi.fn()
    const activateVectors = vi.fn()
    const nextRevision = randomUUID()
    let currentRevision = parseRevisionId
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database: projectDatabaseWithSource(() => currentRevision),
      jobs: { enqueue } as never,
      client: {
        beginVectors: vi.fn(async () => ({ alreadyActive: false, clearedCount: null })),
        embeddingInputs: vi.fn(async () => ({
          total: 1,
          values: [
            {
              chunkId: 'chunk-cached',
              text: 'cached text',
              contentSha256: 'c'.repeat(64),
              cachedVector: [1, 0, 0]
            }
          ]
        })),
        upsertVectors: vi.fn(async () => {
          currentRevision = nextRevision
        }),
        activateVectors
      } as unknown as IndexClient,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    const { embeddingGenerationId } = createEmbeddingGenerationContract(config, {
      generationId: expectedIndexGeneration(),
      contentFingerprint: 'b'.repeat(64)
    })

    await service.handleEmbedding(
      context('build_embedding_generation', { generationId: embeddingGenerationId })
    )

    expect(activateVectors).not.toHaveBeenCalled()
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'build_index_generation',
        payload: { generationId: expectedIndexGeneration(nextRevision) }
      })
    )
  })

  it('does not activate a generation built from a superseded parse revision', async () => {
    const queued: Array<{
      type: string
      payload: Record<string, unknown>
      deduplicationKey?: string
      maxAttempts?: number
    }> = []
    const client = {
      build: vi.fn(async () => {
        throw new Error('stale generation must not build')
      }),
      activate: vi.fn(async () => {
        throw new Error('stale generation must not activate')
      })
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
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database,
      jobs: {
        enqueue: (input: (typeof queued)[number]) => queued.push(input)
      } as never,
      client,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })
    // The queued build job still carries the generation derived from a parse
    // revision that has since been superseded; the current fingerprint differs.
    const staleGenerationId = expectedIndexGeneration('99999999-9999-4999-8999-999999999999')
    expect(staleGenerationId).not.toBe(expectedIndexGeneration())

    await service.handleBuild(
      context('build_index_generation', { generationId: staleGenerationId })
    )

    expect(client.build).not.toHaveBeenCalled()
    expect(client.activate).not.toHaveBeenCalled()
    expect(queued).toEqual([
      {
        type: 'build_index_generation',
        payload: { generationId: expectedIndexGeneration() },
        deduplicationKey: `index-build:${expectedIndexGeneration()}`,
        maxAttempts: 8
      }
    ])
  })

  it('does not activate when a parse revision changes during index build', async () => {
    const supersededRevisionId = '99999999-9999-4999-8999-999999999999'
    let currentRevisionId = parseRevisionId
    let releaseBuild!: () => void
    let resolveBuildStarted!: () => void
    const buildStarted = new Promise<void>((resolve) => {
      resolveBuildStarted = resolve
    })
    const buildRelease = new Promise<void>((resolve) => {
      releaseBuild = resolve
    })
    const queued: Array<{
      type: string
      payload: Record<string, unknown>
      deduplicationKey?: string
      maxAttempts?: number
    }> = []
    const activate = vi.fn(async () => {
      throw new Error('superseded generation must not activate')
    })
    const client = {
      build: vi.fn(async () => {
        resolveBuildStarted()
        await buildRelease
        return { type: 'built', requestId: randomUUID() }
      }),
      activate
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
                parse_revision_id: currentRevisionId,
                normalization_run_id: normalizationRunId,
                relative_path: '.writellm/normalized/run',
                manifest_sha256: manifestSha256
              }
            ]
          })
        })
    } as unknown as ProjectDatabase
    const service = new ProjectIndexService({
      projectRoot,
      projectId,
      database,
      jobs: { enqueue: (input: (typeof queued)[number]) => queued.push(input) } as never,
      client,
      getEmbeddingProvider: async () => config,
      embedBatch: async () => ({ embeddings: [], metadata: {} }) as never,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    })

    const pending = service.handleBuild(
      context('build_index_generation', {
        generationId: expectedIndexGeneration()
      })
    )
    await buildStarted
    currentRevisionId = supersededRevisionId
    releaseBuild()
    await pending

    expect(activate).not.toHaveBeenCalled()
    expect(queued).toEqual([
      {
        type: 'build_index_generation',
        payload: { generationId: expectedIndexGeneration(supersededRevisionId) },
        deduplicationKey: `index-build:${expectedIndexGeneration(supersededRevisionId)}`,
        maxAttempts: 8
      }
    ])
  })
})

function expectedIndexGeneration(revisionId = parseRevisionId): string {
  const sourceSet = hashSourceSet(
    [
      {
        knowledgeItemId,
        extension: 'pdf',
        parseRevisionId: revisionId,
        normalizationRunId,
        manifestSha256
      }
    ],
    INDEX_CHUNKER_VERSION
  )
  return generationIdFor(sourceSet, INDEX_CHUNKER_VERSION)
}

function projectDatabaseWithSource(currentRevision = () => parseRevisionId): ProjectDatabase {
  return {
    immediate: (operation: (database: { prepare: () => { all: () => unknown[] } }) => unknown) =>
      operation({
        prepare: () => ({
          all: () => [
            {
              knowledge_item_id: knowledgeItemId,
              display_name: 'Fixture',
              extension: 'pdf',
              parse_revision_id: currentRevision(),
              normalization_run_id: normalizationRunId,
              relative_path: '.writellm/normalized/run',
              manifest_sha256: manifestSha256
            }
          ]
        })
      })
  } as unknown as ProjectDatabase
}

function context(type: string, payload: Record<string, unknown>): JobHandlerContext {
  return {
    job: { jobId: randomUUID(), type, payload, createdAt: new Date().toISOString() },
    signal: new AbortController().signal,
    reportProgress: vi.fn()
  } as unknown as JobHandlerContext
}
