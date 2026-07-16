import type {
  AuxiliaryUtilityRequest,
  AuxiliaryUtilityResponse
} from '../shared/contracts/model-runtime'
import { linkAbortSignal } from './shared/linked-abort-signal'

export async function runAuxiliaryModelRequest(
  request: AuxiliaryUtilityRequest,
  fetchImplementation: typeof fetch = fetch,
  signal?: AbortSignal
): Promise<AuxiliaryUtilityResponse> {
  return request.operation === 'embedding'
    ? runEmbedding(request, fetchImplementation, signal)
    : runRerank(request, fetchImplementation, signal)
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
