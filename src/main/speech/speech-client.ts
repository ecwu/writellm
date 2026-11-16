import { SpeechFailure } from '../../shared/speech-errors'
import type { Logger } from 'pino'
import type {
  SpeechWorkerStart,
  SpeechWorkerCommand,
  SpeechWorkerEvent
} from '../../shared/contracts/speech'
import { speechWorkerEventSchema } from '../../shared/contracts/speech'
import {
  PersistentUtilityProcess,
  type PersistentUtilityProcessFactory
} from '../workers/persistent-utility-process'
import type { LogCollector } from '../observability/log-collector'

export class SpeechClient {
  readonly #worker: PersistentUtilityProcess
  constructor(
    modulePath: string,
    log: Logger,
    factory: PersistentUtilityProcessFactory,
    collector?: LogCollector
  ) {
    this.#worker = new PersistentUtilityProcess({
      modulePath,
      log,
      factory,
      collector,
      args: ['--writellm-speech-only'],
      serviceName: 'writellm-speech',
      processRole: 'background-worker',
      subsystem: 'worker',
      component: 'speech'
    })
  }
  start(
    request: SpeechWorkerStart,
    signal: AbortSignal,
    event: (event: SpeechWorkerEvent) => void
  ): Promise<void> {
    return this.#worker.request<void>({
      requestId: request.requestId,
      payload: request,
      signal,
      rejectOnAbort: new Error('Speech cancelled'),
      terminateOnAbort: true,
      cancelPayload: {
        type: 'speech-cancel',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId
      },
      onMessage: (raw) => {
        const message = speechWorkerEventSchema.parse(raw)
        if (
          message.requestId !== request.requestId ||
          message.projectSessionId !== request.projectSessionId
        )
          return {
            kind: 'reject',
            error: new Error('Speech worker capability mismatch'),
            terminate: true
          }
        event(message)
        if (message.state === 'error')
          return {
            kind: 'reject',
            error: new SpeechFailure(message.error ?? 'Speech recognition failed.', {
              providerCode: message.errorCode,
              providerParam: message.errorParam
            })
          }
        return message.state === 'final' ? { kind: 'resolve', value: undefined } : { kind: 'event' }
      }
    })
  }
  send(command: SpeechWorkerCommand): void {
    this.#worker.sendToRequest(command)
  }
  reset(): void {
    this.#worker.reset()
  }
  terminate(): void {
    this.#worker.terminate()
  }
}
