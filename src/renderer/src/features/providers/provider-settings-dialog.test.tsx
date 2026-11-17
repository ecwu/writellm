import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProviderRole, ProviderSettingsSnapshot } from '../../../../shared/contracts/providers'
import { changeSpeechDraftMode, newSpeechSourceDraft } from './speech-provider-settings'
import { ModelCatalogRefresh } from './model-candidate-controls'
import { ProviderSettingsWorkspace } from './provider-settings-dialog'

const speechRole: ProviderRole = 'speech'
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
  it('keeps saved custom IDs while showing the active source and fetched candidates', () => {
    const source = (sourceId: string, name: string) => ({
      sourceId,
      name,
      configured: true,
      available: true,
      issues: [],
      config: {
        role: 'speech' as const,
        providerId: 'openai-compatible' as const,
        sourceId,
        name,
        baseUrl: 'http://localhost:8080/v1',
        model: 'my-custom-speech-id',
        mode: 'file' as const,
        timeoutMs: 60000,
        batchLimit: 1 as const,
        embeddingDimension: null,
        fileSizeLimitMb: null
      },
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
          speechCatalog: {
            activeSourceId: 'second',
            sources: [source('first', 'First speech'), source('second', 'Second speech')]
          }
        }}
        closeAction={null}
        onSnapshotChange={() => undefined}
        onError={() => undefined}
      />
    )
    expect(html).toContain('First speech')
    expect(html).toContain('Second speech')
    expect(html).toContain('Active speech source')
    expect(html).toContain('Active source')
    expect(html).toContain('my-custom-speech-id')
    expect(html).toContain('Choose discovered model')
    expect(html).toContain('1 candidates · current')
    expect(html).toContain('Test connection')
    expect(html).not.toContain('gpt-live-transcribe')
  })
  it('opens an empty source workspace without inventing an active source', () => {
    const html = renderToStaticMarkup(
      <ProviderSettingsWorkspace
        role={speechRole}
        snapshot={snapshot}
        closeAction={null}
        onSnapshotChange={() => undefined}
        onError={() => undefined}
      />
    )
    expect(html).toContain('No speech source selected')
    expect(html).toContain('Add source')
    expect(html).not.toContain('Active source')
  })
  it('uses reviewed defaults only for new uncustomized drafts', () => {
    const draft = newSpeechSourceDraft()
    expect(draft.model).toBe('gpt-live-transcribe')
    expect(changeSpeechDraftMode(draft, 'file', true).model).toBe('gpt-transcribe')
    expect(changeSpeechDraftMode(draft, 'file', false).model).toBe('gpt-live-transcribe')
    expect(changeSpeechDraftMode({ ...draft, model: 'saved-custom-id' }, 'file', true).model).toBe(
      'saved-custom-id'
    )
  })
  it('keeps discovery-unavailable feedback distinct from an empty fetched catalog', () => {
    const html = renderToStaticMarkup(
      <ModelCatalogRefresh
        candidates={[]}
        catalog={{ status: 'unsupported', checkedAt: null, lastErrorCode: null }}
        busy={false}
        disabled={false}
        onRefresh={() => undefined}
      />
    )
    expect(html).toContain('Discovery unavailable')
    expect(html).toContain('Fetch models')
  })
})
