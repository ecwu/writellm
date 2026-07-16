import { randomUUID } from 'node:crypto'
import { utilityProcess, type UtilityProcess } from 'electron'
import type { Logger } from 'pino'
import {
  providerProbeResponseSchema,
  type ProviderProbeRequest
} from '../../shared/contracts/provider-probe'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { ConnectionProbe, ConnectionProbeResult } from './provider-service'

export interface UtilityProcessFactory {
  fork(modulePath: string, args?: string[], options?: Electron.ForkOptions): UtilityProcess
}

export class ProviderProbeClient {
  constructor(
    private readonly modulePath: string,
    private readonly log: Logger,
    private readonly processFactory: UtilityProcessFactory = utilityProcess
  ) {}

  readonly probe: ConnectionProbe = (config, credential, signal) =>
    this.run(config, credential, signal)

  private run(
    config: ProviderConfig,
    credential: string,
    signal: AbortSignal
  ): Promise<ConnectionProbeResult> {
    if (signal.aborted) return Promise.reject(abortError())
    const request: ProviderProbeRequest = { requestId: randomUUID(), config, credential }
    const child = this.processFactory.fork(this.modulePath, [], {
      serviceName: 'writellm-provider-probe',
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
        finish(() => reject(new Error(`Provider probe exited before responding (${code})`)))
      }
      const onMessage = (rawResponse: unknown): void => {
        const parsed = providerProbeResponseSchema.safeParse(rawResponse)
        if (!parsed.success || parsed.data.requestId !== request.requestId) {
          const err = parsed.success
            ? new Error('Provider probe response request ID did not match')
            : parsed.error
          this.log.error(
            { event: 'provider.probe.response_invalid', err, requestId: request.requestId },
            'Provider probe returned an invalid response'
          )
          finish(() => reject(new Error('Provider probe returned an invalid response')))
          child.kill()
          return
        }
        if (parsed.data.type === 'error') {
          const err = new Error(parsed.data.error.message)
          err.name = parsed.data.error.name
          if (parsed.data.error.stack !== undefined) err.stack = parsed.data.error.stack
          this.log.error(
            { event: 'provider.probe.failed', err, requestId: request.requestId },
            'Provider probe request failed'
          )
          finish(() => reject(new Error('Provider probe request failed', { cause: err })))
          child.kill()
          return
        }
        const response = parsed.data
        finish(() =>
          resolve({
            status: response.status,
            ...(response.providerCode === undefined ? {} : { providerCode: response.providerCode })
          })
        )
        child.kill()
      }

      signal.addEventListener('abort', onAbort, { once: true })
      child.once('message', onMessage)
      child.once('exit', onExit)
      try {
        child.postMessage(request)
      } catch (err) {
        this.log.error(
          { event: 'provider.probe.start_failed', err, requestId: request.requestId },
          'Failed to start provider probe request'
        )
        finish(() => reject(new Error('Provider probe could not be started', { cause: err })))
        child.kill()
      }
    })
  }
}

function abortError(): Error {
  const error = new Error('Provider probe aborted')
  error.name = 'AbortError'
  return error
}
