import type { IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type {
  AccentPreference,
  CitationDisplayMode,
  OnboardingState,
  ThemePreference
} from '../../shared/contracts/app'
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
  let citationDisplayMode: CitationDisplayMode = 'full'
  let onboardingState: OnboardingState = {
    schemaVersion: 1,
    status: 'pending',
    step: 'welcome'
  }
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
    }),
    getCitationDisplayMode: vi.fn(async () => citationDisplayMode),
    setCitationDisplayMode: vi.fn(async (next: CitationDisplayMode) => {
      citationDisplayMode = next
      return next
    }),
    getOnboardingState: vi.fn(async () => onboardingState),
    setOnboardingState: vi.fn(async (next: OnboardingState) => {
      onboardingState = next
      return next
    })
  }
  const presetSnapshot = {
    schemaVersion: 1 as const,
    defaultPresetId: 'builtin:academic-a4',
    presets: [
      {
        schemaVersion: 1 as const,
        presetId: 'builtin:academic-a4',
        name: 'Academic A4',
        origin: 'application' as const,
        options: {
          schemaVersion: 1 as const,
          pageSize: 'A4' as const,
          marginsMm: { top: 25, right: 25, bottom: 25, left: 25 },
          template: 'academic' as const,
          includeTableOfContents: true,
          includeReferences: true,
          mermaidFallback: 'rendered' as const
        },
        isDefault: true,
        createdAt: '2026-08-13T00:00:00.000Z',
        updatedAt: '2026-08-13T00:00:00.000Z'
      }
    ]
  }
  const publicationPresets = {
    snapshot: vi.fn(() => presetSnapshot),
    create: vi.fn(() => presetSnapshot),
    update: vi.fn(() => presetSnapshot),
    delete: vi.fn(() => presetSnapshot),
    setDefault: vi.fn(() => presetSnapshot)
  }
  const options: RegisterIpcHandlersOptions = {
    appSettings: appSettings as never,
    publicationPresets: publicationPresets as never,
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
    publicationPresets,
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

  it('authorizes and validates citation display settings', async () => {
    const { appSettings, handlers, unauthorized, invoke } = harness()

    await expect(invoke(IPC_CHANNELS.appGetCitationDisplayMode)).resolves.toBe('full')
    await expect(invoke(IPC_CHANNELS.appSetCitationDisplayMode, { mode: 'icon' })).resolves.toBe(
      'icon'
    )
    expect(appSettings.setCitationDisplayMode).toHaveBeenCalledWith('icon')
    await expect(
      Promise.resolve(handlers.get(IPC_CHANNELS.appGetCitationDisplayMode)?.(unauthorized as never))
    ).rejects.toThrow('Unauthorized IPC sender')
    await expect(
      invoke(IPC_CHANNELS.appSetCitationDisplayMode, { mode: 'compact' })
    ).rejects.toThrow()
  })

  it('authorizes and validates versioned onboarding progress', async () => {
    const { appSettings, handlers, unauthorized, invoke } = harness()

    await expect(invoke(IPC_CHANNELS.appGetOnboardingState)).resolves.toEqual({
      schemaVersion: 1,
      status: 'pending',
      step: 'welcome'
    })
    const next = { schemaVersion: 1 as const, status: 'pending' as const, step: 'mineru' as const }
    await expect(invoke(IPC_CHANNELS.appSetOnboardingState, { state: next })).resolves.toEqual(next)
    expect(appSettings.setOnboardingState).toHaveBeenCalledWith(next)
    await expect(
      invoke(IPC_CHANNELS.appSetOnboardingState, {
        state: { schemaVersion: 1, status: 'pending', step: 'image' }
      })
    ).rejects.toThrow()
    await expect(
      Promise.resolve(handlers.get(IPC_CHANNELS.appGetOnboardingState)?.(unauthorized as never))
    ).rejects.toThrow('Unauthorized IPC sender')
  })

  it('validates and routes bounded publication preset CRUD', async () => {
    const { invoke, publicationPresets } = harness()
    const options = publicationPresets.snapshot().presets[0]?.options
    if (options === undefined) throw new Error('Preset fixture missing')

    expect(invoke(IPC_CHANNELS.publicationPresetsSnapshot)).toMatchObject({
      defaultPresetId: 'builtin:academic-a4'
    })
    expect(
      invoke(IPC_CHANNELS.publicationPresetsCreate, { name: 'Custom', options })
    ).toMatchObject({ schemaVersion: 1 })
    expect(publicationPresets.create).toHaveBeenCalledWith({ name: 'Custom', options })
    expect(() =>
      invoke(IPC_CHANNELS.publicationPresetsSetDefault, { presetId: '../../../escape' })
    ).toThrow()
    expect(publicationPresets.setDefault).not.toHaveBeenCalled()
  })
})
