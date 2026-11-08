const TRACE_RESPONSE_HEADERS = new Set([
  'request-id',
  'x-request-id',
  'openai-request-id',
  'retry-after',
  'retry-after-ms',
  'server-timing',
  'x-ratelimit-limit-requests',
  'x-ratelimit-limit-tokens',
  'x-ratelimit-remaining-requests',
  'x-ratelimit-remaining-tokens',
  'x-ratelimit-reset-requests',
  'x-ratelimit-reset-tokens'
])

export function safeProviderResponseHeaders(
  headers: Readonly<Record<string, string>>
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .map(([name, value]) => [name.toLowerCase(), value] as const)
      .filter(([name]) => TRACE_RESPONSE_HEADERS.has(name))
      .map(([name, value]) => [name, value.slice(0, 2_048)])
  )
}
