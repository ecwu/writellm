import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { MessageChannelMain, utilityProcess, type UtilityProcess } from 'electron'
import type { Logger } from 'pino'
import {
  indexUtilityInitSchema,
  indexUtilityRequestSchema,
  indexUtilityResponseSchema,
  type IndexSnapshot,
  type IndexCandidate,
  type IndexSource,
  type VectorGenerationContract,
  type IndexUtilityRequestBody,
  type IndexUtilityResponse
} from '../../shared/contracts/indexing'
import type { LogCollector } from '../observability/log-collector'
import type { KnowledgeSearchFilters } from '../../shared/contracts/search'
import { attachUtilityLogPort, captureUtilityStderr } from '../observability/utility-logs'

interface PendingRequest {
  resolve(response: IndexUtilityResponse): void
  reject(error: unknown): void
}

export class IndexClient {
  readonly #pending = new Map<string, PendingRequest>()
  #child: UtilityProcess | undefined
  #ready: Promise<IndexSnapshot> | undefined
  #resolveReady: ((snapshot: IndexSnapshot) => void) | undefined
  #rejectReady: ((error: unknown) => void) | undefined
  #detachLogs: (() => void) | undefined
  #initialRequestId: string | undefined
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
    }
  ) {}

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
      this.#terminate(new Error('Index utility initialization recovery'))
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
    signal: AbortSignal
  ): Promise<Array<{ chunkId: string; rank: number; strategy: 'unicode61' | 'trigram' }>> {
    const response = await this.#send(
      { operation: 'fts-candidates', requestId: randomUUID(), query, limit, filters },
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

  async beginVectors(contract: VectorGenerationContract, signal: AbortSignal): Promise<boolean> {
    const response = await this.#send(
      { operation: 'begin-vectors', requestId: randomUUID(), contract },
      signal
    )
    if (response.type !== 'vectors-begun') throw new Error('Begin vectors response type mismatch')
    return response.alreadyActive
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
    if (this.#child === undefined) {
      this.#closed = true
      return
    }
    const child = this.#child
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
      child.kill()
      this.#terminate(new Error('Index utility closed'))
    }
  }

  terminate(): void {
    this.#terminate(new Error('Index utility terminated'))
  }

  async #send(
    request: IndexUtilityRequestBody,
    signal: AbortSignal,
    allowClosed = false
  ): Promise<IndexUtilityResponse> {
    if (signal.aborted) throw abortError()
    if (this.#closed && !allowClosed) throw new Error('Index utility client is closed')
    await this.initialize()
    const parsed = indexUtilityRequestSchema.parse({
      ...request,
      projectSessionId: this.options.projectSessionId
    })
    const child = this.#child
    if (child === undefined) throw new Error('Index utility is unavailable')
    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        this.#pending.delete(parsed.requestId)
        this.#terminate(abortError())
        reject(abortError())
      }
      this.#pending.set(parsed.requestId, {
        resolve: (response) => {
          signal.removeEventListener('abort', onAbort)
          resolve(response)
        },
        reject: (err) => {
          signal.removeEventListener('abort', onAbort)
          reject(err)
        }
      })
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        child.postMessage(parsed)
      } catch (err) {
        this.#pending.delete(parsed.requestId)
        signal.removeEventListener('abort', onAbort)
        this.options.log.error(
          { event: 'index.utility.request_start_failed', err, requestId: parsed.requestId },
          'Failed to send index utility request'
        )
        reject(new Error('Index utility request could not start', { cause: err }))
      }
    })
  }

  #ensureReady(): Promise<IndexSnapshot> {
    if (this.#closed) return Promise.reject(new Error('Index utility client is closed'))
    if (this.#ready !== undefined) return this.#ready
    const requestId = randomUUID()
    this.#initialRequestId = requestId
    const child = utilityProcess.fork(this.options.modulePath, [], {
      serviceName: 'writellm-index',
      stdio: 'pipe'
    })
    this.#child = child
    captureUtilityStderr(child, this.options.log)
    const { port1, port2 } = new MessageChannelMain()
    this.#detachLogs = attachUtilityLogPort(port1, this.options.collector, this.options.log)
    this.#ready = new Promise((resolve, reject) => {
      this.#resolveReady = resolve
      this.#rejectReady = reject
    })
    child.on('message', this.#onMessage)
    child.once('exit', this.#onExit)
    try {
      child.postMessage(
        indexUtilityInitSchema.parse({
          type: 'initialize',
          requestId,
          projectId: this.options.projectId,
          projectSessionId: this.options.projectSessionId,
          indexPath: this.options.indexPath,
          extensionPath: this.options.extensionPath
        }),
        [port2]
      )
    } catch (err) {
      this.options.log.error(
        { event: 'index.utility.start_failed', err, projectId: this.options.projectId },
        'Failed to start index utility'
      )
      this.#terminate(new Error('Index utility could not start', { cause: err }))
    }
    return this.#ready
  }

  readonly #onMessage = (raw: unknown): void => {
    const parsed = indexUtilityResponseSchema.safeParse(raw)
    if (!parsed.success) {
      this.options.log.error(
        { event: 'index.utility.response_invalid', err: parsed.error },
        'Index utility returned an invalid response'
      )
      this.#terminate(new Error('Index utility returned an invalid response'))
      return
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
      this.#terminate(err)
      return
    }
    if (response.type === 'ready') {
      if (response.requestId !== this.#initialRequestId) {
        this.#terminate(new Error('Index utility initialization request ID mismatch'))
        return
      }
      this.#resolveReady?.(response.snapshot)
      this.#resolveReady = undefined
      this.#rejectReady = undefined
      this.#initialRequestId = undefined
      return
    }
    if (response.type === 'error') {
      const err = reconstructError(response.error)
      this.options.log.error(
        { event: 'index.utility.request_failed', err, requestId: response.requestId },
        'Index utility request failed'
      )
      if (this.#resolveReady !== undefined) {
        if (response.requestId !== this.#initialRequestId) {
          this.#terminate(new Error('Index utility initialization request ID mismatch'))
          return
        }
        this.#rejectReady?.(err)
        this.#resolveReady = undefined
        this.#rejectReady = undefined
      } else {
        this.#pending.get(response.requestId)?.reject(err)
        this.#pending.delete(response.requestId)
      }
      return
    }
    const pending = this.#pending.get(response.requestId)
    if (pending === undefined) {
      const err = new Error('Index utility response request ID is not pending')
      this.options.log.error(
        { event: 'index.utility.response_unmatched', err, requestId: response.requestId },
        'Index utility returned an unmatched response'
      )
      this.#terminate(err)
      return
    }
    this.#pending.delete(response.requestId)
    pending.resolve(response)
  }

  readonly #onExit = (code: number): void => {
    const err = new Error(`Index utility exited before completion (${code})`)
    this.options.log.error(
      { event: 'index.utility.exited', err, projectId: this.options.projectId },
      'Index utility exited before completion'
    )
    this.#terminate(err, false)
  }

  #terminate(error: Error, kill = true): void {
    const child = this.#child
    if (child !== undefined) {
      child.off('message', this.#onMessage)
      child.off('exit', this.#onExit)
      if (kill) child.kill()
    }
    this.#child = undefined
    this.#detachLogs?.()
    this.#detachLogs = undefined
    this.#rejectReady?.(error)
    this.#resolveReady = undefined
    this.#rejectReady = undefined
    this.#ready = undefined
    this.#initialRequestId = undefined
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
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

function reconstructError(input: { name: string; message: string; stack?: string }): Error {
  const error = new Error(input.message)
  error.name = input.name
  if (input.stack !== undefined) error.stack = input.stack
  return error
}

function abortError(): Error {
  const error = new Error('Index utility request aborted')
  error.name = 'AbortError'
  return error
}
