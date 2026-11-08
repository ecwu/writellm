import { randomUUID } from 'node:crypto'
import { createAbortError } from '../../shared/abort-error'
import { generationIdFor, hashSourceSet } from '../../shared/index-generation'
import type { Logger } from 'pino'
import {
  INDEX_CHUNKER_VERSION,
  indexSourceSchema,
  type IndexSource,
  type VectorRefresh
} from '../../shared/contracts/indexing'
import type { EmbeddingBatchResult } from '../../shared/contracts/model-runtime'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { jobPayloadRegistry } from '../jobs/job-schemas'
import type { JobStore } from '../jobs/job-store'
import type { JobHandlerContext, JobHandlerRegistry } from '../jobs/scheduler/job-handler-registry'
import type { ProjectDatabase } from '../project/project-database'
import { resolveProjectPath } from '../project/project-paths'
import { createEmbeddingGenerationContract } from './embedding-contract'
import type { IndexClient } from './index-client'

interface CurrentIndexGeneration {
  generationId: string
  contentFingerprint: string
  sources: IndexSource[]
}

export type CurrentIndexedSourceSnapshot =
  | { state: 'preparing' }
  | { state: 'unavailable' }
  | {
      state: 'ready'
      generationId: string
      sources: Array<{
        knowledgeItemId: string
        displayName: string
        extension: string | null
      }>
    }

export type IndexReadiness = 'preparing' | 'available' | 'unavailable'

export const GENERATION_BUILD_DEBOUNCE_MS = 1_500

export class ProjectIndexService {
  #initialization: Promise<void> | null = null
  #readiness: IndexReadiness = 'preparing'
  #activeGenerationId: string | null = null
  #closing = false

  constructor(
    private readonly options: {
      projectRoot: string
      projectId: string
      database: ProjectDatabase
      jobs: JobStore
      client: IndexClient
      getEmbeddingProvider: () => Promise<ProviderConfig>
      embedBatch: (
        values: string[],
        expectedContractSha256: string,
        correlation: { operationId: string; jobId: string },
        signal: AbortSignal
      ) => Promise<EmbeddingBatchResult>
      log: Pick<Logger, 'info' | 'warn' | 'error'>
    }
  ) {}

  initialize(): Promise<void> {
    this.#initialization ??= this.#initialize()
    return this.#initialization
  }

  startInitialization(): void {
    void this.initialize().catch((err: unknown) => {
      if (this.#closing) return
      this.#readiness = 'unavailable'
      this.options.log.error(
        {
          event: 'index.service.initialization_failed',
          err,
          projectId: this.options.projectId
        },
        'Project index initialization failed'
      )
    })
  }

  readiness(): IndexReadiness {
    return this.#readiness
  }

  handleWorkerRestart(activeGenerationId: string | null): void {
    if (this.#closing) return
    const current = this.#currentGeneration()
    this.#activeGenerationId = activeGenerationId
    this.#readiness = 'available'
    if (activeGenerationId !== current.generationId) {
      this.#enqueueBuild(current.generationId, 'index-worker-restart')
    }
  }

  async #initialize(): Promise<void> {
    const startedAt = Date.now()
    let activeGenerationId: string | null
    try {
      activeGenerationId = await this.options.client.initialize()
    } catch (err) {
      if (this.#closing) {
        this.options.log.info(
          {
            event: 'index.service.initialization_cancelled',
            projectId: this.options.projectId,
            durationMs: Date.now() - startedAt
          },
          'Index initialization cancelled while closing project'
        )
        return
      }
      this.#readiness = 'unavailable'
      this.options.log.error(
        {
          event: 'index.service.utility_unavailable',
          err,
          projectId: this.options.projectId,
          durationMs: Date.now() - startedAt
        },
        'Index utility is unavailable; rebuild remains durable'
      )
      this.#enqueueBuild(this.#currentGeneration().generationId, 'index-open-recovery')
      return
    }
    if (this.#closing) return
    const current = this.#currentGeneration()
    this.#activeGenerationId = activeGenerationId
    if (activeGenerationId !== current.generationId) {
      this.#enqueueBuild(current.generationId, 'index-open')
    } else {
      await this.#queueEmbeddings(current, 'index-open')
    }
    this.#readiness = 'available'
    this.options.log.info(
      {
        event: 'index.service.initialized',
        projectId: this.options.projectId,
        activeGenerationId,
        currentGenerationId: current.generationId,
        sourceCount: current.sources.length,
        durationMs: Date.now() - startedAt
      },
      'Project index service initialized'
    )
  }

  requestRebuild(): void {
    this.options.jobs.enqueue({
      type: 'rebuild_index',
      payload: {},
      runAfter: new Date(Date.now() + GENERATION_BUILD_DEBOUNCE_MS),
      deduplicationKey: 'index-rebuild:pending',
      maxAttempts: 8
    })
  }

  requestItemDelete(knowledgeItemId: string): void {
    this.options.jobs.enqueue({
      type: 'remove_index_item',
      payload: { knowledgeItemId },
      deduplicationKey: `index-delete:${knowledgeItemId}`,
      maxAttempts: 8
    })
  }

  async requestEmbeddingRefresh(knowledgeItemId?: string): Promise<void> {
    const current = this.#currentGeneration()
    if (current.sources.length === 0) {
      throw new Error('No parsed knowledge sources are available for embedding')
    }
    if (
      knowledgeItemId !== undefined &&
      !current.sources.some((source) => source.knowledgeItemId === knowledgeItemId)
    ) {
      throw new Error('The selected knowledge source has no active parsed revision')
    }
    const { contractSha256 } = createEmbeddingGenerationContract(
      await this.options.getEmbeddingProvider(),
      current
    )
    const activeGenerationId = await this.options.client.activeGenerationId()
    if (this.#confirmCurrentGeneration(current.generationId, activeGenerationId) === null) {
      throw new Error('The knowledge search index is still being prepared')
    }
    const embeddingGenerationId = `embedding-refresh-${randomUUID()}`
    const refreshScope = knowledgeItemId === undefined ? 'all' : 'item'
    const { created } = this.options.jobs.enqueue({
      type: 'build_embedding_generation',
      payload: {
        generationId: embeddingGenerationId,
        refreshScope,
        target: { indexGenerationId: current.generationId, contractSha256 },
        ...(knowledgeItemId === undefined ? {} : { knowledgeItemId })
      },
      deduplicationKey: 'embedding-refresh:active',
      deduplicateByType: true,
      maxAttempts: 8
    })
    if (!created) throw new Error('An embedding generation is already queued or running')
    this.options.log.info(
      {
        event: 'embedding.refresh.queued',
        projectId: this.options.projectId,
        embeddingGenerationId,
        refreshScope,
        ...(knowledgeItemId === undefined ? {} : { knowledgeItemId })
      },
      'Embedding refresh queued'
    )
  }

  async handleRefresh(context: JobHandlerContext): Promise<void> {
    if (context.signal.aborted) throw createAbortError('Index operation aborted')
    // Older refresh jobs stored the delay in the handler rather than runAfter.
    if (context.job.type === 'rebuild_index' && context.job.payload.generationId !== undefined) {
      await waitForLegacyRefreshDelay(context)
      if (context.signal.aborted) throw createAbortError('Index operation aborted')
    }
    const current = this.#currentGeneration()
    this.#enqueueBuild(current.generationId, context.job.jobId)
  }

  async handleBuild(context: JobHandlerContext): Promise<void> {
    const { generationId } = jobPayloadRegistry.build_index_generation.parse(context.job.payload)
    const current = this.#currentGeneration()
    if (current.generationId !== generationId) {
      this.#enqueueBuild(current.generationId, context.job.jobId)
      return
    }
    context.reportProgress({ completed: 0, total: 2, stage: 'chunking' })
    await this.options.client.build(
      {
        generationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: current.sources
      },
      context.signal
    )
    context.reportProgress({ completed: 1, total: 2, stage: 'built' })
    if (this.#deferSupersededActivation(generationId, context)) return
    const activation = await this.options.client.activate(generationId, context.signal)
    this.#activeGenerationId = activation.snapshot.activeGenerationId
    this.#readiness = 'available'
    context.reportProgress({ completed: 2, total: 2, stage: 'active' })
    this.options.log.info(
      {
        event: 'index.generation.activated',
        projectId: this.options.projectId,
        generationId,
        chunkCount: activation.snapshot.chunkCount,
        sourceCount: activation.snapshot.sourceCount
      },
      'Index generation built and activated'
    )
    await this.#queueEmbeddings(current, context.job.jobId)
  }

  async handleEmbedding(context: JobHandlerContext): Promise<void> {
    const { generationId, refreshScope, knowledgeItemId, target } =
      jobPayloadRegistry.build_embedding_generation.parse(context.job.payload)
    context.signal.throwIfAborted()
    const config = await this.options.getEmbeddingProvider()
    context.signal.throwIfAborted()
    const current = this.#currentGeneration()
    if (target !== undefined && target.indexGenerationId !== current.generationId) {
      context.reportProgress({ stage: 'superseded' })
      this.#enqueueBuild(current.generationId, context.job.jobId)
      return
    }
    const standardContract = createEmbeddingGenerationContract(config, current)
    if (target !== undefined && target.contractSha256 !== standardContract.contractSha256) {
      context.reportProgress({ stage: 'superseded' })
      this.#enqueueEmbedding(standardContract.embeddingGenerationId, context.job.jobId)
      return
    }
    if (
      refreshScope === 'item' &&
      !current.sources.some((source) => source.knowledgeItemId === knowledgeItemId)
    ) {
      this.options.log.info(
        {
          event: 'embedding.refresh.item_unavailable',
          projectId: this.options.projectId,
          embeddingGenerationId: generationId,
          knowledgeItemId
        },
        'Embedding refresh ended because the selected source is no longer active'
      )
      return
    }
    if (refreshScope === undefined && generationId !== standardContract.embeddingGenerationId) {
      this.#enqueueEmbedding(standardContract.embeddingGenerationId, context.job.jobId)
      return
    }
    const contract =
      refreshScope === undefined
        ? standardContract
        : { ...standardContract, embeddingGenerationId: generationId }
    let refresh: VectorRefresh | undefined
    if (refreshScope === 'item') refresh = { scope: 'item', knowledgeItemId }
    if (refreshScope === 'all') refresh = { scope: 'all' }
    const { alreadyActive, clearedCount } = await this.options.client.beginVectors(
      contract,
      context.signal,
      refresh
    )
    if (alreadyActive) {
      this.options.log.info(
        {
          event: 'embedding.generation.already_active',
          projectId: this.options.projectId,
          embeddingGenerationId: contract.embeddingGenerationId
        },
        'Embedding generation is already active'
      )
      return
    }
    if (refreshScope !== undefined && clearedCount !== null) {
      this.options.log.info(
        {
          event: 'embedding.refresh.cache_cleared',
          projectId: this.options.projectId,
          embeddingGenerationId: contract.embeddingGenerationId,
          refreshScope,
          clearedCount,
          ...(refreshScope === 'item' ? { knowledgeItemId } : {})
        },
        'Embedding cache cleared for refresh'
      )
    }
    let offset = 0
    let total = 0
    let embedded = 0
    let reused = 0
    do {
      const page = await this.options.client.embeddingInputs(
        contract.indexGenerationId,
        contract.contractSha256,
        contract.dimension,
        offset,
        256,
        context.signal
      )
      total = page.total
      const cached = page.values.filter((value) => value.cachedVector !== undefined)
      if (cached.length > 0) {
        await this.options.client.upsertVectors(
          contract.embeddingGenerationId,
          cached.map((value) => ({
            chunkId: value.chunkId,
            contentSha256: value.contentSha256,
            vector: value.cachedVector as number[]
          })),
          context.signal
        )
        reused += cached.length
      }
      const missing = page.values.filter((value) => value.cachedVector === undefined)
      for (const group of splitEmbeddingBatches(missing, config.batchLimit)) {
        const result = await this.options.embedBatch(
          group.map((value) => value.text),
          contract.contractSha256,
          { operationId: contract.embeddingGenerationId, jobId: context.job.jobId },
          context.signal
        )
        if (result.embeddings.length !== group.length) {
          throw new Error('Embedding provider returned an incompatible batch length')
        }
        const values = result.embeddings.map((vector, index) => {
          if (vector.length !== contract.dimension) {
            throw new Error('Embedding provider returned an incompatible dimension')
          }
          const source = group[index]
          if (source === undefined) throw new Error('Embedding batch correlation is invalid')
          return { chunkId: source.chunkId, contentSha256: source.contentSha256, vector }
        })
        await this.options.client.upsertVectors(
          contract.embeddingGenerationId,
          values,
          context.signal
        )
        embedded += values.length
      }
      offset += page.values.length
      context.reportProgress({ completed: offset, total: Math.max(total, 1), stage: 'embedding' })
    } while (offset < total)
    if (
      this.#deferSupersededActivation(
        contract.indexGenerationId,
        context,
        contract.embeddingGenerationId
      )
    ) {
      return
    }
    await this.options.client.activateVectors(
      contract.embeddingGenerationId,
      contract.contractSha256,
      context.signal
    )
    this.options.log.info(
      {
        event: 'embedding.generation.activated',
        projectId: this.options.projectId,
        embeddingGenerationId: contract.embeddingGenerationId,
        indexGenerationId: contract.indexGenerationId,
        vectorCount: total,
        embeddedCount: embedded,
        reusedCount: reused
      },
      'Embedding generation activated'
    )
  }

  inspectKnowledgeMapping(
    knowledgeItemId: string,
    parseRevisionId: string,
    pageIndex: number,
    fallbackBlockOrdinals: number[] = [],
    signal = new AbortController().signal
  ) {
    return this.options.client.inspectKnowledgeMapping(
      knowledgeItemId,
      parseRevisionId,
      pageIndex,
      fallbackBlockOrdinals,
      signal
    )
  }

  async isCurrentGenerationIndexed(): Promise<boolean> {
    if (this.#closing || this.#readiness !== 'available') return false
    const current = this.#currentGeneration()
    const activeGenerationId = await this.options.client.activeGenerationId()
    return this.#confirmCurrentGeneration(current.generationId, activeGenerationId) !== null
  }

  async currentIndexedSources(signal: AbortSignal): Promise<CurrentIndexedSourceSnapshot> {
    if (this.#closing || this.#readiness === 'unavailable') return { state: 'unavailable' }
    if (this.#readiness === 'preparing') return { state: 'preparing' }
    const before = this.#currentGeneration()
    const activeGenerationId = await this.options.client.activeGenerationId(signal)
    const after = this.#confirmCurrentGeneration(before.generationId, activeGenerationId)
    if (after === null) return { state: this.#closing ? 'unavailable' : 'preparing' }
    return {
      state: 'ready',
      generationId: after.generationId,
      sources: after.sources.map(({ knowledgeItemId, displayName, extension }) => ({
        knowledgeItemId,
        displayName,
        extension
      }))
    }
  }

  #confirmCurrentGeneration(
    expectedGenerationId: string,
    activeGenerationId: string | null
  ): CurrentIndexGeneration | null {
    if (this.#closing) return null
    this.#activeGenerationId = activeGenerationId
    if (activeGenerationId !== expectedGenerationId) return null
    const current = this.#currentGeneration()
    return current.generationId === expectedGenerationId ? current : null
  }

  isRetrievalAvailable(): boolean {
    return (
      !this.#closing &&
      this.#readiness === 'available' &&
      this.#activeGenerationId === this.#currentGeneration().generationId
    )
  }

  close(): Promise<void> {
    this.#closing = true
    return this.options.client.close()
  }

  terminate(): Promise<void> {
    this.#closing = true
    return this.options.client.terminate()
  }

  #deferSupersededActivation(
    builtGenerationId: string,
    context: JobHandlerContext,
    embeddingGenerationId?: string
  ): boolean {
    context.signal.throwIfAborted()
    const current = this.#currentGeneration()
    if (current.generationId === builtGenerationId) return false
    this.options.log.info(
      {
        event: 'index.generation.superseded_before_activation',
        projectId: this.options.projectId,
        builtGenerationId,
        currentGenerationId: current.generationId,
        embeddingGenerationId
      },
      'Source index generation changed before activation'
    )
    this.#enqueueBuild(current.generationId, context.job.jobId)
    return true
  }

  #currentGeneration(): CurrentIndexGeneration {
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT knowledge_items.knowledge_item_id, knowledge_items.display_name,
                    active_parse_revisions.parse_revision_id,
                    active_parse_revisions.normalization_run_id,
                    normalization_runs.relative_path,
                    normalization_runs.manifest_sha256,
                    file_records.extension
               FROM active_parse_revisions
               JOIN knowledge_items USING (knowledge_item_id)
               JOIN file_records USING (file_record_id)
               JOIN normalization_runs USING (normalization_run_id)
              WHERE normalization_runs.state = 'published'
              ORDER BY knowledge_items.knowledge_item_id`
          )
          .all() as Array<{
          knowledge_item_id: string
          display_name: string
          parse_revision_id: string
          normalization_run_id: string
          relative_path: string
          manifest_sha256: string
          extension: string
        }>
    )
    const sources = rows.map((row) =>
      indexSourceSchema.parse({
        knowledgeItemId: row.knowledge_item_id,
        displayName: row.display_name,
        extension: row.extension,
        parseRevisionId: row.parse_revision_id,
        normalizationRunId: row.normalization_run_id,
        normalizationRoot: resolveProjectPath(this.options.projectRoot, row.relative_path),
        manifestSha256: row.manifest_sha256
      })
    )
    const sourceSetSha256 = hashSourceSet(sources, INDEX_CHUNKER_VERSION)
    return {
      sources,
      contentFingerprint: sourceSetSha256,
      generationId: generationIdFor(sourceSetSha256, INDEX_CHUNKER_VERSION)
    }
  }

  async #queueEmbeddings(current: CurrentIndexGeneration, cause: string): Promise<void> {
    try {
      const config = await this.options.getEmbeddingProvider()
      this.#enqueueEmbedding(
        createEmbeddingGenerationContract(config, current).embeddingGenerationId,
        cause
      )
    } catch (err) {
      this.options.log.warn(
        { event: 'embedding.generation.not_queued', err, projectId: this.options.projectId, cause },
        'Embedding generation was not queued because the provider is unavailable'
      )
    }
  }

  #enqueueEmbedding(embeddingGenerationId: string, cause: string): void {
    this.options.jobs.enqueue({
      type: 'build_embedding_generation',
      payload: { generationId: embeddingGenerationId },
      deduplicationKey: `embedding:${embeddingGenerationId}`,
      maxAttempts: 8
    })
    this.options.log.info(
      {
        event: 'embedding.generation.queued',
        projectId: this.options.projectId,
        embeddingGenerationId,
        cause
      },
      'Embedding generation queued'
    )
  }

  #enqueueBuild(generationId: string, cause: string): void {
    this.options.jobs.enqueue({
      type: 'build_index_generation',
      payload: { generationId },
      deduplicationKey: `index-build:${generationId}`,
      maxAttempts: 8
    })
    this.options.log.info(
      { event: 'index.generation.queued', projectId: this.options.projectId, generationId, cause },
      'Index generation queued'
    )
  }
}

async function waitForLegacyRefreshDelay(context: JobHandlerContext): Promise<void> {
  const createdAt = Date.parse(context.job.createdAt)
  if (!Number.isFinite(createdAt)) return
  const remaining = createdAt + GENERATION_BUILD_DEBOUNCE_MS - Date.now()
  if (remaining <= 0) return
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      context.signal.removeEventListener('abort', onAbort)
      reject(createAbortError('Index operation aborted'))
    }
    const timer = setTimeout(() => {
      context.signal.removeEventListener('abort', onAbort)
      resolve()
    }, remaining)
    context.signal.addEventListener('abort', onAbort, { once: true })
    timer.unref?.()
  })
}

export function registerIndexHandlers(
  registry: JobHandlerRegistry,
  service: ProjectIndexService
): void {
  for (const type of ['remove_index_item', 'rebuild_index'] as const) {
    registry.register(type, (context) => service.handleRefresh(context), {
      timeoutMs: 60_000
    })
  }
  registry.register('build_index_generation', (context) => service.handleBuild(context), {
    timeoutMs: 10 * 60_000,
    leaseMs: 60_000,
    heartbeatMs: 15_000
  })
  registry.register('build_embedding_generation', (context) => service.handleEmbedding(context), {
    timeoutMs: 30 * 60_000,
    leaseMs: 60_000,
    heartbeatMs: 15_000
  })
}

function splitEmbeddingBatches<T extends { text: string }>(values: T[], batchLimit: number): T[][] {
  const result: T[][] = []
  let current: T[] = []
  let characters = 0
  for (const value of values) {
    if (
      current.length > 0 &&
      (current.length >= batchLimit || characters + value.text.length > 2_097_152)
    ) {
      result.push(current)
      current = []
      characters = 0
    }
    current.push(value)
    characters += value.text.length
  }
  if (current.length > 0) result.push(current)
  return result
}
