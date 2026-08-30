import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentProviderCatalog } from '../../../../shared/contracts/providers'
import { AgentModelRecovery } from './agent-model-recovery'

const availablePreset: AgentProviderCatalog['presets'][number] = {
  presetId: 'custom:writer',
  kind: 'custom',
  providerId: 'writellm-custom:writer',
  name: 'Writer API',
  logoId: null,
  logoOverrideId: null,
  enabled: true,
  canRefresh: true,
  endpointEditable: true,
  baseUrl: 'https://example.test',
  api: 'openai-responses',
  authMethods: ['api_key'],
  authConfigured: true,
  authSource: 'api_key',
  catalogStatus: 'current',
  checkedAt: '2026-08-30T00:00:00.000Z',
  lastErrorCode: null,
  models: [
    {
      id: 'writer-1',
      name: 'Writer 1',
      api: 'openai-responses',
      enabled: true,
      source: 'discovered',
      reasoning: false,
      supportedThinkingLevels: ['off'],
      input: ['text'],
      contextWindow: 128_000,
      maxTokens: 8_192,
      metadataVerified: false
    }
  ]
}

describe('Agent model recovery', () => {
  it('offers an available model instead of sending a stale conversation back to setup', () => {
    const html = renderToStaticMarkup(
      <AgentModelRecovery
        presets={[availablePreset]}
        selection={{ presetId: 'custom:removed', modelId: 'removed-1' }}
        activeConversation
        disabled={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    )

    expect(html).toContain('This conversation&#x27;s model is unavailable')
    expect(html).toContain('Choose a model')
    expect(html).not.toContain('Set up an Agent model')
  })

  it('keeps setup as the empty-catalog action', () => {
    const html = renderToStaticMarkup(
      <AgentModelRecovery
        presets={[]}
        selection={null}
        activeConversation={false}
        disabled={false}
        onSelect={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    )

    expect(html).toContain('Set up an Agent model')
  })
})
