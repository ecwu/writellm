import { AsyncLocalStorage } from 'node:async_hooks'
import type { Logger } from 'pino'
import { serializeAgentDiagnosticError } from '../../shared/agent-diagnostic-error'
import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent } from 'electron'
import { withLogContext } from './log-context'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Shorter request strings cannot carry meaningful private text, but redacting them would
// blank every matching character run in a failure message or stack.
const MIN_PRIVATE_INPUT_CHARS = 4

export function withIpcLogContext<T>(
  _event: IpcMainInvokeEvent,
  input: unknown,
  callback: () => T
): T {
  const projectSessionId =
    input !== null &&
    typeof input === 'object' &&
    'projectSessionId' in input &&
    typeof input.projectSessionId === 'string' &&
    UUID_PATTERN.test(input.projectSessionId)
      ? input.projectSessionId
      : undefined
  return withLogContext(
    {
      requestId: randomUUID(),
      ...(projectSessionId === undefined ? {} : { projectSessionId })
    },
    callback
  )
}

export interface IpcMainHandleCarrier {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ): void
  removeHandler(channel: string): void
}

export interface IpcLoggingOptions {
  /** Expected rejections, such as a request racing a project close, are logged at warn. */
  isExpectedRejection?: (err: unknown) => boolean
}

export function withIpcLogging<T extends IpcMainHandleCarrier>(
  ipc: T,
  log: Pick<Logger, 'error' | 'warn'>,
  options: IpcLoggingOptions = {}
): T {
  return new Proxy(ipc, {
    get(target, property, receiver) {
      if (property === 'handle') {
        return (
          channel: string,
          listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
        ) =>
          target.handle(channel, (event, ...args) =>
            failureScope.run(
              {
                reported: new Set(),
                input: args[0],
                isExpectedRejection: options.isExpectedRejection
              },
              () =>
                withIpcLogContext(event, args[0], () => {
                  const failed = (err: unknown): never => {
                    reportIpcFailure(
                      log,
                      { event: 'ipc.operation.failed', err, channel },
                      'IPC operation failed'
                    )
                    throw err
                  }
                  try {
                    const result = listener(event, ...args)
                    return result instanceof Promise ? result.catch(failed) : result
                  } catch (err) {
                    return failed(err)
                  }
                })
            )
          )
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}

// Request-local diagnostic bookkeeping is not business state or recovery authority.
const failureScope = new AsyncLocalStorage<{
  reported: Set<unknown>
  input: unknown
  isExpectedRejection: IpcLoggingOptions['isExpectedRejection']
}>()

export function markIpcFailureReported(err: unknown): void {
  failureScope.getStore()?.reported.add(err)
}

function wasReported(err: unknown): boolean {
  const reported = failureScope.getStore()?.reported
  return reported !== undefined && someInCauseChain(err, (value) => reported.has(value))
}

function isExpectedRejection(err: unknown): boolean {
  const classify = failureScope.getStore()?.isExpectedRejection
  if (classify === undefined) return false
  try {
    return someInCauseChain(err, classify)
    // error-handling: allow owner=ipc-logging reason=unclassifiable-error-logs-at-error-level
  } catch {
    // An object that cannot be classified is reported at error level rather than not at all.
    return false
  }
}

function someInCauseChain(err: unknown, matches: (value: unknown) => boolean): boolean {
  let current = err
  for (let depth = 0; depth < 8; depth += 1) {
    if (matches(current)) return true
    if (current === null || typeof current !== 'object') return false
    let descriptor: PropertyDescriptor | undefined
    try {
      descriptor = Object.getOwnPropertyDescriptor(current, 'cause')
      // error-handling: allow owner=ipc-logging reason=hostile-cause-stops-classification
    } catch {
      // A hostile cause descriptor cannot suppress reporting the original thrown object.
      return false
    }
    if (descriptor === undefined || !('value' in descriptor)) return false
    current = descriptor.value
  }
  return false
}

function privateInputStrings(input: unknown): string[] {
  const values: string[] = []
  const seen = new Set<object>()
  let remaining = 256
  const visit = (value: unknown, depth: number): void => {
    if (remaining-- <= 0 || depth > 8) return
    if (typeof value === 'string') {
      if (value.length >= MIN_PRIVATE_INPUT_CHARS && !UUID_PATTERN.test(value)) values.push(value)
    } else if (value !== null && typeof value === 'object' && !seen.has(value)) {
      seen.add(value)
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value)).slice(
        0,
        256
      )) {
        if ('value' in descriptor) visit(descriptor.value, depth + 1)
      }
    }
  }
  visit(input, 0)
  return values
}

export function reportIpcFailure(
  log: Pick<Logger, 'error' | 'warn'>,
  fields: Record<string, unknown> & { err: unknown },
  message: string
): void {
  try {
    if (wasReported(fields.err)) return
    const privateBodies = privateInputStrings(failureScope.getStore()?.input)
    serializeAgentDiagnosticError(fields.err, 'ipc', { privateBodies })
    if (isExpectedRejection(fields.err)) log.warn(fields, message)
    else log.error(fields, message)
    markIpcFailureReported(fields.err)
    // error-handling: allow owner=ipc-observability reason=diagnostic-channel-failure
  } catch {
    // The diagnostic channel itself failed. Preserve the operation's original outcome.
  }
}
