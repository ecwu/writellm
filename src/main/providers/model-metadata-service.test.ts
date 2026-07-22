import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ModelMetadataService } from './model-metadata-service'

const config = {
  role: 'agent' as const,
  providerId: 'openai-compatible' as const,
  baseUrl: 'https://api.example.com/v1',
  model: 'writer',
  modelRevision: 'current',
  contextWindowTokens: null,
  timeoutMs: 60_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null
}

describe('ModelMetadataService', () => {
  it('prefers a manual override without starting a network request', async () => {
    const client = { resolve: vi.fn() }
    const service = new ModelMetadataService(
      { getModelLimitsCache: vi.fn(async () => ({})) } as never,
      client as never,
      pino({ level: 'silent' })
    )
    await expect(
      service.resolve({ ...config, contextWindowTokens: 48_000 }, new AbortController().signal)
    ).resolves.toMatchObject({ contextWindowTokens: 48_000, source: 'manual_override' })
    expect(client.resolve).not.toHaveBeenCalled()
  })

  it('uses a fresh fingerprint-isolated cache and marks its source', async () => {
    const now = new Date('2026-07-22T12:00:00.000Z')
    const cache = {
      ['f'.repeat(64)]: {
        limits: {
          contextWindowTokens: 64_000,
          inputLimitTokens: 60_000,
          outputLimitTokens: 4_000,
          source: 'models_dev',
          catalogModelKey: 'example/writer',
          resolvedAt: '2026-07-22T00:00:00.000Z'
        },
        refreshedAt: now.toISOString()
      }
    }
    const client = { resolve: vi.fn() }
    const settings = { getModelLimitsCache: vi.fn(async () => cache) }
    const service = new ModelMetadataService(
      settings as never,
      client as never,
      pino({ level: 'silent' }),
      () => now
    )
    // A different fingerprint must not borrow this entry.
    client.resolve.mockResolvedValue(null)
    await expect(service.resolve(config, new AbortController().signal)).resolves.toMatchObject({
      contextWindowTokens: 131_072,
      source: 'legacy_fallback'
    })
  })

  it('keeps a stale cache when refresh fails', async () => {
    const now = new Date('2026-07-22T12:00:00.000Z')
    const { createHash } = await import('node:crypto')
    const fingerprint = createHash('sha256')
      .update(`${config.providerId}\0${config.baseUrl}\0${config.model}`)
      .digest('hex')
    const limits = {
      contextWindowTokens: 96_000,
      inputLimitTokens: null,
      outputLimitTokens: 8_000,
      source: 'models_dev' as const,
      catalogModelKey: 'example/writer',
      resolvedAt: '2026-07-19T00:00:00.000Z'
    }
    const service = new ModelMetadataService(
      {
        getModelLimitsCache: vi.fn(async () => ({
          [fingerprint]: { limits, refreshedAt: '2026-07-19T00:00:00.000Z' }
        }))
      } as never,
      { resolve: vi.fn(async () => Promise.reject(new Error('offline'))) } as never,
      pino({ level: 'silent' }),
      () => now
    )
    await expect(service.resolve(config, new AbortController().signal)).resolves.toMatchObject({
      contextWindowTokens: 96_000,
      source: 'cache'
    })
  })
})
