import { MessageChannelMain, type UtilityProcess } from 'electron'
import type { Logger } from 'pino'
import type { ProcessRole, Subsystem } from '../../shared/observability/log-schema'
import type { LogCollector } from '../observability/log-collector'
import { attachUtilityLogPort } from '../observability/utility-logs'

export interface PersistentUtilityProcessFactory {
  fork(modulePath: string, args?: string[], options?: Electron.ForkOptions): UtilityProcess
}

export type UtilityMessageDecision<T> =
  | { kind: 'event' }
  | { kind: 'resolve'; value: T }
  | { kind: 'reject'; error: Error; terminate?: boolean }
  | undefined

interface PendingRequest<T> {
  readonly requestId: string
  readonly signal: AbortSignal
  readonly rejectOnAbort: Error
  readonly onMessage: (raw: unknown) => UtilityMessageDecision<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: Error) => void
  readonly onAbort: () => void
}

export class PersistentUtilityProcess {
  readonly #modulePath: string
  readonly #serviceName: string
  readonly #log: Pick<Logger, 'info' | 'warn' | 'error'>
  readonly #factory: PersistentUtilityProcessFactory
  readonly #collector?: LogCollector
  readonly #processRole?: ProcessRole
  readonly #subsystem?: Subsystem
  readonly #component?: string
  readonly #pending = new Map<string, PendingRequest<unknown>>()
  #child: UtilityProcess | undefined
  #detachLogPort: (() => void) | undefined
  #closed = false

  constructor(options: {
    modulePath: string
    serviceName: string
    log: Pick<Logger, 'info' | 'warn' | 'error'>
    factory: PersistentUtilityProcessFactory
    collector?: LogCollector
    processRole?: ProcessRole
    subsystem?: Subsystem
    component?: string
  }) {
    this.#modulePath = options.modulePath
    this.#serviceName = options.serviceName
    this.#log = options.log
    this.#factory = options.factory
    this.#collector = options.collector
    this.#processRole = options.processRole
    this.#subsystem = options.subsystem
    this.#component = options.component
  }

  request<T>(options: {
    requestId: string
    payload: unknown
    signal: AbortSignal
    rejectOnAbort: Error
    cancelPayload?: unknown
    onMessage: (raw: unknown) => UtilityMessageDecision<T>
  }): Promise<T> {
    if (options.signal.aborted) return Promise.reject(options.rejectOnAbort)
    if (this.#closed) return Promise.reject(new Error(`${this.#serviceName} is closed`))
    if (this.#pending.has(options.requestId)) {
      return Promise.reject(new Error(`${this.#serviceName} request ID is already active`))
    }

    const child = this.#ensureChild()
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        const pending = this.#pending.get(options.requestId)
        if (pending === undefined) return
        if (options.cancelPayload !== undefined) {
          try {
            child.postMessage(options.cancelPayload)
          } catch (err) {
            this.#log.error(
              {
                event: 'worker.utility.cancel_send_failed',
                err,
                requestId: options.requestId,
                serviceName: this.#serviceName
              },
              'Failed to send utility cancellation'
            )
          }
        }
        this.#pending.delete(options.requestId)
        pending.signal.removeEventListener('abort', pending.onAbort)
        reject(pending.rejectOnAbort)
      }
      const pending: PendingRequest<T> = {
        requestId: options.requestId,
        signal: options.signal,
        rejectOnAbort: options.rejectOnAbort,
        onMessage: options.onMessage,
        resolve,
        reject,
        onAbort
      }
      this.#pending.set(options.requestId, pending as PendingRequest<unknown>)
      options.signal.addEventListener('abort', onAbort, { once: true })
      try {
        child.postMessage(options.payload)
      } catch (err) {
        this.#log.error(
          { event: 'worker.utility.start_failed', err, serviceName: this.#serviceName },
          'Failed to send a utility request'
        )
        this.#finishReject(
          options.requestId,
          new Error('Utility request could not be started', { cause: err })
        )
        this.#terminate(new Error('Utility process failed while sending a request'))
      }
    })
  }

  terminate(): void {
    if (this.#closed) return
    this.#closed = true
    this.#rejectAll(new Error(`${this.#serviceName} terminated`))
    const child = this.#child
    this.#child = undefined
    this.#detachLogPort?.()
    this.#detachLogPort = undefined
    child?.kill()
  }

  #ensureChild(): UtilityProcess {
    if (this.#child !== undefined) return this.#child
    const child = this.#factory.fork(this.#modulePath, [], {
      serviceName: this.#serviceName,
      stdio: 'ignore'
    })
    if (
      this.#collector !== undefined &&
      this.#processRole !== undefined &&
      this.#subsystem !== undefined &&
      this.#component !== undefined
    ) {
      const { port1, port2 } = new MessageChannelMain()
      this.#detachLogPort = attachUtilityLogPort(port1, this.#collector, this.#log as Logger)
      try {
        child.postMessage({ type: 'logging-port' }, [port2])
      } catch (err) {
        this.#log.error(
          { event: 'worker.utility.logging_port_failed', err, serviceName: this.#serviceName },
          'Failed to attach the utility logging port'
        )
        this.#detachLogPort()
        this.#detachLogPort = undefined
      }
    }
    child.on('message', (raw: unknown) => this.#handleMessage(raw))
    child.once('exit', (code: number) => this.#handleExit(child, code))
    this.#child = child
    this.#log.info(
      { event: 'worker.utility.started', serviceName: this.#serviceName },
      'Persistent utility worker started'
    )
    return child
  }

  #handleMessage(raw: unknown): void {
    const requestId = extractRequestId(raw)
    if (requestId === undefined) {
      this.#log.error(
        {
          event: 'worker.utility.protocol_violation',
          err: new Error('Response request ID is missing'),
          serviceName: this.#serviceName
        },
        'Persistent utility worker returned a response without a request ID'
      )
      this.#terminate(new Error('Persistent utility worker protocol violation'))
      return
    }
    const pending = this.#pending.get(requestId)
    if (pending === undefined) {
      this.#log.warn(
        { event: 'worker.utility.response_stale', requestId, serviceName: this.#serviceName },
        'Persistent utility worker returned a stale response'
      )
      return
    }
    let decision: UtilityMessageDecision<unknown>
    try {
      decision = pending.onMessage(raw) as UtilityMessageDecision<unknown>
    } catch (err) {
      this.#log.error(
        {
          event: 'worker.utility.response_handler_failed',
          err,
          requestId,
          serviceName: this.#serviceName
        },
        'Persistent utility response handling failed'
      )
      this.#finishReject(requestId, new Error('Utility response handling failed', { cause: err }))
      return
    }
    if (decision === undefined || decision.kind === 'event') return
    if (decision.kind === 'resolve') {
      this.#finishResolve(requestId, decision.value)
      return
    }
    this.#finishReject(requestId, decision.error)
    if (decision.terminate === true)
      this.#terminate(new Error('Persistent utility protocol violation'))
  }

  #handleExit(child: UtilityProcess, code: number): void {
    if (this.#child !== child) return
    this.#child = undefined
    this.#detachLogPort?.()
    this.#detachLogPort = undefined
    this.#rejectAll(new Error(`${this.#serviceName} exited before responding (${code})`))
    if (!this.#closed) {
      this.#log.warn(
        { event: 'worker.utility.exited', code, serviceName: this.#serviceName },
        'Persistent utility worker exited'
      )
    }
  }

  #terminate(reason: Error): void {
    this.#rejectAll(reason)
    const child = this.#child
    this.#child = undefined
    this.#detachLogPort?.()
    this.#detachLogPort = undefined
    child?.kill()
  }

  #finishResolve(requestId: string, value: unknown): void {
    const pending = this.#pending.get(requestId)
    if (pending === undefined) return
    this.#pending.delete(requestId)
    pending.signal.removeEventListener('abort', pending.onAbort)
    pending.resolve(value)
  }

  #finishReject(requestId: string, error: Error): void {
    const pending = this.#pending.get(requestId)
    if (pending === undefined) return
    this.#pending.delete(requestId)
    pending.signal.removeEventListener('abort', pending.onAbort)
    pending.reject(error)
  }

  #rejectAll(error: Error): void {
    for (const requestId of this.#pending.keys()) this.#finishReject(requestId, error)
  }
}

function extractRequestId(value: unknown): string | undefined {
  if (
    value !== null &&
    typeof value === 'object' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(value.requestId)
  ) {
    return value.requestId
  }
  return undefined
}
