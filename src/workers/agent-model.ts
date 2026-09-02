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
  type AgentHistoryMessage,
  type AgentRuntimeMessage
} from '../shared/contracts/agent'
import {
  serializeAgentDiagnosticError,
  agentDiagnosticSensitiveValues
} from '../shared/agent-diagnostic-error'
import { runAgentModelRequest } from './agent-model-request'
import { runAgentSession, type AgentSessionRunControl } from './agent-session-run'
import { withLogContext } from '../main/observability/log-context'
import { createPortLogger } from './shared/port-logger'
import {
  extractUtilityProjectSessionId as extractProjectSessionId,
  extractUtilityRequestId as extractRequestId
} from './shared/utility-message'

const parentPort = process.parentPort
if (parentPort === undefined)
  throw new Error('Agent model utility requires an Electron parent port')

const activeRequests = new Map<
  string,
  {
    projectSessionId: string | null | undefined
    controller: AbortController
  }
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
          controller.signal,
          request.trace === undefined
            ? undefined
            : (capture) => requestUtilityTraceCapture(parentPort, request, capture),
          (error) => {
            workerLog?.(
              'error',
              'agent.worker.trace_capture_failed',
              'Agent trace capture could not be prepared; provider work continues',
              { requestId: request?.requestId },
              error
            )
          }
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
        const diagnostic = serializeError(
          error,
          'worker.utility',
          request?.credential,
          request === undefined ? [] : [request.input.prompt, request.input.systemPrompt]
        )
        workerLog?.(
          'error',
          'agent.worker.request_failed',
          'Agent worker request failed',
          {
            requestId: extractRequestId(event.data),
            ...(request?.projectSessionId == null
              ? {}
              : { projectSessionId: request.projectSessionId })
          },
          err
        )
        response = {
          type: 'error',
          requestId: extractRequestId(event.data),
          projectSessionId: request?.projectSessionId ?? extractProjectSessionId(event.data),
          error: diagnostic
        }
      } finally {
        if (request !== undefined) {
          activeRequests.delete(request.requestId)
        }
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
            reason: 'conversation_active'
          })
          throw new Error('Agent worker already has an active run for this conversation')
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
          agentRunId: request.agentRunId
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
        const diagnostic = serializeError(error, 'worker.session_run', request.credential, [
          request.prompt,
          request.systemPrompt,
          ...historyPrivateBodies(request.history)
        ])
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
          error: diagnostic
        }
      } finally {
        if (acquired) {
          activeSessionRuns.delete(request.requestId)
          workerLog?.('info', 'agent.worker.run_released', 'Agent worker run released', {
            agentSessionId: request.agentSessionId,
            agentRunId: request.agentRunId
          })
        }
      }
      parentPort.postMessage(response)
    }
  )
}

function serializeError(
  error: unknown,
  stage: string,
  credential?: unknown,
  privateBodies: readonly string[] = []
) {
  const knownSensitiveValues = agentDiagnosticSensitiveValues(credential)
  return serializeAgentDiagnosticError(error, stage, {
    ...(knownSensitiveValues.length === 0 ? {} : { knownSensitiveValues }),
    ...(privateBodies.length === 0 ? {} : { privateBodies })
  })
}

function historyPrivateBodies(history: readonly AgentHistoryMessage[]): string[] {
  return history.map((message) =>
    message.role === 'user' ? message.content : message.message.content
  )
}

function requestUtilityTraceCapture(
  port: { postMessage(message: unknown): void },
  request: ReturnType<typeof agentUtilityRequestSchema.parse>,
  capture: {
    apiId: string
    physicalAttempt: number
    documents: Array<{
      kind: 'harness_request' | 'provider_request' | 'provider_response'
      value: unknown
      metadata?: Record<string, unknown>
    }>
  }
): void {
  if (request.trace === undefined || request.projectSessionId == null) {
    workerLog?.(
      'error',
      'agent.worker.trace_capture_skipped',
      'Agent trace capture was skipped because its project session is unavailable',
      { requestId: request.requestId }
    )
    return
  }
  try {
    port.postMessage({
      type: 'trace-capture',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      modelRequestId: request.trace.modelRequestId,
      purpose: request.trace.purpose,
      apiId: capture.apiId,
      physicalAttempt: capture.physicalAttempt,
      documents: capture.documents
    })
  } catch (err) {
    workerLog?.(
      'error',
      'agent.worker.trace_capture_failed',
      'Agent trace capture could not be sent; provider work continues',
      { requestId: request.requestId, modelRequestId: request.trace.modelRequestId },
      err
    )
  }
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
