import {
  autocompleteWorkerResultSchema,
  type AutocompleteWorkerRequest,
  type AutocompleteWorkerResult
} from '../../shared/contracts/autocomplete'
import type { PersistentUtilityProcess } from '../workers/persistent-utility-process'

export interface AutocompleteGateway {
  complete(
    request: AutocompleteWorkerRequest,
    signal: AbortSignal
  ): Promise<AutocompleteWorkerResult>
}
export class AutocompleteClient implements AutocompleteGateway {
  constructor(private readonly worker: PersistentUtilityProcess) {}
  complete(
    request: AutocompleteWorkerRequest,
    signal: AbortSignal
  ): Promise<AutocompleteWorkerResult> {
    return this.worker.request({
      requestId: request.requestId,
      payload: request,
      signal,
      rejectOnAbort: new Error('Autocomplete request cancelled'),
      cancelPayload: {
        type: 'cancel',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId
      },
      onMessage: (raw) => {
        const parsed = autocompleteWorkerResultSchema.safeParse(raw)
        if (
          !parsed.success ||
          parsed.data.requestId !== request.requestId ||
          parsed.data.projectSessionId !== request.projectSessionId
        ) {
          return {
            kind: 'reject',
            error: new Error('Invalid autocomplete Worker response'),
            terminate: true
          }
        }
        return { kind: 'resolve', value: parsed.data }
      }
    })
  }
}
