import { AsyncLocalStorage } from 'node:async_hooks'
import type { LogContext } from '../../shared/observability/log-schema'

const logContextStorage = new AsyncLocalStorage<LogContext>()

export function withLogContext<T>(context: LogContext, callback: () => T): T {
  return logContextStorage.run(
    Object.freeze({
      ...(logContextStorage.getStore() ?? {}),
      ...context
    }),
    callback
  )
}

export function currentLogContext(): LogContext {
  return { ...(logContextStorage.getStore() ?? {}) }
}
