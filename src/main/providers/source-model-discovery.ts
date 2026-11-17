import type { Logger } from 'pino'
import { SourceModelMetadata } from './source-model-metadata'
import {
  sourceModelCandidateSchema,
  type SourceModelCandidate
} from '../../shared/contracts/providers'
import { serializeAgentDiagnosticError } from '../../shared/agent-diagnostic-error'
import {
  fetchConfiguredEndpoint,
  OutboundHttpPolicyError,
  readBoundedBody
} from '../../workers/outbound-http'

const MAX_CATALOG_BYTES = 2 * 1024 * 1024
const MAX_MODELS = 2000
const MAX_PAGES = 10
const DISCOVERY_TIMEOUT_MS = 15000
const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta/'
const XAI_BASE = 'https://api.x.ai/v1/'

export interface SourceModelDiscoveryInput {
  transport: 'openai' | 'xai' | 'google-gemini' | 'google-vertex' | 'openai-compatible'
  baseUrl?: string
  credential?: string
  purpose?: 'embedding'
}

export type SourceModelDiscoveryErrorCode =
  | 'unsupported'
  | 'invalid_endpoint'
  | 'http_error'
  | 'invalid_response'
  | 'limit_exceeded'
  | 'aborted'
  | 'timeout'
  | 'network_error'

export class SourceModelDiscoveryError extends Error {
  constructor(
    readonly code: SourceModelDiscoveryErrorCode,
    options?: ErrorOptions & { httpStatus?: number }
  ) {
    super(`Model discovery failed (${code}).`, options)
    this.name = 'SourceModelDiscoveryError'
    this.httpStatus = options?.httpStatus
  }
  readonly httpStatus?: number
}

const sourceModelMetadata = new SourceModelMetadata()

/** Public metadata classifies candidates without claiming account access or a successful probe. */
export async function discoverSourceModels(
  input: SourceModelDiscoveryInput,
  signal: AbortSignal,
  log: Pick<Logger, 'warn'>,
  metadata: SourceModelMetadata = sourceModelMetadata
): Promise<SourceModelCandidate[]> {
  // The public catalog covers image and speech capabilities only.
  if (input.purpose === 'embedding') return fetchSourceModels(input, signal)
  let candidates: SourceModelCandidate[]
  const publicInput = { transport: input.transport, baseUrl: input.baseUrl }
  try {
    candidates = await fetchSourceModels(input, signal)
  } catch (err) {
    if (
      !(err instanceof SourceModelDiscoveryError) ||
      !(
        err.code === 'unsupported' ||
        (err.code === 'http_error' && [404, 405, 501].includes(err.httpStatus ?? 0))
      )
    )
      throw err
    log.warn(
      { event: 'provider.model_discovery.public_fallback', err },
      'Provider model listing is unavailable; consulting public metadata'
    )
    const fallback = await metadata.candidates(publicInput, null, signal, log)
    if (fallback.length === 0) throw err
    return fallback
  }
  return metadata.candidates(publicInput, candidates, signal, log)
}

/** Catalog entries are candidates, not proof of image or transcription support. */
export async function fetchSourceModels(
  input: SourceModelDiscoveryInput,
  signal: AbortSignal
): Promise<SourceModelCandidate[]> {
  const deadline = new AbortController()
  const timer = setTimeout(() => deadline.abort(), DISCOVERY_TIMEOUT_MS)
  const requestSignal = AbortSignal.any([signal, deadline.signal])
  try {
    requestSignal.throwIfAborted()
    if (input.transport === 'google-vertex') throw new SourceModelDiscoveryError('unsupported')
    const url = discoveryUrl(input)
    const headers = new Headers({ accept: 'application/json' })
    if (input.credential !== undefined) {
      headers.set(
        input.transport === 'google-gemini' ? 'x-goog-api-key' : 'authorization',
        input.transport === 'google-gemini' ? input.credential : `Bearer ${input.credential}`
      )
    }
    const models = new Map<string, SourceModelCandidate>()
    const pageTokens = new Set<string>()
    let remainingBytes = MAX_CATALOG_BYTES
    for (let page = 0; page < MAX_PAGES; page++) {
      requestSignal.throwIfAborted()
      const response = await fetchConfiguredEndpoint(
        url,
        { headers, signal: requestSignal },
        fetch,
        input.transport === 'openai-compatible' && input.purpose !== 'embedding'
          ? 'loopback-only'
          : 'model-service'
      )
      if (!response.ok) {
        await response.body?.cancel()
        throw new SourceModelDiscoveryError('http_error', { httpStatus: response.status })
      }
      const body = await readBoundedBody(response, remainingBytes)
      remainingBytes -= body.byteLength
      requestSignal.throwIfAborted()
      const parsed: unknown = JSON.parse(new TextDecoder().decode(body))
      const { entries, nextPageToken } = parsePage(parsed, input.transport)
      if (entries.length > MAX_MODELS) throw new SourceModelDiscoveryError('limit_exceeded')
      for (const value of entries) {
        const candidate = parseCandidate(value, input.transport)
        models.set(candidate.id, candidate)
        if (models.size > MAX_MODELS) throw new SourceModelDiscoveryError('limit_exceeded')
      }
      if (nextPageToken === undefined) return [...models.values()]
      if (pageTokens.has(nextPageToken)) throw new SourceModelDiscoveryError('invalid_response')
      pageTokens.add(nextPageToken)
      url.searchParams.set('pageToken', nextPageToken)
    }
    throw new SourceModelDiscoveryError('limit_exceeded')
  } catch (err) {
    const code = signal.aborted
      ? 'aborted'
      : deadline.signal.aborted
        ? 'timeout'
        : err instanceof SourceModelDiscoveryError
          ? err.code
          : err instanceof OutboundHttpPolicyError
            ? err.code === 'response_too_large'
              ? 'limit_exceeded'
              : 'invalid_endpoint'
            : err instanceof SyntaxError
              ? 'invalid_response'
              : 'network_error'
    const failure =
      err instanceof SourceModelDiscoveryError && err.code === code
        ? err
        : new SourceModelDiscoveryError(code, { cause: err })
    // ProviderService owns logging. Preserve the original cause while excluding remote content.
    const privateBodies: string[] = []
    const seen = new Set<Error>()
    let current: unknown = err
    while (current instanceof Error && !seen.has(current)) {
      seen.add(current)
      if (!(current instanceof SourceModelDiscoveryError)) privateBodies.push(current.message)
      current = current.cause
    }
    serializeAgentDiagnosticError(failure, 'provider.model-discovery', {
      knownSensitiveValues: [input.credential, input.baseUrl].filter(
        (value): value is string => value !== undefined && value.length > 0
      ),
      privateBodies
    })
    throw failure
  } finally {
    clearTimeout(timer)
  }
}

function discoveryUrl(input: SourceModelDiscoveryInput): URL {
  const base =
    input.transport === 'google-gemini'
      ? GOOGLE_BASE
      : input.baseUrl === undefined
        ? input.transport === 'xai'
          ? XAI_BASE
          : 'https://api.openai.com/v1/'
        : `${input.baseUrl.replace(/\/+$/, '')}/`
  let url: URL
  try {
    url = new URL(base)
  } catch (err) {
    throw new SourceModelDiscoveryError('invalid_endpoint', { cause: err })
  }
  if (url.search || url.hash || url.username || url.password) {
    throw new SourceModelDiscoveryError('invalid_endpoint')
  }
  const path =
    input.transport === 'xai' && url.href === XAI_BASE ? 'image-generation-models' : 'models'
  url = new URL(path, url)
  if (input.transport === 'google-gemini') url.searchParams.set('pageSize', '1000')
  return url
}

function parsePage(
  value: unknown,
  transport: SourceModelDiscoveryInput['transport']
): { entries: unknown[]; nextPageToken?: string } {
  if (value === null || typeof value !== 'object') {
    throw new SourceModelDiscoveryError('invalid_response')
  }
  const object = value as Record<string, unknown>
  const entries = Array.isArray(object.data) ? object.data : object.models
  if (!Array.isArray(entries)) throw new SourceModelDiscoveryError('invalid_response')
  if (transport !== 'google-gemini') {
    if (object.has_more === true || object.nextPageToken) {
      throw new SourceModelDiscoveryError('invalid_response')
    }
    return { entries }
  }
  const token = object.nextPageToken
  if (token === undefined || token === null || token === '') return { entries }
  if (typeof token !== 'string' || token.length > 2048) {
    throw new SourceModelDiscoveryError('invalid_response')
  }
  return { entries, nextPageToken: token }
}

function parseCandidate(
  value: unknown,
  transport: SourceModelDiscoveryInput['transport']
): SourceModelCandidate {
  if (value === null || typeof value !== 'object') {
    throw new SourceModelDiscoveryError('invalid_response')
  }
  const object = value as Record<string, unknown>
  const id =
    typeof object.id === 'string'
      ? object.id
      : typeof object.name === 'string'
        ? transport === 'google-gemini'
          ? object.name.replace(/^models\//, '')
          : object.name
        : undefined
  const result = sourceModelCandidateSchema.safeParse({
    id,
    name: typeof object.displayName === 'string' ? object.displayName : id,
    ...(transport === 'google-gemini' &&
    Array.isArray(object.supportedGenerationMethods) &&
    object.supportedGenerationMethods.length > 0 &&
    !object.supportedGenerationMethods.includes('generateContent')
      ? { capability: 'other' }
      : {})
  })
  if (!result.success) throw new SourceModelDiscoveryError('invalid_response')
  return result.data
}
