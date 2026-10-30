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
    defaultSelection: { sourceId: 'img-gateway', modelId: 'gpt-image-2' },
    sources: [
      {
        sourceId: 'openai',
        providerId: 'openai',
        name: 'OpenAI',
        label: 'OpenAI Images',
        config: null,
        models: [],
        configured: false,
        available: false,
        issues: ['Provider credential is missing.']
      },
      {
        sourceId: 'img-gateway',
        providerId: 'openai',
        name: 'Image gateway',
        label: 'OpenAI Images',
        config: {
          role: 'image',
          providerId: 'openai',
          sourceId: 'img-gateway',
          name: 'Image gateway',
          baseUrl: 'https://gateway.example.test/v1',
          manualModels: [{ id: 'gpt-image-3', name: 'GPT Image 3', imageSizes: ['1K', '2K'] }],
          disabledModelIds: [],
          timeoutMs: 120_000,
          embeddingDimension: null,
          batchLimit: 1,
          fileSizeLimitMb: null,
          defaultAspectRatio: 'auto',
          defaultImageSize: '1K'
        },
        models: [
          {
            id: 'gpt-image-2',
            name: 'gpt-image-2',
            imageSizes: ['1K', '2K'],
            source: 'builtin',
            enabled: true
          },
          {
            id: 'gpt-image-3',
            name: 'GPT Image 3',
            imageSizes: ['1K', '2K'],
            source: 'manual',
            enabled: true
          }
        ],
        configured: true,
        available: true,
        issues: []
      }
    ]
  },
  agentCatalog: { presets: [], defaultSelection: null }
}

describe('ProviderSettingsWorkspace image catalog', () => {
  it('renders every source instance, the default source, endpoint, and manual models', () => {
    const html = renderToStaticMarkup(
      <ProviderSettingsWorkspace
        role='image'
        snapshot={snapshot}
        closeAction={<button type='button'>Close</button>}
        onSnapshotChange={() => undefined}
        onError={() => undefined}
      />
    )

    expect(html).toContain('OpenAI')
    expect(html).toContain('Image gateway')
    expect(html).toContain('not connected')
    expect(html).toContain('Default source')
    expect(html).toContain('https://gateway.example.test/v1')
    expect(html).toContain('GPT Image 3')
    expect(html).toContain('manual')
    expect(html).toContain('Requests never fall back to another model')
  })

  it('renders the Vertex project and local ADC guidance without an API key field', () => {
    const vertexSnapshot: ProviderSettingsSnapshot = {
      ...snapshot,
      imageCatalog: {
        defaultSelection: { sourceId: 'vertex', modelId: 'gemini-3-pro-image' },
        sources: [
          {
            sourceId: 'vertex',
            providerId: 'google-vertex',
            name: 'Vertex',
            label: 'Google Vertex AI',
            config: {
              role: 'image',
              providerId: 'google-vertex',
              sourceId: 'vertex',
              name: 'Vertex',
              projectId: 'writellm-images-123',
              location: 'global',
              manualModels: [],
              disabledModelIds: [],
              timeoutMs: 120_000,
              embeddingDimension: null,
              batchLimit: 1,
              fileSizeLimitMb: null,
              defaultAspectRatio: 'auto',
              defaultImageSize: '1K'
            },
            models: [
              {
                id: 'gemini-3-pro-image',
                name: 'Nano Banana Pro',
                imageSizes: ['1K', '2K'],
                source: 'builtin',
                enabled: true
              }
            ],
            configured: true,
            available: true,
            issues: []
          }
        ]
      }
    }
    const html = renderToStaticMarkup(
      <ProviderSettingsWorkspace
        role='image'
        snapshot={vertexSnapshot}
        closeAction={<button type='button'>Close</button>}
        onSnapshotChange={() => undefined}
        onError={() => undefined}
      />
    )

    expect(html).toContain('Google Cloud Project ID')
    expect(html).toContain('writellm-images-123')
    expect(html).toContain('Nano Banana Pro')
    expect(html).toContain('Application Default Credentials')
    expect(html).toContain('gcloud auth application-default login')
    expect(html).toContain('No Google credential is saved by WriteLLM')
    expect(html).toContain('roles/aiplatform.user')
    expect(html).not.toContain('type="password"')
  })
})
