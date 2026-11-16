import type { Logger } from 'pino'
import { z } from 'zod'
import {
  sourceModelCandidateSchema,
  type SourceModelCandidate
} from '../../shared/contracts/providers'
import { serializeAgentDiagnosticError } from '../../shared/agent-diagnostic-error'
import { fetchConfiguredEndpoint, readBoundedBody } from '../../workers/outbound-http'
import type { SourceModelDiscoveryInput } from './source-model-discovery'

export const SOURCE_MODEL_METADATA_URL =
  'https://models.dev/experimental/v2.0/api.json?type=image,transcription'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_METADATA_BYTES = 16 * 1024 * 1024
const MAX_METADATA_MODELS = 20000
const MAX_CANDIDATES = 2000
const operationSchema = z.object({ base_url: z.string().max(2048).optional() }).passthrough()
const metadataModelSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(200).optional(),
    type: z.string().max(100),
    api: z.record(z.string().max(100), operationSchema)
  })
  .passthrough()

type MetadataModel = z.infer<typeof metadataModelSchema> & { providerId: string }

/** This cache contains public metadata only. It never receives source credentials. */
export class SourceModelMetadata {
  #cached: MetadataModel[] | undefined
  #checkedAt = 0
  #inflight: Promise<MetadataModel[]> | undefined

  constructor(
    private readonly fetchImplementation: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now
  ) {}

  async candidates(
    input: Pick<SourceModelDiscoveryInput, 'transport' | 'baseUrl'>,
    providerModels: SourceModelCandidate[] | null,
    signal: AbortSignal,
    log: Pick<Logger, 'warn'>
  ): Promise<SourceModelCandidate[]> {
    signal.throwIfAborted()
    const models = await awaitWithSignal(this.#load(log), signal)
    const providerId = matchingProvider(input, models)
    const matched =
      providerId === undefined ? [] : models.filter((model) => model.providerId === providerId)
    const byId = new Map(matched.map((model) => [model.id, model]))
    const candidates: SourceModelCandidate[] =
      providerModels ??
      matched
        .filter((model) => {
          const capability = classifyModel(model, input.transport).capability
          return capability === 'image' || capability === 'transcription'
        })
        .map((model) => ({ id: model.id, name: model.name ?? model.id }))
    return candidates.slice(0, MAX_CANDIDATES).map((candidate) => {
      const model = byId.get(candidate.id)
      const classification =
        model === undefined || candidate.capability === 'other'
          ? { capability: candidate.capability ?? ('unknown' as const) }
          : classifyModel(model, input.transport)
      return sourceModelCandidateSchema.parse({
        ...candidate,
        ...classification,
        ...(model === undefined ? {} : { metadataSource: 'models.dev' }),
        availability: providerModels === null ? 'catalog' : 'provider'
      })
    })
  }

  async #load(log: Pick<Logger, 'warn'>): Promise<MetadataModel[]> {
    if (this.#cached !== undefined && this.now() - this.#checkedAt < CACHE_TTL_MS)
      return this.#cached
    if (this.#inflight !== undefined) return this.#inflight
    this.#inflight = this.#refresh(log)
    try {
      return await this.#inflight
    } finally {
      this.#inflight = undefined
    }
  }

  async #refresh(log: Pick<Logger, 'warn'>): Promise<MetadataModel[]> {
    try {
      const response = await fetchConfiguredEndpoint(
        SOURCE_MODEL_METADATA_URL,
        {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(15000)
        },
        this.fetchImplementation
      )
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error(`Public model metadata returned HTTP ${response.status}`)
      }
      const bytes = await readBoundedBody(response, MAX_METADATA_BYTES)
      const models = parseMetadata(JSON.parse(new TextDecoder().decode(bytes)))
      this.#cached = models
      this.#checkedAt = this.now()
      return models
    } catch (err) {
      serializeAgentDiagnosticError(err, 'provider.public-model-metadata', {
        privateBodies: err instanceof Error ? [err.message] : []
      })
      log.warn(
        { event: 'provider.public_model_metadata.failed', err },
        'Public model metadata refresh failed'
      )
      return this.#cached ?? []
    }
  }
}

function parseMetadata(value: unknown): MetadataModel[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Public model metadata format is invalid')
  }
  const models: MetadataModel[] = []
  for (const [providerId, provider] of Object.entries(value)) {
    if (providerId.length > 200 || provider === null || typeof provider !== 'object') continue
    const entries = 'models' in provider ? provider.models : undefined
    if (entries === null || typeof entries !== 'object' || Array.isArray(entries)) continue
    for (const [id, entry] of Object.entries(entries)) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const parsed = metadataModelSchema.safeParse({ ...entry, id })
      if (!parsed.success) continue
      models.push({ ...parsed.data, providerId })
      if (models.length > MAX_METADATA_MODELS)
        throw new Error('Public model metadata exceeds the model limit')
    }
  }
  if (models.length === 0) throw new Error('Public model metadata contains no supported entries')
  return models
}

function normalizeApi(value: string | undefined): string | undefined {
  if (value === undefined || !URL.canParse(value) || value.includes('${')) return undefined
  const url = new URL(value)
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return undefined
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

function matchingProvider(
  input: Pick<SourceModelDiscoveryInput, 'transport' | 'baseUrl'>,
  models: MetadataModel[]
): string | undefined {
  if (input.transport === 'google-gemini') return 'google'
  if (input.transport === 'google-vertex') return 'google-vertex'
  const api = normalizeApi(
    input.baseUrl ??
      (input.transport === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1')
  )
  if (api === 'https://api.openai.com/v1') return 'openai'
  if (api === 'https://api.x.ai/v1') return 'xai'
  if (api === undefined) return undefined
  const providers = new Set(
    models
      .filter((model) =>
        Object.values(model.api).some((operation) => normalizeApi(operation.base_url) === api)
      )
      .map((model) => model.providerId)
  )
  return providers.size === 1 ? [...providers][0] : undefined
}

function classifyModel(
  model: MetadataModel,
  transport: SourceModelDiscoveryInput['transport']
): Pick<SourceModelCandidate, 'capability' | 'speechModes'> {
  if (model.type === 'image') {
    const compatible =
      transport === 'google-gemini' || transport === 'google-vertex'
        ? model.api['generate-content'] !== undefined
        : model.api.images !== undefined
    return {
      capability: compatible ? 'image' : Object.keys(model.api).length > 0 ? 'other' : 'unknown'
    }
  }
  if (model.type === 'transcription') {
    const speechModes: Array<'realtime' | 'file'> = []
    if (model.api.realtime !== undefined) speechModes.push('realtime')
    if (model.api.transcriptions !== undefined) speechModes.push('file')
    return speechModes.length === 0
      ? { capability: Object.keys(model.api).length > 0 ? 'other' : 'unknown' }
      : { capability: 'transcription', speechModes }
  }
  return { capability: 'other' }
}

async function awaitWithSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let abort: (() => void) | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        abort = () => reject(signal.reason)
        signal.addEventListener('abort', abort, { once: true })
      })
    ])
  } finally {
    if (abort !== undefined) signal.removeEventListener('abort', abort)
  }
}
