import { randomUUID } from 'node:crypto'
import type {
  AssistantMessage,
  AssistantMessageEventStream,
  UserMessage
} from '@earendil-works/pi-ai'
import type { Agent } from '@earendil-works/pi-agent-core'
import type { MessagePortMain } from 'electron'
import {
  agentAssistantMessagePayloadSchema,
  agentModelCallAuthorizationSchema,
  agentQueueCommandSchema,
  type AgentAssistantMessagePayload,
  type AgentHistoryMessage,
  type AgentModelCallAuthorization,
  type AgentQueueCommand,
  type AgentRunStart,
  type AgentRuntimeEvent
} from '../shared/contracts/agent'
import { agentToolNameSchema } from '../shared/contracts/agent-tools'
import { agentMessageBudget, boundAgentContextByTokens } from '../shared/agent-context-budget'
import { AgentToolBridge } from './agent-tools'

export interface AgentSessionRunControl {
  enqueue(command: AgentQueueCommand): void
  authorizeModelCall(command: AgentModelCallAuthorization): void
  abort(): void
}

export async function runAgentSession(
  request: AgentRunStart,
  onEvent: (event: AgentRuntimeEvent) => void,
  registerControl: (control: AgentSessionRunControl) => void,
  externalSignal: AbortSignal | undefined,
  toolPort: MessagePortMain
): Promise<void> {
  if (request.config.role !== 'agent') throw new Error('Agent utility requires an agent provider')

  const [{ Agent: AgentClass }, { streamSimple }] = await Promise.all([
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
    maxTokens: request.maxOutputTokens,
    compat: { supportsUsageInStreaming: true, maxTokensField: 'max_tokens' as const }
  }
  const modelRequestIds = [request.modelRequestId]
  const pendingModelCallAuthorizations = new Map<
    string,
    { resolve: (modelRequestId: string) => void; reject: (error: Error) => void }
  >()
  const callCompletions: Promise<void>[] = []
  const modelRequestByToolCallId = new Map<string, string>()
  let lastAssistant: AssistantMessage | undefined
  const toolBridge = new AgentToolBridge(
    toolPort,
    {
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId
    },
    (toolCallId) => {
      const modelRequestId = modelRequestByToolCallId.get(toolCallId)
      if (modelRequestId === undefined) {
        throw new Error('Agent tool call has no authorized source model request')
      }
      return modelRequestId
    }
  )

  const agent = new AgentClass({
    initialState: {
      systemPrompt: request.systemPrompt,
      model,
      thinkingLevel: 'off',
      tools: toolBridge.tools(),
      messages: request.history.map(toPiMessage)
    },
    getApiKey: (providerId) =>
      providerId === request.config.providerId ? request.credential : undefined,
    transformContext: (messages) =>
      Promise.resolve(
        boundAgentContextByTokens(messages, agentMessageBudget(request.maxOutputTokens))
      ),
    beforeToolCall: async ({ toolCall }) => {
      const allowed = agentToolNameSchema.safeParse(toolCall.name)
      return allowed.success
        ? undefined
        : { block: true, reason: 'Tool is not authorized by WriteLLM' }
    },
    streamFn: async (activeModel, context, options) => {
      const modelRequestId =
        modelRequestIds.shift() ??
        (await requestModelCallAuthorization(onEvent, pendingModelCallAuthorizations))
      let fetchCount = 0
      let lastResponseStatus: number | undefined
      const originalFetch = globalThis.fetch
      const countingFetch: typeof fetch = (input, init) => {
        fetchCount += 1
        return originalFetch(input, init)
      }
      globalThis.fetch = countingFetch
      let stream: AssistantMessageEventStream
      try {
        stream = streamSimple(activeModel, context, {
          ...options,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          maxTokens: request.maxOutputTokens,
          maxRetries: 2,
          maxRetryDelayMs: Math.min(request.config.timeoutMs, 30_000),
          timeoutMs: request.config.timeoutMs,
          onResponse: async (response, responseModel) => {
            lastResponseStatus = response.status
            await options?.onResponse?.(response, responseModel)
          }
        })
      } catch (err) {
        globalThis.fetch = originalFetch
        throw err
      }
      const completion = stream
        .result()
        .then((message) => {
          lastAssistant = message
          for (const part of message.content) {
            if (part.type === 'toolCall') modelRequestByToolCallId.set(part.id, modelRequestId)
          }
          const payload = toAssistantPayload(message, fetchCount)
          onEvent({
            type: 'model_call_finished',
            modelRequestId,
            outcome:
              message.stopReason === 'aborted'
                ? 'aborted'
                : message.stopReason === 'error'
                  ? 'failed'
                  : 'succeeded',
            metadata: payload.metadata,
            ...(lastResponseStatus === undefined ? {} : { httpStatus: lastResponseStatus })
          })
          onEvent({ type: 'assistant_message', modelRequestId, message: payload })
        })
        .finally(() => {
          if (globalThis.fetch === countingFetch) globalThis.fetch = originalFetch
        })
      callCompletions.push(completion)
      return stream
    },
    maxRetryDelayMs: Math.min(request.config.timeoutMs, 30_000),
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    toolExecution: 'parallel'
  })

  agent.subscribe((event) => {
    if (
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta' &&
      event.assistantMessageEvent.delta.length > 0
    ) {
      onEvent({ type: 'assistant_delta', delta: event.assistantMessageEvent.delta })
    }
  })

  registerControl({
    enqueue(command) {
      const parsed = agentQueueCommandSchema.parse(command)
      modelRequestIds.push(parsed.modelRequestId)
      const message: UserMessage = {
        role: 'user',
        content: parsed.content,
        timestamp: parsed.timestamp
      }
      if (parsed.operation === 'steer') agent.steer(message)
      else agent.followUp(message)
      onEvent({
        type: 'queue_updated',
        delivery: parsed.operation,
        modelRequestId: parsed.modelRequestId
      })
    },
    authorizeModelCall(command) {
      const parsed = agentModelCallAuthorizationSchema.parse(command)
      const pending = pendingModelCallAuthorizations.get(parsed.continuationId)
      if (pending === undefined) throw new Error('Agent model-call authorization is stale')
      pendingModelCallAuthorizations.delete(parsed.continuationId)
      pending.resolve(parsed.modelRequestId)
    },
    abort: () => agent.abort()
  })

  const timeout = setTimeout(() => agent.abort(), request.config.timeoutMs)
  const abortExternal = (): void => agent.abort()
  if (externalSignal?.aborted) agent.abort()
  else externalSignal?.addEventListener('abort', abortExternal, { once: true })
  let runError: unknown
  try {
    await agent.prompt(request.prompt)
    await agent.waitForIdle()
  } catch (err) {
    runError = err
  } finally {
    await Promise.allSettled(callCompletions)
    for (const pending of pendingModelCallAuthorizations.values()) {
      pending.reject(abortError('Agent run ended before model-call authorization'))
    }
    pendingModelCallAuthorizations.clear()
    toolBridge.close()
    clearTimeout(timeout)
    externalSignal?.removeEventListener('abort', abortExternal)
  }

  if (runError !== undefined) throw runError

  if (lastAssistant === undefined) throw new Error('Agent completed without an assistant response')
  if (lastAssistant.stopReason === 'error') {
    const error: Error & { status?: number } = new Error('Agent provider request failed')
    throw error
  }
  if (lastAssistant.stopReason === 'aborted') {
    const error = new Error('Agent provider request aborted')
    error.name = 'AbortError'
    throw error
  }
}

function toPiMessage(message: AgentHistoryMessage): UserMessage | AssistantMessage {
  if (message.role === 'user') {
    return { role: 'user', content: message.content, timestamp: message.timestamp }
  }
  const payload = message.message
  return {
    role: 'assistant',
    content: payload.content.length === 0 ? [] : [{ type: 'text', text: payload.content }],
    api: 'openai-completions',
    provider: payload.provider,
    model: payload.model,
    ...(payload.responseModel === undefined ? {} : { responseModel: payload.responseModel }),
    ...(payload.responseId === undefined ? {} : { responseId: payload.responseId }),
    usage: {
      input: payload.metadata.usage.inputTokens ?? 0,
      output: payload.metadata.usage.outputTokens ?? 0,
      cacheRead: payload.metadata.usage.cacheReadTokens ?? 0,
      cacheWrite: payload.metadata.usage.cacheWriteTokens ?? 0,
      totalTokens:
        (payload.metadata.usage.inputTokens ?? 0) +
        (payload.metadata.usage.outputTokens ?? 0) +
        (payload.metadata.usage.cacheReadTokens ?? 0) +
        (payload.metadata.usage.cacheWriteTokens ?? 0),
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    },
    stopReason: payload.stopReason,
    timestamp: payload.timestamp
  }
}

function toAssistantPayload(
  message: AssistantMessage,
  fetchCount: number
): AgentAssistantMessagePayload {
  return agentAssistantMessagePayloadSchema.parse({
    content: message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
    stopReason: message.stopReason,
    provider: message.provider,
    model: message.model,
    responseModel: message.responseModel,
    responseId: message.responseId,
    metadata: {
      usage: {
        inputTokens: message.usage.input,
        outputTokens: message.usage.output,
        cacheReadTokens: message.usage.cacheRead,
        cacheWriteTokens: message.usage.cacheWrite,
        estimatedCostUsdMicros: null
      },
      responseIds: message.responseId === undefined ? [] : [message.responseId],
      retryCount: Math.max(0, fetchCount - 1),
      providerModelId: message.responseModel ?? message.model
    },
    timestamp: message.timestamp,
    interrupted: message.stopReason === 'aborted' || message.stopReason === 'error'
  })
}

export type AgentInstance = Agent

function requestModelCallAuthorization(
  onEvent: (event: AgentRuntimeEvent) => void,
  pending: Map<
    string,
    { resolve: (modelRequestId: string) => void; reject: (error: Error) => void }
  >
): Promise<string> {
  const continuationId = randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(continuationId, { resolve, reject })
    try {
      onEvent({ type: 'model_call_requested', continuationId, reason: 'tool_continuation' })
    } catch (err) {
      pending.delete(continuationId)
      reject(new Error('Agent model-call authorization request failed', { cause: err }))
    }
  })
}

function abortError(message: string): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}
