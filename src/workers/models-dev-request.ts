import { z } from 'zod'
import {
  modelsDevResolveResponseSchema,
  type ModelsDevResolveRequest,
  type ModelsDevResolveResponse
} from '../shared/contracts/model-catalog'

const CATALOG_URL = 'https://models.dev/api.json'
const MAX_CATALOG_BYTES = 16 * 1_024 * 1_024

const limitSchema = z
  .object({
    context: z.number().int().min(8_192).max(10_000_000),
    input: z.number().int().min(1).max(10_000_000).optional(),
    output: z.number().int().min(1).max(1_000_000).optional()
  })
  .passthrough()
const modelSchema = z.object({ limit: limitSchema }).passthrough()
const providerSchema = z
  .object({
    api: z.string().url().max(2_048).optional(),
    models: z.record(z.string().max(500), modelSchema)
  })
  .passthrough()
const catalogSchema = z.record(z.string().max(256), providerSchema)

export async function runModelsDevRequest(
  request: ModelsDevResolveRequest,
  fetchImplementation: typeof fetch,
  signal: AbortSignal
): Promise<ModelsDevResolveResponse> {
  const response = await fetchImplementation(CATALOG_URL, {
    method: 'GET',
    headers: { accept: 'application/json' },
    redirect: 'error',
    signal
  })
  if (!response.ok) throw new Error(`models.dev returned HTTP ${response.status}`)
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CATALOG_BYTES) {
    throw new Error('models.dev catalog exceeds the response size limit')
  }
  const text = await readBoundedText(response, MAX_CATALOG_BYTES)
  const catalog = catalogSchema.parse(JSON.parse(text))
  const match = findMatch(catalog, request.baseUrl, request.model)
  return modelsDevResolveResponseSchema.parse({
    type: 'models-dev-result',
    requestId: request.requestId,
    limits:
      match === null
        ? null
        : {
            contextWindowTokens: match.limit.context,
            inputLimitTokens: match.limit.input ?? null,
            outputLimitTokens: match.limit.output ?? null,
            source: 'models_dev',
            catalogModelKey: `${match.providerId}/${match.modelId}`,
            resolvedAt: new Date().toISOString()
          }
  })
}

async function readBoundedText(response: Response, maximumBytes: number): Promise<string> {
  if (response.body === null) return response.text()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maximumBytes) {
      await reader.cancel()
      throw new Error('models.dev catalog exceeds the response size limit')
    }
    chunks.push(value)
  }
  const combined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(combined)
}

type Catalog = z.infer<typeof catalogSchema>
type Match = { providerId: string; modelId: string; limit: z.infer<typeof limitSchema> }

function findMatch(catalog: Catalog, baseUrl: string, configuredModel: string): Match | null {
  const separator = configuredModel.indexOf('/')
  if (separator > 0) {
    const providerId = configuredModel.slice(0, separator)
    const modelId = configuredModel.slice(separator + 1)
    const model = catalog[providerId]?.models[modelId]
    if (model !== undefined) return { providerId, modelId, limit: model.limit }
  }

  const apiMatches: Match[] = []
  for (const [providerId, provider] of Object.entries(catalog)) {
    if (provider.api === undefined || !sameApi(provider.api, baseUrl)) continue
    const model = provider.models[configuredModel]
    if (model !== undefined)
      apiMatches.push({ providerId, modelId: configuredModel, limit: model.limit })
  }
  if (apiMatches.length === 1) return apiMatches[0] ?? null

  const uniqueMatches: Match[] = []
  for (const [providerId, provider] of Object.entries(catalog)) {
    const model = provider.models[configuredModel]
    if (model !== undefined)
      uniqueMatches.push({ providerId, modelId: configuredModel, limit: model.limit })
  }
  return uniqueMatches.length === 1 ? (uniqueMatches[0] ?? null) : null
}

function sameApi(catalogApi: string, configuredBaseUrl: string): boolean {
  try {
    const left = new URL(catalogApi)
    const right = new URL(configuredBaseUrl)
    const normalizePath = (path: string): string => path.replace(/\/+$/, '') || '/'
    return (
      left.origin === right.origin && normalizePath(left.pathname) === normalizePath(right.pathname)
    )
  } catch {
    return false
  }
}
