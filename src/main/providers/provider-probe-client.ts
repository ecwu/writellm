import { randomUUID } from 'node:crypto'
import { utilityProcess } from 'electron'
import type { Logger } from 'pino'
import {
  providerProbeResponseSchema,
  type ProviderProbeRequest,
  type ProviderProbeResponse
} from '../../shared/contracts/provider-probe'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { ConnectionProbe, ConnectionProbeResult } from './provider-service'
import {
  PersistentUtilityProcess,
  type PersistentUtilityProcessFactory,
  type UtilityMessageDecision
} from '../workers/persistent-utility-process'

export type { PersistentUtilityProcessFactory as UtilityProcessFactory }

export class ProviderProbeClient {
  readonly #worker: PersistentUtilityProcess

  constructor(
    modulePath: string,
    private readonly log: Logger,
    processFactory: PersistentUtilityProcessFactory = utilityProcess,
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

  readonly probe: ConnectionProbe = (config, credential, signal) =>
    this.run(config, credential, signal)

  terminate(): void {
    this.#worker.terminate()
  }

  private run(
    config: ProviderConfig,
    credential: string,
    signal: AbortSignal
  ): Promise<ConnectionProbeResult> {
    if (signal.aborted) return Promise.reject(abortError())
    const request: ProviderProbeRequest = {
      requestId: randomUUID(),
      projectSessionId: null,
      config,
      credential
    }
    return this.#worker
      .request<ProviderProbeResponse>({
        requestId: request.requestId,
        payload: request,
        signal,
        rejectOnAbort: abortError(),
        cancelPayload: {
          type: 'cancel',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId
        },
        onMessage: (raw) => this.#handleResponse(raw, request.requestId)
      })
      .then((response) => {
        if (response.type === 'error') throw new Error('Provider probe returned an error response')
        return {
          status: response.status,
          ...(response.providerCode === undefined ? {} : { providerCode: response.providerCode })
        }
      })
  }

  #handleResponse(raw: unknown, requestId: string): UtilityMessageDecision<ProviderProbeResponse> {
    const parsed = providerProbeResponseSchema.safeParse(raw)
    if (
      !parsed.success ||
      parsed.data.requestId !== requestId ||
      (parsed.data.projectSessionId ?? null) !== null
    ) {
      const err = parsed.success
        ? new Error('Provider probe response request ID or project session did not match')
        : parsed.error
      this.log.error(
        { event: 'provider.probe.response_invalid', err, requestId },
        'Provider probe returned an invalid response'
      )
      return {
        kind: 'reject',
        error: new Error('Provider probe returned an invalid response'),
        terminate: true
      }
    }
    if (parsed.data.type === 'error') {
      const err = new Error(parsed.data.error.message)
      err.name = parsed.data.error.name
      if (parsed.data.error.stack !== undefined) err.stack = parsed.data.error.stack
      this.log.error(
        { event: 'provider.probe.failed', err, requestId },
        'Provider probe request failed'
      )
      return { kind: 'reject', error: new Error('Provider probe request failed', { cause: err }) }
    }
    return { kind: 'resolve', value: parsed.data }
  }
}

function abortError(): Error {
  const error = new Error('Provider probe aborted')
  error.name = 'AbortError'
  return error
}
