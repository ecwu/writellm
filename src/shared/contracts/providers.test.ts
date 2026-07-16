import { describe, expect, it } from 'vitest'
import { getProviderCapability } from '../../main/providers/capability-registry'
import { SUPPORTED_KNOWLEDGE_EXTENSIONS } from './knowledge'
import { providerConfigSchema } from './providers'

describe('provider contracts', () => {
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

  it('keeps every importable format explicitly covered by the MinerU capability', () => {
    const supported = new Set(getProviderCapability('mineru').supportedFormats)
    expect(SUPPORTED_KNOWLEDGE_EXTENSIONS.every((extension) => supported.has(extension))).toBe(true)
    expect(supported).toEqual(
      new Set(['pdf', 'docx', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp'])
    )
  })
})
