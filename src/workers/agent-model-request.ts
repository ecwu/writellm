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
  externalSignal?: AbortSignal
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
  let retryState: AgentProviderRetryState | undefined
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
          lastResponseStatus = undefined
          retryAfterMs = undefined
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
            onResponse: async (response, responseModel) => {
              lastResponseStatus = response.status
              retryAfterMs = parseRetryAfterMs(response.headers)
              await options?.onResponse?.(response, responseModel)
            }
          })
        },
        responseStatus: () => lastResponseStatus,
        retryAfterMs: () => retryAfterMs,
        createErrorMessage: (error, aborted) => providerErrorMessage(activeModel, error, aborted),
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
