import { afterEach, describe, expect, it, vi } from 'vitest'
import { agentDiagnosticForLogging } from '../../shared/agent-diagnostic-error'
import {
  fetchSourceModels as discoverSourceModels,
  SourceModelDiscoveryError,
  discoverSourceModels as discoverWithMetadata
} from './source-model-discovery'

const signal = () => new AbortController().signal
const json = (body: unknown) => new Response(JSON.stringify(body))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('source model discovery', () => {
  it('retains a compatible endpoint prefix and sends credentials only in a header', async () => {
    const fetcher = vi.fn(async () => json({ data: [{ id: 'new-transcriber' }] }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      discoverSourceModels(
        {
          transport: 'openai-compatible',
          baseUrl: 'http://127.0.0.1:8080/proxy/v1/',
          credential: 'test-secret'
        },
        signal()
      )
    ).resolves.toEqual([{ id: 'new-transcriber', name: 'new-transcriber' }])
    const [url, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(url.href).toBe('http://127.0.0.1:8080/proxy/v1/models')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer test-secret')
    expect(init.redirect).toBe('error')
  })

  it('lists embedding candidates from the configured source only, without consulting image or speech metadata', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ data: [{ id: 'custom-vector' }] }))
    vi.stubGlobal('fetch', fetcher)
    const input = {
      transport: 'openai-compatible' as const,
      purpose: 'embedding' as const,
      baseUrl: 'http://models.example.test/prefix/v1',
      credential: 'test-key'
    }
    const log = { warn: vi.fn() }
    await expect(discoverWithMetadata(input, signal(), log)).resolves.toEqual([
      { id: 'custom-vector', name: 'custom-vector' }
    ])
    const [url, init] = fetcher.mock.calls[0]
    expect(String(url)).toBe('http://models.example.test/prefix/v1/models')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer test-key')
    expect(init?.redirect).toBe('error')
    fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }))
    await expect(discoverWithMetadata(input, signal(), log)).rejects.toMatchObject({
      code: 'http_error',
      httpStatus: 404
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('omits authorization for unauthenticated loopback sources', async () => {
    const fetcher = vi.fn(async () => json({ data: [] }))
    vi.stubGlobal('fetch', fetcher)
    await discoverSourceModels(
      { transport: 'openai-compatible', baseUrl: 'http://localhost:8000/v1' },
      signal()
    )
    const [, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(new Headers(init.headers).has('authorization')).toBe(false)
  })

  it.each([
    'http://remote.example/v1',
    'ftp://localhost/v1',
    'https://user:secret@example.com/v1',
    'https://example.com/v1?api_key=secret',
    'https://example.com/v1#secret'
  ])('rejects unsafe speech endpoint %s before fetch', async (baseUrl) => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(
      discoverSourceModels({ transport: 'openai-compatible', baseUrl }, signal())
    ).rejects.toMatchObject({ code: 'invalid_endpoint' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses the dedicated official xAI image list but compatible custom sources use models', async () => {
    const fetcher = vi.fn(async () => json({ models: [{ id: 'future-image-model' }] }))
    vi.stubGlobal('fetch', fetcher)
    await discoverSourceModels({ transport: 'xai' }, signal())
    await discoverSourceModels({ transport: 'xai', baseUrl: 'https://api.x.ai/v1' }, signal())
    await discoverSourceModels(
      { transport: 'xai', baseUrl: 'https://proxy.example/api/v1' },
      signal()
    )
    expect(fetcher.mock.calls.map((args) => String((args as unknown as [URL])[0]))).toEqual([
      'https://api.x.ai/v1/image-generation-models',
      'https://api.x.ai/v1/image-generation-models',
      'https://proxy.example/api/v1/models'
    ])
  })

  it('paginates Gemini on its fixed origin and deduplicates candidates without capability inference', async () => {
    const urls: string[] = []
    const headers: Headers[] = []
    const fetcher = vi.fn(async (url: URL, init: RequestInit) => {
      urls.push(url.href)
      headers.push(new Headers(init.headers))
      return urls.length === 1
        ? json({
            models: [
              {
                name: 'models/new-model',
                displayName: 'New model',
                supportedGenerationMethods: ['generateContent']
              }
            ],
            nextPageToken: 'opaque/token'
          })
        : json({
            models: [
              { name: 'models/new-model', displayName: 'New model' },
              { name: 'models/other-model' }
            ]
          })
    })
    vi.stubGlobal('fetch', fetcher)
    await expect(
      discoverSourceModels({ transport: 'google-gemini', credential: 'google-secret' }, signal())
    ).resolves.toEqual([
      { id: 'new-model', name: 'New model' },
      { id: 'other-model', name: 'other-model' }
    ])
    expect(urls).toEqual([
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
      'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000&pageToken=opaque%2Ftoken'
    ])
    expect(headers.every((header) => header.get('x-goog-api-key') === 'google-secret')).toBe(true)
    expect(headers.every((header) => !header.has('authorization'))).toBe(true)
    expect(urls.join('')).not.toContain('google-secret')
  })

  it('accepts an explicit null Gemini pagination terminator', async () => {
    const fetcher = vi.fn(async () =>
      json({ models: [{ name: 'models/new-image' }], nextPageToken: null })
    )
    vi.stubGlobal('fetch', fetcher)
    await expect(discoverSourceModels({ transport: 'google-gemini' }, signal())).resolves.toEqual([
      { id: 'new-image', name: 'new-image' }
    ])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('rejects cyclic Gemini pagination and unsupported Vertex without a network call', async () => {
    const fetcher = vi.fn(async () => json({ models: [], nextPageToken: 'same' }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      discoverSourceModels({ transport: 'google-gemini' }, signal())
    ).rejects.toMatchObject({
      code: 'invalid_response'
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
    fetcher.mockClear()
    await expect(
      discoverSourceModels({ transport: 'google-vertex' }, signal())
    ).rejects.toMatchObject({
      code: 'unsupported'
    })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('bounds Gemini pagination without publishing a partial catalog', async () => {
    let page = 0
    const fetcher = vi.fn(async () => json({ models: [], nextPageToken: `token-${++page}` }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      discoverSourceModels({ transport: 'google-gemini' }, signal())
    ).rejects.toMatchObject({
      code: 'limit_exceeded'
    })
    expect(fetcher).toHaveBeenCalledTimes(10)
  })

  it('rejects redirects without following them or reading their body', async () => {
    const response = new Response('private redirect body', {
      status: 302,
      headers: { location: 'https://other.example/' }
    })
    if (response.body === null) throw new Error('Fixture response body is missing')
    const cancel = vi.spyOn(response.body, 'cancel')
    const fetcher = vi.fn(async () => response)
    vi.stubGlobal('fetch', fetcher)
    await expect(discoverSourceModels({ transport: 'openai' }, signal())).rejects.toMatchObject({
      code: 'invalid_endpoint'
    })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('reports only an HTTP status and cancels the failure body', async () => {
    const response = new Response('private provider rejection', { status: 401 })
    if (response.body === null) throw new Error('Fixture response body is missing')
    const cancel = vi.spyOn(response.body, 'cancel')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response)
    )
    await expect(discoverSourceModels({ transport: 'openai' }, signal())).rejects.toMatchObject({
      code: 'http_error',
      httpStatus: 401,
      message: 'Model discovery failed (http_error).'
    })
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([
    {},
    { data: [null] },
    { data: [{ id: '' }] },
    { data: [{ id: 'x'.repeat(201) }] },
    { data: [{ id: 'good' }], has_more: true }
  ])('rejects malformed or incomplete catalogs', async (body) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json(body))
    )
    await expect(discoverSourceModels({ transport: 'openai' }, signal())).rejects.toMatchObject({
      code: 'invalid_response'
    })
  })

  it('bounds the catalog byte and model counts', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('x', { headers: { 'content-length': String(2 * 1024 * 1024 + 1) } })
      )
      .mockResolvedValueOnce(
        json({ data: Array.from({ length: 2001 }, (_, i) => ({ id: `model-${i}` })) })
      )
    vi.stubGlobal('fetch', fetcher)
    await expect(discoverSourceModels({ transport: 'openai' }, signal())).rejects.toMatchObject({
      code: 'limit_exceeded'
    })
    await expect(discoverSourceModels({ transport: 'openai' }, signal())).rejects.toMatchObject({
      code: 'limit_exceeded'
    })
  })

  it('bounds aggregate paginated bytes and stops without fetching another page', async () => {
    const padding = 'x'.repeat(1100000)
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(json({ models: [], nextPageToken: 'second', padding }))
      .mockResolvedValueOnce(json({ models: [], nextPageToken: 'third', padding }))
    vi.stubGlobal('fetch', fetcher)
    await expect(
      discoverSourceModels({ transport: 'google-gemini' }, signal())
    ).rejects.toMatchObject({ code: 'limit_exceeded' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects an already aborted request without network activity', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()
    controller.abort()
    await expect(
      discoverSourceModels({ transport: 'openai' }, controller.signal)
    ).rejects.toMatchObject({ code: 'aborted' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('retains JSON errors as causes but excludes provider text from shared logs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('private-provider-body'))
    )
    const err = await discoverSourceModels(
      { transport: 'openai', credential: 'private-key' },
      signal()
    ).catch((error: unknown) => error)
    expect(err).toBeInstanceOf(SourceModelDiscoveryError)
    expect(err).toMatchObject({ code: 'invalid_response', cause: expect.any(SyntaxError) })
    expect(JSON.stringify(agentDiagnosticForLogging(err))).not.toContain('private-provider-body')
    expect(JSON.stringify(agentDiagnosticForLogging(err))).not.toContain('private-key')
  })

  it('aborts an in-flight request and preserves the original error privately', async () => {
    const controller = new AbortController()
    const original = new Error('private endpoint failure')
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(original), { once: true })
          })
      )
    )
    const pending = discoverSourceModels({ transport: 'openai' }, controller.signal)
    const assertion = expect(pending).rejects.toMatchObject({ code: 'aborted', cause: original })
    controller.abort()
    await assertion
  })

  it('bounds the complete request time and clears its timer', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('deadline')), {
              once: true
            })
          })
      )
    )
    const assertion = expect(
      discoverSourceModels({ transport: 'openai' }, signal())
    ).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(15000)
    await assertion
    expect(vi.getTimerCount()).toBe(0)
  })
})
