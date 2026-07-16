import {
  agentUtilityRequestSchema,
  utilityCancelMessageSchema,
  type AgentUtilityMessage
} from '../shared/contracts/model-runtime'
import { runAgentModelRequest } from './agent-model-request'
import { withLogContext } from '../main/observability/log-context'
import { createPortLogger } from './shared/port-logger'

const parentPort = process.parentPort
if (parentPort === undefined)
  throw new Error('Agent model utility requires an Electron parent port')

const activeRequests = new Map<
  string,
  { projectSessionId: string | null | undefined; controller: AbortController }
>()
let workerLog: ReturnType<typeof createPortLogger> | undefined

parentPort.on('message', (event) => {
  if (isLoggingPortMessage(event)) {
    workerLog = createPortLogger(event.ports[0], {
      processRole: 'agent-worker',
      subsystem: 'agent',
      component: 'model'
    })
    event.ports[0].start()
    return
  }
  const cancel = utilityCancelMessageSchema.safeParse(event.data)
  if (cancel.success) {
    const active = activeRequests.get(cancel.data.requestId)
    if (
      active !== undefined &&
      (active.projectSessionId ?? null) === (cancel.data.projectSessionId ?? null)
    ) {
      active.controller.abort(new Error('Agent model request cancelled'))
    }
    return
  }
  void withLogContext(
    {
      requestId: extractRequestId(event.data),
      ...(extractProjectSessionId(event.data) === null
        ? {}
        : { projectSessionId: extractProjectSessionId(event.data) as string })
    },
    async () => {
      let response: AgentUtilityMessage
      let request: ReturnType<typeof agentUtilityRequestSchema.parse> | undefined
      try {
        request = agentUtilityRequestSchema.parse(event.data)
        const controller = new AbortController()
        activeRequests.set(request.requestId, {
          projectSessionId: request.projectSessionId,
          controller
        })
        const result = await runAgentModelRequest(
          request,
          (delta) => {
            parentPort.postMessage({
              type: 'text-delta',
              requestId: request?.requestId,
              projectSessionId: request?.projectSessionId ?? null,
              delta
            })
          },
          controller.signal
        )
        response = {
          type: 'result',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId ?? null,
          result
        }
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Agent model utility failed', { cause: err })
        workerLog?.(
          'error',
          'agent.worker.request_failed',
          'Agent worker request failed',
          undefined,
          err
        )
        response = {
          type: 'error',
          requestId: extractRequestId(event.data),
          projectSessionId: request?.projectSessionId ?? extractProjectSessionId(event.data),
          error: serializeError(error)
        }
      } finally {
        if (request !== undefined) activeRequests.delete(request.requestId)
      }
      parentPort.postMessage(response)
    }
  )
})

function serializeError(error: Error): {
  name: string
  message: string
  stack?: string
  httpStatus?: number
} {
  const httpStatus = findHttpStatus(error)
  const message = safeDiagnosticMessage(error, httpStatus)
  const stack = safeStack(error.stack, message)
  return {
    name: error.name.slice(0, 200),
    message,
    ...(stack === undefined ? {} : { stack }),
    ...(httpStatus === undefined ? {} : { httpStatus })
  }
}

function safeDiagnosticMessage(error: Error, httpStatus?: number): string {
  if (error.name === 'AbortError') return 'Agent model request aborted'
  return httpStatus === undefined
    ? 'Agent model request failed'
    : `Agent model request failed with HTTP ${httpStatus}`
}

function safeStack(stack: string | undefined, message: string): string | undefined {
  if (stack === undefined) return undefined
  const frames = stack.split('\n').slice(1).join('\n')
  return `${message}${frames.length === 0 ? '' : `\n${frames}`}`.slice(0, 32_768)
}

function findHttpStatus(error: unknown, depth = 0): number | undefined {
  if (depth > 5 || error === null || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; cause?: unknown }
  const status = candidate.statusCode ?? candidate.status
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : findHttpStatus(candidate.cause, depth + 1)
}

function extractRequestId(value: unknown): string {
  if (
    value !== null &&
    typeof value === 'object' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    /^[0-9a-f-]{36}$/i.test(value.requestId)
  ) {
    return value.requestId
  }
  return '00000000-0000-4000-8000-000000000000'
}

function extractProjectSessionId(value: unknown): string | null {
  if (
    value !== null &&
    typeof value === 'object' &&
    'projectSessionId' in value &&
    (typeof value.projectSessionId === 'string' || value.projectSessionId === null)
  ) {
    return value.projectSessionId
  }
  return null
}

function isLoggingPortMessage(
  event: Electron.MessageEvent
): event is Electron.MessageEvent & { ports: [MessagePort, ...MessagePort[]] } {
  return (
    event.data !== null &&
    typeof event.data === 'object' &&
    'type' in event.data &&
    event.data.type === 'logging-port' &&
    event.ports !== undefined &&
    event.ports.length > 0
  )
}
