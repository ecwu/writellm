import type { IpcMainInvokeEvent } from 'electron'
import type { AuthInteraction, AuthType } from '@earendil-works/pi-ai'
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
  ],
  imageCatalog: { defaultSelection: null, sources: [] },
  agentCatalog: { presets: [], defaultSelection: null }
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
    saveImageSource: vi.fn(async () => snapshot),
    removeImageSource: vi.fn(async () => snapshot),
    testImageSource: vi.fn(async () => ({
      ok: true,
      code: 'connected' as const,
      message: 'Connection succeeded.',
      durationMs: 4
    })),
    setImageDefaultSelection: vi.fn(async () => snapshot),
    saveImageManualModel: vi.fn(async () => snapshot),
    removeImageManualModel: vi.fn(async () => snapshot),
    setImageModelEnabled: vi.fn(async () => snapshot),
    testConnection: vi.fn(async () => ({
      ok: true,
      code: 'connected' as const,
      message: 'Connection succeeded.',
      durationMs: 4
    })),
    loginAgentPreset: vi.fn(
      async (_presetId: string, _type: AuthType, _interaction: AuthInteraction) => snapshot
    ),
    saveAgentCustomPreset: vi.fn(async () => snapshot),
    clearAgentCredential: vi.fn(async () => snapshot),
    setAgentProviderEnabled: vi.fn(async () => snapshot),
    setAgentModelEnabled: vi.fn(async () => snapshot),
    saveAgentManualModel: vi.fn(async () => snapshot),
    removeAgentManualModel: vi.fn(async () => snapshot)
  }
  registerProviderIpc({
    providers: providers as never,
    logger: pino({ level: 'silent' }),
    developmentUrl: 'http://localhost:5173',
    ipc,
    openExternal: vi.fn(async () => undefined)
  })
  const send = vi.fn()
  const event = {
    senderFrame: { url: 'http://localhost:5173/' },
    sender: { id: 7, send }
  } as unknown as IpcMainInvokeEvent
  return {
    providers,
    invoke: (channel: string, input?: unknown) =>
      handlers.get(channel)?.(event as never, input as never),
    unauthorized: {
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent,
    handlers,
    send
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

  it('accepts remote HTTP endpoints through the save contract', async () => {
    const { invoke, providers } = harness()
    const config = { ...snapshot.providers[0]?.config, baseUrl: 'http://remote.invalid:8080/v1' }
    await invoke(IPC_CHANNELS.providersSave, { config, apiKey: 'secret' })
    expect(providers.save).toHaveBeenCalledWith(config, 'secret')
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
        config: { ...snapshot.providers[0]?.config, baseUrl: 'ftp://remote.invalid' },
        apiKey: 'secret'
      })
    ).rejects.toThrow()
    expect(providers.remove).not.toHaveBeenCalled()
    expect(providers.save).not.toHaveBeenCalled()
  })

  it('routes image sources only through validated image source channels', async () => {
    const { invoke, providers } = harness()
    await expect(invoke(IPC_CHANNELS.providersRemove, { role: 'image' })).rejects.toThrow()
    await expect(
      invoke(IPC_CHANNELS.providersTestConnection, { role: 'image', providerId: 'openai' })
    ).rejects.toThrow()

    await invoke(IPC_CHANNELS.providersSaveImageSource, {
      source: { providerId: 'openai', name: 'Gateway', baseUrl: 'https://gateway.example.test/v1' },
      apiKey: 'gateway-secret'
    })
    expect(providers.saveImageSource).toHaveBeenCalledWith({
      source: { providerId: 'openai', name: 'Gateway', baseUrl: 'https://gateway.example.test/v1' },
      apiKey: 'gateway-secret'
    })
    await expect(
      invoke(IPC_CHANNELS.providersSaveImageSource, {
        source: { providerId: 'google-gemini', name: 'Gemini', baseUrl: 'https://proxy.test' }
      })
    ).rejects.toThrow()
    await expect(
      invoke(IPC_CHANNELS.providersSaveImageSource, {
        source: { providerId: 'google-vertex', name: 'Vertex', projectId: 'writellm-images-1' },
        apiKey: 'must-not-be-sent'
      })
    ).rejects.toThrow()
    await expect(
      invoke(IPC_CHANNELS.providersSaveImageSource, {
        source: { providerId: 'custom', name: 'Unknown' }
      })
    ).rejects.toThrow()

    await invoke(IPC_CHANNELS.providersRemoveImageSource, { sourceId: 'img-1' })
    expect(providers.removeImageSource).toHaveBeenCalledWith('img-1')
    await invoke(IPC_CHANNELS.providersTestImageSource, { sourceId: 'img-1' })
    expect(providers.testImageSource).toHaveBeenCalledWith('img-1', undefined)
    await invoke(IPC_CHANNELS.providersSetImageDefault, {
      sourceId: 'img-1',
      modelId: 'gpt-image-2'
    })
    expect(providers.setImageDefaultSelection).toHaveBeenCalledWith({
      sourceId: 'img-1',
      modelId: 'gpt-image-2'
    })
    await invoke(IPC_CHANNELS.providersSetImageDefault, null)
    expect(providers.setImageDefaultSelection).toHaveBeenLastCalledWith(null)
    await expect(
      invoke(IPC_CHANNELS.providersSetImageDefault, { sourceId: '../escape', modelId: 'x' })
    ).rejects.toThrow()

    await invoke(IPC_CHANNELS.providersSaveImageManualModel, {
      sourceId: 'img-1',
      model: { id: 'gpt-image-3', name: 'GPT Image 3', imageSizes: ['1K', '2K'] }
    })
    expect(providers.saveImageManualModel).toHaveBeenCalledWith('img-1', {
      id: 'gpt-image-3',
      name: 'GPT Image 3',
      imageSizes: ['1K', '2K']
    })
    await expect(
      invoke(IPC_CHANNELS.providersSaveImageManualModel, {
        sourceId: 'img-1',
        model: { id: 'gpt-image-3', name: 'No 1K', imageSizes: ['2K'] }
      })
    ).rejects.toThrow()
    await invoke(IPC_CHANNELS.providersSetImageModelEnabled, {
      sourceId: 'img-1',
      modelId: 'gpt-image-2',
      enabled: false
    })
    expect(providers.setImageModelEnabled).toHaveBeenCalledWith('img-1', 'gpt-image-2', false)
    await invoke(IPC_CHANNELS.providersRemoveImageManualModel, {
      sourceId: 'img-1',
      modelId: 'gpt-image-3'
    })
    expect(providers.removeImageManualModel).toHaveBeenCalledWith('img-1', 'gpt-image-3')
  })

  it('validates and forwards Agent availability and manual model updates', async () => {
    const { invoke, providers } = harness()
    await invoke(IPC_CHANNELS.providersSetAgentProviderEnabled, {
      presetId: 'custom:loopback',
      enabled: false
    })
    await invoke(IPC_CHANNELS.providersSetAgentModelEnabled, {
      presetId: 'custom:loopback',
      modelId: 'writer-1',
      enabled: false
    })
    await invoke(IPC_CHANNELS.providersSaveAgentManualModel, {
      presetId: 'custom:loopback',
      model: {
        id: 'manual-writer',
        name: 'Manual Writer',
        api: 'openai-responses',
        contextWindow: 131_072,
        maxTokens: 8_192,
        reasoning: false,
        input: ['text']
      }
    })

    expect(providers.setAgentProviderEnabled).toHaveBeenCalledWith('custom:loopback', false)
    expect(providers.setAgentModelEnabled).toHaveBeenCalledWith(
      'custom:loopback',
      'writer-1',
      false
    )
    expect(providers.saveAgentManualModel).toHaveBeenCalledWith(
      'custom:loopback',
      expect.objectContaining({ id: 'manual-writer', contextWindow: 131_072 })
    )

    await expect(
      invoke(IPC_CHANNELS.providersSaveAgentManualModel, {
        presetId: 'custom:loopback',
        model: {
          id: '',
          api: 'openai-responses',
          contextWindow: 0,
          maxTokens: 0,
          reasoning: false,
          input: []
        }
      })
    ).rejects.toThrow()
  })

  it('validates and forwards only packaged custom Provider logo overrides', async () => {
    const { invoke, providers } = harness()
    const input = {
      name: 'DeepSeek proxy',
      logoOverrideId: 'deepseek',
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions',
      authMode: 'api_key',
      timeoutMs: 30_000
    }
    await invoke(IPC_CHANNELS.providersSaveAgentPreset, input)
    expect(providers.saveAgentCustomPreset).toHaveBeenCalledWith(input)

    await expect(
      invoke(IPC_CHANNELS.providersSaveAgentPreset, {
        ...input,
        logoOverrideId: 'https://attacker.invalid/logo.svg'
      })
    ).rejects.toThrow()
    expect(providers.saveAgentCustomPreset).toHaveBeenCalledTimes(1)
  })

  it('brokers a request-scoped OAuth prompt without exposing the credential', async () => {
    const { invoke, providers, send } = harness()
    providers.loginAgentPreset.mockImplementationOnce(async (_presetId, _type, interaction) => {
      interaction.notify({
        type: 'device_code',
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://login.example.test/device'
      })
      const code = await interaction.prompt({
        type: 'manual_code',
        message: 'Paste the returned code'
      })
      expect(code).toBe('oauth-result-code')
      return snapshot
    })
    const flowId = '019c6a5c-8d34-7a8e-a602-3d37a52dc499'
    const login = Promise.resolve(
      invoke(IPC_CHANNELS.providersLoginAgentPreset, {
        flowId,
        presetId: 'builtin:anthropic',
        type: 'oauth'
      })
    )
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2))
    const prompt = send.mock.calls[1]?.[1] as { promptId: string }
    await invoke(IPC_CHANNELS.providersRespondAgentAuth, {
      flowId,
      promptId: prompt.promptId,
      value: 'oauth-result-code'
    })
    const result = await login
    expect(providers.loginAgentPreset).toHaveBeenCalledWith(
      'builtin:anthropic',
      'oauth',
      expect.any(Object)
    )
    expect(JSON.stringify(result)).not.toContain('oauth-result-code')
  })
})
