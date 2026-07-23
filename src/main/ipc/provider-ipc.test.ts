import type { IpcMainInvokeEvent } from 'electron'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { ProviderSettingsSnapshot } from '../../shared/contracts/providers'
import { registerProviderIpc, type ProviderIpcMain } from './provider-ipc'

function emptyStatus(
  role: 'embedding' | 'rerank' | 'mineru' | 'image'
): ProviderSettingsSnapshot['providers'][number] {
  const capabilities: ProviderSettingsSnapshot['providers'][number]['capability']['capabilities'] =
    role === 'embedding'
      ? ['embedding']
      : role === 'rerank'
        ? ['rerank']
        : role === 'image'
          ? ['image-generation']
          : ['parse']
  return {
    role,
    capability: {
      role,
      providerId:
        role === 'rerank'
          ? 'cohere-compatible'
          : role === 'mineru'
            ? 'mineru'
            : role === 'image'
              ? 'google-gemini'
              : 'openai-compatible',
      label: role,
      capabilities,
      supportedFormats: [],
      maxBatchSize: 100,
      maxFileSizeMb: null,
      maxPages: null
    },
    config: null,
    configured: false,
    available: false,
    issues: []
  }
}

const snapshot: ProviderSettingsSnapshot = {
  credentialBackend: {
    platform: 'linux',
    backend: 'kwallet6',
    encryptionAvailable: true,
    securePersistence: true,
    persistenceAllowed: true,
    warning: null
  },
  providers: [
    {
      role: 'agent',
      capability: {
        role: 'agent',
        providerId: 'openai-compatible',
        label: 'Agent model',
        capabilities: ['chat', 'tool-calling'],
        supportedFormats: [],
        maxBatchSize: 1,
        maxFileSizeMb: null,
        maxPages: null
      },
      config: {
        role: 'agent',
        providerId: 'openai-compatible',
        baseUrl: 'https://api.example.test/v1',
        model: 'writer',
        modelRevision: 'writer-rev-1',
        timeoutMs: 60_000,
        embeddingDimension: null,
        batchLimit: 1,
        fileSizeLimitMb: null
      },
      configured: true,
      available: true,
      issues: []
    },
    ...(['embedding', 'rerank', 'mineru', 'image'] as const).map(emptyStatus)
  ]
}

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipc: ProviderIpcMain = {
    handle: (channel, handler) => handlers.set(channel, handler as never),
    removeHandler: vi.fn()
  }
  const providers = {
    snapshot: vi.fn(async () => snapshot),
    save: vi.fn(async () => snapshot),
    remove: vi.fn(async () => snapshot),
    testConnection: vi.fn(async () => ({
      ok: true,
      code: 'connected' as const,
      message: 'Connection succeeded.',
      durationMs: 4
    }))
  }
  registerProviderIpc({
    providers: providers as never,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc
  })
  const event = {
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  return {
    providers,
    invoke: (channel: string, input?: unknown) =>
      handlers.get(channel)?.(event as never, input as never),
    unauthorized: {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent,
    handlers
  }
}

describe('provider IPC', () => {
  it('returns renderer-safe status and never echoes a saved secret', async () => {
    const { invoke, providers } = harness()
    const result = await invoke(IPC_CHANNELS.providersSave, {
      config: snapshot.providers[0]?.config,
      apiKey: 'renderer-secret'
    })

    expect(providers.save).toHaveBeenCalledWith(snapshot.providers[0]?.config, 'renderer-secret')
    expect(JSON.stringify(result)).not.toContain('renderer-secret')
  })

  it('authorizes the sender before reading status', async () => {
    const { handlers, providers, unauthorized } = harness()
    await expect(
      Promise.resolve(handlers.get(IPC_CHANNELS.providersSnapshot)?.(unauthorized as never))
    ).rejects.toThrow('Unauthorized IPC sender')
    expect(providers.snapshot).not.toHaveBeenCalled()
  })

  it('validates role and configuration inputs before service calls', async () => {
    const { invoke, providers } = harness()
    await expect(invoke(IPC_CHANNELS.providersRemove, { role: 'unknown' })).rejects.toThrow()
    await expect(
      invoke(IPC_CHANNELS.providersSave, {
        config: { ...snapshot.providers[0]?.config, baseUrl: 'http://remote.invalid' },
        apiKey: 'secret'
      })
    ).rejects.toThrow()
    expect(providers.remove).not.toHaveBeenCalled()
    expect(providers.save).not.toHaveBeenCalled()
  })
})
