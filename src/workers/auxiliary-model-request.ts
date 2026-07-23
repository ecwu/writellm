import { GoogleGenAI } from '@google/genai'
import type {
  AuxiliaryUtilityRequest,
  AuxiliaryUtilityResponse
} from '../shared/contracts/model-runtime'
import { effectiveGoogleGeminiImageSize } from '../shared/contracts/providers'
import { linkAbortSignal } from './shared/linked-abort-signal'

export async function runAuxiliaryModelRequest(
  request: AuxiliaryUtilityRequest,
  fetchImplementation: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AuxiliaryUtilityResponse> {
  if (request.operation === 'embedding') return runEmbedding(request, fetchImplementation, signal)
  if (request.operation === 'rerank') return runRerank(request, fetchImplementation, signal)
  return runImageGeneration(request, signal)
}

async function runImageGeneration(
  request: Extract<AuxiliaryUtilityRequest, { operation: 'image' }>,
  externalSignal?: AbortSignal
): Promise<AuxiliaryUtilityResponse> {
  if (request.config.role !== 'image') throw new Error('Image provider role is required')
  const controller = new AbortController()
  const unlink = linkAbortSignal(externalSignal, controller)
  const timeout = setTimeout(() => controller.abort(), request.config.timeoutMs)
  const effectiveImageSize = effectiveGoogleGeminiImageSize(
    request.config.model,
    request.input.imageSize
  )
  try {
    const ai = new GoogleGenAI({
      apiKey: request.credential
    })
    let interaction: Awaited<ReturnType<typeof ai.interactions.create>>
    try {
      interaction = await settleOnAbort(
        ai.interactions.create(
          {
            model: request.config.model,
            input: request.input.prompt,
            response_format: {
              type: 'image',
              // The Interactions API accepts only image/jpeg here; image/png is rejected with
              // HTTP 400. Main still validates the actual response magic for PNG and JPEG.
              mime_type: 'image/jpeg',
              ...(request.input.aspectRatio === 'auto'
                ? {}
                : { aspect_ratio: request.input.aspectRatio }),
              image_size: effectiveImageSize
            }
          },
          {
            signal: controller.signal,
            maxRetries: 0
          }
        ),
        controller.signal
      )
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          externalSignal?.aborted
            ? 'Gemini image request was cancelled'
            : 'Gemini image request timed out'
        )
      }
      throw safeGeminiSdkError(error)
    }
    const image = interaction.output_image
    if (image?.data === undefined) throw new Error('Gemini response did not contain one image')
    const mimeType = image.mime_type ?? 'image/jpeg'
    if (mimeType !== 'image/png' && mimeType !== 'image/jpeg') {
      throw new Error('Gemini returned an unsupported image MIME')
    }
    if (!isCanonicalBase64(image.data)) throw new Error('Gemini returned malformed image data')
    const responseId =
      typeof interaction.id === 'string' && interaction.id.length <= 500 ? interaction.id : null
    const usage = objectField(interaction, 'usage')
    return {
      type: 'image-result',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      result: {
        dataBase64: image.data,
        mimeType,
        effectiveImageSize,
        metadata: {
          usage: {
            inputTokens: numberField(usage, [
              'total_input_tokens',
              'input_tokens',
              'prompt_token_count'
            ]),
            outputTokens: numberField(usage, [
              'total_output_tokens',
              'output_tokens',
              'candidates_token_count'
            ]),
            cacheReadTokens: numberField(usage, ['total_cached_tokens', 'cached_tokens']),
            cacheWriteTokens: null,
            estimatedCostUsdMicros: null
          },
          responseIds: responseId === null ? [] : [responseId],
          retryCount: 0,
          providerModelId: request.config.model
        }
      }
    }
  } finally {
    clearTimeout(timeout)
    unlink()
  }
}

function settleOnAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<T>((resolve, reject) => {
    const finish = (callback: () => void): void => {
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = (): void => finish(() => reject(signal.reason))
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    )
  })
}

function safeGeminiSdkError(value: unknown): Error {
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
  const status = numericStatus(record)
  const providerCode =
    findMachineCode(record?.error) ??
    findMachineCodeFromJson(typeof record?.body === 'string' ? record.body : undefined)
  const error = new Error(
    `Gemini image request failed${status === undefined ? '' : ` with HTTP ${status}`}${
      providerCode === undefined ? '' : ` (${providerCode})`
    }`,
    { cause: value }
  ) as Error & {
    status?: number
    providerCode?: string
  }
  if (status !== undefined) error.status = status
  if (providerCode !== undefined) error.providerCode = providerCode
  return error
}

function numericStatus(value: Record<string, unknown> | null): number | undefined {
  if (value === null) return undefined
  for (const key of ['status', 'statusCode']) {
    const field = value[key]
    if (typeof field === 'number' && Number.isInteger(field) && field >= 100 && field <= 599) {
      return field
    }
  }
  return undefined
}

function findMachineCodeFromJson(responseText: string | undefined): string | undefined {
  if (responseText === undefined || responseText.length > 65_536) return undefined
  let value: unknown
  try {
    value = JSON.parse(responseText) as unknown
  } catch {
    return undefined
  }
  return findMachineCode(value)
}

function findMachineCode(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || value === null || typeof value !== 'object') return undefined
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) {
      const found = findMachineCode(item, depth + 1)
      if (found !== undefined) return found
    }
    return undefined
  }
  const record = value as Record<string, unknown>
  const reason = record.reason
  if (typeof reason === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(reason)) {
    return reason
  }
  for (const key of ['details', 'error']) {
    const found = findMachineCode(record[key], depth + 1)
    if (found !== undefined) return found
  }
  const status = record.status
  if (typeof status === 'string' && /^[A-Z][A-Z0-9_]{1,127}$/.test(status)) {
    return status
  }
  return undefined
}

function isCanonicalBase64(value: string): boolean {
  return (
    value.length <= 28_000_000 &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
}

function objectField(value: unknown, key: string): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const field = (value as Record<string, unknown>)[key]
  return field !== null && typeof field === 'object' && !Array.isArray(field)
    ? (field as Record<string, unknown>)
    : null
}

function numberField(value: Record<string, unknown> | null, keys: string[]): number | null {
  if (value === null) return null
  for (const key of keys) {
    const field = value[key]
    if (typeof field === 'number' && Number.isInteger(field) && field >= 0) return field
  }
  return null
}

async function runEmbedding(
  request: Extract<AuxiliaryUtilityRequest, { operation: 'embedding' }>,
  fetchImplementation: typeof fetch,
  externalSignal?: AbortSignal
): Promise<AuxiliaryUtilityResponse> {
  if (request.config.role !== 'embedding') throw new Error('Embedding provider role is required')
  const [{ embedMany }, { createOpenAICompatible }] = await Promise.all([
    import('ai'),
    import('@ai-sdk/openai-compatible')
  ])
  let fetchCount = 0
  const countedFetch: typeof fetch = (input, init) => {
    fetchCount += 1
    return fetchImplementation(input, init)
  }
  const provider = createOpenAICompatible({
    name: 'writellm-openai-compatible',
    baseURL: request.config.baseUrl,
    apiKey: request.credential,
    fetch: countedFetch
  })
  const controller = new AbortController()
  const unlink = linkAbortSignal(externalSignal, controller)
  const timeout = setTimeout(() => controller.abort(), request.config.timeoutMs)
  const embeddings: number[][] = []
  const responseIds: string[] = []
  let inputTokens = 0
  let calls = 0
  try {
    for (
      let offset = 0;
      offset < request.input.values.length;
      offset += request.config.batchLimit
    ) {
      const values = request.input.values.slice(offset, offset + request.config.batchLimit)
      calls += 1
      const result = await embedMany({
        model: provider.embeddingModel(request.config.model),
        values,
        maxParallelCalls: 1,
        maxRetries: 2,
        abortSignal: controller.signal,
        telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false }
      })
      inputTokens += result.usage.tokens
      embeddings.push(...result.embeddings)
      for (const response of result.responses ?? []) {
        const id = response?.headers?.['x-request-id'] ?? response?.headers?.['request-id']
        if (id !== undefined && id.length <= 500) responseIds.push(id)
      }
    }
  } finally {
    clearTimeout(timeout)
    unlink()
  }
  if (embeddings.length !== request.input.values.length) {
    throw new Error('Embedding provider returned an unexpected vector count')
  }
  const expectedDimension = request.config.embeddingDimension
  if (
    expectedDimension === null ||
    embeddings.some((embedding) => embedding.length !== expectedDimension)
  ) {
    throw new Error('Embedding provider returned an unexpected vector dimension')
  }
  return {
    type: 'embedding-result',
    requestId: request.requestId,
    projectSessionId: request.projectSessionId ?? null,
    result: {
      embeddings,
      metadata: {
        usage: {
          inputTokens,
          outputTokens: null,
          cacheReadTokens: null,
          cacheWriteTokens: null,
          estimatedCostUsdMicros: null
        },
        responseIds: [...new Set(responseIds)].slice(0, 100),
        retryCount: Math.max(0, fetchCount - calls),
        providerModelId: request.config.model
      }
    }
  }
}

async function runRerank(
  request: Extract<AuxiliaryUtilityRequest, { operation: 'rerank' }>,
  fetchImplementation: typeof fetch,
  externalSignal?: AbortSignal
): Promise<AuxiliaryUtilityResponse> {
  if (request.config.role !== 'rerank') throw new Error('Rerank provider role is required')
  const [{ rerank }, { createCohere }] = await Promise.all([import('ai'), import('@ai-sdk/cohere')])
  let fetchCount = 0
  const countedFetch: typeof fetch = (input, init) => {
    fetchCount += 1
    return fetchImplementation(input, init)
  }
  const provider = createCohere({
    baseURL: request.config.baseUrl,
    apiKey: request.credential,
    fetch: countedFetch
  })
  const controller = new AbortController()
  const unlink = linkAbortSignal(externalSignal, controller)
  const timeout = setTimeout(() => controller.abort(), request.config.timeoutMs)
  try {
    const result = await rerank({
      model: provider.reranking(request.config.model),
      documents: request.input.documents,
      query: request.input.query,
      topN: request.input.topN,
      maxRetries: 2,
      abortSignal: controller.signal,
      telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false }
    })
    if (
      result.ranking.length > request.input.topN ||
      result.ranking.some(({ originalIndex }) => originalIndex >= request.input.documents.length)
    ) {
      throw new Error('Rerank provider returned an invalid document index')
    }
    return {
      type: 'rerank-result',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId ?? null,
      result: {
        ranking: result.ranking.map(({ originalIndex, score }) => ({ originalIndex, score })),
        metadata: {
          usage: {
            inputTokens: null,
            outputTokens: null,
            cacheReadTokens: null,
            cacheWriteTokens: null,
            estimatedCostUsdMicros: null
          },
          responseIds: result.response.id === undefined ? [] : [result.response.id],
          retryCount: Math.max(0, fetchCount - 1),
          providerModelId: result.response.modelId
        }
      }
    }
  } finally {
    clearTimeout(timeout)
    unlink()
  }
}
