import { providerErrorDetails, providerErrorMessage } from './agent-provider-errors'
import { createAbortError } from '../shared/abort-error'
import { traceJsonValue as jsonValue } from '../shared/trace-image-redaction'
import type { AgentRunResult, AgentUtilityRequest } from '../shared/contracts/model-runtime'
import {
  AGENT_PROVIDER_MAX_RETRY_DELAY_MS,
  createRetryingAgentProviderStream,
  type AgentProviderRetryState,
  parseRetryAfterMs
} from './agent-provider-stream'
import {
  apiKeyForProvider,
  AgentOutputLimitError,
  buildAgentProviderModel,
  loadAgentStreamSimple
} from './agent-provider-runtime'

export async function runAgentModelRequest(
  request: AgentUtilityRequest,
  onTextDelta: (delta: string) => void,
  externalSignal?: AbortSignal,
  onTraceCapture?: (input: {
    apiId: string
    physicalAttempt: number
    documents: Array<{
      kind: 'harness_request' | 'provider_request' | 'provider_response'
      value: unknown
      metadata?: Record<string, unknown>
    }>
  }) => void | Promise<void>,
  onTraceError?: (error: unknown) => void
): Promise<AgentRunResult> {
  if (request.config.role !== 'agent') throw new Error('Agent utility requires an agent provider')

  const [{ Agent }, streamSimple] = await Promise.all([
    import('@earendil-works/pi-agent-core'),
    loadAgentStreamSimple(request.config.api ?? 'openai-completions')
  ])
  const model = buildAgentProviderModel({
    config: request.config,
    modelLimits: request.modelLimits,
    maxOutputTokens: request.input.maxOutputTokens,
    imageInput: (request.input.images?.length ?? 0) > 0
  })
  let lastResponseStatus: number | undefined
  let retryAfterMs: number | undefined
  let responseHeaders: Record<string, string> = {}
  let retryState: AgentProviderRetryState | undefined
  let lastProviderError: unknown
  let physicalAttempt = 0
  const startedAt = Date.now()
  let ttftMs: number | undefined
  const agent = new Agent({
    initialState: {
      systemPrompt: request.input.systemPrompt,
      model,
      thinkingLevel: 'off',
      tools: [],
      messages: []
    },
    getApiKey: (providerId) =>
      apiKeyForProvider(request.credential, request.config.providerId, providerId),
    streamFn: (activeModel, context, options) => {
      const retrying = createRetryingAgentProviderStream({
        signal: options?.signal,
        startAttempt: () => {
          physicalAttempt += 1
          const attempt = physicalAttempt
          lastResponseStatus = undefined
          retryAfterMs = undefined
          responseHeaders = {}
          return streamSimple(activeModel, context, {
            ...options,
            ...(request.input.temperature === undefined
              ? {}
              : { temperature: request.input.temperature }),
            maxTokens: request.input.maxOutputTokens,
            maxRetries: 0,
            headers: request.credential.headers,
            env: request.credential.env,
            maxRetryDelayMs: AGENT_PROVIDER_MAX_RETRY_DELAY_MS,
            timeoutMs: undefined,
            onPayload: async (payload, payloadModel) => {
              const transformed = await options?.onPayload?.(payload, payloadModel)
              if (onTraceCapture !== undefined) {
                const trace = makeTraceCapture(
                  onTraceCapture,
                  payloadModel.api,
                  attempt,
                  () => [
                    {
                      kind: 'harness_request',
                      value: jsonValue({
                        messages: context.messages
                      })
                    },
                    {
                      kind: 'provider_request',
                      value: jsonValue(transformed === undefined ? payload : transformed)
                    }
                  ],
                  onTraceError
                )
                if (trace !== undefined) {
                  void Promise.resolve(trace).catch((error) =>
                    reportTraceError(onTraceError, error)
                  )
                }
              }
              return transformed
            },
            onResponse: async (response, responseModel) => {
              lastResponseStatus = response.status
              retryAfterMs = parseRetryAfterMs(response.headers)
              responseHeaders = safeProviderResponseHeaders(response.headers)
              await options?.onResponse?.(response, responseModel)
            }
          })
        },
        responseStatus: () => lastResponseStatus,
        retryAfterMs: () => retryAfterMs,
        createErrorMessage: (error, aborted) => {
          lastProviderError = error
          return providerErrorMessage(activeModel, error, aborted)
        },
        onFirstAssistantContent: () => {
          ttftMs ??= Math.max(0, Date.now() - startedAt)
        },
        onRetry: () => undefined
      })
      retryState = retrying.state
      return retrying.stream
    },
    maxRetryDelayMs: AGENT_PROVIDER_MAX_RETRY_DELAY_MS,
    toolExecution: 'sequential'
  })
  agent.subscribe((event) => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta' &&
      event.assistantMessageEvent.delta.length > 0
    ) {
      onTextDelta(event.assistantMessageEvent.delta)
    }
  })
  const abortExternal = (): void => agent.abort()
  if (externalSignal?.aborted) agent.abort()
  else externalSignal?.addEventListener('abort', abortExternal, { once: true })
  try {
    await agent.prompt(
      request.input.prompt,
      request.input.images?.map(({ type, data, mimeType }) => ({ type, data, mimeType }))
    )
    await agent.waitForIdle()
  } finally {
    externalSignal?.removeEventListener('abort', abortExternal)
  }

  const finalMessage = [...agent.state.messages]
    .reverse()
    .find((message) => message.role === 'assistant')
  if (finalMessage === undefined || finalMessage.role !== 'assistant') {
    throw new Error('Agent completed without an assistant response')
  }
  if (onTraceCapture !== undefined) {
    const trace = makeTraceCapture(
      onTraceCapture,
      model.api,
      Math.max(1, physicalAttempt),
      () => [
        {
          kind: 'provider_response',
          value: jsonValue(finalMessage),
          metadata: {
            ...(lastResponseStatus === undefined ? {} : { httpStatus: lastResponseStatus }),
            responseHeaders,
            ...(ttftMs === undefined ? {} : { ttftMs }),
            totalDurationMs: Math.max(0, Date.now() - startedAt)
          }
        }
      ],
      onTraceError
    )
    if (trace !== undefined) {
      void Promise.resolve(trace).catch((error) => reportTraceError(onTraceError, error))
    }
  }
  if (finalMessage.stopReason === 'error') {
    const providerDetails = providerErrorDetails(finalMessage, lastProviderError)
    const error: Error & { status?: number; code?: string } = new Error(
      finalMessage.errorMessage || 'Agent provider request failed',
      providerDetails.cause === undefined ? undefined : { cause: providerDetails.cause }
    )
    if (retryState?.exhausted) {
      error.name = 'ProviderRetriesExhaustedError'
    }
    const status = providerDetails.status ?? lastResponseStatus
    if (status !== undefined) error.status = status
    if (providerDetails.code !== undefined) error.code = providerDetails.code
    throw error
  }
  if (finalMessage.stopReason === 'aborted') {
    throw createAbortError('Agent provider request aborted')
  }
  if (finalMessage.stopReason === 'length') {
    throw new AgentOutputLimitError(request.input.maxOutputTokens)
  }
  const text = finalMessage.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
  return {
    text,
    stopReason: finalMessage.stopReason,
    metadata: {
      usage: {
        inputTokens: finalMessage.usage.input,
        outputTokens: finalMessage.usage.output,
        cacheReadTokens: finalMessage.usage.cacheRead,
        cacheWriteTokens: finalMessage.usage.cacheWrite,
        estimatedCostUsdMicros: null
      },
      responseIds: finalMessage.responseId === undefined ? [] : [finalMessage.responseId],
      retryCount: retryState?.retryCount ?? 0,
      providerModelId: finalMessage.responseModel ?? finalMessage.model
    }
  }
}

function safeProviderResponseHeaders(
  headers: Readonly<Record<string, string>>
): Record<string, string> {
  const allowed = new Set([
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
  return Object.fromEntries(
    Object.entries(headers)
      .map(([name, value]) => [name.toLowerCase(), value] as const)
      .filter(([name]) => allowed.has(name))
      .map(([name, value]) => [name, value.slice(0, 2_048)])
  )
}

function makeTraceCapture(
  onTraceCapture: (input: {
    apiId: string
    physicalAttempt: number
    documents: Array<{
      kind: 'harness_request' | 'provider_request' | 'provider_response'
      value: unknown
      metadata?: Record<string, unknown>
    }>
  }) => void | Promise<void>,
  apiId: string,
  physicalAttempt: number,
  documents: () => Array<{
    kind: 'harness_request' | 'provider_request' | 'provider_response'
    value: unknown
    metadata?: Record<string, unknown>
  }>,
  onTraceError?: (error: unknown) => void
): void | Promise<void> {
  try {
    return onTraceCapture({ apiId, physicalAttempt, documents: documents() })
  } catch (error) {
    reportTraceError(onTraceError, error)
    return undefined
  }
}

function reportTraceError(
  onTraceError: ((error: unknown) => void) | undefined,
  error: unknown
): void {
  if (onTraceError === undefined) return
  try {
    onTraceError(error)
    // error-handling: allow owner=agent-trace reason=reporter-fallback
  } catch {
    // Trace is observational. If its reporter transport is closed, no safe
    // diagnostic channel remains; keep the provider result independent of it.
  }
}
