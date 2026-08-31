import type { Api, AssistantMessage } from '@earendil-works/pi-ai'
import type { AgentRunResult, AgentUtilityRequest } from '../shared/contracts/model-runtime'
import {
  AGENT_PROVIDER_MAX_RETRY_DELAY_MS,
  createRetryingAgentProviderStream,
  type AgentProviderRetryState,
  parseRetryAfterMs
} from './agent-provider-stream'
import {
  apiKeyForProvider,
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
  }) => Promise<void>
): Promise<AgentRunResult> {
  if (request.config.role !== 'agent') throw new Error('Agent utility requires an agent provider')

  const [{ Agent }, streamSimple] = await Promise.all([
    import('@earendil-works/pi-agent-core'),
    loadAgentStreamSimple(request.config.api ?? 'openai-completions')
  ])
  const model = buildAgentProviderModel({
    config: request.config,
    modelLimits: request.modelLimits,
    maxOutputTokens: request.input.maxOutputTokens
  })
  let lastResponseStatus: number | undefined
  let retryAfterMs: number | undefined
  let responseHeaders: Record<string, string> = {}
  let retryState: AgentProviderRetryState | undefined
  let physicalAttempt = 0
  const startedAt = Date.now()
  let ttftMs: number | undefined
  let terminalTraceError: Error | undefined
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
                try {
                  await onTraceCapture({
                    apiId: payloadModel.api,
                    physicalAttempt: attempt,
                    documents: [
                      {
                        kind: 'harness_request',
                        value: jsonValue({
                          systemPrompt: context.systemPrompt,
                          messages: context.messages,
                          tools: context.tools
                        })
                      },
                      {
                        kind: 'provider_request',
                        value: jsonValue(transformed === undefined ? payload : transformed)
                      }
                    ]
                  })
                } catch (err) {
                  terminalTraceError = traceErrorFrom(err)
                  throw terminalTraceError
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
        createErrorMessage: (error, aborted) => providerErrorMessage(activeModel, error, aborted),
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
    await agent.prompt(request.input.prompt)
    await agent.waitForIdle()
  } finally {
    externalSignal?.removeEventListener('abort', abortExternal)
  }

  const finalMessage = [...agent.state.messages]
    .reverse()
    .find((message) => message.role === 'assistant')
  if (terminalTraceError !== undefined) throw terminalTraceError
  if (finalMessage === undefined || finalMessage.role !== 'assistant') {
    throw new Error('Agent completed without an assistant response')
  }
  if (onTraceCapture !== undefined) {
    await onTraceCapture({
      apiId: model.api,
      physicalAttempt: Math.max(1, physicalAttempt),
      documents: [
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
      ]
    })
  }
  if (finalMessage.stopReason === 'error') {
    const error: Error & { status?: number } = new Error(
      finalMessage.errorMessage || 'Agent provider request failed'
    )
    if (retryState?.exhausted) {
      error.name = 'ProviderRetriesExhaustedError'
      error.message = 'Agent provider request failed after 5 attempts'
    }
    if (lastResponseStatus !== undefined) error.status = lastResponseStatus
    throw error
  }
  if (finalMessage.stopReason === 'aborted') {
    const error = new Error('Agent provider request aborted')
    error.name = 'AbortError'
    throw error
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

function traceErrorFrom(error: unknown): Error & { code: string } {
  if (
    error instanceof Error &&
    'code' in error &&
    (error.code === 'trace_capture_failed' || error.code === 'trace_payload_too_large')
  ) {
    return error as Error & { code: string }
  }
  return traceError('trace_capture_failed', { cause: error })
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

function jsonValue(value: unknown): null | boolean | number | string | unknown[] | object {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw traceError('trace_capture_failed')
  return JSON.parse(serialized) as null | boolean | number | string | unknown[] | object
}

function traceError(
  code: 'trace_capture_failed' | 'trace_payload_too_large',
  options?: ErrorOptions
): Error & { code: string } {
  const error: Error & { code: string } = new Error(
    'Agent request trace could not be persisted',
    options
  )
  error.name = 'AgentTracePersistenceError'
  error.code = code
  return error
}

function providerErrorMessage(
  model: { api: Api; provider: string; id: string },
  error: unknown,
  aborted: boolean
): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: aborted ? 'aborted' : 'error',
    errorMessage: error instanceof Error ? error.message : String(error),
    timestamp: Date.now()
  }
}
