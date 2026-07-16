import { randomUUID } from 'node:crypto'
import { utilityProcess } from 'electron'
import type { Logger } from 'pino'
import {
  auxiliaryUtilityResponseSchema,
  embeddingBatchInputSchema,
  rerankInputSchema,
  type AuxiliaryUtilityRequest,
  type AuxiliaryUtilityResponse
} from '../../shared/contracts/model-runtime'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { EmbeddingGateway, RerankGateway } from './gateways'
import type { UtilityProcessFactory } from './provider-probe-client'
import {
  PersistentUtilityProcess,
  type UtilityMessageDecision
} from '../workers/persistent-utility-process'

type AuxiliarySuccessResponse = Exclude<AuxiliaryUtilityResponse, { type: 'error' }>

export class AuxiliaryModelClient implements EmbeddingGateway, RerankGateway {
  readonly #worker: PersistentUtilityProcess

  constructor(
    modulePath: string,
    private readonly log: Logger,
    processFactory: UtilityProcessFactory = utilityProcess,
    sharedWorker?: PersistentUtilityProcess
  ) {
    this.#worker =
      sharedWorker ??
      new PersistentUtilityProcess({
        modulePath,
        serviceName: 'writellm-background-worker',
        log,
        factory: processFactory
      })
  }

  terminate(): void {
    this.#worker.terminate()
  }

  embedBatch(
    config: ProviderConfig,
    credential: string,
    rawInput: Parameters<EmbeddingGateway['embedBatch']>[2],
    signal: AbortSignal,
    projectSessionId?: string
  ): ReturnType<EmbeddingGateway['embedBatch']> {
    if (config.role !== 'embedding') return Promise.reject(new Error('Embedding role is required'))
    const request: AuxiliaryUtilityRequest = {
      operation: 'embedding',
      requestId: randomUUID(),
      config,
      credential,
      input: embeddingBatchInputSchema.parse(rawInput)
    }
    return this.#run(request, signal, projectSessionId).then((response) => {
      if (response.type !== 'embedding-result') throw new Error('Embedding response type mismatch')
      return response.result
    })
  }

  rerank(
    config: ProviderConfig,
    credential: string,
    rawInput: Parameters<RerankGateway['rerank']>[2],
    signal: AbortSignal,
    projectSessionId?: string
  ): ReturnType<RerankGateway['rerank']> {
    if (config.role !== 'rerank') return Promise.reject(new Error('Rerank role is required'))
    const request: AuxiliaryUtilityRequest = {
      operation: 'rerank',
      requestId: randomUUID(),
      config,
      credential,
      input: rerankInputSchema.parse(rawInput)
    }
    return this.#run(request, signal, projectSessionId).then((response) => {
      if (response.type !== 'rerank-result') throw new Error('Rerank response type mismatch')
      return response.result
    })
  }

  #run(
    request: AuxiliaryUtilityRequest,
    signal: AbortSignal,
    projectSessionId?: string
  ): Promise<AuxiliarySuccessResponse> {
    if (signal.aborted) return Promise.reject(abortError())
    const requestWithSession = { ...request, projectSessionId: projectSessionId ?? null }
    return this.#worker.request({
      requestId: request.requestId,
      payload: requestWithSession,
      signal,
      rejectOnAbort: abortError(),
      cancelPayload: {
        type: 'cancel',
        requestId: request.requestId,
        projectSessionId: requestWithSession.projectSessionId
      },
      onMessage: (raw) =>
        this.#handleResponse(raw, request.requestId, requestWithSession.projectSessionId)
    })
  }

  #handleResponse(
    raw: unknown,
    requestId: string,
    projectSessionId: string | null
  ): UtilityMessageDecision<AuxiliarySuccessResponse> {
    const parsed = auxiliaryUtilityResponseSchema.safeParse(raw)
    if (
      !parsed.success ||
      parsed.data.requestId !== requestId ||
      (parsed.data.projectSessionId ?? null) !== projectSessionId
    ) {
      const err = parsed.success
        ? new Error('Auxiliary response request or project session mismatch')
        : parsed.error
      this.log.error(
        { event: 'auxiliary_model.response_invalid', err, requestId },
        'Auxiliary model utility returned an invalid response'
      )
      return {
        kind: 'reject',
        error: new Error('Auxiliary model utility returned an invalid response'),
        terminate: true
      }
    }
    const response = parsed.data
    if (response.type === 'error') {
      const err = reconstructError(response.error)
      this.log.error(
        { event: 'auxiliary_model.failed', err, requestId },
        'Auxiliary model request failed'
      )
      return { kind: 'reject', error: new Error('Auxiliary model request failed', { cause: err }) }
    }
    return { kind: 'resolve', value: response }
  }
}

function reconstructError(input: {
  name: string
  message: string
  stack?: string
  httpStatus?: number
}): Error & { status?: number } {
  const error: Error & { status?: number } = new Error(input.message)
  error.name = input.name
  if (input.stack !== undefined) error.stack = input.stack
  if (input.httpStatus !== undefined) error.status = input.httpStatus
  return error
}

function abortError(): Error {
  const error = new Error('Auxiliary model request aborted')
  error.name = 'AbortError'
  return error
}
