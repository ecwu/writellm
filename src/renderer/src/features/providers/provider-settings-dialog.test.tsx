import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProviderRole, ProviderSettingsSnapshot } from '../../../../shared/contracts/providers'
import {
  changeSpeechModelMode,
  SpeechModelDiscovery,
  suggestedSpeechModelId
} from './speech-model-settings'
import { ProviderSettingsWorkspace } from './provider-settings-dialog'

const speechRole: ProviderRole = 'speech'
const snapshot: ProviderSettingsSnapshot = {
  purposeCatalog: {
    embedding: { sources: [], defaultSelection: null },
    rerank: { sources: [], defaultSelection: null },
    mineru: { sources: [], defaultSelection: null },
    speech: { sources: [], defaultSelection: null }
  },
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
        modelCandidates: [],
        catalog: { status: 'never', checkedAt: null, lastErrorCode: null },
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
        modelCandidates: [{ id: 'new-image-id', name: 'New image model' }],
        catalog: {
          status: 'stale',
          checkedAt: '2026-11-16T12:00:00.000Z',
          lastErrorCode: 'network_error'
        },
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
  speechCatalog: { activeSourceId: null, sources: [] },
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
    expect(html).toContain('Default source')
    expect(html).toContain('https://gateway.example.test/v1')
    expect(html).toContain('GPT Image 3')
    expect(html).toContain('Manage GPT Image 3')
    expect(html).toContain('Fetch models')
    expect(html).toContain('1 candidates · stale')
    expect(html).not.toContain('new-image-id')
    expect(html).toContain('Image gateway · gpt-image-2')
    expect(html).toContain('Connection')
  })

  it('shows the saved default with its connection issue when the source is unavailable', () => {
    const html = renderToStaticMarkup(
      <ProviderSettingsWorkspace
        role='image'
        snapshot={{
          ...snapshot,
          imageCatalog: {
            ...snapshot.imageCatalog,
            sources: snapshot.imageCatalog.sources.map((source) =>
              source.sourceId === 'img-gateway'
                ? { ...source, available: false, issues: ['Provider credential is missing.'] }
                : source
            )
          }
        }}
        closeAction={null}
        onSnapshotChange={() => undefined}
        onError={() => undefined}
      />
    )

    expect(html).toContain('Image gateway · gpt-image-2')
    expect(html).toContain('image-default-model-issue')
    expect(html).toContain('Provider credential is missing.')
  })

  it('renders the Vertex project and local ADC guidance without an API key field', () => {
    const vertexSnapshot: ProviderSettingsSnapshot = {
      ...snapshot,
      imageCatalog: {
        defaultSelection: { sourceId: 'vertex', modelId: 'gemini-3-pro-image' },
        sources: [
          {
            sourceId: 'vertex',
            modelCandidates: [],
            catalog: { status: 'unsupported', checkedAt: null, lastErrorCode: null },
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

describe('Speech source settings', () => {
  it('keeps saved custom IDs and distinguishes two configurations for the same model', () => {
    const source = (sourceId: string, name: string) => ({
      role: 'speech' as const,
      providerId: 'openai-compatible' as const,
      sourceId,
      name,
      enabled: true,
      authConfigured: false,
      available: true,
      issues: [],
      baseUrl: 'http://localhost:8080/v1',
      timeoutMs: 60000,
      batchLimit: 1 as const,
      fileSizeLimitMb: null,
      models: (['realtime', 'file'] as const).map((mode) => ({
        configId: mode,
        modelId: 'my-custom-speech-id',
        mode,
        enabled: true,
        modelRevision: null,
        embeddingDimension: null
      })),
      modelCandidates: [{ id: 'discovered-id', name: 'Discovered candidate' }],
      catalog: {
        status: 'current' as const,
        checkedAt: '2026-11-16T12:00:00.000Z',
        lastErrorCode: null
      }
    })
    const html = renderToStaticMarkup(
      <ProviderSettingsWorkspace
        role={speechRole}
        snapshot={{
          ...snapshot,
          purposeCatalog: {
            ...snapshot.purposeCatalog,
            speech: {
              defaultSelection: { sourceId: 'second', configId: 'file' },
              sources: [source('first', 'First speech'), source('second', 'Second speech')]
            }
          }
        }}
        closeAction={null}
        onSnapshotChange={() => undefined}
        onError={() => undefined}
      />
    )
    expect(html).toContain('First speech')
    expect(html).toContain('Second speech')
    expect(html).toContain('Default model')
    expect(html).toContain('Default source')
    expect(html).toContain('Second speech · my-custom-speech-id (File)')
    expect(html).toContain('my-custom-speech-id (Realtime)')
    expect(html).toContain('Fetch models')
    expect(html).toContain('Test connection')
    expect(html).not.toContain('gpt-live-transcribe')
  })
  it('opens an empty source workspace without choosing a default', () => {
    const html = renderToStaticMarkup(
      <ProviderSettingsWorkspace
        role={speechRole}
        snapshot={snapshot}
        closeAction={null}
        onSnapshotChange={() => undefined}
        onError={() => undefined}
      />
    )
    expect(html).toContain('No source selected')
    expect(html).toContain('Add source')
    expect(html).not.toContain('Default source')
  })
  it('uses reviewed defaults only for new uncustomized drafts', () => {
    const draft = { mode: 'realtime', modelId: suggestedSpeechModelId('realtime') } as const
    expect(draft.modelId).toBe('gpt-live-transcribe')
    expect(changeSpeechModelMode(draft, 'file', true).modelId).toBe('gpt-transcribe')
    expect(changeSpeechModelMode(draft, 'file', false).modelId).toBe('gpt-live-transcribe')
    expect(
      changeSpeechModelMode({ ...draft, modelId: 'saved-custom-id' }, 'file', true).modelId
    ).toBe('saved-custom-id')
  })
  it('keeps discovery-unavailable feedback distinct from an empty fetched catalog', () => {
    const html = renderToStaticMarkup(
      <SpeechModelDiscovery
        sourceId='first'
        catalog={{ status: 'unsupported', checkedAt: null, lastErrorCode: null }}
        onSnapshotChange={() => undefined}
        onError={() => undefined}
      />
    )
    expect(html).toContain('Model discovery is unavailable for this source.')
    expect(html).toContain('Fetch models')
  })
})
