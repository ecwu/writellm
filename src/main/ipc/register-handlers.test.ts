import type { IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { AccentPreference, ThemePreference } from '../../shared/contracts/app'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import {
  registerIpcHandlers,
  type AppIpcMain,
  type RegisterIpcHandlersOptions
} from './register-handlers'

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipc: AppIpcMain = {
    handle: (channel, handler) => handlers.set(channel, handler as never),
    removeHandler: vi.fn()
  }
  let preference: ThemePreference = 'system'
  let accent: AccentPreference = 'neutral'
  const appSettings = {
    getThemePreference: vi.fn(async () => preference),
    setThemePreference: vi.fn(async (next: ThemePreference) => {
      preference = next
      return next
    }),
    getAccentPreference: vi.fn(async () => accent),
    setAccentPreference: vi.fn(async (next: AccentPreference) => {
      accent = next
      return next
    })
  }
  const options: RegisterIpcHandlersOptions = {
    appSettings: appSettings as never,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc
  }
  registerIpcHandlers(options)
  const event = {
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent

  return {
    appSettings,
    event,
    handlers,
    invoke: (channel: string, input?: unknown) =>
      handlers.get(channel)?.(event as never, input as never),
    unauthorized: {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
  }
}

describe('application IPC', () => {
  it('reads and validates the persisted theme preference', async () => {
    const { appSettings, invoke } = harness()

    await expect(invoke(IPC_CHANNELS.appGetThemePreference)).resolves.toBe('system')
    await expect(invoke(IPC_CHANNELS.appSetThemePreference, { preference: 'dark' })).resolves.toBe(
      'dark'
    )
    expect(appSettings.setThemePreference).toHaveBeenCalledWith('dark')
    await expect(invoke(IPC_CHANNELS.appGetThemePreference)).resolves.toBe('dark')
  })

  it('authorizes the sender and validates theme input before accessing settings', async () => {
    const { appSettings, handlers, unauthorized, invoke } = harness()

    await expect(
      Promise.resolve(handlers.get(IPC_CHANNELS.appGetThemePreference)?.(unauthorized as never))
    ).rejects.toThrow('Unauthorized IPC sender')
    await expect(
      invoke(IPC_CHANNELS.appSetThemePreference, { preference: 'sepia' })
    ).rejects.toThrow()
    expect(appSettings.getThemePreference).not.toHaveBeenCalled()
    expect(appSettings.setThemePreference).not.toHaveBeenCalled()
  })

  it('reads and validates the persisted accent preference', async () => {
    const { appSettings, invoke } = harness()

    await expect(invoke(IPC_CHANNELS.appGetAccentPreference)).resolves.toBe('neutral')
    await expect(
      invoke(IPC_CHANNELS.appSetAccentPreference, { preference: 'green' })
    ).resolves.toBe('green')
    expect(appSettings.setAccentPreference).toHaveBeenCalledWith('green')
  })
})
