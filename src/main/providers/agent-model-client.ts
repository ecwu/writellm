import { randomUUID } from 'node:crypto'
import {
  reconstructAgentDiagnosticError,
  serializeAgentDiagnosticError,
  type AgentDiagnosticError
} from '../../shared/agent-diagnostic-error'
import { MessageChannelMain, utilityProcess, type MessagePortMain } from 'electron'
import type { Logger } from 'pino'
import {
  agentRunInputSchema,
  agentUtilityMessageSchema,
  type AgentUtilityRequest
} from '../../shared/contracts/model-runtime'
import {
  agentFollowUpConsumptionAuthorizationSchema,
  agentQueueActionCommandSchema,
  agentQueueCommandSchema,
  agentRunStartSchema,
  agentModelCallAuthorizationSchema,
  agentRuntimeMessageSchema,
  agentSessionRunResultSchema,
  type AgentRuntimeEvent,
  type AgentSessionRunResult
} from '../../shared/contracts/agent'
import {
  AGENT_TOOL_RESULT_SCHEMA_VERSION,
  agentToolRequestEnvelopeSchema,
  agentToolRequestSchema,
  agentToolResponseSchema,
  type AgentToolRequestEnvelope,
  type AgentToolRequest,
  type AgentToolResponse
} from '../../shared/contracts/agent-tools'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type {
  AgentModelRuntime,
  AgentSessionRunHandle,
  AgentSessionRunInput,
  AgentSessionRuntime
} from './gateways'
import type { UtilityProcessFactory } from './provider-probe-client'
import {
  PersistentUtilityProcess,
  type UtilityMessageDecision
} from '../workers/persistent-utility-process'
import type { LogCollector } from '../observability/log-collector'
import type { AgentModelLimits } from '../../shared/contracts/agent'
import { agentToolProfileAllows } from '../../shared/agent-tool-specs'

export class AgentModelClient implements AgentModelRuntime, AgentSessionRuntime {
  readonly #worker: PersistentUtilityProcess

  constructor(
    modulePath: string,
    private readonly log: Logger,
    processFactory: UtilityProcessFactory = utilityProcess,
    collector?: LogCollector,
    private readonly createMessageChannel: () => {
      port1: MessagePortMain
      port2: MessagePortMain
    } = () => new MessageChannelMain()
  ) {
    this.#worker = new PersistentUtilityProcess({
      modulePath,
      serviceName: 'writellm-agent-worker',
      log,
      factory: processFactory,
      collector,
      processRole: 'agent-worker',
      subsystem: 'agent',
      component: 'model'
    })
  }

  terminate(): void {
    this.#worker.terminate()
  }

  run(
    config: ProviderConfig,
    credential: string,
    rawInput: Parameters<AgentModelRuntime['run']>[2],
    signal: AbortSignal,
    onEvent: Parameters<AgentModelRuntime['run']>[4],
    projectSessionId?: string,
    modelLimits?: Parameters<AgentModelRuntime['run']>[6],
    trace?: Parameters<AgentModelRuntime['run']>[7]
  ): ReturnType<AgentModelRuntime['run']> {
    if (signal.aborted) return Promise.reject(abortError())
    if (config.role !== 'agent') return Promise.reject(new Error('Agent provider role is required'))
    const input = agentRunInputSchema.parse(rawInput)
    const request: AgentUtilityRequest = {
      requestId: randomUUID(),
      projectSessionId: projectSessionId ?? null,
      config,
      credential: decodeAgentRuntimeAuth(credential),
      modelLimits: modelLimits ?? legacyLimits(config.contextWindowTokens),
      input,
      ...(trace === undefined ? {} : { trace: trace.context })
    }
    return this.#worker.request({
      requestId: request.requestId,
      payload: request,
      signal,
      rejectOnAbort: abortError(),
      cancelPayload: {
        type: 'cancel',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId
      },
      onMessage: (raw) =>
        this.#handleMessage(raw, request.requestId, request.projectSessionId, onEvent, trace)
    })
  }

  beginSessionRun(
    config: ProviderConfig,
    credential: string,
    input: AgentSessionRunInput,
    signal: AbortSignal,
    onEvent: (event: AgentRuntimeEvent) => void | Promise<void>,
    onToolRequest?: (request: AgentToolRequest, signal: AbortSignal) => Promise<AgentToolResponse>
  ): AgentSessionRunHandle {
    if (signal.aborted) {
      return rejectedSessionHandle(abortError())
    }
    if (config.role !== 'agent')
      return rejectedSessionHandle(new Error('Agent provider role is required'))
    const requestId = randomUUID()
    const request = agentRunStartSchema.parse({
      operation: 'run_start',
      requestId,
      config,
      credential: decodeAgentRuntimeAuth(credential),
      ...input,
      modelLimits: input.modelLimits ?? legacyLimits(config.contextWindowTokens)
    })
    const { port1, port2 } = this.createMessageChannel()
    const traceRequestIds = new Set([request.modelRequestId])
    const toolBridge = this.#attachToolBridge(port1, request, signal, onToolRequest)
    const pendingQueueActions = new Map<
      string,
      {
        resolve: (outcome: 'completed' | 'stale') => void
        reject: (error: Error) => void
      }
    >()
    const deliverSessionEvent = async (event: AgentRuntimeEvent): Promise<void> => {
      if (event.type !== 'queue_action_completed') {
        await onEvent(event)
        return
      }
      const pending = pendingQueueActions.get(event.actionId)
      if (pending === undefined) throw new Error('Agent queue action acknowledgement is stale')
      pendingQueueActions.delete(event.actionId)
      pending.resolve(event.outcome)
    }
    const workerCompletion = this.#worker.request<AgentSessionRunResult>({
      requestId,
      payload: request,
      signal,
      rejectOnAbort: abortError(),
      cancelPayload: {
        operation: 'cancel',
        requestId,
        projectSessionId: request.projectSessionId,
        agentSessionId: request.agentSessionId,
        agentRunId: request.agentRunId
      },
      transfer: [port2],
      onMessage: (raw) =>
        this.#handleSessionMessage(raw, request, deliverSessionEvent, traceRequestIds)
    })
    const completion = workerCompletion.finally(async () => {
      const error = new Error('Agent run ended before a queue action completed')
      for (const pending of pendingQueueActions.values()) pending.reject(error)
      pendingQueueActions.clear()
      toolBridge.close()
      await toolBridge.drain()
    })
    const queue = (raw: unknown): void => {
      const parsed = agentQueueCommandSchema.parse(raw)
      if (
        parsed.projectSessionId !== request.projectSessionId ||
        parsed.agentSessionId !== request.agentSessionId ||
        parsed.agentRunId !== request.agentRunId
      ) {
        throw new Error('Agent queue command does not belong to the active run')
      }
      if (parsed.operation === 'steer') traceRequestIds.add(parsed.modelRequestId)
      this.#worker.send(parsed)
    }
    return {
      requestId,
      completion,
      steer: (command) => queue({ operation: 'steer', requestId, ...command }),
      followUp: (command) => queue({ operation: 'follow_up', requestId, ...command }),
      queueAction: (command) => {
        const parsed = agentQueueActionCommandSchema.parse({ requestId, ...command })
        if (
          parsed.projectSessionId !== request.projectSessionId ||
          parsed.agentSessionId !== request.agentSessionId ||
          parsed.agentRunId !== request.agentRunId
        ) {
          return Promise.reject(new Error('Agent queue action does not belong to the active run'))
        }
        if (parsed.operation === 'commit_follow_up_steer') {
          traceRequestIds.add(parsed.modelRequestId)
        }
        return new Promise<'completed' | 'stale'>((resolve, reject) => {
          pendingQueueActions.set(parsed.actionId, { resolve, reject })
          try {
            this.#worker.send(parsed)
          } catch (err) {
            pendingQueueActions.delete(parsed.actionId)
            reject(
              err instanceof Error ? err : new Error('Agent queue action failed', { cause: err })
            )
          }
        })
      },
      authorizeFollowUpConsumption: (command) => {
        const parsed = agentFollowUpConsumptionAuthorizationSchema.parse({
          operation: 'authorize_follow_up_consumption',
          requestId,
          ...command
        })
        if (
          parsed.projectSessionId !== request.projectSessionId ||
          parsed.agentSessionId !== request.agentSessionId ||
          parsed.agentRunId !== request.agentRunId
        ) {
          throw new Error('Agent Follow-up authorization does not belong to the active run')
        }
        traceRequestIds.add(parsed.modelRequestId)
        this.#worker.send(parsed)
      },
      authorizeModelCall: (command) => {
        const parsed = agentModelCallAuthorizationSchema.parse({
          operation: 'authorize_model_call',
          requestId,
          ...command
        })
        if (
          parsed.projectSessionId !== request.projectSessionId ||
          parsed.agentSessionId !== request.agentSessionId ||
          parsed.agentRunId !== request.agentRunId
        ) {
          throw new Error('Agent model-call authorization does not belong to the active run')
        }
        traceRequestIds.add(parsed.modelRequestId)
        this.#worker.send(parsed)
      }
    }
  }

  #attachToolBridge(
    port: MessagePortMain,
    request: ReturnType<typeof agentRunStartSchema.parse>,
    signal: AbortSignal,
    onToolRequest?: (request: AgentToolRequest, signal: AbortSignal) => Promise<AgentToolResponse>
  ): { close: () => void; drain: () => Promise<void> } {
    const diagnosticFor = (error: unknown): AgentDiagnosticError =>
      serializeAgentDiagnosticError(error, 'tool.bridge', {
        knownSensitiveValues: [
          request.credential.apiKey,
          ...Object.values(request.credential.headers ?? {}),
          ...Object.values(request.credential.env ?? {})
        ].filter((value): value is string => typeof value === 'string'),
        privateBodies: [
          request.prompt,
          request.systemPrompt,
          ...request.history.map((message) =>
            message.role === 'user' ? message.content : message.message.content
          )
        ]
      })
    const controller = new AbortController()
    const inFlight = new Set<Promise<void>>()
    let resolveDrain: (() => void) | undefined
    let drainPromise: Promise<void> | undefined
    let closed = false
    const settleDrain = (): void => {
      if (closed && inFlight.size === 0) {
        resolveDrain?.()
        resolveDrain = undefined
      }
    }
    const close = (): void => {
      if (closed) return
      closed = true
      controller.abort(new Error('Agent tool bridge closed'))
      signal.removeEventListener('abort', close)
      port.removeAllListeners()
      port.close()
      settleDrain()
    }
    const drain = (): Promise<void> => {
      if (drainPromise !== undefined) return drainPromise
      if (inFlight.size === 0) return Promise.resolve()
      drainPromise = new Promise<void>((resolve) => {
        resolveDrain = resolve
        settleDrain()
      })
      return drainPromise
    }
    const failProtocol = (err: unknown): void => {
      this.log.error(
        { event: 'agent_tool_bridge.protocol_violation', err, agentRunId: request.agentRunId },
        'Agent tool bridge protocol violation'
      )
      close()
      this.#worker.terminate()
    }
    port.on('message', (event) => {
      const task = (async () => {
        const envelope = agentToolRequestEnvelopeSchema.safeParse(event.data)
        if (
          !envelope.success ||
          envelope.data.projectSessionId !== request.projectSessionId ||
          envelope.data.agentSessionId !== request.agentSessionId ||
          envelope.data.agentRunId !== request.agentRunId
        ) {
          failProtocol(
            envelope.success ? new Error('Agent tool request capability mismatch') : envelope.error
          )
          return
        }
        const parsed = agentToolRequestSchema.safeParse(envelope.data)
        let response: AgentToolResponse
        if (!parsed.success) {
          const diagnostic = diagnosticFor(parsed.error)
          this.log.warn(
            {
              event: 'agent_tool_bridge.arguments_invalid',
              err: parsed.error,
              agentRunId: request.agentRunId,
              toolCallId: envelope.data.toolCallId,
              toolName: envelope.data.toolName
            },
            'Agent tool bridge rejected invalid tool arguments'
          )
          response = invalidArgumentsToolResponse(envelope.data, diagnostic)
        } else {
          try {
            if (!agentToolProfileAllows(request.toolProfile, parsed.data.toolName)) {
              this.log.warn(
                {
                  event: 'agent_tool_bridge.profile_rejected',
                  agentRunId: request.agentRunId,
                  toolCallId: parsed.data.toolCallId,
                  toolName: parsed.data.toolName,
                  toolProfile: request.toolProfile
                },
                'Agent tool bridge rejected a tool outside the run profile'
              )
              response = unauthorizedToolResponse(parsed.data)
            } else {
              response =
                onToolRequest === undefined
                  ? unavailableToolResponse(parsed.data)
                  : await onToolRequest(parsed.data, controller.signal)
            }
          } catch (err) {
            const diagnostic = diagnosticFor(err)
            this.log.error(
              {
                event: 'agent_tool_bridge.handler_failed',
                err,
                agentRunId: request.agentRunId,
                toolCallId: parsed.data.toolCallId,
                toolName: parsed.data.toolName
              },
              'Agent tool bridge handler failed'
            )
            response = internalToolResponse(parsed.data, diagnostic)
          }
        }
        const validated = agentToolResponseSchema.safeParse(response)
        if (
          !validated.success ||
          validated.data.requestId !== envelope.data.requestId ||
          validated.data.projectSessionId !== envelope.data.projectSessionId ||
          validated.data.agentSessionId !== envelope.data.agentSessionId ||
          validated.data.agentRunId !== envelope.data.agentRunId ||
          validated.data.toolCallId !== envelope.data.toolCallId ||
          validated.data.toolName !== envelope.data.toolName ||
          validated.data.modelRequestId !== envelope.data.modelRequestId
        ) {
          failProtocol(
            validated.success
              ? new Error('Agent tool response capability mismatch')
              : validated.error
          )
          return
        }
        if (closed) return
        try {
          port.postMessage(validated.data)
        } catch (err) {
          this.log.error(
            {
              event: 'agent_tool_bridge.response_send_failed',
              err,
              agentRunId: request.agentRunId
            },
            'Agent tool bridge response could not be sent'
          )
          close()
        }
      })()
      inFlight.add(task)
      void task.then(
        () => {
          inFlight.delete(task)
          settleDrain()
        },
        () => {
          inFlight.delete(task)
          settleDrain()
        }
      )
    })
    port.once('close', close)
    signal.addEventListener('abort', close, { once: true })
    port.start()
    return { close, drain }
  }

  async #handleMessage(
    raw: unknown,
    requestId: string,
    projectSessionId: string | null | undefined,
    onEvent: Parameters<AgentModelRuntime['run']>[4],
    trace?: Parameters<AgentModelRuntime['run']>[7]
  ): Promise<UtilityMessageDecision<Awaited<ReturnType<AgentModelRuntime['run']>>>> {
    const parsed = agentUtilityMessageSchema.safeParse(raw)
    if (
      !parsed.success ||
      parsed.data.requestId !== requestId ||
      (parsed.data.projectSessionId ?? null) !== (projectSessionId ?? null)
    ) {
      const err = parsed.success
        ? new Error('Agent response request or project session mismatch')
        : parsed.error
      this.log.error(
        { event: 'agent_model.response_invalid', err, requestId },
        'Agent model utility returned an invalid response'
      )
      return {
        kind: 'reject',
        error: new Error('Agent model utility returned an invalid response'),
        terminate: true
      }
    }
    const message = parsed.data
    if (message.type === 'trace-capture') {
      if (trace === undefined || message.modelRequestId !== trace.context.modelRequestId) {
        return {
          kind: 'reject',
          error: new Error('Agent trace capture has no matching Main authority'),
          terminate: true
        }
      }
      try {
        void Promise.resolve(
          trace.capture({
            ...trace.context,
            apiId: message.apiId,
            physicalAttempt: message.physicalAttempt,
            documents: message.documents
          })
        ).catch((err) => {
          this.log.error(
            { event: 'agent_model.trace_capture_failed', err, requestId },
            'Agent model trace capture failed'
          )
        })
      } catch (err) {
        this.log.error(
          { event: 'agent_model.trace_capture_failed', err, requestId },
          'Agent model trace capture failed'
        )
        return { kind: 'event' }
      }
      return { kind: 'event' }
    }
    if (message.type === 'text-delta') {
      try {
        onEvent({ type: 'text-delta', delta: message.delta })
      } catch (err) {
        this.log.error(
          { event: 'agent_model.event_delivery_failed', err, requestId },
          'Agent model event delivery failed'
        )
        return {
          kind: 'reject',
          error: new Error('Agent model event delivery failed', { cause: err })
        }
      }
      return { kind: 'event' }
    }
    if (message.type === 'error') {
      const err = reconstructAgentDiagnosticError(message.error)
      this.log.error({ event: 'agent_model.failed', err, requestId }, 'Agent model request failed')
      return { kind: 'reject', error: err }
    }
    return { kind: 'resolve', value: message.result }
  }

  async #handleSessionMessage(
    raw: unknown,
    request: ReturnType<typeof agentRunStartSchema.parse>,
    onEvent: (event: AgentRuntimeEvent) => void | Promise<void>,
    traceRequestIds: ReadonlySet<string>
  ): Promise<UtilityMessageDecision<AgentSessionRunResult>> {
    const parsed = agentRuntimeMessageSchema.safeParse(raw)
    if (
      !parsed.success ||
      parsed.data.requestId !== request.requestId ||
      parsed.data.projectSessionId !== request.projectSessionId ||
      parsed.data.agentSessionId !== request.agentSessionId ||
      parsed.data.agentRunId !== request.agentRunId
    ) {
      const err = parsed.success
        ? new Error('Agent run response capability mismatch')
        : parsed.error
      this.log.error(
        {
          event: 'agent_session.response_invalid',
          err,
          requestId: request.requestId,
          agentRunId: request.agentRunId
        },
        'Agent worker returned an invalid session response'
      )
      return {
        kind: 'reject',
        error: new Error('Agent worker returned an invalid session response'),
        terminate: true
      }
    }
    const message = parsed.data
    if (message.type === 'event') {
      if (message.event.type === 'model_trace_capture_requested') {
        if (!traceRequestIds.has(message.event.modelRequestId)) {
          return {
            kind: 'reject',
            error: new Error('Agent trace capture has no matching Main authority'),
            terminate: true
          }
        }
        const failed = (err: unknown): void => {
          this.log.error(
            { event: 'agent_session.trace_capture_failed', err, agentRunId: request.agentRunId },
            'Agent request continues without trace capture'
          )
        }
        try {
          void Promise.resolve(onEvent(message.event)).catch(failed)
        } catch (err) {
          failed(err)
        }
        return { kind: 'event' }
      }
      try {
        await onEvent(message.event)
      } catch (err) {
        this.log.error(
          {
            event: 'agent_session.event_delivery_failed',
            err,
            requestId: request.requestId,
            agentRunId: request.agentRunId
          },
          'Agent session event delivery failed'
        )
        return {
          kind: 'reject',
          error: new Error('Agent session event delivery failed', { cause: err }),
          terminate: true
        }
      }
      return { kind: 'event' }
    }
    if (message.type === 'error') {
      const err = reconstructAgentDiagnosticError(message.error)
      this.log.error(
        {
          event: 'agent_session.failed',
          err,
          requestId: request.requestId,
          agentRunId: request.agentRunId
        },
        'Agent session run failed'
      )
      return { kind: 'reject', error: err }
    }
    return {
      kind: 'resolve',
      value: agentSessionRunResultSchema.parse({ outcome: message.outcome })
    }
  }
}

function legacyLimits(contextWindowTokens?: number | null): AgentModelLimits {
  return {
    contextWindowTokens: contextWindowTokens ?? 131_072,
    inputLimitTokens: null,
    outputLimitTokens: null,
    source: contextWindowTokens == null ? 'legacy_fallback' : 'manual_override',
    catalogModelKey: null,
    resolvedAt: null
  }
}

function abortError(): Error {
  const error = new Error('Agent model request aborted')
  error.name = 'AbortError'
  return error
}

function decodeAgentRuntimeAuth(value: string): {
  apiKey?: string
  headers?: Record<string, string | null>
  env?: Record<string, string>
} {
  if (!value.startsWith('{')) return { apiKey: value }
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (err) {
    throw new Error('Agent runtime authentication envelope is invalid', { cause: err })
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('Agent runtime authentication envelope is invalid')
  }
  return parsed as {
    apiKey?: string
    headers?: Record<string, string | null>
    env?: Record<string, string>
  }
}

function rejectedSessionHandle(error: Error): AgentSessionRunHandle {
  return {
    requestId: '00000000-0000-4000-8000-000000000000',
    completion: Promise.reject(error),
    steer: () => {
      throw error
    },
    followUp: () => {
      throw error
    },
    queueAction: () => Promise.reject(error),
    authorizeFollowUpConsumption: () => {
      throw error
    },
    authorizeModelCall: () => {
      throw error
    }
  }
}

function unavailableToolResponse(request: AgentToolRequest): AgentToolResponse {
  return {
    type: 'tool_response',
    schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName,
    ok: false,
    error: {
      code: 'unavailable',
      category: 'transient',
      message: 'Agent read tools are unavailable',
      recovery: { action: 'retry' }
    }
  }
}

function unauthorizedToolResponse(request: AgentToolRequest): AgentToolResponse {
  return {
    type: 'tool_response',
    schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName,
    ok: false,
    error: {
      code: 'unauthorized',
      category: 'authorization',
      message: 'Agent tool is not authorized for this run',
      recovery: { action: 'do_not_retry' }
    }
  }
}

function invalidArgumentsToolResponse(
  request: AgentToolRequestEnvelope,
  details: AgentDiagnosticError
): AgentToolResponse {
  return {
    type: 'tool_response',
    schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName,
    ok: false,
    error: {
      code: 'invalid_arguments',
      category: 'validation',
      message: details.message.slice(0, 1_000),
      details,
      recovery: { action: 'fix_arguments', tool: request.toolName }
    }
  }
}

function internalToolResponse(
  request: AgentToolRequest,
  details: AgentDiagnosticError
): AgentToolResponse {
  return {
    type: 'tool_response',
    schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName,
    ok: false,
    error: {
      code: 'internal',
      category: 'internal',
      message: details.message.slice(0, 1_000),
      details,
      recovery: { action: 'do_not_retry' }
    }
  }
}
