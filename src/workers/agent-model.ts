import {
  agentUtilityRequestSchema,
  utilityCancelMessageSchema,
  type AgentUtilityMessage
} from '../shared/contracts/model-runtime'
import {
  agentFollowUpConsumptionAuthorizationSchema,
  agentQueueActionCommandSchema,
  agentQueueCommandSchema,
  agentRunStartSchema,
  agentModelCallAuthorizationSchema,
  agentRuntimeCancelSchema,
  type AgentRuntimeMessage
} from '../shared/contracts/agent'
import { MAX_CONCURRENT_AGENT_RUNS } from '../shared/contracts/agent-ipc'
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
  const queueAction = agentQueueActionCommandSchema.safeParse(event.data)
  if (queueAction.success) {
    const active = activeSessionRuns.get(queueAction.data.requestId)
    if (
      active === undefined ||
      active.projectSessionId !== queueAction.data.projectSessionId ||
      active.agentSessionId !== queueAction.data.agentSessionId ||
      active.agentRunId !== queueAction.data.agentRunId
    ) {
      workerLog?.(
        'warn',
        'agent.worker.queue_action_rejected',
        'Rejected an Agent queue action for an inactive run',
        { requestId: queueAction.data.requestId }
      )
      return
    }
    active.control?.queueAction(queueAction.data)
    return
  }
  const followUpAuthorization = agentFollowUpConsumptionAuthorizationSchema.safeParse(event.data)
  if (followUpAuthorization.success) {
    const active = activeSessionRuns.get(followUpAuthorization.data.requestId)
    if (
      active === undefined ||
      active.projectSessionId !== followUpAuthorization.data.projectSessionId ||
      active.agentSessionId !== followUpAuthorization.data.agentSessionId ||
      active.agentRunId !== followUpAuthorization.data.agentRunId
    ) {
      workerLog?.(
        'warn',
        'agent.worker.follow_up_authorization_rejected',
        'Rejected an Agent Follow-up authorization for an inactive run',
        { requestId: followUpAuthorization.data.requestId }
      )
      return
    }
    active.control?.authorizeFollowUpConsumption(followUpAuthorization.data)
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
      let acquired = false
      try {
        if (
          [...activeSessionRuns.values()].some(
            (active) => active.agentSessionId === request.agentSessionId
          )
        ) {
          workerLog?.('warn', 'agent.worker.run_rejected', 'Rejected duplicate conversation run', {
            agentSessionId: request.agentSessionId,
            agentRunId: request.agentRunId,
            reason: 'conversation_active',
            activeCount: activeSessionRuns.size,
            concurrencyLimit: MAX_CONCURRENT_AGENT_RUNS
          })
          throw new Error('Agent worker already has an active run for this conversation')
        }
        if (activeSessionRuns.size >= MAX_CONCURRENT_AGENT_RUNS) {
          workerLog?.('warn', 'agent.worker.run_rejected', 'Rejected Agent run at capacity', {
            agentSessionId: request.agentSessionId,
            agentRunId: request.agentRunId,
            reason: 'worker_capacity',
            activeCount: activeSessionRuns.size,
            concurrencyLimit: MAX_CONCURRENT_AGENT_RUNS
          })
          throw new Error('Agent worker reached its active run limit')
        }
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
        acquired = true
        workerLog?.('info', 'agent.worker.run_started', 'Agent worker run started', {
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          activeCount: activeSessionRuns.size,
          concurrencyLimit: MAX_CONCURRENT_AGENT_RUNS
        })
        const result = await runAgentSession(
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
          toolPort,
          workerLog
        )
        response = {
          type: 'result',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          status: 'completed',
          outcome: result.outcome
        }
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
        if (acquired) {
          activeSessionRuns.delete(request.requestId)
          workerLog?.('info', 'agent.worker.run_released', 'Agent worker run released', {
            agentSessionId: request.agentSessionId,
            agentRunId: request.agentRunId,
            activeCount: activeSessionRuns.size,
            concurrencyLimit: MAX_CONCURRENT_AGENT_RUNS
          })
        }
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
  code?: 'context_overflow' | 'tool_batch_context_exhausted'
} {
  const httpStatus = findHttpStatus(error)
  const code = hasErrorCode(error, 'tool_batch_context_exhausted')
    ? 'tool_batch_context_exhausted'
    : isContextOverflowError(error)
      ? 'context_overflow'
      : undefined
  const message = safeDiagnosticMessage(error, httpStatus, code)
  const stack = safeStack(error.stack, message)
  return {
    name: error.name.slice(0, 200),
    message,
    ...(stack === undefined ? {} : { stack }),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    ...(code === undefined ? {} : { code })
  }
}

function safeDiagnosticMessage(
  error: Error,
  httpStatus?: number,
  code?: 'context_overflow' | 'tool_batch_context_exhausted'
): string {
  if (code === 'context_overflow') return 'Agent provider context window exceeded'
  if (code === 'tool_batch_context_exhausted') {
    return 'The latest Agent read batch still exceeds context after one smaller-read recovery'
  }
  if (error.name === 'ProviderTimeoutError') return 'Agent provider request timed out'
  if (error.name === 'ProviderRetriesExhaustedError') {
    return 'Agent provider request failed after 5 attempts'
  }
  if (error.name === 'AbortError') return 'Agent model request aborted'
  return httpStatus === undefined
    ? 'Agent model request failed'
    : `Agent model request failed with HTTP ${httpStatus}`
}

function hasErrorCode(error: unknown, expected: string, depth = 0): boolean {
  if (depth > 6 || error === null || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; cause?: unknown }
  return candidate.code === expected || hasErrorCode(candidate.cause, expected, depth + 1)
}

function isContextOverflowError(error: unknown, depth = 0): boolean {
  if (depth > 6 || error === null || typeof error !== 'object') return false
  const candidate = error as {
    code?: unknown
    message?: unknown
    status?: unknown
    statusCode?: unknown
    cause?: unknown
  }
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : ''
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
  const status = candidate.statusCode ?? candidate.status
  return (
    code.includes('context_length') ||
    code.includes('context_window') ||
    /context (?:length|window).*(?:exceed|overflow|too long)|maximum context|too many tokens/u.test(
      message
    ) ||
    (status === 400 && /context|token limit/u.test(message)) ||
    isContextOverflowError(candidate.cause, depth + 1)
  )
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
