import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { AgentProviderCatalog } from '../../../../shared/contracts/providers'
import { AgentModelEffortPicker, modelEffortLabel } from './agent-model-effort-picker'
import { AgentModelPickerPanel } from './agent-model-picker-panel'

const presets: AgentProviderCatalog['presets'] = [
  {
    presetId: 'openai-codex',
    kind: 'builtin',
    providerId: 'openai-codex',
    name: 'OpenAI Codex',
    logoId: 'openai',
    logoOverrideId: null,
    enabled: true,
    canRefresh: false,
    endpointEditable: false,
    authMethods: ['api_key'],
    authConfigured: true,
    authSource: 'test',
    catalogStatus: 'packaged',
    checkedAt: null,
    lastErrorCode: null,
    models: [
      {
        id: 'gpt-5.6-sol',
        name: 'GPT 5.6 Sol',
        api: 'openai-codex-responses',
        enabled: true,
        reasoning: true,
        supportedThinkingLevels: ['low', 'high', 'xhigh'],
        input: ['text'],
        contextWindow: 200_000,
        maxTokens: 32_000,
        source: 'packaged',
        metadataVerified: true
      }
    ]
  }
]

describe('AgentModelEffortPicker', () => {
  it('uses the model name and exact lower-case effort without provider branding', () => {
    expect(modelEffortLabel('GPT 5.6 Sol', 'xhigh', ['low', 'high', 'xhigh'])).toBe(
      'GPT 5.6 Sol xhigh'
    )
    expect(modelEffortLabel('Writer model', 'off', ['off'])).toBe('Writer model')

    const html = renderToStaticMarkup(
      <AgentModelEffortPicker
        presets={presets}
        selection={{ presetId: 'openai-codex', modelId: 'gpt-5.6-sol' }}
        levels={['low', 'high', 'xhigh']}
        effort='xhigh'
        disabled={false}
        onModelSelect={vi.fn()}
        onEffortSelect={vi.fn()}
      />
    )

    expect(html).toContain('GPT 5.6 Sol xhigh')
    expect(html).not.toContain('OpenAI Codex ·')
  })

  it('does not advertise an effort choice for a non-reasoning model', () => {
    expect(modelEffortLabel('Writer model', 'off', ['off'])).toBe('Writer model')
  })
})

describe('AgentModelPickerPanel', () => {
  const secondPreset = {
    ...presets[0],
    presetId: 'local-writer',
    providerId: 'openai-compatible',
    name: 'Local Writer',
    logoId: null,
    models: [{ ...presets[0].models[0], id: 'draft-model', name: 'Draft model' }]
  } satisfies AgentProviderCatalog['presets'][number]

  it('shows a provider rail and every provider model grouped by provider', () => {
    const html = renderToStaticMarkup(
      <AgentModelPickerPanel
        presets={[...presets, secondPreset]}
        selection={{ presetId: 'local-writer', modelId: 'draft-model' }}
        onModelSelect={vi.fn()}
      />
    )

    expect(html).toContain('aria-label="Providers"')
    expect(html).toContain('aria-label="All providers"')
    expect(html).toContain('aria-label="Local Writer"')
    expect(html).toContain('GPT 5.6 Sol')
    expect(html).toContain('Draft model')
    expect(html).toContain('placeholder="Search models…"')
  })

  it('omits the provider rail when only one provider is available', () => {
    const html = renderToStaticMarkup(
      <AgentModelPickerPanel presets={presets} selection={null} onModelSelect={vi.fn()} />
    )

    expect(html).not.toContain('aria-label="Providers"')
    expect(html).toContain('GPT 5.6 Sol')
  })
})
