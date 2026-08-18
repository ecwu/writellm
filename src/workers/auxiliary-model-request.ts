import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'
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
  return runImageGeneration(request, fetchImplementation, signal)
}

async function runImageGeneration(
  request: Extract<AuxiliaryUtilityRequest, { operation: 'image' }>,
  fetchImplementation: typeof fetch,
  externalSignal?: AbortSignal
): Promise<AuxiliaryUtilityResponse> {
  if (request.config.role !== 'image') throw new Error('Image provider role is required')
  if (request.config.providerId !== 'google-gemini') {
    return runOpenAiCompatibleImageGeneration(request, fetchImplementation, externalSignal)
  }
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

async function runOpenAiCompatibleImageGeneration(
  request: Extract<AuxiliaryUtilityRequest, { operation: 'image' }>,
  fetchImplementation: typeof fetch,
  externalSignal?: AbortSignal
): Promise<AuxiliaryUtilityResponse> {
  if (request.config.role !== 'image' || request.config.providerId === 'google-gemini') {
    throw new Error('OpenAI-compatible image provider is required')
  }
  const controller = new AbortController()
  const unlink = linkAbortSignal(externalSignal, controller)
  const timeout = setTimeout(() => controller.abort(), request.config.timeoutMs)
  const providerLabel = request.config.providerId === 'openai' ? 'OpenAI' : 'xAI'
  try {
    const client = new OpenAI({
      apiKey: request.credential,
      baseURL:
        request.config.providerId === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1',
      maxRetries: 0,
      fetch: fetchImplementation
    })
    const effectiveImageSize =
      request.config.providerId === 'openai' && request.input.aspectRatio === 'auto'
        ? null
        : request.input.imageSize
    const params =
      request.config.providerId === 'openai'
        ? {
            model: request.config.model,
            prompt: request.input.prompt,
            n: 1,
            quality: 'auto' as const,
            output_format: 'png' as const,
            size: openAiImageSize(request.input.aspectRatio, request.input.imageSize)
          }
        : {
            model: request.config.model,
            prompt: request.input.prompt,
            n: 1,
            response_format: 'b64_json' as const,
            aspect_ratio: request.input.aspectRatio,
            resolution: request.input.imageSize.toLowerCase()
          }
    let result: Awaited<ReturnType<ReturnType<typeof client.images.generate>['withResponse']>>
    try {
      result = await settleOnAbort(
        client.images
          .generate(params as OpenAI.Images.ImageGenerateParamsNonStreaming, {
            signal: controller.signal
          })
          .withResponse(),
        controller.signal
      )
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          externalSignal?.aborted
            ? `${providerLabel} image request was cancelled`
            : `${providerLabel} image request timed out`
        )
      }
      throw safeSdkError(providerLabel, error)
    }
    const images = result.data.data
    if (images.length !== 1 || images[0]?.b64_json === undefined) {
      throw new Error(`${providerLabel} response did not contain one base64 image`)
    }
    const dataBase64 = images[0].b64_json
    if (!isCanonicalBase64(dataBase64)) {
      throw new Error(`${providerLabel} returned malformed image data`)
    }
    const detectedMime = detectImageMime(dataBase64)
    if (detectedMime === null) throw new Error(`${providerLabel} returned unsupported image data`)
    if (request.config.providerId === 'openai' && detectedMime !== 'image/png') {
      throw new Error('OpenAI returned a non-PNG image')
    }
    const usage = objectField(result.data, 'usage')
    return {
      type: 'image-result',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      result: {
        dataBase64,
        mimeType: detectedMime,
        effectiveImageSize,
        metadata: {
          usage: {
            inputTokens: numberField(usage, ['input_tokens']),
            outputTokens: numberField(usage, ['output_tokens']),
            cacheReadTokens: null,
            cacheWriteTokens: null,
            estimatedCostUsdMicros: null
          },
          responseIds:
            result.request_id === null || result.request_id.length > 500 ? [] : [result.request_id],
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

function openAiImageSize(aspectRatio: 'auto' | '1:1' | '16:9', imageSize: '1K' | '2K'): string {
  if (aspectRatio === 'auto') return 'auto'
  if (aspectRatio === '1:1') return imageSize === '1K' ? '1024x1024' : '2048x2048'
  return imageSize === '1K' ? '1280x720' : '2048x1152'
}

function detectImageMime(dataBase64: string): 'image/png' | 'image/jpeg' | null {
  const bytes = Buffer.from(dataBase64.slice(0, 32), 'base64')
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  return null
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

function safeSdkError(providerLabel: string, value: unknown): Error {
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null
  const status = numericStatus(record)
  const providerCode = normalizeMachineCode(
    stringValue(record?.code) ?? stringValue(objectField(record, 'error')?.code)
  )
  const error = new Error(
    `${providerLabel} image request failed${status === undefined ? '' : ` with HTTP ${status}`}${
      providerCode === undefined ? '' : ` (${providerCode})`
    }`,
    { cause: value }
  ) as Error & { status?: number; providerCode?: string }
  if (status !== undefined) error.status = status
  if (providerCode !== undefined) error.providerCode = providerCode
  return error
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 200 ? value : undefined
}

function normalizeMachineCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
  return /^[A-Z][A-Z0-9_]{1,127}$/.test(normalized) ? normalized : undefined
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
