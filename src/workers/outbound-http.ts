import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'

export class OutboundHttpPolicyError extends Error {
  constructor(
    readonly code:
      | 'url_not_https'
      | 'url_credentials_forbidden'
      | 'url_fragment_forbidden'
      | 'hostname_not_public'
      | 'redirect_invalid'
      | 'redirect_limit'
      | 'configured_url_invalid'
      | 'response_too_large',
    options?: ErrorOptions
  ) {
    super('Outbound HTTP policy rejected the request', options)
    this.name = 'OutboundHttpPolicyError'
  }
}

export type ArtifactUrlValidator = (url: URL) => Promise<void>

const blockedIpv4 = createBlockList('ipv4', [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
])
const blockedIpv6 = createBlockList('ipv6', [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8]
])

export async function assertPublicHttpsUrl(
  value: URL,
  lookupImplementation: typeof lookup = lookup
): Promise<void> {
  if (value.protocol !== 'https:') throw new OutboundHttpPolicyError('url_not_https')
  if (value.username !== '' || value.password !== '') {
    throw new OutboundHttpPolicyError('url_credentials_forbidden')
  }
  if (value.hash !== '') throw new OutboundHttpPolicyError('url_fragment_forbidden')
  const hostname = stripIpv6Brackets(value.hostname)
  const literalFamily = isIP(hostname)
  if (literalFamily !== 0) {
    if (!isPublicAddress(hostname, literalFamily)) {
      throw new OutboundHttpPolicyError('hostname_not_public')
    }
    return
  }
  let addresses: Array<{ address: string; family: number }>
  try {
    addresses = (await lookupImplementation(hostname, { all: true, verbatim: true })) as Array<{
      address: string
      family: number
    }>
  } catch (err) {
    throw new OutboundHttpPolicyError('hostname_not_public', { cause: err })
  }
  if (
    addresses.length === 0 ||
    addresses.some((entry) => !isPublicAddress(entry.address, entry.family))
  ) {
    throw new OutboundHttpPolicyError('hostname_not_public')
  }
}

/**
 * Direct-constructor test seam for local HTTP fixtures. Product composition must
 * never select this validator.
 */
export async function assertPublicHttpsOrLoopbackTestUrl(value: URL): Promise<void> {
  if (
    value.username !== '' ||
    value.password !== '' ||
    value.hash !== '' ||
    (value.protocol !== 'http:' && value.protocol !== 'https:')
  ) {
    throw new OutboundHttpPolicyError('hostname_not_public')
  }
  const hostname = stripIpv6Brackets(value.hostname)
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return
  await assertPublicHttpsUrl(value)
}

export async function fetchPublicHttps(
  input: string | URL,
  init: RequestInit,
  options: {
    fetchImplementation?: typeof fetch
    validateUrl?: ArtifactUrlValidator
    maxRedirects?: number
  } = {}
): Promise<Response> {
  const fetchImplementation = options.fetchImplementation ?? fetch
  const validateUrl = options.validateUrl ?? assertPublicHttpsUrl
  const maxRedirects = options.maxRedirects ?? 0
  let current = new URL(input)
  let headers = new Headers(init.headers)
  for (let redirects = 0; ; redirects += 1) {
    await validateUrl(current)
    const response = await fetchImplementation(current, {
      ...init,
      headers,
      redirect: 'manual'
    })
    if (!isRedirect(response.status)) return response
    if (redirects >= maxRedirects) {
      await response.body?.cancel()
      throw new OutboundHttpPolicyError('redirect_limit')
    }
    const location = response.headers.get('location')
    if (location === null) {
      await response.body?.cancel()
      throw new OutboundHttpPolicyError('redirect_invalid')
    }
    let next: URL
    try {
      next = new URL(location, current)
    } catch (err) {
      await response.body?.cancel()
      throw new OutboundHttpPolicyError('redirect_invalid', { cause: err })
    }
    await validateUrl(next)
    if (next.origin !== current.origin) {
      headers = new Headers(headers)
      headers.delete('authorization')
      headers.delete('cookie')
      headers.delete('proxy-authorization')
    }
    await response.body?.cancel()
    current = next
  }
}

export async function fetchConfiguredEndpoint(
  input: string | URL,
  init: RequestInit,
  fetchImplementation: typeof fetch = fetch
): Promise<Response> {
  const url = new URL(input)
  const loopbackHttp =
    url.protocol === 'http:' &&
    (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
  if (
    (url.protocol !== 'https:' && !loopbackHttp) ||
    url.username !== '' ||
    url.password !== '' ||
    url.hash !== ''
  ) {
    throw new OutboundHttpPolicyError('configured_url_invalid')
  }
  const response = await fetchImplementation(url, { ...init, redirect: 'error' })
  if (isRedirect(response.status)) {
    await response.body?.cancel()
    throw new OutboundHttpPolicyError('redirect_invalid')
  }
  return response
}

export async function readBoundedBody(
  response: Response,
  maximumBytes: number
): Promise<Uint8Array> {
  const declared = response.headers.get('content-length')
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
      await response.body?.cancel()
      throw new OutboundHttpPolicyError('response_too_large')
    }
  }
  if (response.body === null) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximumBytes) {
      await reader.cancel()
      throw new OutboundHttpPolicyError('response_too_large')
    }
    chunks.push(value)
  }
  const result = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

export async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  return new TextDecoder().decode(await readBoundedBody(response, maximumBytes))
}

function createBlockList(
  type: 'ipv4' | 'ipv6',
  entries: ReadonlyArray<readonly [string, number]>
): BlockList {
  const list = new BlockList()
  for (const [network, prefix] of entries) list.addSubnet(network, prefix, type)
  return list
}

function isPublicAddress(address: string, family: number): boolean {
  if (family === 4) return !blockedIpv4.check(address, 'ipv4')
  if (family === 6) return !blockedIpv6.check(address, 'ipv6')
  return false
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

function isRedirect(status: number): boolean {
  return status >= 300 && status <= 399 && status !== 304
}
