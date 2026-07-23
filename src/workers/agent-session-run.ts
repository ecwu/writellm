import { createHash, randomUUID } from 'node:crypto'
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
import {
  agentMessageBudget,
  boundAgentContextByTokens,
  estimateAgentTokens
} from '../shared/agent-context-budget'
import { AgentToolBridge } from './agent-tools'
import { linkAbortSignal } from './shared/linked-abort-signal'

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

  const modelLimits = request.modelLimits ?? {
    contextWindowTokens: 131_072,
    inputLimitTokens: null,
    outputLimitTokens: null,
    source: 'legacy_fallback' as const,
    catalogModelKey: null,
    resolvedAt: null
  }
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
    contextWindow: modelLimits.contextWindowTokens,
    maxTokens: request.maxOutputTokens,
    compat: { supportsUsageInStreaming: true, maxTokensField: 'max_tokens' as const }
  }
  const modelRequestIds = [request.modelRequestId]
  const systemPromptByModelRequestId = new Map<string, string>()
  const pendingModelCallAuthorizations = new Map<
    string,
    {
      resolve: (authorization: AgentModelCallAuthorization) => void
      reject: (error: Error) => void
    }
  >()
  const callCompletions: Promise<void>[] = []
  const modelRequestByToolCallId = new Map<string, string>()
  let lastAssistant: AssistantMessage | undefined
  let lastAssistantTimedOut = false
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
        boundAgentContextByTokens(
          messages,
          agentMessageBudget(request.maxOutputTokens, modelLimits)
        )
      ),
    prepareNextTurnWithContext: async ({ context, toolResults }) => {
      const queuedModelRequestId = modelRequestIds[0]
      if (queuedModelRequestId !== undefined) {
        const systemPrompt = systemPromptByModelRequestId.get(queuedModelRequestId)
        if (systemPrompt !== undefined) {
          systemPromptByModelRequestId.delete(queuedModelRequestId)
          return { context: { ...context, systemPrompt } }
        }
      }
      if (toolResults.length === 0) return undefined
      const authorization = await requestModelCallAuthorization(
        onEvent,
        pendingModelCallAuthorizations
      )
      modelRequestIds.push(authorization.modelRequestId)
      return { context: { ...context, systemPrompt: authorization.systemPrompt } }
    },
    beforeToolCall: async ({ assistantMessage, toolCall }) => {
      const allowed = agentToolNameSchema.safeParse(toolCall.name)
      if (!allowed.success) {
        return { block: true, reason: 'Tool is not authorized by WriteLLM' }
      }
      const calls = assistantMessage.content
        .filter((part) => part.type === 'toolCall')
        .map((part) => ({ id: part.id, name: part.name }))
      const mutationCalls = calls.filter((call) => isMutationTool(call.name))
      if (isMutationTool(toolCall.name) && mutationCalls.length > 1) {
        return {
          block: true,
          reason: 'Only one mutation may be submitted in an assistant message'
        }
      }
      if (isMutationTool(toolCall.name) && calls.some((call) => !isMutationTool(call.name))) {
        return {
          block: true,
          reason: 'Mutation was blocked because its assistant message also requested read tools'
        }
      }
      return undefined
    },
    afterToolCall: async ({ result }) => {
      const details = result.details
      if (
        details !== null &&
        typeof details === 'object' &&
        'schemaVersion' in details &&
        details.schemaVersion === 2 &&
        'ok' in details &&
        details.ok === false
      ) {
        return { isError: true }
      }
      if (
        details !== null &&
        typeof details === 'object' &&
        'data' in details &&
        details.data !== null &&
        typeof details.data === 'object' &&
        'continuation' in details.data &&
        details.data.continuation === 'pause_for_review'
      ) {
        return { terminate: true }
      }
      return undefined
    },
    streamFn: async (activeModel, context, options) => {
      const modelRequestId = modelRequestIds.shift()
      if (modelRequestId === undefined) {
        throw new Error('Agent provider call has no authorized model request')
      }
      const callController = new AbortController()
      const unlinkAbortSignal = linkAbortSignal(options?.signal, callController)
      let timedOut = false
      const callTimeout = setTimeout(() => {
        timedOut = true
        callController.abort(new AgentProviderTimeoutError(request.config.timeoutMs))
      }, request.config.timeoutMs)
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
          signal: callController.signal,
          timeoutMs: undefined,
          ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
          maxTokens: request.maxOutputTokens,
          maxRetries: 2,
          maxRetryDelayMs: Math.min(request.config.timeoutMs, 30_000),
          onResponse: async (response, responseModel) => {
            lastResponseStatus = response.status
            await options?.onResponse?.(response, responseModel)
          }
        })
      } catch (err) {
        globalThis.fetch = originalFetch
        clearTimeout(callTimeout)
        unlinkAbortSignal()
        throw err
      }
      const completion = stream
        .result()
        .then((message) => {
          lastAssistant = message
          lastAssistantTimedOut = timedOut
          for (const part of message.content) {
            if (part.type === 'toolCall') modelRequestByToolCallId.set(part.id, modelRequestId)
          }
          const providerPromptTokens = message.usage.input + message.usage.cacheRead
          const contextTokensEstimated = providerPromptTokens === 0
          const payload = toAssistantPayload(
            message,
            fetchCount,
            timedOut,
            contextTokensEstimated ? estimateAgentTokens(context) : providerPromptTokens,
            contextTokensEstimated
          )
          onEvent({
            type: 'model_call_finished',
            modelRequestId,
            outcome: timedOut
              ? 'timed_out'
              : message.stopReason === 'aborted'
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
          clearTimeout(callTimeout)
          unlinkAbortSignal()
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
    if (event.type === 'tool_execution_start') {
      const modelRequestId = modelRequestByToolCallId.get(event.toolCallId)
      if (modelRequestId === undefined) {
        throw new Error('Agent tool attempt has no authorized source model request')
      }
      onEvent({
        type: 'tool_attempted',
        modelRequestId,
        toolCallId: event.toolCallId,
        requestedToolName: event.toolName,
        argsHash: createHash('sha256')
          .update(JSON.stringify(event.args) ?? 'undefined')
          .digest('hex'),
        argumentShape: describeArgumentShape(event.args),
        timestamp: Date.now()
      })
      return
    }
    if (event.type === 'tool_execution_end' && !toolBridge.hasDispatched(event.toolCallId)) {
      const modelRequestId = modelRequestByToolCallId.get(event.toolCallId)
      if (modelRequestId === undefined) {
        throw new Error('Agent tool preflight failure has no authorized source model request')
      }
      onEvent({
        type: 'tool_preflight_failed',
        modelRequestId,
        toolCallId: event.toolCallId,
        requestedToolName: event.toolName,
        phase: 'pre_dispatch',
        timestamp: Date.now()
      })
      return
    }
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
      systemPromptByModelRequestId.set(parsed.modelRequestId, parsed.systemPrompt)
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
      pending.resolve(parsed)
    },
    abort: () => agent.abort()
  })

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
    externalSignal?.removeEventListener('abort', abortExternal)
  }

  if (runError !== undefined) throw runError

  if (lastAssistant === undefined) throw new Error('Agent completed without an assistant response')
  if (lastAssistantTimedOut) {
    throw new AgentProviderTimeoutError(request.config.timeoutMs)
  }
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
  fetchCount: number,
  timedOut: boolean,
  contextTokensUsed: number,
  contextTokensEstimated: boolean
): AgentAssistantMessagePayload {
  return agentAssistantMessagePayloadSchema.parse({
    content: message.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(''),
    stopReason: timedOut ? 'error' : message.stopReason,
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
      providerModelId: message.responseModel ?? message.model,
      contextTokensUsed,
      contextTokensEstimated
    },
    timestamp: message.timestamp,
    interrupted: !timedOut && (message.stopReason === 'aborted' || message.stopReason === 'error')
  })
}

class AgentProviderTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`Agent provider request timed out after ${timeoutMs}ms`)
    this.name = 'ProviderTimeoutError'
  }
}

export type AgentInstance = Agent

function requestModelCallAuthorization(
  onEvent: (event: AgentRuntimeEvent) => void,
  pending: Map<
    string,
    {
      resolve: (authorization: AgentModelCallAuthorization) => void
      reject: (error: Error) => void
    }
  >
): Promise<AgentModelCallAuthorization> {
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

function isMutationTool(toolName: string): boolean {
  return (
    toolName === 'submit_brief_change' ||
    toolName === 'submit_outline_change' ||
    toolName === 'submit_section_change' ||
    toolName === 'generate_image'
  )
}

function describeArgumentShape(value: unknown, depth = 0): string {
  if (depth >= 4) return 'depth-limit'
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    const shapes = [
      ...new Set(value.slice(0, 20).map((item) => describeArgumentShape(item, depth + 1)))
    ]
    return `array(${value.length})<${shapes.join('|')}>`.slice(0, 4_096)
  }
  if (typeof value === 'object') {
    return (
      Object.entries(value)
        .slice(0, 100)
        .map(([key, item]) => `${key}:${describeArgumentShape(item, depth + 1)}`)
        .join(',')
        .slice(0, 4_096) || 'object(empty)'
    )
  }
  return typeof value
}
