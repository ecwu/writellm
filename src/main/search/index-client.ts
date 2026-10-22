import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { MessageChannelMain, utilityProcess } from 'electron'
import { createAbortError } from '../../shared/abort-error'
import type { Logger } from 'pino'
import {
  indexUtilityInitSchema,
  indexUtilityRequestSchema,
  indexUtilityResponseSchema,
  type IndexSnapshot,
  type IndexCandidate,
  type IndexSource,
  type FtsSearchMode,
  type VectorGenerationContract,
  type IndexUtilityRequestBody,
  type IndexUtilityResponse
} from '../../shared/contracts/indexing'
import type { LogCollector } from '../observability/log-collector'
import type { KnowledgeSearchFilters } from '../../shared/contracts/search'
import { attachUtilityLogPort } from '../observability/utility-logs'
import {
  PersistentUtilityProcess,
  type PersistentUtilityProcessFactory,
  type UtilityMessageDecision
} from '../workers/persistent-utility-process'
import { reconstructUtilityError } from '../workers/utility-message'

export type IndexUtilityProcessFactory = PersistentUtilityProcessFactory

export class IndexClient {
  readonly #worker: PersistentUtilityProcess
  #ready: Promise<IndexSnapshot> | undefined
  #initializing = false
  #detachLogs: (() => void) | undefined
  #recovering = false
  #closed = false

  constructor(
    private readonly options: {
      modulePath: string
      indexPath: string
      extensionPath: string
      projectId: string
      projectSessionId: string
      collector: LogCollector
      log: Logger
      processFactory?: IndexUtilityProcessFactory
    }
  ) {
    this.#worker = new PersistentUtilityProcess({
      modulePath: options.modulePath,
      serviceName: 'writellm-index',
      log: options.log,
      factory: options.processFactory ?? utilityProcess,
      stdio: 'pipe',
      attachLoggingPort: false,
      rejectStaleResponses: true
    })
  }

  async initialize(): Promise<IndexSnapshot> {
    try {
      return await this.#ensureReady()
    } catch (err) {
      if (this.#recovering || this.#closed) throw err
      this.#recovering = true
      this.options.log.error(
        { event: 'index.utility.initialization_failed', err, projectId: this.options.projectId },
        'Index utility initialization failed; recreating derived index'
      )
      this.#worker.reset(new Error('Index utility initialization recovery'))
      try {
        await this.#removeDatabaseFamily()
        return await this.#ensureReady()
      } finally {
        this.#recovering = false
      }
    }
  }

  async build(
    input: { generationId: string; chunkerVersion: 1; sources: IndexSource[] },
    signal: AbortSignal
  ): Promise<Extract<IndexUtilityResponse, { type: 'built' }>> {
    const response = await this.#send(
      { operation: 'build', requestId: randomUUID(), ...input },
      signal
    )
    if (response.type !== 'built') throw new Error('Index build response type mismatch')
    return response
  }

  async activate(
    generationId: string,
    signal: AbortSignal
  ): Promise<Extract<IndexUtilityResponse, { type: 'activated' }>> {
    const response = await this.#send(
      { operation: 'activate', requestId: randomUUID(), generationId },
      signal
    )
    if (response.type !== 'activated') throw new Error('Index activate response type mismatch')
    return response
  }

  async inspect(signal = new AbortController().signal): Promise<IndexSnapshot> {
    const response = await this.#send({ operation: 'inspect', requestId: randomUUID() }, signal)
    if (response.type !== 'snapshot') throw new Error('Index inspect response type mismatch')
    return response.snapshot
  }

  async retrievalState(
    signal: AbortSignal
  ): Promise<
    Pick<
      Extract<IndexUtilityResponse, { type: 'retrieval-state' }>,
      'activeIndexGenerationId' | 'activeEmbeddingContract'
    >
  > {
    const response = await this.#send(
      { operation: 'retrieval-state', requestId: randomUUID() },
      signal
    )
    if (response.type !== 'retrieval-state') {
      throw new Error('Retrieval state response type mismatch')
    }
    return response
  }

  async ftsCandidates(
    query: string,
    limit: number,
    filters: KnowledgeSearchFilters,
    signal: AbortSignal,
    mode: FtsSearchMode = 'phrase'
  ): Promise<
    Array<{ chunkId: string; rank: number; strategy: 'unicode61' | 'trigram' | 'substring' }>
  > {
    const response = await this.#send(
      { operation: 'fts-candidates', requestId: randomUUID(), query, limit, filters, mode },
      signal
    )
    if (response.type !== 'fts-candidates') {
      throw new Error('FTS candidates response type mismatch')
    }
    return response.values
  }

  async hydrateCandidates(
    chunkIds: string[],
    filters: KnowledgeSearchFilters,
    signal: AbortSignal
  ): Promise<IndexCandidate[]> {
    const response = await this.#send(
      { operation: 'hydrate-candidates', requestId: randomUUID(), chunkIds, filters },
      signal
    )
    if (response.type !== 'hydrated-candidates') {
      throw new Error('Hydrate candidates response type mismatch')
    }
    return response.values
  }

  async expandCitations(citationIds: string[], signal: AbortSignal): Promise<IndexCandidate[]> {
    const response = await this.#send(
      { operation: 'expand-citations', requestId: randomUUID(), citationIds },
      signal
    )
    if (response.type !== 'expanded-citations') {
      throw new Error('Expand citations response type mismatch')
    }
    return response.values
  }

  async embeddingInputs(
    indexGenerationId: string,
    contractSha256: string,
    dimension: number,
    offset: number,
    limit: number,
    signal: AbortSignal
  ): Promise<Extract<IndexUtilityResponse, { type: 'embedding-inputs' }>> {
    const response = await this.#send(
      {
        operation: 'embedding-inputs',
        requestId: randomUUID(),
        indexGenerationId,
        contractSha256,
        dimension,
        offset,
        limit
      },
      signal
    )
    if (response.type !== 'embedding-inputs') {
      throw new Error('Embedding inputs response type mismatch')
    }
    return response
  }

  async inspectKnowledgeMapping(
    knowledgeItemId: string,
    parseRevisionId: string,
    pageIndex: number,
    fallbackBlockOrdinals: number[],
    signal: AbortSignal
  ): Promise<Extract<IndexUtilityResponse, { type: 'knowledge-mapping' }>> {
    const response = await this.#send(
      {
        operation: 'inspect-knowledge-mapping',
        requestId: randomUUID(),
        knowledgeItemId,
        parseRevisionId,
        pageIndex,
        fallbackBlockOrdinals
      },
      signal
    )
    if (response.type !== 'knowledge-mapping') {
      throw new Error('Knowledge mapping response type mismatch')
    }
    return response
  }

  async beginVectors(contract: VectorGenerationContract, signal: AbortSignal): Promise<boolean> {
    const response = await this.#send(
      { operation: 'begin-vectors', requestId: randomUUID(), contract },
      signal
    )
    if (response.type !== 'vectors-begun') throw new Error('Begin vectors response type mismatch')
    return response.alreadyActive
  }

  async clearEmbeddingCache(
    indexGenerationId: string,
    contractSha256: string,
    knowledgeItemId: string | undefined,
    signal: AbortSignal
  ): Promise<number> {
    const response = await this.#send(
      {
        operation: 'clear-embedding-cache',
        requestId: randomUUID(),
        indexGenerationId,
        contractSha256,
        ...(knowledgeItemId === undefined ? {} : { knowledgeItemId })
      },
      signal
    )
    if (response.type !== 'embedding-cache-cleared') {
      throw new Error('Clear embedding cache response type mismatch')
    }
    return response.count
  }

  async upsertVectors(
    embeddingGenerationId: string,
    values: Array<{ chunkId: string; contentSha256: string; vector: number[] }>,
    signal: AbortSignal
  ): Promise<void> {
    const response = await this.#send(
      { operation: 'upsert-vectors', requestId: randomUUID(), embeddingGenerationId, values },
      signal
    )
    if (response.type !== 'vectors-upserted' || response.count !== values.length) {
      throw new Error('Upsert vectors response type mismatch')
    }
  }

  async activateVectors(
    embeddingGenerationId: string,
    contractSha256: string,
    signal: AbortSignal
  ): Promise<void> {
    const response = await this.#send(
      {
        operation: 'activate-vectors',
        requestId: randomUUID(),
        embeddingGenerationId,
        contractSha256
      },
      signal
    )
    if (response.type !== 'vectors-activated') {
      throw new Error('Activate vectors response type mismatch')
    }
  }

  async queryVectors(
    embeddingGenerationId: string,
    vector: number[],
    limit: number,
    filters: KnowledgeSearchFilters,
    signal: AbortSignal
  ): Promise<Array<{ chunkId: string; distance: number }>> {
    const response = await this.#send(
      {
        operation: 'query-vectors',
        requestId: randomUUID(),
        embeddingGenerationId,
        vector,
        limit,
        filters
      },
      signal
    )
    if (response.type !== 'vector-candidates') {
      throw new Error('Vector query response type mismatch')
    }
    return response.values
  }

  async deleteVectors(embeddingGenerationId: string, signal: AbortSignal): Promise<void> {
    const response = await this.#send(
      { operation: 'delete-vectors', requestId: randomUUID(), embeddingGenerationId },
      signal
    )
    if (response.type !== 'vectors-deleted') {
      throw new Error('Delete vectors response type mismatch')
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return
    if (this.#initializing) {
      this.#closed = true
      this.#detachLogs?.()
      this.#detachLogs = undefined
      this.#worker.terminate(createAbortError('Index utility request aborted'))
      return
    }
    if (!this.#worker.running) {
      this.#closed = true
      this.#worker.terminate(new Error('Index utility closed'))
      return
    }
    try {
      const response = await this.#send(
        { operation: 'close', requestId: randomUUID() },
        new AbortController().signal,
        true
      )
      if (response.type !== 'closed') throw new Error('Index close response type mismatch')
    } catch (err) {
      this.options.log.error(
        { event: 'index.utility.close_failed', err, projectId: this.options.projectId },
        'Index utility did not close cleanly'
      )
      throw new Error('Index utility close failed', { cause: err })
    } finally {
      this.#closed = true
      this.#detachLogs?.()
      this.#detachLogs = undefined
      this.#worker.terminate(new Error('Index utility closed'))
    }
  }

  terminate(): void {
    this.#closed = true
    this.#detachLogs?.()
    this.#detachLogs = undefined
    this.#worker.terminate(new Error('Index utility terminated'))
  }

  async #send(
    request: IndexUtilityRequestBody,
    signal: AbortSignal,
    allowClosed = false
  ): Promise<IndexUtilityResponse> {
    if (signal.aborted) throw createAbortError('Index utility request aborted')
    if (this.#closed && !allowClosed) throw new Error('Index utility client is closed')
    await this.initialize()
    if (!this.#worker.running) {
      this.#ready = undefined
      await this.initialize()
    }
    const parsed = indexUtilityRequestSchema.parse({
      ...request,
      projectSessionId: this.options.projectSessionId
    })
    return this.#worker.request<IndexUtilityResponse>({
      requestId: parsed.requestId,
      payload: parsed,
      signal,
      rejectOnAbort: createAbortError('Index utility request aborted'),
      terminateOnAbort: !allowClosed,
      onMessage: (raw) => this.#handleMessage(raw)
    })
  }

  #ensureReady(): Promise<IndexSnapshot> {
    if (this.#closed) return Promise.reject(new Error('Index utility client is closed'))
    if (this.#ready !== undefined) return this.#ready
    const requestId = randomUUID()
    this.#initializing = true
    this.#detachLogs?.()
    this.#detachLogs = undefined
    const { port1, port2 } = new MessageChannelMain()
    this.#detachLogs = attachUtilityLogPort(port1, this.options.collector, this.options.log)
    const request = indexUtilityInitSchema.parse({
      type: 'initialize',
      requestId,
      projectId: this.options.projectId,
      projectSessionId: this.options.projectSessionId,
      indexPath: this.options.indexPath,
      extensionPath: this.options.extensionPath
    })
    const ready = this.#worker
      .request<IndexUtilityResponse>({
        requestId,
        payload: request,
        signal: new AbortController().signal,
        rejectOnAbort: createAbortError('Index utility request aborted'),
        transfer: [port2],
        onMessage: (raw) => this.#handleMessage(raw)
      })
      .then((response) => {
        if (response.type !== 'ready')
          throw new Error('Index utility initialization response mismatch')
        return response.snapshot
      })
      .then(
        (snapshot) => snapshot,
        (err) => {
          this.#initializing = false
          this.#ready = undefined
          this.#detachLogs?.()
          this.#detachLogs = undefined
          throw err
        }
      )
    ready.then(
      () => {
        this.#initializing = false
      },
      () => {
        this.#initializing = false
      }
    )
    this.#ready = ready
    return ready
  }

  #handleMessage(raw: unknown): UtilityMessageDecision<IndexUtilityResponse> {
    const parsed = indexUtilityResponseSchema.safeParse(raw)
    if (!parsed.success) {
      this.options.log.error(
        { event: 'index.utility.response_invalid', err: parsed.error },
        'Index utility returned an invalid response'
      )
      return {
        kind: 'reject',
        error: new Error('Index utility returned an invalid response'),
        terminate: true
      }
    }
    const response = parsed.data
    if (response.projectSessionId !== this.options.projectSessionId) {
      const err = new Error('Index utility response belongs to a stale project session')
      this.options.log.error(
        {
          event: 'index.utility.stale_session_response',
          err,
          projectId: this.options.projectId,
          projectSessionId: response.projectSessionId
        },
        'Rejected an Index utility response from a stale project session'
      )
      return { kind: 'reject', error: err, terminate: true }
    }
    if (response.type === 'error') {
      const err = reconstructUtilityError(response.error)
      this.options.log.error(
        { event: 'index.utility.request_failed', err, requestId: response.requestId },
        'Index utility request failed'
      )
      return { kind: 'reject', error: err }
    }
    return { kind: 'resolve', value: response }
  }

  async #removeDatabaseFamily(): Promise<void> {
    for (const path of [
      this.options.indexPath,
      `${this.options.indexPath}-wal`,
      `${this.options.indexPath}-shm`
    ]) {
      try {
        await rm(path, { force: true })
      } catch (err) {
        this.options.log.error(
          {
            event: 'index.database.recovery_cleanup_failed',
            err,
            projectId: this.options.projectId
          },
          'Failed to remove rebuildable index database during recovery'
        )
        throw err
      }
    }
  }
}
