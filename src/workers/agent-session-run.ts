import { createHash, randomUUID } from 'node:crypto'
import type { Api, AssistantMessage, UserMessage } from '@earendil-works/pi-ai'
import type { Agent } from '@earendil-works/pi-agent-core'
import type { MessagePortMain } from 'electron'
import { Value } from 'typebox/value'
import { AGENT_MODEL_VISIBLE_TOOL_SPECS } from '../shared/agent-tool-specs'
import {
  agentAssistantMessagePayloadSchema,
  agentFollowUpConsumptionAuthorizationSchema,
  agentModelCallAuthorizationSchema,
  agentQueueActionCommandSchema,
  agentQueueCommandSchema,
  type AgentAssistantMessagePayload,
  type AgentFollowUpConsumptionAuthorization,
  type AgentHistoryMessage,
  type AgentModelCallAuthorization,
  type AgentQueueActionCommand,
  type AgentQueueCommand,
  type AgentRunStart,
  type AgentRuntimeEvent,
  type AgentSessionRunResult
} from '../shared/contracts/agent'
import { agentToolNameSchema } from '../shared/contracts/agent-tools'
import {
  AGENT_PROVIDER_MAX_RETRY_DELAY_MS,
  createRetryingAgentProviderStream,
  parseRetryAfterMs
} from './agent-provider-stream'
import {
  AgentContextBudgetController,
  agentMessageBudget,
  estimateAgentTokens
} from '../shared/agent-context-budget'
import { AgentToolBridge } from './agent-tools'
import {
  apiKeyForProvider,
  buildAgentProviderModel,
  loadAgentStreamSimple
} from './agent-provider-runtime'

export interface AgentSessionRunControl {
  enqueue(command: AgentQueueCommand): void
  queueAction(command: AgentQueueActionCommand): void
  authorizeFollowUpConsumption(command: AgentFollowUpConsumptionAuthorization): void
  authorizeModelCall(command: AgentModelCallAuthorization): void
  abort(): void
}

export async function runAgentSession(
  request: AgentRunStart,
  onEvent: (event: AgentRuntimeEvent) => void,
  registerControl: (control: AgentSessionRunControl) => void,
  externalSignal: AbortSignal | undefined,
  toolPort: MessagePortMain,
  log?: (
    level: 'info' | 'warn',
    event: string,
    message: string,
    fields?: Record<string, unknown>
  ) => void
): Promise<AgentSessionRunResult> {
  if (request.config.role !== 'agent') throw new Error('Agent utility requires an agent provider')
  const runtimeCredential =
    typeof request.credential === 'string' ? { apiKey: request.credential } : request.credential

  const modelLimits = request.modelLimits ?? {
    contextWindowTokens: 131_072,
    inputLimitTokens: null,
    outputLimitTokens: null,
    source: 'legacy_fallback' as const,
    catalogModelKey: null,
    resolvedAt: null
  }
  const [{ Agent: AgentClass }, streamSimple] = await Promise.all([
    import('@earendil-works/pi-agent-core'),
    loadAgentStreamSimple(request.runtimeModel?.api ?? request.config.api ?? 'openai-completions')
  ])
  const model = buildAgentProviderModel({
    config: request.config,
    runtimeModel: request.runtimeModel,
    modelLimits,
    maxOutputTokens: request.maxOutputTokens
  })
  const contextBudget = new AgentContextBudgetController(
    agentMessageBudget(request.maxOutputTokens, modelLimits),
    (event) => {
      const batchHash = createHash('sha256').update(event.batchKey).digest('hex')
      if (event.type === 'active_batch_retry') {
        log?.(
          'warn',
          'agent.context.active_batch_retry',
          'Retrying an oversized Agent read batch',
          {
            agentRunId: request.agentRunId,
            batchHash,
            toolNames: event.toolNames,
            maxAttempts: 1
          }
        )
        return
      }
      log?.(
        'info',
        'agent.context.active_batch_recovered',
        'Recovered Agent context with a smaller read batch',
        { agentRunId: request.agentRunId, batchHash }
      )
    }
  )
  const modelRequestIds = [request.modelRequestId]
  const systemPromptByModelRequestId = new Map<string, string>()
  interface QueueEntry {
    pendingMessageId: string | null
    modelRequestId: string
    message: UserMessage
    systemPrompt: string
  }
  const steeringEntries: QueueEntry[] = []
  const followUpEntries: QueueEntry[] = []
  const reservedFollowUps = new Map<string, QueueEntry>()
  let loadedFollowUpId: string | null = null
  let initialPromptPending = true
  const pendingModelCallAuthorizations = new Map<
    string,
    {
      resolve: (authorization: AgentModelCallAuthorization) => void
      reject: (error: Error) => void
    }
  >()
  const pendingFollowUpConsumptions = new Map<
    string,
    {
      pendingMessageId: string
      modelRequestId: string
      resolve: (authorization: AgentFollowUpConsumptionAuthorization) => void
      reject: (error: Error) => void
    }
  >()
  const callCompletions: Promise<void>[] = []
  const modelRequestByToolCallId = new Map<string, string>()
  const rawArgumentsByToolCallId = new Map<string, unknown>()
  const toolStartedAtByToolCallId = new Map<string, number>()
  let lastAssistant: AssistantMessage | undefined
  let lastAssistantRetriesExhausted = false
  let lastAssistantHttpStatus: number | undefined
  let awaitingReview = false
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
      thinkingLevel: request.thinkingLevel ?? 'off',
      tools: toolBridge.tools(),
      messages: request.history.map(toPiMessage)
    },
    getApiKey: (providerId) =>
      apiKeyForProvider(runtimeCredential, request.config.providerId, providerId),
    transformContext: (messages) => Promise.resolve(contextBudget.transform(messages)),
    prepareNextTurnWithContext: async ({ context, toolResults }) => {
      if (toolResults.some((result) => pausesForReview(result.details))) return undefined
      const queuedModelRequestId = modelRequestIds[0]
      if (queuedModelRequestId !== undefined) {
        const systemPrompt = systemPromptByModelRequestId.get(queuedModelRequestId)
        if (systemPrompt !== undefined) {
          systemPromptByModelRequestId.delete(queuedModelRequestId)
          return { context: { ...context, systemPrompt } }
        }
      }
      if (toolResults.length === 0) {
        const followUp = followUpEntries[0]
        return followUp === undefined
          ? undefined
          : { context: { ...context, systemPrompt: followUp.systemPrompt } }
      }
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
      const clarificationCalls = calls.filter((call) => call.name === 'ask_user')
      if (
        clarificationCalls.length > 0 &&
        (clarificationCalls.length !== 1 || calls.length !== 1)
      ) {
        return {
          block: true,
          reason: 'User clarification must be the only tool in an assistant message'
        }
      }
      const skillCalls = calls.filter((call) => call.name === 'read_writing_skill')
      if (skillCalls.length > 0 && calls.some((call) => call.name !== 'read_writing_skill')) {
        return {
          block: true,
          reason: 'Writing Skill preparation cannot be mixed with other tools'
        }
      }
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
      if (pausesForReview(details)) {
        awaitingReview = true
        agent.clearAllQueues()
        steeringEntries.length = 0
        followUpEntries.length = 0
        reservedFollowUps.clear()
        loadedFollowUpId = null
        return { terminate: true }
      }
      return undefined
    },
    streamFn: async (activeModel, context, options) => {
      const modelRequestId = modelRequestIds.shift()
      if (modelRequestId === undefined) {
        throw new Error('Agent provider call has no authorized model request')
      }
      let lastResponseStatus: number | undefined
      let retryAfterMs: number | undefined
      const retrying = createRetryingAgentProviderStream({
        signal: options?.signal,
        startAttempt: () => {
          lastResponseStatus = undefined
          retryAfterMs = undefined
          return streamSimple(activeModel, context, {
            ...options,
            signal: options?.signal,
            apiKey: runtimeCredential.apiKey,
            headers: runtimeCredential.headers,
            env: runtimeCredential.env,
            timeoutMs: undefined,
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            maxTokens: request.maxOutputTokens,
            maxRetries: 0,
            maxRetryDelayMs: AGENT_PROVIDER_MAX_RETRY_DELAY_MS,
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
        onRetry: ({ completedAttempts, maxAttempts, delayMs, reasonCode }) => {
          onEvent({
            type: 'model_call_retrying',
            modelRequestId,
            completedAttempts,
            maxAttempts,
            delayMs,
            reasonCode
          })
        }
      })
      const stream = retrying.stream
      const completion = stream.result().then((message) => {
        lastAssistant = message
        lastAssistantRetriesExhausted = retrying.state.exhausted
        lastAssistantHttpStatus = lastResponseStatus
        for (const part of message.content) {
          if (part.type === 'toolCall') modelRequestByToolCallId.set(part.id, modelRequestId)
        }
        const providerPromptTokens = message.usage.input + message.usage.cacheRead
        const contextTokensEstimated = providerPromptTokens === 0
        const payload = toAssistantPayload(
          message,
          retrying.state.retryCount,
          contextTokensEstimated ? estimateAgentTokens(context) : providerPromptTokens,
          contextTokensEstimated
        )
        const failed = message.stopReason === 'error'
        onEvent({
          type: 'model_call_finished',
          modelRequestId,
          outcome: message.stopReason === 'aborted' ? 'aborted' : failed ? 'failed' : 'succeeded',
          metadata: payload.metadata,
          ...(failed
            ? {
                failureCode: retrying.state.exhausted
                  ? ('provider_retries_exhausted' as const)
                  : ('provider_request_failed' as const),
                retryable: retrying.state.retryableFailure
              }
            : {}),
          ...(lastResponseStatus === undefined ? {} : { httpStatus: lastResponseStatus })
        })
        onEvent({ type: 'assistant_message', modelRequestId, message: payload })
      })
      callCompletions.push(completion)
      return stream
    },
    maxRetryDelayMs: AGENT_PROVIDER_MAX_RETRY_DELAY_MS,
    steeringMode: 'one-at-a-time',
    followUpMode: 'one-at-a-time',
    toolExecution: 'parallel'
  })

  const loadFollowUpHead = (): void => {
    if (loadedFollowUpId !== null) return
    const head = followUpEntries[0]
    if (head === undefined || head.pendingMessageId === null) return
    loadedFollowUpId = head.pendingMessageId
    agent.followUp(head.message)
  }

  agent.subscribe(async (event) => {
    if (event.type === 'message_start' && event.message.role === 'user') {
      if (initialPromptPending) {
        initialPromptPending = false
        return
      }
      if (steeringEntries.length > 0) {
        steeringEntries.shift()
        return
      }
      const followUp = followUpEntries[0]
      if (
        followUp === undefined ||
        followUp.pendingMessageId === null ||
        loadedFollowUpId !== followUp.pendingMessageId
      ) {
        throw new Error('Agent consumed an untracked Follow-up message')
      }
      followUpEntries.shift()
      loadedFollowUpId = null
      const authorization = await requestFollowUpConsumption(
        onEvent,
        pendingFollowUpConsumptions,
        followUp.pendingMessageId,
        followUp.modelRequestId
      )
      modelRequestIds.push(authorization.modelRequestId)
      loadFollowUpHead()
      return
    }
    if (event.type === 'tool_execution_start') {
      const modelRequestId = modelRequestByToolCallId.get(event.toolCallId)
      if (modelRequestId === undefined) {
        throw new Error('Agent tool attempt has no authorized source model request')
      }
      rawArgumentsByToolCallId.set(event.toolCallId, event.args)
      toolStartedAtByToolCallId.set(event.toolCallId, Date.now())
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
      const diagnostic = safePreflightDiagnostic(
        event.toolName,
        rawArgumentsByToolCallId.get(event.toolCallId)
      )
      const startedAt = toolStartedAtByToolCallId.get(event.toolCallId)
      onEvent({
        type: 'tool_preflight_failed',
        modelRequestId,
        toolCallId: event.toolCallId,
        requestedToolName: event.toolName,
        phase: 'pre_dispatch',
        diagnostic,
        ...(startedAt === undefined ? {} : { durationMs: Math.max(0, Date.now() - startedAt) }),
        timestamp: Date.now()
      })
      rawArgumentsByToolCallId.delete(event.toolCallId)
      toolStartedAtByToolCallId.delete(event.toolCallId)
      return
    }
    if (event.type === 'tool_execution_end') {
      rawArgumentsByToolCallId.delete(event.toolCallId)
      toolStartedAtByToolCallId.delete(event.toolCallId)
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
      if (awaitingReview) {
        throw new Error('Agent conversation is waiting for review')
      }
      const message: UserMessage = {
        role: 'user',
        content: parsed.content,
        timestamp: parsed.timestamp
      }
      if (parsed.operation === 'steer') {
        const entry: QueueEntry = {
          pendingMessageId: null,
          modelRequestId: parsed.modelRequestId,
          message,
          systemPrompt: parsed.systemPrompt
        }
        steeringEntries.push(entry)
        modelRequestIds.push(parsed.modelRequestId)
        systemPromptByModelRequestId.set(parsed.modelRequestId, parsed.systemPrompt)
        agent.steer(message)
      } else {
        followUpEntries.push({
          pendingMessageId: parsed.pendingMessageId,
          modelRequestId: parsed.modelRequestId,
          message,
          systemPrompt: parsed.systemPrompt
        })
        loadFollowUpHead()
      }
      onEvent({
        type: 'queue_updated',
        delivery: parsed.operation,
        modelRequestId: parsed.modelRequestId
      })
    },
    queueAction(command) {
      const parsed = agentQueueActionCommandSchema.parse(command)
      if (awaitingReview) throw new Error('Agent conversation is waiting for review')
      if (parsed.operation === 'commit_follow_up_steer') {
        const reserved = reservedFollowUps.get(parsed.reservationId)
        if (reserved === undefined) {
          onEvent({
            type: 'queue_action_completed',
            actionId: parsed.actionId,
            operation: parsed.operation,
            outcome: 'stale'
          })
          return
        }
        reservedFollowUps.delete(parsed.reservationId)
        const entry: QueueEntry = {
          ...reserved,
          modelRequestId: parsed.modelRequestId,
          systemPrompt: parsed.systemPrompt
        }
        steeringEntries.push(entry)
        modelRequestIds.push(parsed.modelRequestId)
        systemPromptByModelRequestId.set(parsed.modelRequestId, parsed.systemPrompt)
        agent.steer(entry.message)
        onEvent({
          type: 'queue_action_completed',
          actionId: parsed.actionId,
          operation: parsed.operation,
          outcome: 'completed'
        })
        return
      }
      const index = followUpEntries.findIndex(
        (entry) => entry.pendingMessageId === parsed.pendingMessageId
      )
      if (index < 0) {
        onEvent({
          type: 'queue_action_completed',
          actionId: parsed.actionId,
          operation: parsed.operation,
          outcome: 'stale'
        })
        return
      }
      const [entry] = followUpEntries.splice(index, 1)
      if (entry === undefined) throw new Error('Agent Follow-up queue removal failed')
      if (index === 0 && loadedFollowUpId === parsed.pendingMessageId) {
        agent.clearFollowUpQueue()
        loadedFollowUpId = null
        loadFollowUpHead()
      }
      if (parsed.operation === 'reserve_follow_up') {
        reservedFollowUps.set(parsed.actionId, entry)
      }
      onEvent({
        type: 'queue_action_completed',
        actionId: parsed.actionId,
        operation: parsed.operation,
        outcome: 'completed'
      })
    },
    authorizeFollowUpConsumption(command) {
      const parsed = agentFollowUpConsumptionAuthorizationSchema.parse(command)
      const pending = pendingFollowUpConsumptions.get(parsed.consumptionId)
      if (
        pending === undefined ||
        pending.pendingMessageId !== parsed.pendingMessageId ||
        pending.modelRequestId !== parsed.modelRequestId
      ) {
        throw new Error('Agent Follow-up consumption authorization is stale')
      }
      pendingFollowUpConsumptions.delete(parsed.consumptionId)
      pending.resolve(parsed)
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
    for (const pending of pendingFollowUpConsumptions.values()) {
      pending.reject(abortError('Agent run ended before Follow-up consumption authorization'))
    }
    pendingFollowUpConsumptions.clear()
    toolBridge.close()
    externalSignal?.removeEventListener('abort', abortExternal)
  }

  if (runError !== undefined) throw runError
  const contextError = contextBudget.terminalError()
  if (contextError !== null) throw contextError

  if (lastAssistant === undefined) throw new Error('Agent completed without an assistant response')
  if (lastAssistant.stopReason === 'error') {
    if (lastAssistantRetriesExhausted) {
      throw new AgentProviderRetriesExhaustedError(lastAssistantHttpStatus)
    }
    const contextOverflow = isContextOverflowFailure(
      lastAssistant.errorMessage,
      lastAssistantHttpStatus
    )
    const error: Error & { status?: number; code?: string } = new Error(
      contextOverflow ? 'Agent provider context window exceeded' : 'Agent provider request failed'
    )
    if (lastAssistantHttpStatus !== undefined) error.status = lastAssistantHttpStatus
    if (contextOverflow) error.code = 'context_overflow'
    throw error
  }
  if (lastAssistant.stopReason === 'aborted') {
    const error = new Error('Agent provider request aborted')
    error.name = 'AbortError'
    throw error
  }
  return { outcome: awaitingReview ? 'awaiting_review' : 'finished' }
}

function isContextOverflowFailure(
  message: string | undefined,
  status: number | undefined
): boolean {
  const normalized = message?.toLowerCase() ?? ''
  return (
    /context (?:length|window).*(?:exceed|overflow|too long)|maximum context|too many tokens/u.test(
      normalized
    ) ||
    (status === 400 && /context|token limit/u.test(normalized))
  )
}

function pausesForReview(details: unknown): boolean {
  return (
    details !== null &&
    typeof details === 'object' &&
    'data' in details &&
    details.data !== null &&
    typeof details.data === 'object' &&
    'continuation' in details.data &&
    details.data.continuation === 'pause_for_review'
  )
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
  retryCount: number,
  contextTokensUsed: number,
  contextTokensEstimated: boolean
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
      retryCount,
      providerModelId: message.responseModel ?? message.model,
      contextTokensUsed,
      contextTokensEstimated
    },
    timestamp: message.timestamp,
    interrupted: message.stopReason === 'aborted' || message.stopReason === 'error'
  })
}

class AgentProviderRetriesExhaustedError extends Error {
  readonly status?: number

  constructor(status?: number) {
    super('Agent provider request failed after 5 attempts')
    this.name = 'ProviderRetriesExhaustedError'
    if (status !== undefined) this.status = status
  }
}

function providerErrorMessage(
  model: { api: Api; provider: string; id: string },
  error: unknown,
  aborted: boolean
): AssistantMessage {
  const message = error instanceof Error ? error.message : String(error)
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
    errorMessage: message,
    timestamp: Date.now()
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

function requestFollowUpConsumption(
  onEvent: (event: AgentRuntimeEvent) => void,
  pending: Map<
    string,
    {
      pendingMessageId: string
      modelRequestId: string
      resolve: (authorization: AgentFollowUpConsumptionAuthorization) => void
      reject: (error: Error) => void
    }
  >,
  pendingMessageId: string,
  modelRequestId: string
): Promise<AgentFollowUpConsumptionAuthorization> {
  const consumptionId = randomUUID()
  return new Promise((resolve, reject) => {
    pending.set(consumptionId, { pendingMessageId, modelRequestId, resolve, reject })
    try {
      onEvent({
        type: 'follow_up_consumption_requested',
        consumptionId,
        pendingMessageId,
        modelRequestId
      })
    } catch (err) {
      pending.delete(consumptionId)
      reject(new Error('Agent Follow-up consumption request failed', { cause: err }))
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
    toolName === 'submit_writing_rules_change' ||
    toolName === 'submit_outline_change' ||
    toolName === 'submit_section_change' ||
    toolName === 'record_review_issues' ||
    toolName === 'update_review_issues' ||
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

function safePreflightDiagnostic(
  requestedToolName: string,
  rawArguments: unknown
): {
  code: 'invalid_arguments' | 'unknown_tool' | 'preparation_failed'
  message: string
  paths: string[]
} {
  const tool = AGENT_MODEL_VISIBLE_TOOL_SPECS.find(
    (candidate) => candidate.name === requestedToolName
  )
  if (tool === undefined) {
    return {
      code: 'unknown_tool',
      message:
        'The requested tool is not registered. Choose one of the model-visible WriteLLM tools and retry once.',
      paths: []
    }
  }
  try {
    const converted = structuredClone(rawArguments)
    Value.Convert(tool.parameters, converted)
    const paths = [
      ...new Set(
        [...Value.Errors(tool.parameters, converted)]
          .slice(0, 16)
          .map((error) => error.instancePath || '/')
      )
    ]
    if (paths.length > 0) {
      return {
        code: 'invalid_arguments',
        message:
          `Arguments for ${tool.name} failed preflight at ${paths.join(', ')}. Received shape: ${describeArgumentShape(rawArguments)}. Fix the named fields and retry once.`.slice(
            0,
            1_000
          ),
        paths
      }
    }
  } catch {
    return {
      code: 'preparation_failed',
      message: `Arguments for ${tool.name} could not be prepared safely. Use the documented object shape and retry once.`,
      paths: []
    }
  }
  return {
    code: 'preparation_failed',
    message: `${tool.name} passed basic argument validation but was blocked before Main dispatch. Separate reads from mutations, submit at most one mutation, and retry once.`,
    paths: []
  }
}
