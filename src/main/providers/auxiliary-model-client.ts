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

export class AuxiliaryModelClient implements EmbeddingGateway, RerankGateway {
  constructor(
    private readonly modulePath: string,
    private readonly log: Logger,
    private readonly processFactory: UtilityProcessFactory = utilityProcess
  ) {}

  embedBatch(
    config: ProviderConfig,
    credential: string,
    rawInput: Parameters<EmbeddingGateway['embedBatch']>[2],
    signal: AbortSignal
  ): ReturnType<EmbeddingGateway['embedBatch']> {
    if (config.role !== 'embedding') return Promise.reject(new Error('Embedding role is required'))
    const request: AuxiliaryUtilityRequest = {
      operation: 'embedding',
      requestId: randomUUID(),
      config,
      credential,
      input: embeddingBatchInputSchema.parse(rawInput)
    }
    return this.run(request, signal).then((response) => {
      if (response.type !== 'embedding-result') throw new Error('Embedding response type mismatch')
      return response.result
    })
  }

  rerank(
    config: ProviderConfig,
    credential: string,
    rawInput: Parameters<RerankGateway['rerank']>[2],
    signal: AbortSignal
  ): ReturnType<RerankGateway['rerank']> {
    if (config.role !== 'rerank') return Promise.reject(new Error('Rerank role is required'))
    const request: AuxiliaryUtilityRequest = {
      operation: 'rerank',
      requestId: randomUUID(),
      config,
      credential,
      input: rerankInputSchema.parse(rawInput)
    }
    return this.run(request, signal).then((response) => {
      if (response.type !== 'rerank-result') throw new Error('Rerank response type mismatch')
      return response.result
    })
  }

  private run(
    request: AuxiliaryUtilityRequest,
    signal: AbortSignal
  ): Promise<Exclude<AuxiliaryUtilityResponse, { type: 'error' }>> {
    if (signal.aborted) return Promise.reject(abortError())
    const child = this.processFactory.fork(this.modulePath, [], {
      serviceName: 'writellm-auxiliary-model',
      stdio: 'ignore'
    })
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        child.removeListener('message', onMessage)
        child.removeListener('exit', onExit)
        operation()
      }
      const onAbort = (): void => {
        finish(() => reject(abortError()))
        child.kill()
      }
      const onExit = (code: number): void => {
        finish(() => reject(new Error(`Auxiliary model utility exited early (${code})`)))
      }
      const onMessage = (raw: unknown): void => {
        const parsed = auxiliaryUtilityResponseSchema.safeParse(raw)
        if (!parsed.success || parsed.data.requestId !== request.requestId) {
          const err = parsed.success
            ? new Error('Auxiliary response request ID mismatch')
            : parsed.error
          this.log.error(
            { event: 'auxiliary_model.response_invalid', err, requestId: request.requestId },
            'Auxiliary model utility returned an invalid response'
          )
          finish(() => reject(new Error('Auxiliary model utility returned an invalid response')))
          child.kill()
          return
        }
        const response = parsed.data
        if (response.type === 'error') {
          const err = reconstructError(response.error)
          this.log.error(
            { event: 'auxiliary_model.failed', err, requestId: request.requestId },
            'Auxiliary model request failed'
          )
          finish(() => reject(new Error('Auxiliary model request failed', { cause: err })))
          child.kill()
          return
        }
        finish(() => resolve(response))
        child.kill()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      child.once('message', onMessage)
      child.once('exit', onExit)
      try {
        child.postMessage(request)
      } catch (err) {
        this.log.error(
          { event: 'auxiliary_model.start_failed', err, requestId: request.requestId },
          'Failed to start auxiliary model utility'
        )
        finish(() => reject(new Error('Auxiliary model utility could not start', { cause: err })))
        child.kill()
      }
    })
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
