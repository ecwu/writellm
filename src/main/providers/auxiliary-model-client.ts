import { randomUUID } from 'node:crypto'
import { utilityProcess } from 'electron'
import type { Logger } from 'pino'
import PQueueDefault from 'p-queue'
import {
  auxiliaryUtilityResponseSchema,
  embeddingBatchInputSchema,
  imageGenerationInputSchema,
  rerankInputSchema,
  type AuxiliaryUtilityRequest,
  type AuxiliaryUtilityResponse
} from '../../shared/contracts/model-runtime'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { EmbeddingGateway, ImageGenerationGateway, RerankGateway } from './gateways'
import type { UtilityProcessFactory } from './provider-probe-client'
import {
  PersistentUtilityProcess,
  type UtilityMessageDecision
} from '../workers/persistent-utility-process'

type AuxiliarySuccessResponse = Exclude<AuxiliaryUtilityResponse, { type: 'error' }>

const PQueue =
  (PQueueDefault as unknown as { default?: typeof PQueueDefault }).default ?? PQueueDefault

export class AuxiliaryModelClient
  implements EmbeddingGateway, RerankGateway, ImageGenerationGateway
{
  readonly #worker: PersistentUtilityProcess
  readonly #imageQueue = new PQueue({ concurrency: 1 })

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

  generateImage(
    config: ProviderConfig,
    credential: string | undefined,
    rawInput: Parameters<ImageGenerationGateway['generateImage']>[2],
    signal: AbortSignal,
    projectSessionId: string
  ): ReturnType<ImageGenerationGateway['generateImage']> {
    if (config.role !== 'image') return Promise.reject(new Error('Image role is required'))
    const request: AuxiliaryUtilityRequest = {
      operation: 'image',
      requestId: randomUUID(),
      projectSessionId,
      config,
      ...(credential === undefined ? {} : { credential }),
      input: imageGenerationInputSchema.parse(rawInput)
    }
    return this.#imageQueue.add(
      () =>
        this.#run(request, signal, projectSessionId).then((response) => {
          if (response.type !== 'image-result') throw new Error('Image response type mismatch')
          return response.result
        }),
      { signal }
    )
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
  providerCode?: string
}): Error & { status?: number; providerCode?: string } {
  const error: Error & { status?: number; providerCode?: string } = new Error(input.message)
  error.name = input.name
  if (input.stack !== undefined) error.stack = input.stack
  if (input.httpStatus !== undefined) error.status = input.httpStatus
  if (input.providerCode !== undefined) error.providerCode = input.providerCode
  return error
}

function abortError(): Error {
  const error = new Error('Auxiliary model request aborted')
  error.name = 'AbortError'
  return error
}
