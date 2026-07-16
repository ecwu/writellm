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
