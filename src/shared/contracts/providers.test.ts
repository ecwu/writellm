import { describe, expect, it } from 'vitest'
import { getProviderCapability } from '../../main/providers/capability-registry'
import { SUPPORTED_KNOWLEDGE_EXTENSIONS } from './knowledge'
import {
  agentCustomPresetInputSchema,
  agentModelSummarySchema,
  agentThinkingLevelSchema,
  effectiveGoogleGeminiImageSize,
  GOOGLE_GEMINI_IMAGE_MODELS,
  providerConfigSchema
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

  it('accepts HTTPS and loopback HTTP but rejects embedded credentials and remote HTTP', () => {
    const base = {
      role: 'agent' as const,
      providerId: 'openai-compatible' as const,
      model: 'writer',
      modelRevision: 'writer-rev-1',
      timeoutMs: 30_000,
      embeddingDimension: null,
      batchLimit: 1,
      fileSizeLimitMb: null
    }
    expect(
      providerConfigSchema.parse({ ...base, baseUrl: 'https://api.example.test/v1/' }).baseUrl
    ).toBe('https://api.example.test/v1')
    expect(
      providerConfigSchema.safeParse({ ...base, baseUrl: 'http://localhost:8080/v1' }).success
    ).toBe(true)
    expect(
      providerConfigSchema.safeParse({ ...base, baseUrl: 'http://api.example.test' }).success
    ).toBe(false)
    expect(
      providerConfigSchema.safeParse({ ...base, baseUrl: 'https://key@example.test' }).success
    ).toBe(false)
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

  it('accepts fixed Gemini image models and strips only a legacy official URL', () => {
    const image = {
      role: 'image' as const,
      providerId: 'google-gemini' as const,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-3.1-flash-image',
      timeoutMs: 120_000,
      embeddingDimension: null,
      batchLimit: 1,
      fileSizeLimitMb: null,
      defaultAspectRatio: 'auto' as const,
      defaultImageSize: '1K' as const
    }
    const parsed = providerConfigSchema.parse(image)
    const { baseUrl: _legacyBaseUrl, ...currentImage } = image
    expect(parsed).toEqual(currentImage)
    expect('baseUrl' in parsed).toBe(false)
    for (const model of GOOGLE_GEMINI_IMAGE_MODELS) {
      expect(providerConfigSchema.safeParse({ ...image, model }).success).toBe(true)
    }
    expect(
      providerConfigSchema.safeParse({
        ...image,
        baseUrl: 'https://gemini-proxy.example.test'
      }).success
    ).toBe(false)
    expect(providerConfigSchema.safeParse({ ...image, model: 'gemini-custom-image' }).success).toBe(
      false
    )
    expect(
      providerConfigSchema.safeParse({ ...image, providerId: 'openai-compatible' }).success
    ).toBe(false)
    expect(providerConfigSchema.safeParse({ ...image, defaultImageSize: '4K' }).success).toBe(false)
    expect(effectiveGoogleGeminiImageSize('gemini-3.1-flash-image', '2K')).toBe('2K')
    expect(effectiveGoogleGeminiImageSize('gemini-3-pro-image', '2K')).toBe('2K')
    expect(effectiveGoogleGeminiImageSize('gemini-3.1-flash-lite-image', '2K')).toBe('1K')
    expect(effectiveGoogleGeminiImageSize('gemini-2.5-flash-image', '2K')).toBe('1K')
  })

  it('keeps every importable format explicitly covered by the MinerU capability', () => {
    const supported = new Set(getProviderCapability('mineru').supportedFormats)
    expect(SUPPORTED_KNOWLEDGE_EXTENSIONS.every((extension) => supported.has(extension))).toBe(true)
    expect(supported).toEqual(
      new Set(['pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp'])
    )
  })
})
