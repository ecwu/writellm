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
  AgentOutputLimitError,
  buildAgentProviderModel,
  loadAgentStreamSimple
} from './agent-provider-runtime'
import { safeAgentDiagnosticMessage } from '../shared/agent-diagnostic-error'

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
    maxOutputTokens: request.input.maxOutputTokens
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
                        systemPrompt: context.systemPrompt,
                        messages: context.messages,
                        tools: context.tools
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
    await agent.prompt(request.input.prompt)
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
    const error = new Error('Agent provider request aborted')
    error.name = 'AbortError'
    throw error
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
  } catch {
    // Trace is observational. If its reporter transport is closed, no safe
    // diagnostic channel remains; keep the provider result independent of it.
  }
}

function jsonValue(value: unknown): null | boolean | number | string | unknown[] | object {
  const serialized = JSON.stringify(value)
  if (serialized === undefined) throw new Error('Agent trace payload is not JSON serializable')
  return JSON.parse(serialized) as null | boolean | number | string | unknown[] | object
}

function providerErrorMessage(
  model: { api: Api; provider: string; id: string },
  error: unknown,
  aborted: boolean
): AssistantMessage {
  const message =
    error instanceof Error
      ? error.message
      : safeAgentDiagnosticMessage(error) || 'Unknown provider error'
  const assistantMessage: AssistantMessage = {
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
    errorMessage: message,
    timestamp: Date.now()
  }
  const details = providerErrorDetails(assistantMessage, error)
  Object.defineProperty(assistantMessage, 'cause', {
    configurable: true,
    value: error,
    writable: true
  })
  if (details.status !== undefined) {
    Object.defineProperty(assistantMessage, 'status', {
      configurable: true,
      value: details.status,
      writable: true
    })
  }
  if (details.code !== undefined) {
    Object.defineProperty(assistantMessage, 'code', {
      configurable: true,
      value: details.code,
      writable: true
    })
  }
  return assistantMessage
}

interface ProviderErrorDetails {
  cause?: unknown
  status?: number
  code?: string
}

function providerErrorDetails(
  message: AssistantMessage,
  originalError?: unknown
): ProviderErrorDetails {
  const source = originalError === undefined ? message : originalError
  const status = readProviderStatus(source)
  const code = readProviderCode(source)
  return {
    ...(originalError === undefined
      ? { cause: readProperty(message, 'cause') }
      : { cause: originalError }),
    ...(status === undefined ? {} : { status }),
    ...(code === undefined ? {} : { code })
  }
}

function readProviderStatus(value: unknown): number | undefined {
  for (const key of ['httpStatus', 'statusCode', 'status'] as const) {
    const status = readProviderProperty(value, key)
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
      return status
    }
  }
  return undefined
}

function readProviderCode(value: unknown): string | undefined {
  for (const key of ['code', 'providerCode', 'errorCode'] as const) {
    const code = readProviderProperty(value, key)
    if (typeof code === 'string' && code.length > 0) return code
    if (typeof code === 'number' && Number.isFinite(code)) return String(code)
  }
  return undefined
}

function readProviderProperty(
  value: unknown,
  property: 'code' | 'providerCode' | 'errorCode' | 'httpStatus' | 'statusCode' | 'status'
): unknown {
  const seen = new Set<object>()
  let current = value
  while (current !== null && typeof current === 'object') {
    if (seen.has(current)) break
    seen.add(current)
    const candidate = (current as Record<string, unknown>)[property]
    if (candidate !== undefined) return candidate
    current = (current as Record<string, unknown>).cause
  }
  return undefined
}

function readProperty(value: unknown, property: string): unknown {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)[property]
    : undefined
}
