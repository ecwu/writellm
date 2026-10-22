import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from '../shared/contracts/providers'
import type { Api, Model } from '@earendil-works/pi-ai'
import {
  apiKeyForProvider,
  buildAgentProviderModel,
  loadAgentStreamSimple
} from './agent-provider-runtime'

const limits = {
  contextWindowTokens: 131_072,
  inputLimitTokens: null,
  outputLimitTokens: null,
  source: 'provider_metadata' as const,
  catalogModelKey: 'test/model',
  resolvedAt: '2026-08-11T00:00:00.000Z'
}

describe('shared Agent provider runtime construction', () => {
  it('disables Anthropic automatic fallback while preserving the selected model snapshot', () => {
    const provider = config('anthropic-messages', 'anthropic', 'chosen-model')
    const runtimeModel = {
      id: 'chosen-model',
      name: 'Chosen model',
      provider: 'anthropic',
      api: 'anthropic-messages' as const,
      baseUrl: provider.baseUrl,
      reasoning: true,
      input: ['text' as const],
      contextWindow: 200_000,
      maxTokens: 8_192,
      compat: {
        forceAdaptiveThinking: true,
        allowedFallbackModels: [
          {
            provider: 'anthropic',
            model: 'other-model',
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
          }
        ]
      }
    }
    const model = buildAgentProviderModel({
      config: provider,
      runtimeModel,
      modelLimits: limits,
      maxOutputTokens: 8_192
    })
    expect(model).toMatchObject({
      id: 'chosen-model',
      compat: {
        forceAdaptiveThinking: true,
        allowedFallbackModels: []
      }
    })
    expect(runtimeModel.compat.allowedFallbackModels).toHaveLength(1)
  })

  it.each([
    ['OpenAI Codex', config('openai-codex-responses', 'openai-codex', 'gpt-5.4')],
    ['Kimi', config('openai-completions', 'kimi-coding', 'kimi-k2.5')],
    ['OpenAI compatible', config('openai-completions', 'custom-openai', 'writer')]
  ])('preserves %s transport identity for session and single-shot callers', (_label, provider) => {
    const model = buildAgentProviderModel({
      config: provider,
      modelLimits: limits,
      maxOutputTokens: 8_192
    })

    expect(model).toMatchObject({
      api: provider.api,
      provider: provider.providerId,
      id: provider.model,
      baseUrl: provider.baseUrl
    })
  })

  it('uses the same bounded credential envelope semantics', () => {
    const auth = { apiKey: 'secret', headers: { 'x-account': 'account' }, env: { REGION: 'test' } }
    expect(apiKeyForProvider(auth, 'openai-codex', 'openai-codex')).toBe('secret')
    expect(apiKeyForProvider(auth, 'openai-codex', 'other')).toBeUndefined()
  })
})

function config(
  api: NonNullable<Extract<ProviderConfig, { role: 'agent' }>['api']>,
  providerId: string,
  model: string
): Extract<ProviderConfig, { role: 'agent' }> {
  return {
    role: 'agent',
    providerId,
    baseUrl: 'https://provider.example.test/v1',
    model,
    modelRevision: 'test',
    api,
    timeoutMs: 30_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null
  }
}

describe('Azure stream routing', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('routes Azure Chat Completions models through the Azure endpoint resolver', async () => {
    vi.stubEnv('AZURE_OPENAI_BASE_URL', '')
    vi.stubEnv('AZURE_OPENAI_RESOURCE_NAME', '')
    const model = {
      id: 'deepseek-v4-pro',
      name: 'DeepSeek V4 Pro',
      api: 'openai-completions',
      provider: 'azure',
      baseUrl: '',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131_072,
      maxTokens: 8_192
    } as Model<Api>
    const streamSimple = await loadAgentStreamSimple('openai-completions', 'azure')
    const result = await streamSimple(
      model,
      { messages: [{ role: 'user', content: 'hello', timestamp: 0 }] },
      { apiKey: 'azure-test-key' }
    ).result()

    // The generic transport would send the request without resolving an Azure resource.
    expect(result.stopReason).toBe('error')
    expect(result.errorMessage).toContain('Azure OpenAI base URL is required')
  })
})
