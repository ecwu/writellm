import type {
  LogContext,
  LogEnvelope,
  LogLevel,
  ProcessRole,
  Subsystem
} from '../../shared/observability/log-schema'

interface LogPort {
  postMessage(message: unknown): void
}

export function createPortLogger(
  port: LogPort,
  bindings: { processRole: ProcessRole; subsystem: Subsystem; component: string },
  context: LogContext = {}
): (level: LogLevel, event: string, message: string, fields?: LogEnvelope['fields']) => void {
  let sequence = 0
  let pending: LogEnvelope[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (pending.length === 0) return
    port.postMessage(pending)
    pending = []
  }

  return (level, event, message, fields) => {
    const envelope = {
      level,
      sourceTime: new Date().toISOString(),
      ...bindings,
      event,
      message,
      context,
      fields,
      processSequence: sequence++
    } satisfies LogEnvelope

    if (level === 'error' || level === 'fatal') {
      flush()
      port.postMessage(envelope)
      return
    }

    pending.push(envelope)
    if (pending.length >= 50) {
      flush()
    } else if (timer === undefined) {
      timer = setTimeout(flush, 75)
      timer.unref()
    }
  }
}
