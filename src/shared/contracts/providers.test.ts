import { describe, expect, it } from 'vitest'
import { getProviderCapability } from '../../main/providers/capability-registry'
import { SUPPORTED_KNOWLEDGE_EXTENSIONS } from './knowledge'
import {
  agentCustomPresetInputSchema,
  agentModelSummarySchema,
  agentThinkingLevelSchema,
  BUILTIN_IMAGE_MODELS,
  effectiveImageSize,
  imageProviderCatalogSchema,
  imageSourceConfigSchema,
  imageSourceSaveInputSchema,
  providerBaseUrlSchema,
  providerConfigSchema,
  providerSaveInputSchema
} from './providers'

describe('provider contracts', () => {
  it('bounds the unified Agent Thinking levels and model capability projection', () => {
    expect(agentThinkingLevelSchema.options).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'xhigh',
      'max'
    ])
    expect(agentThinkingLevelSchema.safeParse('extreme').success).toBe(false)
    expect(
      agentModelSummarySchema.parse({
        id: 'writer',
        name: 'Writer',
        api: 'openai-responses',
        enabled: true,
        source: 'packaged',
        reasoning: true,
        supportedThinkingLevels: ['off', 'medium', 'max'],
        input: ['text'],
        contextWindow: 131_072,
        maxTokens: 8_192,
        metadataVerified: true
      }).supportedThinkingLevels
    ).toEqual(['off', 'medium', 'max'])
  })

  it('keeps Vertex on the global location with local ADC only', () => {
    const vertex = {
      role: 'image' as const,
      providerId: 'google-vertex' as const,
      sourceId: 'vertex',
      name: 'Vertex',
      projectId: 'writellm-images-123',
      location: 'global' as const,
      manualModels: [],
      disabledModelIds: [],
      timeoutMs: 120_000,
      embeddingDimension: null,
      batchLimit: 1,
      fileSizeLimitMb: null,
      defaultAspectRatio: 'auto' as const,
      defaultImageSize: '1K' as const
    }
    expect(imageSourceConfigSchema.safeParse(vertex).success).toBe(true)
    expect(
      imageSourceConfigSchema.safeParse({ ...vertex, projectId: 'Invalid Project' }).success
    ).toBe(false)
    expect(imageSourceConfigSchema.safeParse({ ...vertex, location: 'us-central1' }).success).toBe(
      false
    )
    expect(
      imageSourceConfigSchema.safeParse({ ...vertex, baseUrl: 'https://vertex-proxy.example.test' })
        .success
    ).toBe(false)
    const draft = { providerId: 'google-vertex', name: 'Vertex', projectId: 'writellm-images-123' }
    expect(imageSourceSaveInputSchema.safeParse({ source: draft }).success).toBe(true)
    expect(
      imageSourceSaveInputSchema.safeParse({ source: draft, apiKey: 'must-not-be-accepted' })
        .success
    ).toBe(false)
    expect(
      BUILTIN_IMAGE_MODELS['google-vertex'].map((model) => [model.id, model.imageSizes])
    ).toEqual([
      ['gemini-2.5-flash-image', ['1K']],
      ['gemini-3-pro-image', ['1K', '2K']],
      ['gemini-3.1-flash-image', ['1K', '2K']]
    ])
  })

  it('accepts custom Agent Providers without the legacy generation timeout', () => {
    const custom = {
      name: 'No deadline proxy',
      baseUrl: 'https://api.example.test',
      api: 'openai-completions' as const,
      authMode: 'api_key' as const
    }
    expect(agentCustomPresetInputSchema.safeParse(custom).success).toBe(true)
    expect(agentCustomPresetInputSchema.parse(custom)).not.toHaveProperty('timeoutMs')
  })

  it('accepts only packaged models.dev logo overrides for custom Agent Providers', () => {
    const custom = {
      name: 'DeepSeek proxy',
      baseUrl: 'https://api.deepseek.com',
      api: 'openai-completions' as const,
      authMode: 'api_key' as const,
      timeoutMs: 30_000
    }
    expect(
      agentCustomPresetInputSchema.safeParse({ ...custom, logoOverrideId: 'deepseek' }).success
    ).toBe(true)
    expect(
      agentCustomPresetInputSchema.safeParse({ ...custom, logoOverrideId: null }).success
    ).toBe(true)
    expect(
      agentCustomPresetInputSchema.safeParse({ ...custom, logoOverrideId: 'remote-provider' })
        .success
    ).toBe(false)
  })

  it.each([
    'https://api.example.test/v1',
    'http://luoluo.ucd.ie:8080',
    'http://api.example.test/v1',
    'http://100-api.example.test',
    'http://8.8.8.8:8080/v1',
    'http://172.16.0.2:1234/v1',
    'http://localhost:8080/v1',
    'http://127.0.0.1:1234/v1',
    'http://192.168.1.20:1234/v1',
    'http://100.96.1.104:1234/v1',
    'http://10.0.0.8:1234/v1',
    'http://[::1]:8080/v1',
    'http://[2001:db8::1]:8080/v1'
  ])('accepts and normalizes model-service endpoint %s', (baseUrl) => {
    const base = {
      model: 'writer',
      modelRevision: 'writer-rev-1',
      timeoutMs: 30_000,
      batchLimit: 1,
      embeddingDimension: null,
      fileSizeLimitMb: null,
      baseUrl: `${baseUrl}/`
    }
    for (const config of [
      { ...base, role: 'agent', providerId: 'openai-compatible' },
      { ...base, role: 'embedding', providerId: 'openai-compatible', embeddingDimension: 8 },
      { ...base, role: 'rerank', providerId: 'cohere-compatible' }
    ]) {
      expect(providerConfigSchema.parse(config)).toMatchObject({ baseUrl })
    }
    expect(
      agentCustomPresetInputSchema.parse({
        name: 'HTTP model',
        baseUrl: `${baseUrl}/`,
        api: 'openai-completions',
        authMode: 'none'
      })
    ).toMatchObject({ baseUrl })
  })

  it.each([
    'ftp://api.example.test',
    'file:///tmp/model',
    'not a URL',
    'http://key:secret@example.test',
    'https://key@example.test',
    'http://example.test?key=secret',
    'https://example.test#fragment',
    `http://example.test/${'x'.repeat(2_048)}`
  ])('rejects invalid model-service endpoint %s', (baseUrl) => {
    expect(providerBaseUrlSchema.safeParse(baseUrl).success).toBe(false)
  })

  it('retains the MinerU HTTP host restrictions', () => {
    const base = {
      role: 'mineru',
      providerId: 'mineru',
      model: 'vlm',
      timeoutMs: 30_000,
      batchLimit: 1,
      embeddingDimension: null,
      fileSizeLimitMb: 100
    }
    for (const baseUrl of [
      'https://mineru.example.test',
      'http://localhost:8080',
      'http://[::1]:8080',
      'http://10.0.0.8',
      'http://100.96.1.104',
      'http://127.0.0.1',
      'http://192.168.1.20'
    ])
      expect(providerConfigSchema.safeParse({ ...base, baseUrl }).success).toBe(true)
    for (const baseUrl of [
      'http://mineru.example.test',
      'http://8.8.8.8',
      'http://172.16.0.2',
      'http://100-api.example.test',
      'http://[2001:db8::1]'
    ])
      expect(providerConfigSchema.safeParse({ ...base, baseUrl }).success).toBe(false)
  })

  it('enforces embedding and MinerU role-specific capabilities', () => {
    const mineru = {
      role: 'mineru' as const,
      providerId: 'mineru' as const,
      baseUrl: 'https://mineru.net',
      model: 'vlm',
      timeoutMs: 60_000,
      embeddingDimension: null,
      batchLimit: 200,
      fileSizeLimitMb: 200
    }
    expect(providerConfigSchema.safeParse(mineru).success).toBe(true)
    const legacy = providerConfigSchema.parse({ ...mineru, modelRevision: 'legacy-revision' })
    expect('modelRevision' in legacy).toBe(false)
    expect(providerConfigSchema.safeParse({ ...mineru, batchLimit: 201 }).success).toBe(false)
    expect(providerConfigSchema.safeParse({ ...mineru, model: 'unknown' }).success).toBe(false)
  })

  it('requires model revisions only for model-runtime providers', () => {
    const base = {
      role: 'agent' as const,
      providerId: 'openai-compatible' as const,
      baseUrl: 'https://api.example.test',
      model: 'writer',
      timeoutMs: 30_000,
      embeddingDimension: null,
      batchLimit: 1,
      fileSizeLimitMb: null
    }
    expect(providerConfigSchema.safeParse(base).success).toBe(false)
    expect(
      providerConfigSchema.safeParse({
        ...base,
        role: 'mineru',
        providerId: 'mineru',
        baseUrl: 'https://mineru.net',
        model: 'vlm',
        batchLimit: 200,
        fileSizeLimitMb: 200
      }).success
    ).toBe(true)
  })

  it('accepts endpoints only for OpenAI-compatible image source instances', () => {
    expect(
      imageSourceSaveInputSchema.safeParse({
        source: {
          providerId: 'openai',
          name: 'Gateway',
          baseUrl: 'https://gateway.example.test/v1/'
        }
      })
    ).toMatchObject({
      success: true,
      data: { source: { baseUrl: 'https://gateway.example.test/v1' } }
    })
    expect(
      imageSourceSaveInputSchema.safeParse({
        source: { providerId: 'xai', name: 'xAI', baseUrl: 'https://user:pass@x.example.test' }
      }).success
    ).toBe(false)
    expect(
      imageSourceSaveInputSchema.safeParse({
        source: { providerId: 'google-gemini', name: 'Gemini', baseUrl: 'https://proxy.test' }
      }).success
    ).toBe(false)
    expect(
      imageSourceSaveInputSchema.safeParse({ source: { providerId: 'custom', name: 'Other' } })
        .success
    ).toBe(false)
    expect(
      providerSaveInputSchema.safeParse({
        config: {
          role: 'image',
          providerId: 'openai',
          sourceId: 'openai',
          model: 'gpt-image-2',
          imageSizes: ['1K'],
          timeoutMs: 120_000,
          embeddingDimension: null,
          batchLimit: 1,
          fileSizeLimitMb: null,
          defaultAspectRatio: 'auto',
          defaultImageSize: '1K'
        }
      }).success
    ).toBe(false)
  })

  it('validates manual image models and clamps unsupported sizes to 1K', () => {
    const source = {
      role: 'image' as const,
      providerId: 'google-gemini' as const,
      sourceId: 'gemini',
      name: 'Gemini',
      manualModels: [{ id: 'gemini-next-image', name: 'Next', imageSizes: ['1K', '2K'] }],
      disabledModelIds: ['gemini-2.5-flash-image'],
      timeoutMs: 120_000,
      embeddingDimension: null,
      batchLimit: 1,
      fileSizeLimitMb: null,
      defaultAspectRatio: 'auto' as const,
      defaultImageSize: '1K' as const
    }
    expect(imageSourceConfigSchema.safeParse(source).success).toBe(true)
    for (const manualModels of [
      [{ id: 'gemini-3-pro-image', name: 'Built-in clash', imageSizes: ['1K'] }],
      [
        { id: 'dup', name: 'One', imageSizes: ['1K'] },
        { id: 'dup', name: 'Two', imageSizes: ['1K'] }
      ],
      [{ id: 'only-2k', name: 'Only 2K', imageSizes: ['2K'] }],
      [{ id: 'four-k', name: '4K', imageSizes: ['1K', '4K'] }]
    ]) {
      expect(imageSourceConfigSchema.safeParse({ ...source, manualModels }).success).toBe(false)
    }
    expect(imageSourceConfigSchema.safeParse({ ...source, model: 'legacy' }).success).toBe(false)
    expect(effectiveImageSize(['1K', '2K'], '2K')).toBe('2K')
    expect(effectiveImageSize(['1K'], '2K')).toBe('1K')
    expect(
      providerConfigSchema.safeParse({
        role: 'image',
        providerId: 'xai',
        sourceId: 'xai',
        model: 'grok-imagine-image-next',
        imageSizes: ['1K', '2K'],
        baseUrl: 'https://xai-proxy.example.test/v1',
        timeoutMs: 120_000,
        embeddingDimension: null,
        batchLimit: 1,
        fileSizeLimitMb: null,
        defaultAspectRatio: 'auto',
        defaultImageSize: '1K'
      }).success
    ).toBe(true)
  })

  it('rejects image catalog snapshots with duplicate or mismatched sources', () => {
    const source = {
      sourceId: 'img-1',
      providerId: 'openai' as const,
      name: 'OpenAI',
      label: 'OpenAI Images',
      config: null,
      models: [],
      configured: false,
      available: false,
      issues: []
    }
    const catalog = { defaultSelection: null, sources: [source, { ...source, sourceId: 'img-2' }] }
    expect(imageProviderCatalogSchema.safeParse(catalog).success).toBe(true)
    expect(
      imageProviderCatalogSchema.safeParse({ ...catalog, sources: [source, source] }).success
    ).toBe(false)
    expect(
      imageProviderCatalogSchema.safeParse({
        ...catalog,
        sources: [{ ...source, available: true }]
      }).success
    ).toBe(false)
  })

  it('keeps every importable format explicitly covered by the MinerU capability', () => {
    const supported = new Set(getProviderCapability('mineru').supportedFormats)
    expect(SUPPORTED_KNOWLEDGE_EXTENSIONS.every((extension) => supported.has(extension))).toBe(true)
    expect(supported).toEqual(
      new Set(['pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp'])
    )
  })
})
