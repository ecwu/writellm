import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'
import type {
  ProviderProbeRequest,
  ProviderProbeResponse
} from '../shared/contracts/provider-probe'
import { fetchConfiguredEndpoint, readBoundedText } from './outbound-http'
import { createGoogleVertexClient, type GoogleVertexClientFactory } from './google-vertex-client'

export async function runProviderProbeRequest(
  request: ProviderProbeRequest,
  fetchImplementation: typeof fetch = fetch,
  signal?: AbortSignal,
  googleVertexClientFactory: GoogleVertexClientFactory = createGoogleVertexClient
): Promise<ProviderProbeResponse> {
  try {
    if (request.config.role === 'image') {
      if (request.config.providerId === 'google-gemini') {
        return await runGeminiProviderProbe(request, signal)
      }
      if (request.config.providerId === 'google-vertex') {
        return await runGoogleVertexProviderProbe(request, signal, googleVertexClientFactory)
      }
      return await runOpenAiProviderProbe(request, fetchImplementation, signal)
    }
    const path =
      request.config.role === 'mineru' ? 'api/v4/extract/task/__writellm_probe__' : 'models'
    const response = await fetchConfiguredEndpoint(
      new URL(path, `${request.config.baseUrl}/`),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${request.credential}`, Accept: 'application/json' },
        signal
      },
      fetchImplementation
    )
    if (request.config.role !== 'mineru') {
      return {
        type: 'result',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId ?? null,
        status: response.status
      }
    }

    const body = await readBoundedText(response, 4_096)
    try {
      const value = JSON.parse(body) as { code?: unknown }
      return {
        type: 'result',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId ?? null,
        status: response.status,
        providerCode: String(value.code ?? '')
      }
    } catch {
      return {
        type: 'result',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId ?? null,
        status: response.status
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error('Provider probe failed', { cause: err })
    return {
      type: 'error',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId ?? null,
      error: {
        name: error.name.slice(0, 200),
        message: error.message.slice(0, 4_096),
        ...(error.stack === undefined ? {} : { stack: error.stack.slice(0, 32_768) })
      }
    }
  }
}

async function runOpenAiProviderProbe(
  request: ProviderProbeRequest,
  fetchImplementation: typeof fetch,
  signal?: AbortSignal
): Promise<ProviderProbeResponse> {
  if (
    request.config.role !== 'image' ||
    request.config.providerId === 'google-gemini' ||
    request.config.providerId === 'google-vertex'
  ) {
    throw new Error('OpenAI-compatible image provider is required')
  }
  const client = new OpenAI({
    apiKey: request.credential,
    baseURL:
      request.config.providerId === 'xai' ? 'https://api.x.ai/v1' : 'https://api.openai.com/v1',
    maxRetries: 0,
    fetch: fetchImplementation
  })
  try {
    await client.models.retrieve(request.config.model, { signal })
    return {
      type: 'result',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId ?? null,
      status: 200
    }
  } catch (error) {
    const status = sdkHttpStatus(error)
    if (status !== undefined) {
      return {
        type: 'result',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId ?? null,
        status
      }
    }
    if (signal?.aborted) {
      const aborted = new Error('Image provider probe aborted')
      aborted.name = 'AbortError'
      throw aborted
    }
    throw new Error('Image provider probe failed', { cause: error })
  }
}

async function runGoogleVertexProviderProbe(
  request: ProviderProbeRequest,
  signal: AbortSignal | undefined,
  googleVertexClientFactory: GoogleVertexClientFactory
): Promise<ProviderProbeResponse> {
  if (request.config.role !== 'image' || request.config.providerId !== 'google-vertex') {
    throw new Error('Google Vertex image provider is required')
  }
  const models = googleVertexClientFactory({
    project: request.config.projectId,
    location: request.config.location
  })
  try {
    await models.countTokens({
      model: request.config.model,
      contents: 'WriteLLM connection probe',
      ...(signal === undefined ? {} : { config: { abortSignal: signal } })
    })
    return {
      type: 'result',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId ?? null,
      status: 200
    }
  } catch (error) {
    const status = sdkHttpStatus(error)
    if (status !== undefined) {
      return {
        type: 'result',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId ?? null,
        status
      }
    }
    if (signal?.aborted) {
      const aborted = new Error('Google Vertex provider probe aborted')
      aborted.name = 'AbortError'
      throw aborted
    }
    throw new Error('Google Vertex provider probe failed', { cause: error })
  }
}

async function runGeminiProviderProbe(
  request: ProviderProbeRequest,
  signal?: AbortSignal
): Promise<ProviderProbeResponse> {
  const ai = new GoogleGenAI({ apiKey: request.credential })
  try {
    await ai.models.get({
      model: request.config.model,
      ...(signal === undefined ? {} : { config: { abortSignal: signal } })
    })
    return {
      type: 'result',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId ?? null,
      status: 200
    }
  } catch (error) {
    const status = sdkHttpStatus(error)
    if (status !== undefined) {
      return {
        type: 'result',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId ?? null,
        status
      }
    }
    if (signal?.aborted) {
      const aborted = new Error('Gemini provider probe aborted')
      aborted.name = 'AbortError'
      throw aborted
    }
    throw new Error('Gemini provider probe failed')
  }
}

function sdkHttpStatus(value: unknown): number | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  for (const key of ['status', 'statusCode']) {
    const status = record[key]
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status
    }
  }
  return undefined
}
