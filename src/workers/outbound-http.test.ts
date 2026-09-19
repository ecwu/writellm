import { describe, expect, it, vi } from 'vitest'
import {
  assertPublicHttpsUrl,
  assertPublicHttpsOrLoopbackTestUrl,
  fetchConfiguredEndpoint,
  fetchPublicHttps,
  readBoundedBody,
  readBoundedText
} from './outbound-http'

describe('outbound HTTP policy', () => {
  it('rejects private and credential-bearing artifact URLs before fetch', async () => {
    await expect(assertPublicHttpsUrl(new URL('https://127.0.0.1/artifact'))).rejects.toMatchObject(
      {
        code: 'hostname_not_public'
      }
    )
    await expect(
      assertPublicHttpsUrl(new URL('https://user:secret@example.com/artifact'))
    ).rejects.toMatchObject({ code: 'url_credentials_forbidden' })
    await expect(
      assertPublicHttpsUrl(new URL('http://example.com/artifact'))
    ).rejects.toMatchObject({ code: 'url_not_https' })
    await expect(assertPublicHttpsUrl(new URL('https://[::1]/artifact'))).rejects.toMatchObject({
      code: 'hostname_not_public'
    })
    await expect(assertPublicHttpsUrl(new URL('https://[fe80::1]/artifact'))).rejects.toMatchObject(
      { code: 'hostname_not_public' }
    )
    await expect(
      assertPublicHttpsUrl(new URL('https://example.com/artifact#private'))
    ).rejects.toMatchObject({ code: 'url_fragment_forbidden' })
    await expect(assertPublicHttpsUrl(new URL('https://8.8.8.8/artifact'))).resolves.toBeUndefined()
    await expect(
      assertPublicHttpsUrl(new URL('https://[2606:4700:4700::1111]/artifact'))
    ).resolves.toBeUndefined()
  })

  it('rejects a hostname when any DNS result is not public', async () => {
    const mixedLookup = vi.fn(async () => [
      { address: '8.8.8.8', family: 4 as const },
      { address: '10.0.0.8', family: 4 as const }
    ])
    await expect(
      assertPublicHttpsUrl(new URL('https://mixed.example/artifact'), mixedLookup)
    ).rejects.toMatchObject({ code: 'hostname_not_public' })
  })

  it('allows loopback only through the direct test validator', async () => {
    await expect(
      assertPublicHttpsOrLoopbackTestUrl(new URL('http://127.0.0.1:4321/upload'))
    ).resolves.toBeUndefined()
    await expect(
      assertPublicHttpsOrLoopbackTestUrl(new URL('http://[::1]:4321/result.zip'))
    ).resolves.toBeUndefined()
    await expect(
      assertPublicHttpsOrLoopbackTestUrl(new URL('http://10.0.0.1/result.zip'))
    ).rejects.toMatchObject({ code: 'url_not_https' })
  })

  it('validates every redirect hop and strips authorization across origins', async () => {
    const validateUrl = vi.fn(async (url: URL) => {
      if (url.hostname === 'private.example') throw new Error('private')
    })
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: 'https://second.example/artifact' }
        })
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
    const response = await fetchPublicHttps(
      'https://first.example/artifact',
      { headers: { authorization: 'Bearer secret' } },
      { fetchImplementation, validateUrl, maxRedirects: 3 }
    )

    expect(await response.text()).toBe('ok')
    expect(validateUrl).toHaveBeenCalledTimes(3)
    expect(new Headers(fetchImplementation.mock.calls[1]?.[1]?.headers).has('authorization')).toBe(
      false
    )
  })

  it('cancels an actually oversized streaming response', async () => {
    const response = new Response('x'.repeat(33))
    await expect(readBoundedText(response, 32)).rejects.toMatchObject({
      code: 'response_too_large'
    })
    await expect(
      readBoundedBody(new Response('short', { headers: { 'content-length': '1000' } }), 32)
    ).rejects.toMatchObject({ code: 'response_too_large' })
  })

  it('rejects redirect downgrade, private hops, and chains beyond the configured maximum', async () => {
    const validateUrl = vi.fn(async (url: URL) => {
      if (url.protocol !== 'https:' || url.hostname === 'private.example') {
        throw new Error('unsafe hop')
      }
    })
    const redirect = (location: string) =>
      new Response(null, { status: 302, headers: { location } })

    await expect(
      fetchPublicHttps(
        'https://public.example/start',
        {},
        {
          fetchImplementation: vi.fn(async () => redirect('http://public.example/downgrade')),
          validateUrl,
          maxRedirects: 3
        }
      )
    ).rejects.toThrow('unsafe hop')
    await expect(
      fetchPublicHttps(
        'https://public.example/start',
        {},
        {
          fetchImplementation: vi.fn(async () => redirect('https://private.example/artifact')),
          validateUrl,
          maxRedirects: 3
        }
      )
    ).rejects.toThrow('unsafe hop')
    await expect(
      fetchPublicHttps(
        'https://public.example/start',
        {},
        {
          fetchImplementation: vi.fn(async () => redirect('https://public.example/again')),
          validateUrl,
          maxRedirects: 3
        }
      )
    ).rejects.toMatchObject({ code: 'redirect_limit' })
  })

  it.each([
    'http://models.example.test:8080/v1/models',
    'http://8.8.8.8/models',
    'http://172.16.0.2/models',
    'http://[2001:db8::1]/models'
  ])('allows model-service HTTP but preserves the default policy for %s', async (url) => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => new Response('{}'))
    await expect(fetchConfiguredEndpoint(url, {}, fetchImplementation)).rejects.toMatchObject({
      code: 'configured_url_invalid'
    })
    expect(fetchImplementation).not.toHaveBeenCalled()
    await fetchConfiguredEndpoint(url, {}, fetchImplementation, 'model-service')
    expect(fetchImplementation).toHaveBeenCalledWith(new URL(url), { redirect: 'error' })
  })

  it.each([
    'ftp://models.example.test/models',
    'http://key:secret@models.example.test/models',
    'http://models.example.test/models#fragment'
  ])('rejects unsafe model-service URL %s before fetch', async (url) => {
    const fetchImplementation = vi.fn<typeof fetch>()
    await expect(
      fetchConfiguredEndpoint(url, {}, fetchImplementation, 'model-service')
    ).rejects.toMatchObject({ code: 'configured_url_invalid' })
    expect(fetchImplementation).not.toHaveBeenCalled()
  })

  it.each(['https://configured.example/v1/models', 'http://configured.example/v1/models'])(
    'never follows redirects for credential-bearing endpoint %s',
    async (url) => {
      const fetchImplementation = vi.fn<typeof fetch>(async (_input, init) => {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer secret')
        expect(init?.redirect).toBe('error')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://attacker.example/collect' }
        })
      })

      await expect(
        fetchConfiguredEndpoint(
          url,
          { headers: { authorization: 'Bearer secret' } },
          fetchImplementation,
          'model-service'
        )
      ).rejects.toMatchObject({ code: 'redirect_invalid' })
      expect(fetchImplementation).toHaveBeenCalledTimes(1)
    }
  )
})
