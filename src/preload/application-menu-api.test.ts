import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { applicationMenuApi } from './application-menu-api'
import { IPC_CHANNELS } from '../shared/contracts/channels'
const ipc = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn(), invoke: vi.fn() }))
vi.mock('electron', () => ({ ipcRenderer: ipc }))

describe('native menu preload boundary', () => {
  it('validates events and removes exactly the installed listener', () => {
    const listener = vi.fn()
    const unsubscribe = applicationMenuApi.subscribe(listener)
    const handler = ipc.on.mock.calls.at(-1)?.[1]
    const event = {
      command: { kind: 'action', action: 'onOpenSettings' },
      projectSessionId: null,
      operationId: randomUUID()
    }
    handler({}, event)
    expect(listener).toHaveBeenCalledWith(event)
    expect(() =>
      handler({}, { ...event, command: { kind: 'action', action: 'arbitrary' } })
    ).toThrow()
    unsubscribe()
    expect(ipc.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.menuCommand, handler)
  })
})
