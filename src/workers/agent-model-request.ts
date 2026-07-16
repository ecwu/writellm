import type { AgentRunResult, AgentUtilityRequest } from '../shared/contracts/model-runtime'

export async function runAgentModelRequest(
  request: AgentUtilityRequest,
  onTextDelta: (delta: string) => void,
  externalSignal?: AbortSignal
): Promise<AgentRunResult> {
  if (request.config.role !== 'agent') throw new Error('Agent utility requires an agent provider')

  const [{ Agent }, { streamSimple }] = await Promise.all([
    import('@earendil-works/pi-agent-core'),
    import('@earendil-works/pi-ai/api/openai-completions')
  ])
  const model = {
    id: request.config.model,
    name: request.config.model,
    api: 'openai-completions' as const,
    provider: request.config.providerId,
    baseUrl: request.config.baseUrl,
    reasoning: false,
    input: ['text' as const],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 131_072,
    maxTokens: request.input.maxOutputTokens,
    compat: { supportsUsageInStreaming: true, maxTokensField: 'max_tokens' as const }
  }
  let fetchCount = 0
  let lastResponseStatus: number | undefined
  const agent = new Agent({
    initialState: {
      systemPrompt: request.input.systemPrompt,
      model,
      thinkingLevel: 'off',
      tools: [],
      messages: []
    },
    getApiKey: (providerId) =>
      providerId === request.config.providerId ? request.credential : undefined,
    streamFn: (activeModel, context, options) =>
      streamSimple(activeModel, context, {
        ...options,
        ...(request.input.temperature === undefined
          ? {}
          : { temperature: request.input.temperature }),
        maxTokens: request.input.maxOutputTokens,
        maxRetries: 2,
        maxRetryDelayMs: Math.min(request.config.timeoutMs, 30_000),
        timeoutMs: request.config.timeoutMs,
        onResponse: async (response, responseModel) => {
          lastResponseStatus = response.status
          await options?.onResponse?.(response, responseModel)
        }
      }),
    maxRetryDelayMs: Math.min(request.config.timeoutMs, 30_000),
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
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    fetchCount += 1
    return originalFetch(input, init)
  }
  const timeout = setTimeout(() => agent.abort(), request.config.timeoutMs)
  const abortExternal = (): void => agent.abort()
  if (externalSignal?.aborted) agent.abort()
  else externalSignal?.addEventListener('abort', abortExternal, { once: true })
  try {
    await agent.prompt(request.input.prompt)
    await agent.waitForIdle()
  } finally {
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortExternal)
    globalThis.fetch = originalFetch
  }

  const finalMessage = [...agent.state.messages]
    .reverse()
    .find((message) => message.role === 'assistant')
  if (finalMessage === undefined || finalMessage.role !== 'assistant') {
    throw new Error('Agent completed without an assistant response')
  }
  if (finalMessage.stopReason === 'error') {
    const error: Error & { status?: number } = new Error('Agent provider request failed')
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
      retryCount: Math.max(0, fetchCount - 1),
      providerModelId: finalMessage.responseModel ?? finalMessage.model
    }
  }
}
