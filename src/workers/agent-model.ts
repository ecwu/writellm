import {
  agentUtilityRequestSchema,
  utilityCancelMessageSchema,
  type AgentUtilityMessage
} from '../shared/contracts/model-runtime'
import {
  agentQueueCommandSchema,
  agentRunStartSchema,
  agentModelCallAuthorizationSchema,
  agentRuntimeCancelSchema,
  type AgentRuntimeMessage
} from '../shared/contracts/agent'
import { runAgentModelRequest } from './agent-model-request'
import { runAgentSession, type AgentSessionRunControl } from './agent-session-run'
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
const activeSessionRuns = new Map<
  string,
  {
    projectSessionId: string
    agentSessionId: string
    agentRunId: string
    controller: AbortController
    control?: AgentSessionRunControl
  }
>()

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
  const sessionCancel = agentRuntimeCancelSchema.safeParse(event.data)
  if (sessionCancel.success) {
    const active = activeSessionRuns.get(sessionCancel.data.requestId)
    if (
      active !== undefined &&
      active.projectSessionId === sessionCancel.data.projectSessionId &&
      active.agentSessionId === sessionCancel.data.agentSessionId &&
      active.agentRunId === sessionCancel.data.agentRunId
    ) {
      active.controller.abort(new Error('Agent session run cancelled'))
      active.control?.abort()
    }
    return
  }
  const queueCommand = agentQueueCommandSchema.safeParse(event.data)
  if (queueCommand.success) {
    const active = activeSessionRuns.get(queueCommand.data.requestId)
    if (
      active === undefined ||
      active.projectSessionId !== queueCommand.data.projectSessionId ||
      active.agentSessionId !== queueCommand.data.agentSessionId ||
      active.agentRunId !== queueCommand.data.agentRunId
    ) {
      workerLog?.(
        'warn',
        'agent.worker.queue_rejected',
        'Rejected an Agent queue message for an inactive run',
        { requestId: queueCommand.data.requestId }
      )
      return
    }
    active.control?.enqueue(queueCommand.data)
    return
  }
  const modelCallAuthorization = agentModelCallAuthorizationSchema.safeParse(event.data)
  if (modelCallAuthorization.success) {
    const active = activeSessionRuns.get(modelCallAuthorization.data.requestId)
    if (
      active === undefined ||
      active.projectSessionId !== modelCallAuthorization.data.projectSessionId ||
      active.agentSessionId !== modelCallAuthorization.data.agentSessionId ||
      active.agentRunId !== modelCallAuthorization.data.agentRunId
    ) {
      workerLog?.(
        'warn',
        'agent.worker.model_call_authorization_rejected',
        'Rejected an Agent model-call authorization for an inactive run',
        { requestId: modelCallAuthorization.data.requestId }
      )
      return
    }
    active.control?.authorizeModelCall(modelCallAuthorization.data)
    return
  }
  const sessionRun = agentRunStartSchema.safeParse(event.data)
  if (sessionRun.success) {
    void handleSessionRun(sessionRun.data, event.ports[0])
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

async function handleSessionRun(
  request: ReturnType<typeof agentRunStartSchema.parse>,
  toolPort: Electron.MessagePortMain | undefined
): Promise<void> {
  await withLogContext(
    {
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId
    },
    async () => {
      let response: AgentRuntimeMessage
      const controller = new AbortController()
      try {
        if (activeSessionRuns.size > 0) throw new Error('Agent worker already has an active run')
        if (toolPort === undefined)
          throw new Error('Agent session run requires a dedicated tool port')
        const active = {
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          controller,
          control: undefined as AgentSessionRunControl | undefined
        }
        activeSessionRuns.set(request.requestId, active)
        workerLog?.('info', 'agent.worker.run_started', 'Agent worker run started', {
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId
        })
        await runAgentSession(
          request,
          (runtimeEvent) => {
            parentPort.postMessage({
              type: 'event',
              requestId: request.requestId,
              projectSessionId: request.projectSessionId,
              agentSessionId: request.agentSessionId,
              agentRunId: request.agentRunId,
              event: runtimeEvent
            } satisfies AgentRuntimeMessage)
          },
          (control) => {
            active.control = control
          },
          controller.signal,
          toolPort
        )
        response = {
          type: 'result',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          status: 'completed'
        }
        workerLog?.('info', 'agent.worker.run_completed', 'Agent worker run completed', {
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId
        })
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error('Agent session run failed', { cause: err })
        workerLog?.(
          'error',
          'agent.worker.run_failed',
          'Agent worker run failed',
          { agentSessionId: request.agentSessionId, agentRunId: request.agentRunId },
          err
        )
        response = {
          type: 'error',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          error: serializeError(error)
        }
      } finally {
        activeSessionRuns.delete(request.requestId)
      }
      parentPort.postMessage(response)
    }
  )
}

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
  if (error.name === 'ProviderTimeoutError') return 'Agent provider request timed out'
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
