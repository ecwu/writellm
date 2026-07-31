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

  it('never follows redirects for an explicitly configured credential-bearing endpoint', async () => {
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
        'https://configured.example/v1/models',
        { headers: { authorization: 'Bearer secret' } },
        fetchImplementation
      )
    ).rejects.toMatchObject({ code: 'redirect_invalid' })
    expect(fetchImplementation).toHaveBeenCalledTimes(1)
  })
})
