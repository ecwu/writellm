import type { Logger } from 'pino'
import { logEnvelopeSchema, type LogEnvelope } from '../../shared/observability/log-schema'
import { redactLogValue } from './redact'

const LEVEL_METHODS = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal'
} as const

export class LogCollector {
  constructor(private readonly getLogger: (envelope: LogEnvelope) => Logger) {}

  ingest(input: unknown): void {
    const envelope = logEnvelopeSchema.parse(input)
    const logger = this.getLogger(envelope)
    const err =
      envelope.error === undefined
        ? undefined
        : new Error(envelope.error.message, {
            cause: envelope.error.cause
          })
    if (err !== undefined) {
      err.name = envelope.error?.type ?? 'Error'
      if (envelope.error?.stack !== undefined) err.stack = envelope.error.stack
    }
    const fields = redactLogValue({
      event: envelope.event,
      sourceTime: envelope.sourceTime,
      processSequence: envelope.processSequence,
      ...envelope.context,
      ...envelope.fields
    }) as Record<string, unknown>
    if (err !== undefined) fields.err = err

    logger[LEVEL_METHODS[envelope.level]](fields, envelope.message)
  }
}
