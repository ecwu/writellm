import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { registerAutocompleteIpc } from './autocomplete-ipc'
import { AutocompleteService } from '../providers/autocomplete-service'
import { IPC_CHANNELS } from '../../shared/contracts/channels'

function harness() {
  const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
  const manager = { assertActiveSession: vi.fn() }
  const complete = vi.fn()
  const service = new AutocompleteService({
    settings: {
      getAutocompleteDefaultEnabled: async () => false,
      setAutocompleteDefaultEnabled: async () => undefined,
      getAutocompleteStyle: async () => 'word',
      setAutocompleteStyle: async () => undefined,
      getAutocompleteSelection: async () => null,
      setAutocompleteSelection: async () => undefined
    },
    credential: async () => null,
    gateway: { complete },
    assertSection: vi.fn(),
    log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    changed: vi.fn()
  })
  const registration = registerAutocompleteIpc({
    service,
    manager: manager as never,
    developmentUrl: 'http://localhost:5173',
    ipc: {
      handle: (channel, handler) => {
        handlers.set(channel, handler)
      },
      removeHandler: (channel) => {
        handlers.delete(channel)
      }
    }
  })
  const event = {
    senderFrame: { url: 'http://localhost:5173' },
    sender: { id: 1 }
  } as IpcMainInvokeEvent
  function invoke(channel: string, sender: IpcMainInvokeEvent, input: unknown) {
    const handler = handlers.get(channel)
    if (!handler) throw new Error('Missing IPC handler')
    return handler(sender, input)
  }
  return { handlers, manager, complete, registration, event, invoke }
}
const session = { projectSessionId: '00000000-0000-4000-8000-000000000002' }
describe('Autocomplete IPC', () => {
  it('rejects untrusted senders, malformed requests and revoked projects', async () => {
    const h = harness()
    await expect(
      h.invoke(
        IPC_CHANNELS.autocompleteSession,
        { ...h.event, senderFrame: { url: 'https://evil.test' } } as IpcMainInvokeEvent,
        session
      )
    ).rejects.toThrow('Unauthorized')
    await expect(
      h.invoke(IPC_CHANNELS.autocompleteToggle, h.event, { ...session, enabled: 'true' })
    ).rejects.toThrow()
    h.manager.assertActiveSession.mockImplementation(() => {
      throw new Error('Revoked')
    })
    await expect(h.invoke(IPC_CHANNELS.autocompleteSession, h.event, session)).rejects.toThrow(
      'Revoked'
    )
    await expect(h.invoke(IPC_CHANNELS.autocompleteStyle, h.event, 'unbounded')).rejects.toThrow()
    await expect(
      h.invoke(
        IPC_CHANNELS.autocompleteStyle,
        { ...h.event, senderFrame: { url: 'https://evil.test' } } as IpcMainInvokeEvent,
        'paragraph'
      )
    ).rejects.toThrow('Unauthorized')
    expect(h.complete).not.toHaveBeenCalled()
  })
  it('validates and authorizes temporary changes and reset', async () => {
    const h = harness()
    await h.invoke(IPC_CHANNELS.autocompleteSession, h.event, session)
    await expect(
      h.invoke(IPC_CHANNELS.autocompleteDefaultEnabled, h.event, 'true')
    ).rejects.toThrow()
    await expect(
      h.invoke(IPC_CHANNELS.autocompleteSessionStyle, h.event, { ...session, style: 'long' })
    ).rejects.toThrow()
    for (const [channel, value] of [
      [IPC_CHANNELS.autocompleteSessionStyle, { ...session, style: 'sentence' }],
      [IPC_CHANNELS.autocompleteResetOverrides, session]
    ] as const) {
      await expect(
        h.invoke(channel, { ...h.event, sender: { id: 2 } } as IpcMainInvokeEvent, value)
      ).rejects.toThrow('another window')
      h.manager.assertActiveSession.mockImplementationOnce(() => {
        throw new Error('Revoked')
      })
      await expect(h.invoke(channel, h.event, value)).rejects.toThrow('Revoked')
    }
  })
  it('binds a session to its sender and removes all handlers on unregister', async () => {
    const h = harness()
    expect(await h.invoke(IPC_CHANNELS.autocompleteSession, h.event, session)).toEqual({
      defaultEnabled: false,
      overrides: { enabled: false, style: false },
      selection: null,
      style: 'word',
      enabled: false,
      available: false
    })
    await expect(
      h.invoke(
        IPC_CHANNELS.autocompleteSession,
        { ...h.event, sender: { id: 2 } } as IpcMainInvokeEvent,
        session
      )
    ).rejects.toThrow('another window')
    h.registration.revokeSession(session.projectSessionId)
    expect(
      await h.invoke(
        IPC_CHANNELS.autocompleteSession,
        { ...h.event, sender: { id: 2 } } as IpcMainInvokeEvent,
        session
      )
    ).toMatchObject({ enabled: false })
    h.registration.unregister()
    expect(h.handlers.size).toBe(0)
  })
})
