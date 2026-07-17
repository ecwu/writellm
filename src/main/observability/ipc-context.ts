import { randomUUID } from 'node:crypto'
import type { IpcMainInvokeEvent } from 'electron'
import { withLogContext } from './log-context'

export function withIpcLogContext<T>(
  _event: IpcMainInvokeEvent,
  input: unknown,
  callback: () => T
): T {
  const projectSessionId =
    input !== null &&
    typeof input === 'object' &&
    'projectSessionId' in input &&
    typeof input.projectSessionId === 'string'
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

export function withIpcLogging<T extends IpcMainHandleCarrier>(ipc: T): T {
  return new Proxy(ipc, {
    get(target, property, receiver) {
      if (property === 'handle') {
        return (
          channel: string,
          listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
        ) =>
          target.handle(channel, (event, ...args) =>
            withIpcLogContext(event, args[0], () => listener(event, ...args))
          )
      }
      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
}
