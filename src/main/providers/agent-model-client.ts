import { randomUUID } from 'node:crypto'
import { MessageChannelMain, utilityProcess, type MessagePortMain } from 'electron'
import type { Logger } from 'pino'
import {
  agentRunInputSchema,
  agentUtilityMessageSchema,
  type AgentUtilityRequest
} from '../../shared/contracts/model-runtime'
import {
  agentQueueCommandSchema,
  agentRunStartSchema,
  agentModelCallAuthorizationSchema,
  agentRuntimeMessageSchema,
  type AgentQueueCommand,
  type AgentRuntimeEvent
} from '../../shared/contracts/agent'
import {
  agentToolRequestSchema,
  agentToolResponseSchema,
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
    projectSessionId?: string
  ): ReturnType<AgentModelRuntime['run']> {
    if (signal.aborted) return Promise.reject(abortError())
    if (config.role !== 'agent') return Promise.reject(new Error('Agent provider role is required'))
    const input = agentRunInputSchema.parse(rawInput)
    const request: AgentUtilityRequest = {
      requestId: randomUUID(),
      projectSessionId: projectSessionId ?? null,
      config,
      credential,
      input
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
        this.#handleMessage(raw, request.requestId, request.projectSessionId, onEvent)
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
    const requestId = randomUUID()
    const request = agentRunStartSchema.parse({
      operation: 'run_start',
      requestId,
      config,
      credential,
      ...input
    })
    const { port1, port2 } = this.createMessageChannel()
    const toolBridge = this.#attachToolBridge(port1, request, signal, onToolRequest)
    const workerCompletion = this.#worker.request<void>({
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
      onMessage: (raw) => this.#handleSessionMessage(raw, request, onEvent)
    })
    const completion = workerCompletion.finally(async () => {
      toolBridge.close()
      await toolBridge.drain()
    })
    const queue = (
      operation: AgentQueueCommand['operation'],
      command: Omit<AgentQueueCommand, 'operation' | 'requestId'>
    ): void => {
      const parsed = agentQueueCommandSchema.parse({ operation, requestId, ...command })
      if (
        parsed.projectSessionId !== request.projectSessionId ||
        parsed.agentSessionId !== request.agentSessionId ||
        parsed.agentRunId !== request.agentRunId
      ) {
        throw new Error('Agent queue command does not belong to the active run')
      }
      this.#worker.send(parsed)
    }
    return {
      requestId,
      completion,
      steer: (command) => queue('steer', command),
      followUp: (command) => queue('follow_up', command),
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
        const parsed = agentToolRequestSchema.safeParse(event.data)
        if (
          !parsed.success ||
          parsed.data.projectSessionId !== request.projectSessionId ||
          parsed.data.agentSessionId !== request.agentSessionId ||
          parsed.data.agentRunId !== request.agentRunId
        ) {
          failProtocol(
            parsed.success ? new Error('Agent tool request capability mismatch') : parsed.error
          )
          return
        }
        let response: AgentToolResponse
        try {
          response =
            onToolRequest === undefined
              ? unavailableToolResponse(parsed.data)
              : await onToolRequest(parsed.data, controller.signal)
        } catch (err) {
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
          response = internalToolResponse(parsed.data)
        }
        const validated = agentToolResponseSchema.safeParse(response)
        if (
          !validated.success ||
          validated.data.requestId !== parsed.data.requestId ||
          validated.data.projectSessionId !== parsed.data.projectSessionId ||
          validated.data.agentSessionId !== parsed.data.agentSessionId ||
          validated.data.agentRunId !== parsed.data.agentRunId ||
          validated.data.toolCallId !== parsed.data.toolCallId ||
          validated.data.toolName !== parsed.data.toolName ||
          validated.data.modelRequestId !== parsed.data.modelRequestId
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

  #handleMessage(
    raw: unknown,
    requestId: string,
    projectSessionId: string | null | undefined,
    onEvent: Parameters<AgentModelRuntime['run']>[4]
  ): UtilityMessageDecision<Awaited<ReturnType<AgentModelRuntime['run']>>> {
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
      const err = reconstructError(message.error)
      this.log.error({ event: 'agent_model.failed', err, requestId }, 'Agent model request failed')
      return { kind: 'reject', error: new Error('Agent model request failed', { cause: err }) }
    }
    return { kind: 'resolve', value: message.result }
  }

  async #handleSessionMessage(
    raw: unknown,
    request: ReturnType<typeof agentRunStartSchema.parse>,
    onEvent: (event: AgentRuntimeEvent) => void | Promise<void>
  ): Promise<UtilityMessageDecision<void>> {
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
      const err = reconstructError(message.error)
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
    return { kind: 'resolve', value: undefined }
  }
}

function reconstructError(input: {
  name: string
  message: string
  stack?: string
  httpStatus?: number
}): Error & { status?: number } {
  const error: Error & { status?: number } = new Error(input.message)
  error.name = input.name
  if (input.stack !== undefined) error.stack = input.stack
  if (input.httpStatus !== undefined) error.status = input.httpStatus
  return error
}

function abortError(): Error {
  const error = new Error('Agent model request aborted')
  error.name = 'AbortError'
  return error
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
    authorizeModelCall: () => {
      throw error
    }
  }
}

function unavailableToolResponse(request: AgentToolRequest): AgentToolResponse {
  return {
    type: 'tool_response',
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
      message: 'Agent read tools are unavailable',
      retryable: true
    }
  }
}

function internalToolResponse(request: AgentToolRequest): AgentToolResponse {
  return {
    type: 'tool_response',
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName,
    ok: false,
    error: { code: 'internal', message: 'Agent read tool failed', retryable: false }
  }
}
