import { describe, expect, it, vi } from 'vitest'
import { runModelsDevRequest } from './models-dev-request'

const request = {
  operation: 'models_dev_resolve' as const,
  requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc620',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-test'
}

describe('models.dev request', () => {
  it('matches provider/model keys, provider APIs, and globally unique model IDs in order', async () => {
    const catalog = {
      openai: {
        api: 'https://api.openai.com/v1',
        models: { 'gpt-test': { limit: { context: 200_000, input: 180_000, output: 20_000 } } }
      },
      other: {
        api: 'https://other.example/v1',
        models: {
          'gpt-test': { limit: { context: 99_000 } },
          unique: { limit: { context: 32_000 } }
        }
      }
    }
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({ redirect: 'error', method: 'GET' })
      return new Response(JSON.stringify(catalog), { status: 200 })
    }) as unknown as typeof fetch

    const apiMatch = await runModelsDevRequest(request, fetcher, new AbortController().signal)
    expect(apiMatch).toMatchObject({
      type: 'models-dev-result',
      limits: { contextWindowTokens: 200_000, catalogModelKey: 'openai/gpt-test' }
    })
    const direct = await runModelsDevRequest(
      { ...request, model: 'other/gpt-test' },
      fetcher,
      new AbortController().signal
    )
    expect(direct).toMatchObject({
      limits: { contextWindowTokens: 99_000, catalogModelKey: 'other/gpt-test' }
    })
    const unique = await runModelsDevRequest(
      { ...request, baseUrl: 'https://custom.example/v1', model: 'unique' },
      fetcher,
      new AbortController().signal
    )
    expect(unique).toMatchObject({ limits: { catalogModelKey: 'other/unique' } })
  })

  it('does not guess when an exact model ID is ambiguous', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            one: { models: { shared: { limit: { context: 32_000 } } } },
            two: { models: { shared: { limit: { context: 64_000 } } } }
          }),
          { status: 200 }
        )
    ) as unknown as typeof fetch
    const result = await runModelsDevRequest(
      { ...request, baseUrl: 'https://custom.example/v1', model: 'shared' },
      fetcher,
      new AbortController().signal
    )
    expect(result).toMatchObject({ type: 'models-dev-result', limits: null })
  })

  it('rejects a declared oversized catalog before parsing it', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response('{}', {
          status: 200,
          headers: { 'content-length': String(17 * 1_024 * 1_024) }
        })
    ) as unknown as typeof fetch
    await expect(
      runModelsDevRequest(request, fetcher, new AbortController().signal)
    ).rejects.toThrow('response size limit')
  })
})
