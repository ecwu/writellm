import { providerErrorMessage } from './agent-provider-errors'
import { traceJsonValue as jsonValue } from '../shared/trace-image-redaction'
import { createHash, randomUUID } from 'node:crypto'
import { createAbortError } from '../shared/abort-error'
import {
  createInitialSystemMessage,
  getCurrentSystemMessage,
  toToolDeclaration,
  type AssistantMessage,
  type UserMessage
} from '@earendil-works/pi-ai'
import type { Agent } from '@earendil-works/pi-agent-core'
import type { MessagePortMain } from 'electron'
import { piApiSchema } from '../shared/contracts/providers'
import type { JSONType } from 'zod'
import { Value } from 'typebox/value'
import {
  agentModelVisibleToolSpecs,
  agentToolEnvelope,
  type AgentModelVisibleToolSpec
} from '../shared/agent-tool-specs'
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
  type AgentTracePurpose,
  type AgentQueueActionCommand,
  type AgentQueueCommand,
  type AgentRunStart,
  type AgentRuntimeEvent,
  type AgentSessionRunResult
} from '../shared/contracts/agent'
import {
  AGENT_PROVIDER_MAX_RETRY_DELAY_MS,
  createRetryingAgentProviderStream,
  parseRetryAfterMs
} from './agent-provider-stream'
import { agentRuntimeMessageBudget, estimateAgentTokens } from '../shared/agent-context-budget'
import { AgentToolBridge } from './agent-tools'
import {
  apiKeyForProvider,
  AgentOutputLimitError,
  loadAgentStreamSimple
} from './agent-provider-runtime'
import { finalizeAgentSessionResult } from './agent-session-finalization'
import { prepareAgentSessionRuntime } from './agent-session-runtime'
import { validateAgentToolCallBatch } from './agent-tool-preflight'
import {
  safeAgentDiagnosticMessage,
  serializeAgentDiagnosticError
} from '../shared/agent-diagnostic-error'

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
    level: 'info' | 'warn' | 'error',
    event: string,
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown
  ) => void
): Promise<AgentSessionRunResult> {
  if (request.config.role !== 'agent') throw new Error('Agent utility requires an agent provider')
  const runtimeCredential = request.credential
  const { modelLimits, toolProfile, interactionMode } = request
  const [{ Agent: AgentClass }, streamSimple] = await Promise.all([
    import('@earendil-works/pi-agent-core'),
    loadAgentStreamSimple(
      request.runtimeModel?.api ?? request.config.api ?? 'openai-completions',
      request.config.providerId
    )
  ])
  const runtime = prepareAgentSessionRuntime(request)
  const { model, contextBudget } = runtime
  let activeToolGroups = runtime.activeToolGroups
  const modelRequestIds = [request.modelRequestId]
  const modelRequestPurposes = new Map<string, AgentTracePurpose>([
    [request.modelRequestId, 'agent_prompt']
  ])
  const authorizedContinuationRequestIds = new Set<string>()
  const systemPromptByModelRequestId = new Map<string, string>()
  let currentSystemPrompt = request.systemPrompt
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
  let outputLimitError: AgentOutputLimitError | undefined
  const modelRequestByToolCallId = new Map<string, string>()
  const modelVisibleToolsByRequestId = new Map<
    string,
    ReadonlyMap<string, AgentModelVisibleToolSpec>
  >()
  const preflightPolicyDiagnosticByToolCallId = new Map<
    string,
    ReturnType<typeof policyPreflightDiagnostic>
  >()
  const emittedPreflightDiagnosticsByModelRequestId = new Map<string, Set<string>>()
  const rawArgumentsByToolCallId = new Map<string, unknown>()
  const toolStartedAtByToolCallId = new Map<string, number>()
  const toolTraceOccurrenceByModelRequestId = new Map<string, number>()
  let lastAssistant: AssistantMessage | undefined
  let lastAssistantRetriesExhausted = false
  let lastAssistantHttpStatus: number | undefined
  let lastProviderError: unknown
  let awaitingReview = false
  const setRuntimeMessageBudget = (tokens: number): void => {
    contextBudget.setTokenBudget(tokens)
  }
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
    },
    toolProfile,
    interactionMode
  )

  const agent = new AgentClass({
    initialState: {
      systemPrompt: request.systemPrompt,
      model,
      thinkingLevel: request.thinkingLevel,
      tools: toolBridge.tools(request.activeToolGroups),
      messages: request.history.map(toPiMessage)
    },
    getApiKey: (providerId) =>
      apiKeyForProvider(runtimeCredential, request.config.providerId, providerId),
    transformContext: (messages) => {
      const system = getCurrentSystemMessage(messages)
      const bounded = contextBudget.transform(
        messages.filter((message) => message.role !== 'system')
      )
      return Promise.resolve(system === undefined ? bounded : [system, ...bounded])
    },
    finishTurn: ({ message }) => {
      if (message.stopReason === 'length') {
        outputLimitError = new AgentOutputLimitError(request.maxOutputTokens)
        log?.(
          'error',
          'agent.model.output_limit_reached',
          outputLimitError.message,
          { maxOutputTokens: request.maxOutputTokens },
          outputLimitError
        )
        return { action: 'end' }
      }
      return undefined
    },
    prepareRequest: async ({ context }) => {
      let modelRequestId = modelRequestIds[0]
      if (modelRequestId === undefined) {
        const authorization = await requestModelCallAuthorization(
          onEvent,
          pendingModelCallAuthorizations
        )
        if (authorization.interactionMode !== interactionMode) {
          throw new Error('Agent model-call authorization changed the immutable interaction mode')
        }
        modelRequestId = authorization.modelRequestId
        modelRequestIds.push(modelRequestId)
        modelRequestPurposes.set(modelRequestId, 'tool_continuation')
        authorizedContinuationRequestIds.add(modelRequestId)
        activeToolGroups = authorization.activeToolGroups ?? activeToolGroups
        currentSystemPrompt = authorization.systemPrompt
        setRuntimeMessageBudget(
          authorization.runtimeMessageBudgetTokens ??
            agentRuntimeMessageBudget({
              maxOutputTokens: request.maxOutputTokens,
              limits: modelLimits,
              systemPrompt: currentSystemPrompt,
              advertisedTools: agentToolEnvelope(
                agentModelVisibleToolSpecs(toolProfile, activeToolGroups, interactionMode)
              )
            })
        )
      }
      const updatedPrompt = systemPromptByModelRequestId.get(modelRequestId)
      if (updatedPrompt !== undefined) {
        systemPromptByModelRequestId.delete(modelRequestId)
        currentSystemPrompt = updatedPrompt
        setRuntimeMessageBudget(
          agentRuntimeMessageBudget({
            maxOutputTokens: request.maxOutputTokens,
            limits: modelLimits,
            systemPrompt: currentSystemPrompt,
            advertisedTools: agentToolEnvelope(
              agentModelVisibleToolSpecs(toolProfile, activeToolGroups, interactionMode)
            )
          })
        )
      }
      const tools = toolBridge.tools(activeToolGroups)
      const system = createInitialSystemMessage(currentSystemPrompt, tools.map(toToolDeclaration))
      const messages = context.messages.filter((message) => message.role !== 'system')
      return {
        context: { messages: system === undefined ? messages : [system, ...messages], tools }
      }
    },
    beforeToolCall: async ({ assistantMessage, toolCall }) => {
      const calls = assistantMessage.content
        .filter((part) => part.type === 'toolCall')
        .map((part) => ({ id: part.id, name: part.name }))
      const failure = validateAgentToolCallBatch({
        toolName: toolCall.name,
        calls,
        isMutationTool
      })
      if (failure === undefined) return undefined
      preflightPolicyDiagnosticByToolCallId.set(
        toolCall.id,
        policyPreflightDiagnostic(failure.code, failure.message)
      )
      return { block: true as const, reason: failure.message }
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
      const advertisedToolNames = new Set(
        (getCurrentSystemMessage(context.messages)?.toolsAdded ?? []).map((tool) => tool.name)
      )
      modelVisibleToolsByRequestId.set(
        modelRequestId,
        new Map(
          agentModelVisibleToolSpecs(toolProfile, activeToolGroups, interactionMode)
            .filter((tool) => advertisedToolNames.has(tool.name))
            .map((tool) => [tool.name, tool])
        )
      )
      authorizedContinuationRequestIds.delete(modelRequestId)
      const tracePurpose = modelRequestPurposes.get(modelRequestId) ?? 'tool_continuation'
      let lastResponseStatus: number | undefined
      let retryAfterMs: number | undefined
      let responseHeaders: Record<string, string> = {}
      let physicalAttempt = 0
      const callStartedAt = Date.now()
      let ttftMs: number | undefined
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
            signal: options?.signal,
            apiKey: runtimeCredential.apiKey,
            headers: runtimeCredential.headers,
            env: runtimeCredential.env,
            timeoutMs: undefined,
            ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
            maxTokens: request.maxOutputTokens,
            maxRetries: 0,
            maxRetryDelayMs: AGENT_PROVIDER_MAX_RETRY_DELAY_MS,
            onPayload: async (payload, payloadModel) => {
              const transformed = await options?.onPayload?.(payload, payloadModel)
              const providerRequest = transformed === undefined ? payload : transformed
              if (request.traceCapture) {
                requestTraceCapture(
                  onEvent,
                  modelRequestId,
                  tracePurpose,
                  payloadModel.api,
                  attempt,
                  () => [
                    {
                      kind: 'harness_request',
                      value: serializableHarnessContext(context)
                    },
                    { kind: 'provider_request', value: jsonValue(providerRequest) }
                  ],
                  log,
                  request.agentRunId
                )
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
          ttftMs ??= Math.max(0, Date.now() - callStartedAt)
        },
        onRetry: ({ completedAttempts, maxAttempts, delayMs, reasonCode }) => {
          log?.(
            'info',
            'agent.provider.retrying',
            'Agent provider transient failure; retrying request',
            { modelRequestId, completedAttempts, maxAttempts, delayMs, reasonCode }
          )
        }
      })
      const stream = retrying.stream
      const completion = stream.result().then(async (message) => {
        lastAssistant = message
        lastAssistantRetriesExhausted = retrying.state.exhausted
        lastAssistantHttpStatus = lastResponseStatus
        for (const part of message.content) {
          if (part.type === 'toolCall') modelRequestByToolCallId.set(part.id, modelRequestId)
        }
        if (request.traceCapture) {
          requestTraceCapture(
            onEvent,
            modelRequestId,
            tracePurpose,
            activeModel.api,
            Math.max(1, physicalAttempt),
            () => [
              {
                kind: 'provider_response',
                value: jsonValue(message),
                metadata: {
                  ...(lastResponseStatus === undefined ? {} : { httpStatus: lastResponseStatus }),
                  responseHeaders,
                  ...(ttftMs === undefined ? {} : { ttftMs }),
                  totalDurationMs: Math.max(0, Date.now() - callStartedAt)
                }
              }
            ],
            log,
            request.agentRunId
          )
        }
        const providerPromptTokens = message.usage.input + message.usage.cacheRead
        const contextTokensEstimated = providerPromptTokens === 0
        const payload = toAssistantPayload(
          message,
          retrying.state.retryCount,
          contextTokensEstimated ? estimateAgentTokens(context) : providerPromptTokens,
          contextTokensEstimated
        )
        const truncated = message.stopReason === 'length'
        const failed = message.stopReason === 'error' || truncated
        onEvent({
          type: 'model_call_finished',
          modelRequestId,
          outcome: message.stopReason === 'aborted' ? 'aborted' : failed ? 'failed' : 'succeeded',
          metadata: payload.metadata,
          ...(failed
            ? {
                failureCode: truncated
                  ? ('output_limit_reached' as const)
                  : retrying.state.exhausted
                    ? ('provider_retries_exhausted' as const)
                    : ('provider_request_failed' as const),
                retryable: !truncated && retrying.state.retryableFailure
              }
            : {}),
          ...(lastResponseStatus === undefined ? {} : { httpStatus: lastResponseStatus }),
          physicalAttemptCount: Math.max(1, physicalAttempt),
          ...(ttftMs === undefined ? {} : { ttftMs }),
          totalDurationMs: Math.max(0, Date.now() - callStartedAt)
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
      systemPromptByModelRequestId.set(authorization.modelRequestId, followUp.systemPrompt)
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
      if (request.traceCapture) {
        const traceOccurrence = (toolTraceOccurrenceByModelRequestId.get(modelRequestId) ?? 0) + 1
        toolTraceOccurrenceByModelRequestId.set(modelRequestId, traceOccurrence)
        requestTraceCapture(
          onEvent,
          modelRequestId,
          modelRequestPurposes.get(modelRequestId) ?? 'tool_continuation',
          model.api,
          traceOccurrence,
          () => [
            {
              kind: 'tool_attempt',
              value: jsonValue({ toolName: event.toolName, args: event.args }),
              metadata: { toolCallId: event.toolCallId }
            }
          ],
          log,
          request.agentRunId
        )
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
      const diagnostic = safePreflightDiagnostic(
        modelVisibleToolsByRequestId.get(modelRequestId) ?? new Map(),
        event.toolName,
        rawArgumentsByToolCallId.get(event.toolCallId),
        preflightPolicyDiagnosticByToolCallId.get(event.toolCallId),
        log,
        request.agentRunId
      )
      const startedAt = toolStartedAtByToolCallId.get(event.toolCallId)
      const fingerprint = JSON.stringify([
        event.toolName,
        diagnostic.code,
        diagnostic.message,
        diagnostic.paths
      ])
      const emitted = emittedPreflightDiagnosticsByModelRequestId.get(modelRequestId) ?? new Set()
      if (!emitted.has(fingerprint)) {
        emitted.add(fingerprint)
        emittedPreflightDiagnosticsByModelRequestId.set(modelRequestId, emitted)
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
      } else {
        log?.(
          'info',
          'agent.tool.preflight_duplicate_suppressed',
          'Suppressed a duplicate Agent preflight diagnostic from one model response',
          {
            agentRunId: request.agentRunId,
            modelRequestId,
            toolName: event.toolName,
            code: diagnostic.code
          }
        )
      }
      preflightPolicyDiagnosticByToolCallId.delete(event.toolCallId)
      rawArgumentsByToolCallId.delete(event.toolCallId)
      toolStartedAtByToolCallId.delete(event.toolCallId)
      return
    }
    if (event.type === 'tool_execution_end') {
      preflightPolicyDiagnosticByToolCallId.delete(event.toolCallId)
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
        content: piUserContent(parsed.content, parsed.images),
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
        modelRequestPurposes.set(parsed.modelRequestId, 'agent_steer')
        systemPromptByModelRequestId.set(parsed.modelRequestId, parsed.systemPrompt)
        agent.steer(message)
      } else {
        followUpEntries.push({
          pendingMessageId: parsed.pendingMessageId,
          modelRequestId: parsed.modelRequestId,
          message,
          systemPrompt: parsed.systemPrompt
        })
        modelRequestPurposes.set(parsed.modelRequestId, 'agent_follow_up')
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
        modelRequestPurposes.set(parsed.modelRequestId, 'agent_steer')
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
    abort() {
      agent.abort()
    }
  })

  const abortExternal = (): void => agent.abort()
  if (externalSignal?.aborted) agent.abort()
  else externalSignal?.addEventListener('abort', abortExternal, { once: true })
  let runError: unknown
  try {
    await agent.prompt(
      request.prompt,
      request.images?.map(({ type, data, mimeType }) => ({ type, data, mimeType }))
    )
    await agent.waitForIdle()
    while (true) {
      const completedCallCount = callCompletions.length
      await Promise.all(callCompletions)
      if (
        lastAssistant?.stopReason === 'error' ||
        lastAssistant?.stopReason === 'aborted' ||
        lastAssistant?.stopReason === 'length'
      )
        break
      await recoverAuthorizedContinuation({
        awaitingReview,
        pendingAuthorizationCount: () => authorizedContinuationRequestIds.size,
        continueAgent: () => agent.continue(),
        waitForIdle: () => agent.waitForIdle(),
        log
      })
      if (callCompletions.length > completedCallCount) continue
      break
    }
  } catch (err) {
    runError = err
  } finally {
    await Promise.allSettled(callCompletions)
    for (const pending of pendingModelCallAuthorizations.values()) {
      pending.reject(createAbortError('Agent run ended before model-call authorization'))
    }
    pendingModelCallAuthorizations.clear()
    for (const pending of pendingFollowUpConsumptions.values()) {
      pending.reject(createAbortError('Agent run ended before Follow-up consumption authorization'))
    }
    pendingFollowUpConsumptions.clear()
    toolBridge.close()
    externalSignal?.removeEventListener('abort', abortExternal)
  }

  return finalizeAgentSessionResult({
    maxOutputTokens: request.maxOutputTokens,
    outputLimitError,
    runError,
    lastAssistant,
    lastAssistantRetriesExhausted,
    lastAssistantHttpStatus,
    lastProviderError,
    awaitingReview
  })
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
    return {
      role: 'user',
      content: piUserContent(message.content, message.images),
      timestamp: message.timestamp
    }
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
    interrupted:
      message.stopReason === 'aborted' ||
      message.stopReason === 'error' ||
      message.stopReason === 'length'
  })
}

export class AgentContinuationLostError extends Error {
  readonly code = 'continuation_lost'

  constructor(cause: unknown) {
    super('Agent tool continuation could not be consumed', { cause })
    this.name = 'AgentContinuationLostError'
  }
}

export async function recoverAuthorizedContinuation(input: {
  awaitingReview: boolean
  pendingAuthorizationCount(): number
  continueAgent(): Promise<void>
  waitForIdle(): Promise<void>
  log?: (
    level: 'info' | 'warn' | 'error',
    event: string,
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown
  ) => void
}): Promise<void> {
  const pendingCount = input.pendingAuthorizationCount()
  if (input.awaitingReview || pendingCount === 0) return
  input.log?.(
    'info',
    'agent.worker.continuation_recovered',
    'Agent worker resumed a model call whose authorized tool continuation was not consumed',
    { pendingAuthorizationCount: pendingCount }
  )
  try {
    await input.continueAgent()
    await input.waitForIdle()
  } catch (err) {
    throw new AgentContinuationLostError(err)
  }
  if (input.pendingAuthorizationCount() > 0) {
    throw new AgentContinuationLostError(
      new Error('Authorized model request remained unconsumed after continuation recovery')
    )
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

function requestTraceCapture(
  onEvent: (event: AgentRuntimeEvent) => void,
  modelRequestId: string,
  purpose: AgentTracePurpose,
  apiId: string,
  physicalAttempt: number,
  documents: () => Extract<
    AgentRuntimeEvent,
    { type: 'model_trace_capture_requested' }
  >['documents'],
  log?: (
    level: 'info' | 'warn' | 'error',
    event: string,
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown
  ) => void,
  agentRunId?: string
): void {
  try {
    const parsedApiId = piApiSchema.safeParse(apiId)
    if (!parsedApiId.success) throw new Error(`Unsupported trace API: ${apiId}`)
    onEvent({
      type: 'model_trace_capture_requested',
      modelRequestId,
      purpose,
      apiId: parsedApiId.data,
      physicalAttempt,
      documents: documents()
    })
  } catch (err) {
    reportTraceCaptureFailure(
      log,
      {
        ...(agentRunId === undefined ? {} : { agentRunId }),
        modelRequestId,
        purpose,
        physicalAttempt
      },
      err
    )
  }
}

function reportTraceCaptureFailure(
  log:
    | ((
        level: 'info' | 'warn' | 'error',
        event: string,
        message: string,
        fields?: Record<string, unknown>,
        error?: unknown
      ) => void)
    | undefined,
  fields: Record<string, unknown>,
  error: unknown
): void {
  try {
    log?.(
      'error',
      'agent.trace.capture_failed',
      'Agent trace capture was skipped; provider work continues',
      fields,
      error
    )
    // error-handling: allow owner=agent-trace reason=reporter-fallback
  } catch {
    // Trace is observational. If its reporter transport is closed, no safe
    // diagnostic channel remains; keep the provider result independent of it.
  }
}

function serializableHarnessContext(context: { messages: unknown[] }): JSONType {
  return jsonValue({ messages: context.messages })
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

function isMutationTool(toolName: string): boolean {
  return (
    toolName === 'submit_brief_change' ||
    toolName === 'submit_writing_rules_change' ||
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

function policyPreflightDiagnostic(
  code: 'invalid_arguments' | 'unknown_tool',
  message: string
): {
  code: 'invalid_arguments' | 'unknown_tool'
  message: string
  paths: string[]
  details: ReturnType<typeof serializeAgentDiagnosticError>
} {
  const boundedMessage = message.slice(0, 1_000)
  return {
    code,
    message: boundedMessage,
    paths: [],
    details: serializePreflightDiagnostic(code, boundedMessage)
  }
}

function safePreflightDiagnostic(
  modelVisibleTools: ReadonlyMap<string, AgentModelVisibleToolSpec>,
  requestedToolName: string,
  rawArguments: unknown,
  policyDiagnostic?: ReturnType<typeof policyPreflightDiagnostic>,
  log?: (
    level: 'info' | 'warn' | 'error',
    event: string,
    message: string,
    fields?: Record<string, unknown>,
    error?: unknown
  ) => void,
  agentRunId?: string
): {
  code: 'invalid_arguments' | 'unknown_tool' | 'preparation_failed'
  message: string
  paths: string[]
  details: ReturnType<typeof serializeAgentDiagnosticError>
} {
  if (policyDiagnostic !== undefined) return policyDiagnostic
  const tool = modelVisibleTools.get(requestedToolName)
  if (tool === undefined) {
    const message =
      'The requested tool is not registered. Choose one of the model-visible WriteLLM tools.'
    return {
      code: 'unknown_tool',
      message,
      paths: [],
      details: serializePreflightDiagnostic('unknown_tool', message)
    }
  }
  try {
    const converted = structuredClone(rawArguments)
    Value.Convert(tool.parameters, converted)
    const validationErrors = [...Value.Errors(tool.parameters, converted)].slice(0, 16)
    const paths = [...new Set(validationErrors.map((error) => error.instancePath || '/'))]
    if (paths.length > 0) {
      const reasons = validationErrors
        .map((error) => `${error.instancePath || '/'}: ${error.message}`)
        .join('; ')
      const message =
        `Arguments for ${tool.name} failed preflight at ${paths.join(', ')}. Validation: ${reasons}. Received shape: ${describeArgumentShape(rawArguments)}. Fix the named fields.`.slice(
          0,
          1_000
        )
      return {
        code: 'invalid_arguments',
        message,
        paths,
        details: serializePreflightDiagnostic('invalid_arguments', message)
      }
    }
  } catch (error) {
    const detail = safeAgentDiagnosticMessage(error)
    log?.(
      'error',
      'agent.tool.preflight_failed',
      'Agent tool arguments could not be prepared for preflight validation',
      {
        ...(agentRunId === undefined ? {} : { agentRunId }),
        toolName: tool.name
      },
      error
    )
    return {
      code: 'preparation_failed',
      message: `Arguments for ${tool.name} could not be prepared safely: ${detail}`.slice(0, 1_000),
      paths: [],
      details: serializePreflightDiagnostic(
        'preparation_failed',
        `Arguments for ${tool.name} could not be prepared safely`,
        error
      )
    }
  }
  const message = `${tool.name} passed basic argument validation but was blocked before Main dispatch. Separate reads from mutations and submit at most one mutation.`
  return {
    code: 'preparation_failed',
    message,
    paths: [],
    details: serializePreflightDiagnostic('preparation_failed', message)
  }
}

function serializePreflightDiagnostic(
  code: 'invalid_arguments' | 'unknown_tool' | 'preparation_failed',
  message: string,
  cause?: unknown
): ReturnType<typeof serializeAgentDiagnosticError> {
  const error = new Error(message, cause === undefined ? undefined : { cause }) as Error & {
    code?: string
  }
  error.name = 'AgentToolPreflightError'
  error.code = code
  return serializeAgentDiagnosticError(error, 'tool.preflight')
}

function piUserContent(
  text: string,
  images?: import('../shared/contracts/agent-attachments').AgentImageContent[]
): UserMessage['content'] {
  return !images?.length
    ? text
    : [
        ...(text.length ? [{ type: 'text' as const, text }] : []),
        ...images.map(({ type, data, mimeType }) => ({ type, data, mimeType }))
      ]
}
