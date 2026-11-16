import { readFileSync } from 'node:fs'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverSourceModels } from './source-model-discovery'
import { SOURCE_MODEL_METADATA_URL, SourceModelMetadata } from './source-model-metadata'

const signal = () => new AbortController().signal
const log = pino({ enabled: false })
const json = (body: unknown) => new Response(JSON.stringify(body))
const image = (base = 'https://api.openai.com/v1') => ({
  type: 'image',
  name: 'Fresh image',
  api: { images: { base_url: base, sdk: { package: 'never-execute' } } }
})
const transcription = (
  api: Record<string, object> = {
    transcriptions: { base_url: 'https://api.openai.com/v1' },
    realtime: { base_url: 'https://api.openai.com/v1' }
  }
) => ({ type: 'transcription', api })
const fixture = {
  openai: {
    models: {
      'fresh-image': image(),
      'fresh-transcriber': transcription(),
      'live-only': transcription({ realtime: { base_url: 'https://api.openai.com/v1' } })
    }
  },
  google: {
    models: {
      'fresh-gemini': {
        type: 'image',
        api: {
          'generate-content': { base_url: 'https://generativelanguage.googleapis.com/v1beta' }
        }
      },
      'predict-only': {
        type: 'image',
        api: { predict: { base_url: 'https://generativelanguage.googleapis.com/v1beta' } }
      }
    }
  },
  'google-vertex': {
    models: {
      'vertex-image': {
        type: 'image',
        api: {
          'generate-content': {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: Public metadata uses literal environment templates.
            base_url: 'https://${LOCATION}-aiplatform.googleapis.com/v1/projects/${PROJECT}'
          }
        }
      },
      'vertex-predict': {
        type: 'image',
        api: {
          predict: {
            // biome-ignore lint/suspicious/noTemplateCurlyInString: Public metadata uses literal environment templates.
            base_url: 'https://${LOCATION}-aiplatform.googleapis.com'
          }
        }
      }
    }
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('public source model metadata', () => {
  it('classifies exact official IDs and keeps unknown provider models selectable', async () => {
    const fetcher = vi.fn(async () => json(fixture))
    const metadata = new SourceModelMetadata(fetcher)
    const models = await metadata.candidates(
      { transport: 'openai' },
      [
        { id: 'fresh-image', name: 'Provider name' },
        { id: 'fresh-transcriber', name: 'Transcriber' },
        { id: 'live-only', name: 'Live' },
        { id: 'not-in-catalog', name: 'Unknown' }
      ],
      signal(),
      log
    )
    expect(models).toEqual([
      {
        id: 'fresh-image',
        name: 'Provider name',
        capability: 'image',
        metadataSource: 'models.dev',
        availability: 'provider'
      },
      {
        id: 'fresh-transcriber',
        name: 'Transcriber',
        capability: 'transcription',
        speechModes: ['realtime', 'file'],
        metadataSource: 'models.dev',
        availability: 'provider'
      },
      {
        id: 'live-only',
        name: 'Live',
        capability: 'transcription',
        speechModes: ['realtime'],
        metadataSource: 'models.dev',
        availability: 'provider'
      },
      { id: 'not-in-catalog', name: 'Unknown', capability: 'unknown', availability: 'provider' }
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url, request] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(url)).toBe(SOURCE_MODEL_METADATA_URL)
    expect(request.redirect).toBe('error')
    expect(new Headers(request.headers).get('authorization')).toBeNull()
    expect(request.body).toBeUndefined()
  })

  it('does not match IDs across unrelated providers or endpoint prefixes', async () => {
    const metadata = new SourceModelMetadata(async () => json(fixture))
    const candidates = [{ id: 'fresh-image', name: 'Unknown source image' }]
    await expect(
      metadata.candidates(
        { transport: 'openai-compatible', baseUrl: 'https://proxy.example/v1' },
        candidates,
        signal(),
        log
      )
    ).resolves.toEqual([{ ...candidates[0], capability: 'unknown', availability: 'provider' }])
    await expect(
      metadata.candidates(
        { transport: 'openai-compatible', baseUrl: 'https://api.openai.com/custom/v1' },
        null,
        signal(),
        log
      )
    ).resolves.toEqual([])
  })

  it('matches a unique catalog provider only by its full configured API base', async () => {
    const metadata = new SourceModelMetadata(async () =>
      json({
        ...fixture,
        relay: { models: { 'relay-model': image('https://relay.example/proxy/v1') } }
      })
    )
    await expect(
      metadata.candidates(
        { transport: 'openai-compatible', baseUrl: 'https://relay.example/proxy/v1/' },
        null,
        signal(),
        log
      )
    ).resolves.toEqual([
      {
        id: 'relay-model',
        name: 'Fresh image',
        capability: 'image',
        metadataSource: 'models.dev',
        availability: 'catalog'
      }
    ])
  })

  it('does not use ambiguous API matches for public fallback', async () => {
    const metadata = new SourceModelMetadata(async () =>
      json({
        first: { models: { model: image('https://relay.example/v1') } },
        second: { models: { other: image('https://relay.example/v1') } }
      })
    )
    await expect(
      metadata.candidates(
        { transport: 'openai', baseUrl: 'https://relay.example/v1' },
        null,
        signal(),
        log
      )
    ).resolves.toEqual([])
  })

  it('requires generate-content metadata for Google image fallback and never evaluates URL templates', async () => {
    const fetcher = vi.fn(async () => json(fixture))
    const metadata = new SourceModelMetadata(fetcher)
    const google = await metadata.candidates({ transport: 'google-gemini' }, null, signal(), log)
    const vertex = await metadata.candidates({ transport: 'google-vertex' }, null, signal(), log)
    expect(google.map((model) => model.id)).toEqual(['fresh-gemini'])
    expect(vertex.map((model) => model.id)).toEqual(['vertex-image'])
    expect(vertex[0]).toMatchObject({ capability: 'image', availability: 'catalog' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String((fetcher.mock.calls[0] as unknown as [URL])[0])).toBe(SOURCE_MODEL_METADATA_URL)
  })

  it('marks known incompatible Google methods as other and retains unmatched IDs as unknown', async () => {
    const metadata = new SourceModelMetadata(async () => json(fixture))
    const result = await metadata.candidates(
      { transport: 'google-gemini' },
      [
        { id: 'predict-only', name: 'Imagen' },
        { id: 'new-unknown-id', name: 'New ID' }
      ],
      signal(),
      log
    )
    expect(result[0]).toMatchObject({ id: 'predict-only', capability: 'other' })
    expect(result[1]).toMatchObject({ id: 'new-unknown-id', capability: 'unknown' })
  })

  it('does not override provider evidence of an incompatible Google generation method', async () => {
    const metadata = new SourceModelMetadata(async () => json(fixture))
    const candidates = [{ id: 'fresh-gemini', name: 'Gemini', capability: 'other' as const }]
    const result = await metadata.candidates(
      { transport: 'google-gemini' },
      candidates,
      signal(),
      log
    )
    expect(result[0]?.capability).toBe('other')
  })

  it('does not infer speech transcription from audio modalities or realtime chat types', async () => {
    const metadata = new SourceModelMetadata(async () =>
      json({
        openai: {
          models: {
            voice: {
              type: 'realtime',
              modalities: { input: ['audio/pcm'] },
              api: { realtime: { base_url: 'https://api.openai.com/v1' } }
            },
            tts: { type: 'speech', api: { speech: { base_url: 'https://api.openai.com/v1' } } }
          }
        }
      })
    )
    const result = await metadata.candidates(
      { transport: 'openai' },
      [
        { id: 'voice', name: 'Voice' },
        { id: 'tts', name: 'TTS' }
      ],
      signal(),
      log
    )
    expect(
      result.every((model) => model.capability === 'other' && model.speechModes === undefined)
    ).toBe(true)
  })

  it('deduplicates concurrent public fetches and caches results for 24 hours', async () => {
    let now = 100
    const fetcher = vi.fn(async () => json(fixture))
    const metadata = new SourceModelMetadata(fetcher, () => now)
    await Promise.all([
      metadata.candidates({ transport: 'openai' }, null, signal(), log),
      metadata.candidates({ transport: 'google-gemini' }, null, signal(), log)
    ])
    now += 24 * 60 * 60 * 1000 - 1
    await metadata.candidates({ transport: 'openai' }, null, signal(), log)
    expect(fetcher).toHaveBeenCalledTimes(1)
    now += 1
    await metadata.candidates({ transport: 'openai' }, null, signal(), log)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('retains a last successful public catalog when refresh fails and logs the original error', async () => {
    let now = 0
    const original = new Error('public unavailable')
    const fetcher = vi.fn().mockResolvedValueOnce(json(fixture)).mockRejectedValueOnce(original)
    const warn = vi.fn()
    const metadata = new SourceModelMetadata(fetcher, () => now)
    const initial = await metadata.candidates({ transport: 'openai' }, null, signal(), { warn })
    now += 24 * 60 * 60 * 1000
    expect(await metadata.candidates({ transport: 'openai' }, null, signal(), { warn })).toEqual(
      initial
    )
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: original }),
      expect.any(String)
    )
  })

  it.each([
    () => new Response('private invalid JSON'),
    () => json({ unknown: 'new experimental schema' }),
    () => new Response('x', { status: 302, headers: { location: 'https://untrusted.example' } }),
    () => new Response('x', { headers: { 'content-length': String(16 * 1024 * 1024 + 1) } })
  ])(
    'retains provider candidates on malformed, redirected, or oversized public metadata',
    async (response) => {
      const fetcher = vi.fn(async () => response())
      const metadata = new SourceModelMetadata(fetcher)
      const warn = vi.fn()
      const result = await metadata.candidates(
        { transport: 'openai' },
        [{ id: 'fresh-image', name: 'Provider model' }],
        signal(),
        { warn }
      )
      expect(result).toEqual([
        {
          id: 'fresh-image',
          name: 'Provider model',
          capability: 'unknown',
          availability: 'provider'
        }
      ])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  )

  it('cancels one waiter without cancelling the shared public fetch', async () => {
    let finish: (value: Response) => void = () => undefined
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        })
    )
    const metadata = new SourceModelMetadata(fetcher)
    const controller = new AbortController()
    const cancelled = metadata.candidates({ transport: 'openai' }, null, controller.signal, log)
    const other = metadata.candidates({ transport: 'openai' }, null, signal(), log)
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    finish(json(fixture))
    expect((await other).length).toBe(3)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})

describe('provider discovery with public metadata', () => {
  it('enriches provider results without sending source credentials to the public request', async () => {
    const providerFetch = vi.fn(async () =>
      json({ data: [{ id: 'fresh-image' }, { id: 'custom-unknown' }] })
    )
    vi.stubGlobal('fetch', providerFetch)
    const publicFetch = vi.fn(async () => json(fixture))
    const models = await discoverSourceModels(
      { transport: 'openai', credential: 'private-key' },
      signal(),
      log,
      new SourceModelMetadata(publicFetch)
    )
    expect(models[0]).toMatchObject({ capability: 'image', availability: 'provider' })
    expect(models[1]).toMatchObject({ capability: 'unknown', id: 'custom-unknown' })
    const [, publicRequest] = publicFetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(new Headers(publicRequest.headers).has('authorization')).toBe(false)
    const [, providerRequest] = providerFetch.mock.calls[0] as unknown as [URL, RequestInit]
    expect(new Headers(providerRequest.headers).get('authorization')).toBe('Bearer private-key')
  })

  it.each([404, 405, 501])(
    'uses public fallback only for an unsupported provider list HTTP %s',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status }))
      )
      const models = await discoverSourceModels(
        { transport: 'openai' },
        signal(),
        log,
        new SourceModelMetadata(async () => json(fixture))
      )
      expect(models).toHaveLength(3)
      expect(models.every((model) => model.availability === 'catalog')).toBe(true)
    }
  )

  it.each([401, 403, 429, 500])(
    'preserves provider failure HTTP %s without public fallback',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('', { status }))
      )
      const publicFetch = vi.fn(async () => json(fixture))
      await expect(
        discoverSourceModels(
          { transport: 'openai' },
          signal(),
          log,
          new SourceModelMetadata(publicFetch)
        )
      ).rejects.toMatchObject({ code: 'http_error', httpStatus: status })
      expect(publicFetch).not.toHaveBeenCalled()
    }
  )

  it('uses Vertex public metadata without a provider request or ADC access', async () => {
    const providerFetch = vi.fn()
    vi.stubGlobal('fetch', providerFetch)
    const models = await discoverSourceModels(
      { transport: 'google-vertex' },
      signal(),
      log,
      new SourceModelMetadata(async () => json(fixture))
    )
    expect(models.map((model) => model.id)).toEqual(['vertex-image'])
    expect(providerFetch).not.toHaveBeenCalled()
  })

  it('retains the unsupported error when public fallback is unavailable', async () => {
    await expect(
      discoverSourceModels(
        { transport: 'google-vertex' },
        signal(),
        log,
        new SourceModelMetadata(async () => new Response('', { status: 503 }))
      )
    ).rejects.toMatchObject({ code: 'unsupported' })
  })
})

describe('recorded public models.dev v2 response', () => {
  it('classifies real provider entries without fixture-shaped reconstruction', async () => {
    const captured = readFileSync(
      new URL('./fixtures/models-dev-v2-sample.json', import.meta.url),
      'utf8'
    )
    const fetcher = vi.fn(async () => new Response(captured))
    const metadata = new SourceModelMetadata(fetcher)
    const openai = await metadata.candidates({ transport: 'openai' }, null, signal(), log)
    expect(openai).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'gpt-live-transcribe',
          capability: 'transcription',
          speechModes: ['realtime']
        }),
        expect.objectContaining({
          id: 'gpt-transcribe',
          capability: 'transcription',
          speechModes: expect.arrayContaining(['realtime', 'file'])
        }),
        expect.objectContaining({ id: 'gpt-image-2.6-sunburst', capability: 'image' })
      ])
    )
    for (const transport of ['google-gemini', 'google-vertex', 'xai'] as const) {
      const candidates = await metadata.candidates({ transport }, null, signal(), log)
      expect(candidates).toHaveLength(1)
      expect(candidates[0]).toMatchObject({
        capability: 'image',
        availability: 'catalog',
        metadataSource: 'models.dev'
      })
    }
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
