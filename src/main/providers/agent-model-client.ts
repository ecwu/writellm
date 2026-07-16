import { randomUUID } from 'node:crypto'
import { utilityProcess } from 'electron'
import type { Logger } from 'pino'
import {
  agentRunInputSchema,
  agentUtilityMessageSchema,
  type AgentUtilityRequest
} from '../../shared/contracts/model-runtime'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { AgentModelRuntime } from './gateways'
import type { UtilityProcessFactory } from './provider-probe-client'
import {
  PersistentUtilityProcess,
  type UtilityMessageDecision
} from '../workers/persistent-utility-process'
import type { LogCollector } from '../observability/log-collector'

export class AgentModelClient implements AgentModelRuntime {
  readonly #worker: PersistentUtilityProcess

  constructor(
    modulePath: string,
    private readonly log: Logger,
    processFactory: UtilityProcessFactory = utilityProcess,
    collector?: LogCollector
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
