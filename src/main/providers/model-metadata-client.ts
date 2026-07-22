import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import {
  modelsDevResolveResponseSchema,
  type ModelsDevResolveRequest
} from '../../shared/contracts/model-catalog'
import type { AgentModelLimits } from '../../shared/contracts/agent'
import type {
  PersistentUtilityProcess,
  UtilityMessageDecision
} from '../workers/persistent-utility-process'

export class ModelMetadataClient {
  constructor(
    private readonly worker: PersistentUtilityProcess,
    private readonly log: Pick<Logger, 'error'>
  ) {}

  resolve(baseUrl: string, model: string, signal: AbortSignal): Promise<AgentModelLimits | null> {
    const request: ModelsDevResolveRequest = {
      operation: 'models_dev_resolve',
      requestId: randomUUID(),
      baseUrl,
      model
    }
    return this.worker.request({
      requestId: request.requestId,
      payload: request,
      signal,
      rejectOnAbort: abortError(),
      cancelPayload: { type: 'cancel', requestId: request.requestId, projectSessionId: null },
      onMessage: (raw): UtilityMessageDecision<AgentModelLimits | null> => {
        const parsed = modelsDevResolveResponseSchema.safeParse(raw)
        if (!parsed.success || parsed.data.requestId !== request.requestId) {
          const err = parsed.success
            ? new Error('models.dev response request mismatch')
            : parsed.error
          this.log.error(
            { event: 'agent.model_limits.response_invalid', err, requestId: request.requestId },
            'models.dev metadata response was invalid'
          )
          return {
            kind: 'reject',
            error: new Error('models.dev response was invalid'),
            terminate: true
          }
        }
        if (parsed.data.type === 'models-dev-error') {
          const err = new Error(parsed.data.error.message)
          err.name = parsed.data.error.name
          err.stack = parsed.data.error.stack
          return { kind: 'reject', error: err }
        }
        return { kind: 'resolve', value: parsed.data.limits }
      }
    })
  }
}

function abortError(): Error {
  const error = new Error('models.dev metadata refresh aborted')
  error.name = 'AbortError'
  return error
}
