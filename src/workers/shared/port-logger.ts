import type {
  LogContext,
  LogEnvelope,
  LogLevel,
  ProcessRole,
  Subsystem
} from '../../shared/observability/log-schema'
import { currentLogContext } from '../../main/observability/log-context'
import { agentDiagnosticForLogging } from '../../shared/agent-diagnostic-error'

interface LogPort {
  postMessage(message: unknown): void
}

export function createPortLogger(
  port: LogPort,
  bindings: { processRole: ProcessRole; subsystem: Subsystem; component: string },
  context: LogContext = {}
): (
  level: LogLevel,
  event: string,
  message: string,
  fields?: LogEnvelope['fields'],
  error?: unknown
) => void {
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

  return (level, event, message, fields, error) => {
    const original = error instanceof Error ? error : undefined
    const diagnostic = agentDiagnosticForLogging(error)
    const stack = diagnostic === undefined ? original?.stack : diagnostic.stack
    const envelope = {
      level,
      sourceTime: new Date().toISOString(),
      ...bindings,
      event,
      message,
      context: { ...context, ...currentLogContext() },
      fields,
      ...(original === undefined
        ? {}
        : {
            error: {
              type: (diagnostic?.name ?? original.name).slice(0, 128),
              message: (diagnostic?.message ?? original.message).slice(0, 4_096),
              ...(stack === undefined ? {} : { stack: stack.slice(0, 32_768) }),
              ...(original.cause === undefined
                ? {}
                : {
                    cause: (diagnostic === undefined
                      ? String(original.cause)
                      : JSON.stringify(diagnostic.causes)
                    ).slice(0, 4_096)
                  })
            }
          }),
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
