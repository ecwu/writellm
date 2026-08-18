import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProviderSettingsSnapshot } from '../../../../shared/contracts/providers'
import { ProviderSettingsWorkspace } from './provider-settings-dialog'

const snapshot: ProviderSettingsSnapshot = {
  credentialBackend: {
    platform: 'darwin',
    backend: 'keychain',
    encryptionAvailable: true,
    securePersistence: true,
    persistenceAllowed: true,
    warning: null
  },
  providers: [
    ['agent', 'openai-compatible', ['chat', 'tool-calling']],
    ['embedding', 'openai-compatible', ['embedding']],
    ['rerank', 'cohere-compatible', ['rerank']],
    ['mineru', 'mineru', ['parse']],
    ['image', 'openai', ['image-generation']]
  ].map(([role, providerId, capabilities]) => ({
    role,
    capability: {
      role,
      providerId,
      label: role,
      capabilities,
      supportedFormats: [],
      maxBatchSize: 1,
      maxFileSizeMb: null,
      maxPages: null
    },
    config: null,
    configured: false,
    available: false,
    issues: []
  })) as ProviderSettingsSnapshot['providers'],
  imageCatalog: {
    activeProviderId: 'openai',
    sources: [
      {
        providerId: 'google-gemini',
        label: 'Google Gemini',
        models: ['gemini-3.1-flash-image'],
        config: null,
        configured: false,
        available: false,
        active: false,
        issues: []
      },
      {
        providerId: 'openai',
        label: 'OpenAI',
        models: ['gpt-image-2'],
        config: {
          role: 'image',
          providerId: 'openai',
          model: 'gpt-image-2',
          timeoutMs: 120_000,
          embeddingDimension: null,
          batchLimit: 1,
          fileSizeLimitMb: null,
          defaultAspectRatio: 'auto',
          defaultImageSize: '1K'
        },
        configured: true,
        available: true,
        active: true,
        issues: []
      },
      {
        providerId: 'xai',
        label: 'xAI',
        models: ['grok-imagine-image-2.0'],
        config: null,
        configured: false,
        available: false,
        active: false,
        issues: []
      }
    ]
  },
  agentCatalog: { presets: [], defaultSelection: null }
}

describe('ProviderSettingsWorkspace image catalog', () => {
  it('renders all fixed sources, the active choice, and provider-neutral billing behavior', () => {
    const html = renderToStaticMarkup(
      <ProviderSettingsWorkspace
        role='image'
        snapshot={snapshot}
        closeAction={<button type='button'>Close</button>}
        onSnapshotChange={() => undefined}
        onError={() => undefined}
      />
    )

    expect(html).toContain('Google Gemini')
    expect(html).toContain('OpenAI')
    expect(html).toContain('xAI')
    expect(html).toContain('Active: OpenAI')
    expect(html).toContain('gpt-image-2')
    expect(html).toContain('Requests never fall back or rotate')
    expect(html).not.toContain('Gemini-generated')
  })
})
