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

export class AgentModelClient implements AgentModelRuntime {
  constructor(
    private readonly modulePath: string,
    private readonly log: Logger,
    private readonly processFactory: UtilityProcessFactory = utilityProcess
  ) {}

  run(
    config: ProviderConfig,
    credential: string,
    rawInput: Parameters<AgentModelRuntime['run']>[2],
    signal: AbortSignal,
    onEvent: Parameters<AgentModelRuntime['run']>[4]
  ): ReturnType<AgentModelRuntime['run']> {
    if (signal.aborted) return Promise.reject(abortError())
    if (config.role !== 'agent') return Promise.reject(new Error('Agent provider role is required'))
    const input = agentRunInputSchema.parse(rawInput)
    const request: AgentUtilityRequest = { requestId: randomUUID(), config, credential, input }
    const child = this.processFactory.fork(this.modulePath, [], {
      serviceName: 'writellm-agent-model',
      stdio: 'ignore'
    })
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (operation: () => void): void => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        child.removeListener('message', onMessage)
        child.removeListener('exit', onExit)
        operation()
      }
      const onAbort = (): void => {
        finish(() => reject(abortError()))
        child.kill()
      }
      const onExit = (code: number): void => {
        finish(() => reject(new Error(`Agent model utility exited before responding (${code})`)))
      }
      const onMessage = (raw: unknown): void => {
        const parsed = agentUtilityMessageSchema.safeParse(raw)
        if (!parsed.success || parsed.data.requestId !== request.requestId) {
          const err = parsed.success
            ? new Error('Agent response request ID mismatch')
            : parsed.error
          this.log.error(
            { event: 'agent_model.response_invalid', err, requestId: request.requestId },
            'Agent model utility returned an invalid response'
          )
          finish(() => reject(new Error('Agent model utility returned an invalid response')))
          child.kill()
          return
        }
        const message = parsed.data
        if (message.type === 'text-delta') {
          try {
            onEvent({ type: 'text-delta', delta: message.delta })
          } catch (err) {
            this.log.error(
              { event: 'agent_model.event_delivery_failed', err, requestId: request.requestId },
              'Agent model event delivery failed'
            )
            finish(() => reject(new Error('Agent model event delivery failed', { cause: err })))
            child.kill()
          }
          return
        }
        if (message.type === 'error') {
          const err = reconstructError(message.error)
          this.log.error(
            { event: 'agent_model.failed', err, requestId: request.requestId },
            'Agent model request failed'
          )
          finish(() => reject(new Error('Agent model request failed', { cause: err })))
          child.kill()
          return
        }
        finish(() => resolve(message.result))
        child.kill()
      }
      signal.addEventListener('abort', onAbort, { once: true })
      child.on('message', onMessage)
      child.once('exit', onExit)
      try {
        child.postMessage(request)
      } catch (err) {
        this.log.error(
          { event: 'agent_model.start_failed', err, requestId: request.requestId },
          'Failed to start agent model utility'
        )
        finish(() => reject(new Error('Agent model utility could not be started', { cause: err })))
        child.kill()
      }
    })
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
