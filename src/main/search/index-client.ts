import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { MessageChannelMain, utilityProcess } from 'electron'
import { createAbortError } from '../../shared/abort-error'
import type { Logger } from 'pino'
import {
  indexUtilityInitSchema,
  indexUtilityRequestSchema,
  indexUtilityResponseSchema,
  type IndexCandidate,
  type IndexSource,
  type FtsSearchMode,
  type VectorRefresh,
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
  #ready: Promise<string | null> | undefined
  #initializing = false
  #hasOpened = false
  #detachLogs: (() => void) | undefined
  #recoveryCleanup: Promise<void> | undefined
  #closePending: Promise<void> | undefined
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
      onRestart?: (activeGenerationId: string | null) => void
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

  initialize(): Promise<string | null> {
    if (this.#closed) return Promise.reject(new Error('Index utility client is closed'))
    if (this.#ready !== undefined && (this.#initializing || this.#worker.running)) {
      return this.#ready
    }
    this.#initializing = true
    this.#ready = this.#startWithRecovery()
      .then((activeGenerationId) => {
        if (this.#closed) throw createAbortError('Index utility request aborted')
        if (this.#hasOpened) this.options.onRestart?.(activeGenerationId)
        this.#hasOpened = true
        return activeGenerationId
      })
      .then(
        (activeGenerationId) => {
          this.#initializing = false
          return activeGenerationId
        },
        (err) => {
          if (!this.#closed) {
            this.options.log.error(
              { event: 'index.utility.start_failed', err, projectId: this.options.projectId },
              'Index utility did not become ready'
            )
          }
          this.#initializing = false
          this.#ready = undefined
          this.#detachLogs?.()
          this.#detachLogs = undefined
          this.#worker.reset(new Error('Index utility initialization failed', { cause: err }))
          throw err
        }
      )
    return this.#ready
  }

  async #startWithRecovery(): Promise<string | null> {
    try {
      return await this.#startWorker()
    } catch (err) {
      if (this.#closed) throw err
      this.options.log.error(
        { event: 'index.utility.initialization_failed', err, projectId: this.options.projectId },
        'Index utility initialization failed; recreating derived index'
      )
      this.#worker.reset(new Error('Index utility initialization recovery'))
      const cleanup = this.#removeDatabaseFamily()
      this.#recoveryCleanup = cleanup
      try {
        await cleanup
      } finally {
        this.#recoveryCleanup = undefined
      }
      return await this.#startWorker()
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

  async activeGenerationId(signal = new AbortController().signal): Promise<string | null> {
    const response = await this.#send(
      { operation: 'active-generation', requestId: randomUUID() },
      signal
    )
    if (response.type !== 'active-generation') {
      throw new Error('Index active generation response type mismatch')
    }
    return response.activeGenerationId
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
    indexGenerationId: string,
    query: string,
    limit: number,
    filters: KnowledgeSearchFilters,
    signal: AbortSignal,
    mode: FtsSearchMode = 'phrase'
  ): Promise<IndexCandidate[] | null> {
    return this.#searchCandidates(
      { operation: 'fts-candidates', indexGenerationId, query, limit, filters, mode },
      signal
    )
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

  async beginVectors(
    contract: VectorGenerationContract,
    signal: AbortSignal,
    refresh?: VectorRefresh
  ): Promise<{ alreadyActive: boolean; clearedCount: number | null }> {
    const response = await this.#send(
      { operation: 'begin-vectors', requestId: randomUUID(), contract, refresh },
      signal
    )
    if (response.type !== 'vectors-begun') throw new Error('Begin vectors response type mismatch')
    return { alreadyActive: response.alreadyActive, clearedCount: response.clearedCount }
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
    indexGenerationId: string,
    embeddingGenerationId: string,
    vector: number[],
    limit: number,
    filters: KnowledgeSearchFilters,
    signal: AbortSignal
  ): Promise<IndexCandidate[] | null> {
    return this.#searchCandidates(
      {
        operation: 'query-vectors',
        indexGenerationId,
        embeddingGenerationId,
        vector,
        limit,
        filters
      },
      signal
    )
  }

  async #searchCandidates(
    request:
      | Omit<Extract<IndexUtilityRequestBody, { operation: 'fts-candidates' }>, 'requestId'>
      | Omit<Extract<IndexUtilityRequestBody, { operation: 'query-vectors' }>, 'requestId'>,
    signal: AbortSignal
  ): Promise<IndexCandidate[] | null> {
    const response = await this.#send({ ...request, requestId: randomUUID() }, signal)
    if (response.type !== 'search-candidates')
      throw new Error('Search candidates response type mismatch')
    return response.values
  }

  close(): Promise<void> {
    this.#closePending ??= this.#closeWorker().finally(() => {
      this.#closePending = undefined
    })
    return this.#closePending
  }

  async #closeWorker(): Promise<void> {
    if (this.#initializing) {
      return this.#stopWorker(createAbortError('Index utility request aborted'))
    }
    if (this.#closed || !this.#worker.running) {
      return this.#stopWorker(new Error('Index utility closed'))
    }
    this.#closed = true
    try {
      const response = await this.#postRequest(
        { operation: 'close', requestId: randomUUID() },
        new AbortController().signal
      )
      if (response.type !== 'closed') throw new Error('Index close response type mismatch')
    } catch (err) {
      this.options.log.error(
        { event: 'index.utility.close_failed', err, projectId: this.options.projectId },
        'Index utility did not close cleanly'
      )
      throw new Error('Index utility close failed', { cause: err })
    } finally {
      await this.#stopWorker(new Error('Index utility closed'))
    }
  }

  terminate(): Promise<void> {
    return this.#stopWorker(new Error('Index utility terminated'))
  }

  async #stopWorker(reason: Error): Promise<void> {
    this.#closed = true
    this.#detachLogs?.()
    this.#detachLogs = undefined
    this.#worker.terminate(reason)
    if (this.#recoveryCleanup !== undefined) {
      // Startup receives the cleanup error. Shutdown only needs the file work to finish.
      await Promise.allSettled([this.#recoveryCleanup])
    }
  }

  async #send(
    request: IndexUtilityRequestBody,
    signal: AbortSignal
  ): Promise<IndexUtilityResponse> {
    if (signal.aborted) throw createAbortError('Index utility request aborted')
    await this.initialize()
    if (this.#closed) throw new Error('Index utility client is closed')
    return this.#postRequest(request, signal)
  }

  #postRequest(
    request: IndexUtilityRequestBody,
    signal: AbortSignal
  ): Promise<IndexUtilityResponse> {
    if (!this.#worker.running) throw new Error('Index utility stopped before the request')
    const parsed = indexUtilityRequestSchema.parse({
      ...request,
      projectSessionId: this.options.projectSessionId
    })
    return this.#worker.request<IndexUtilityResponse>({
      requestId: parsed.requestId,
      payload: parsed,
      signal,
      rejectOnAbort: createAbortError('Index utility request aborted'),
      terminateOnAbort: true,
      onMessage: (raw) => this.#handleMessage(raw)
    })
  }

  async #startWorker(): Promise<string | null> {
    if (this.#closed) throw new Error('Index utility client is closed')
    const requestId = randomUUID()
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
    const response = await this.#worker.request<IndexUtilityResponse>({
      requestId,
      payload: request,
      signal: new AbortController().signal,
      rejectOnAbort: createAbortError('Index utility request aborted'),
      transfer: [port2],
      onMessage: (raw) => this.#handleMessage(raw)
    })
    if (response.type !== 'ready') throw new Error('Index utility initialization response mismatch')
    return response.activeGenerationId
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
