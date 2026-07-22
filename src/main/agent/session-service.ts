import { createHash, randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import {
  AGENT_EVENT_SCHEMA_VERSION,
  AGENT_RUNTIME_VERSION,
  agentAssistantMessagePayloadSchema,
  agentCompactionSummaryPayloadSchema,
  agentEditorContextSchema,
  agentHistorySchema,
  agentUserMessagePayloadSchema,
  type AgentAssistantMessagePayload,
  type AgentEditorContext,
  type AgentEventType,
  type AgentHistoryMessage,
  type AgentRuntimeEvent
} from '../../shared/contracts/agent'
import { agentMessageBudget, estimateAgentTokens } from '../../shared/agent-context-budget'
import {
  AGENT_EVENT_PAGE_LIMIT,
  agentEventPageSchema,
  agentEventRecordSchema,
  agentRunRecordSchema,
  agentSessionRecordSchema,
  type AgentEventPage,
  type AgentEventRecord,
  type AgentRunRecord,
  type AgentSessionRecord
} from '../../shared/contracts/agent-ipc'
import {
  agentToolCallPayloadSchema,
  agentToolResponseSchema,
  agentToolResultPayloadSchema,
  type AgentToolRequest,
  type AgentToolResponse
} from '../../shared/contracts/agent-tools'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { withLogContext } from '../observability/log-context'
import type { ProjectDatabase } from '../project/project-database'
import type { AgentSessionRunHandle, AgentSessionRuntime } from '../providers/gateways'
import { ModelRequestRepository } from '../providers/model-request-repository'
import type { ProviderService } from '../providers/provider-service'
import type { AgentContextBuilder } from './context'
import { AgentToolDomainError } from './read-tools'
import type { AgentToolExecutor } from './tools'

const DEFAULT_SYSTEM_PROMPT =
  'You are the WriteLLM writing assistant. Respond to the user request without accessing tools.'
const HISTORY_EVENT_LIMIT = 200
const HISTORY_BYTE_LIMIT = 2_097_152
const COMPACTION_SOURCE_EVENT_LIMIT = 120
const COMPACTION_SOURCE_TEXT_LIMIT = 196_608

export interface StartedAgentRun {
  agentRunId: string
  completion: Promise<void>
}

interface ActiveRun {
  readonly agentSessionId: string
  readonly agentRunId: string
  readonly operationId: string
  readonly controller: AbortController
  readonly handle: AgentSessionRunHandle
  readonly config: Extract<ProviderConfig, { role: 'agent' }>
  readonly editorContext: AgentEditorContext
  readonly authorizedModelRequestIds: Set<string>
  readonly pendingModelRequestIds: Set<string>
  partialText: string
  completion: Promise<void>
}

export interface AgentSessionServiceOptions {
  projectId: string
  projectSessionId: string
  database: ProjectDatabase
  providers: Pick<ProviderService, 'withConfiguredProvider'>
  runtime: AgentSessionRuntime
  contextBuilder?: Pick<AgentContextBuilder, 'build'>
  tools?: AgentToolExecutor
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  publishEvent?: (event: AgentEventRecord) => void | Promise<void>
  publishDelta?: (event: {
    agentSessionId: string
    agentRunId: string
    delta: string
  }) => void | Promise<void>
  summarizeHistory?: (input: {
    agentSessionId: string
    agentRunId: string
    sourceText: string
    coveredThroughSequence: number
    estimatedInputTokens: number
    signal: AbortSignal
  }) => Promise<{ summary: string; modelRequestId: string }>
  messageTokenBudget?: number
  now?: () => Date
  createId?: () => string
}

export class AgentSessionService {
  readonly #now: () => Date
  readonly #createId: () => string
  #active: ActiveRun | undefined

  constructor(private readonly options: AgentSessionServiceOptions) {
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  createSession(title = 'New conversation'): AgentSessionRecord {
    const agentSessionId = this.#createId()
    const now = this.#now().toISOString()
    const normalizedTitle = title.trim().slice(0, 500) || 'New conversation'
    this.options.database.immediate((database) => {
      database
        .prepare(
          `INSERT INTO agent_sessions (
             agent_session_id, title, pi_runtime_version, event_schema_version,
             status, created_at, updated_at, archived_at
           ) VALUES (?, ?, ?, ?, 'active', ?, ?, NULL)`
        )
        .run(
          agentSessionId,
          normalizedTitle,
          AGENT_RUNTIME_VERSION,
          AGENT_EVENT_SCHEMA_VERSION,
          now,
          now
        )
    })
    this.options.log.info(
      { event: 'agent.session.created', agentSessionId },
      'Agent session created'
    )
    return agentSessionRecordSchema.parse({
      agentSessionId,
      title: normalizedTitle,
      status: 'active',
      compatible: true,
      createdAt: now,
      updatedAt: now
    })
  }

  listSessions(): AgentSessionRecord[] {
    return this.options.database.immediate((database) =>
      (
        database
          .prepare(
            `SELECT agent_session_id, title, pi_runtime_version, event_schema_version,
                    status, created_at, updated_at
               FROM agent_sessions
              ORDER BY updated_at DESC, agent_session_id DESC
              LIMIT 200`
          )
          .all() as Array<{
          agent_session_id: string
          title: string
          pi_runtime_version: string
          event_schema_version: number
          status: 'active' | 'archived'
          created_at: string
          updated_at: string
        }>
      ).map((row) =>
        agentSessionRecordSchema.parse({
          agentSessionId: row.agent_session_id,
          title: row.title,
          status: row.status,
          compatible:
            row.pi_runtime_version === AGENT_RUNTIME_VERSION &&
            row.event_schema_version === AGENT_EVENT_SCHEMA_VERSION,
          createdAt: row.created_at,
          updatedAt: row.updated_at
        })
      )
    )
  }

  listEvents(agentSessionId: string): AgentEventRecord[] {
    const events: AgentEventRecord[] = []
    let afterSequence = 0
    while (events.length < 1_000) {
      const page = this.listEventPage(
        agentSessionId,
        afterSequence,
        Math.min(AGENT_EVENT_PAGE_LIMIT, 1_000 - events.length)
      )
      events.push(...page.events)
      if (!page.hasMore || page.nextAfterSequence <= afterSequence) break
      afterSequence = page.nextAfterSequence
    }
    return events
  }

  listEventPage(
    agentSessionId: string,
    afterSequence = 0,
    limit = AGENT_EVENT_PAGE_LIMIT
  ): AgentEventPage {
    this.#assertSessionExists(agentSessionId)
    const boundedLimit = Math.min(AGENT_EVENT_PAGE_LIMIT, Math.max(1, Math.floor(limit)))
    const events = this.options.database.immediate((database) =>
      (
        database
          .prepare(
            `SELECT agent_event_id, agent_session_id, agent_run_id, sequence, type,
                    payload_json, model_request_id, created_at
               FROM agent_events
              WHERE agent_session_id = ? AND sequence > ?
              ORDER BY sequence
              LIMIT ?`
          )
          .all(agentSessionId, Math.max(0, Math.floor(afterSequence)), boundedLimit + 1) as Array<{
          agent_event_id: string
          agent_session_id: string
          agent_run_id: string | null
          sequence: number
          type: AgentEventType
          payload_json: string
          model_request_id: string | null
          created_at: string
        }>
      ).map((row) =>
        agentEventRecordSchema.parse({
          agentEventId: row.agent_event_id,
          agentSessionId: row.agent_session_id,
          agentRunId: row.agent_run_id,
          sequence: row.sequence,
          type: row.type,
          payload: JSON.parse(row.payload_json) as Record<string, unknown>,
          modelRequestId: row.model_request_id,
          createdAt: row.created_at
        })
      )
    )
    const pageEvents = events.slice(0, boundedLimit)
    return agentEventPageSchema.parse({
      events: pageEvents,
      nextAfterSequence: pageEvents.at(-1)?.sequence ?? Math.max(0, Math.floor(afterSequence)),
      hasMore: events.length > boundedLimit
    })
  }

  listRuns(agentSessionId: string, limit = 200): AgentRunRecord[] {
    this.#assertSessionExists(agentSessionId)
    const boundedLimit = Math.min(200, Math.max(1, Math.floor(limit)))
    return this.options.database.immediate((database) =>
      (
        database
          .prepare(
            `SELECT agent_run_id, agent_session_id, status, provider_id, model_id,
                    editor_context_json, error_json, started_at, completed_at, updated_at
               FROM agent_runs
              WHERE agent_session_id = ?
              ORDER BY started_at DESC, agent_run_id DESC
              LIMIT ?`
          )
          .all(agentSessionId, boundedLimit) as Array<{
          agent_run_id: string
          agent_session_id: string
          status: 'running' | 'completed' | 'interrupted' | 'failed'
          provider_id: string
          model_id: string
          editor_context_json: string
          error_json: string | null
          started_at: string
          completed_at: string | null
          updated_at: string
        }>
      ).map((row) =>
        agentRunRecordSchema.parse({
          agentRunId: row.agent_run_id,
          agentSessionId: row.agent_session_id,
          status: row.status,
          providerId: row.provider_id,
          modelId: row.model_id,
          editorContext: JSON.parse(row.editor_context_json),
          errorCode: safeErrorCode(row.error_json),
          startedAt: row.started_at,
          completedAt: row.completed_at,
          updatedAt: row.updated_at
        })
      )
    )
  }

  requireRun(agentRunId: string): AgentRunRecord {
    const row = this.options.database.immediate(
      (database) =>
        database
          .prepare('SELECT agent_session_id FROM agent_runs WHERE agent_run_id = ?')
          .get(agentRunId) as { agent_session_id: string } | undefined
    )
    if (row === undefined) throw new Error('Agent run does not exist')
    const run = this.listRuns(row.agent_session_id).find((item) => item.agentRunId === agentRunId)
    if (run === undefined) throw new Error('Agent run is outside the bounded session history')
    return run
  }

  async startRun(input: {
    agentSessionId: string
    prompt: string
    editorContext: AgentEditorContext
    systemPrompt?: string
    maxOutputTokens?: number
    temperature?: number
    operationId?: string
  }): Promise<StartedAgentRun> {
    if (this.#active !== undefined) throw new Error('An Agent run is already active')
    const prompt = agentUserMessagePayloadSchema.shape.content.parse(input.prompt)
    const editorContext = agentEditorContextSchema.parse(input.editorContext)
    const builtContext = this.options.contextBuilder?.build({ prompt, editorContext })
    const userRequest = builtContext?.userRequest ?? prompt
    const systemPrompt = (
      builtContext?.systemPrompt ??
      input.systemPrompt ??
      DEFAULT_SYSTEM_PROMPT
    ).slice(0, 65_536)
    const operationId = input.operationId ?? this.#createId()
    const agentRunId = this.#createId()
    this.#assertCompatibleSession(input.agentSessionId)
    return withLogContext(
      {
        operationId,
        projectId: this.options.projectId,
        projectSessionId: this.options.projectSessionId,
        agentSessionId: input.agentSessionId,
        agentRunId
      },
      () =>
        this.options.providers.withConfiguredProvider('agent', async (config, credential) => {
          const now = this.#now()
          this.#insertRunAndUserEvent({
            agentSessionId: input.agentSessionId,
            agentRunId,
            config,
            editorContext,
            prompt,
            now
          })
          const controller = new AbortController()
          let history: AgentHistoryMessage[]
          try {
            history = await this.#prepareRuntimeHistory({
              agentSessionId: input.agentSessionId,
              agentRunId,
              prompt: userRequest,
              maxOutputTokens: input.maxOutputTokens ?? 8_192,
              signal: controller.signal
            })
          } catch (err) {
            this.options.log.error(
              { event: 'agent.compaction.failed', err, agentRunId },
              'Failed to prepare bounded Agent history'
            )
            await this.#finishRunAndAppendEvent({
              agentRunId,
              agentSessionId: input.agentSessionId,
              status: 'failed',
              error: { code: 'compaction_failed' },
              eventPayload: { code: 'compaction_failed', status: 'failed' }
            })
            throw err
          }
          const modelRequests = new ModelRequestRepository(
            this.options.database,
            this.options.log,
            this.#now,
            this.#createId
          )
          let modelRequestId: string
          try {
            modelRequestId = (
              await modelRequests.start({
                operation: 'agent',
                provider: config,
                request: { prompt, delivery: 'prompt' },
                inputItems: 1,
                operationId,
                agentRunId,
                projectSessionId: this.options.projectSessionId
              })
            ).modelRequestId
          } catch (err) {
            this.options.log.error(
              { event: 'agent.run.model_request_start_failed', err, agentRunId },
              'Failed to persist the initial Agent model request'
            )
            await this.#finishRunAndAppendEvent({
              agentRunId,
              agentSessionId: input.agentSessionId,
              status: 'failed',
              error: { code: 'model_request_start_failed' },
              eventPayload: { code: 'model_request_start_failed', status: 'failed' }
            })
            throw err
          }
          const initialEvent = this.#linkInitialUserEvent(
            input.agentSessionId,
            agentRunId,
            modelRequestId
          )
          await this.#publishDurable(initialEvent)
          const handle = this.options.runtime.beginSessionRun(
            config,
            credential,
            {
              projectSessionId: this.options.projectSessionId,
              agentSessionId: input.agentSessionId,
              agentRunId,
              modelRequestId,
              systemPrompt,
              history,
              prompt: userRequest,
              maxOutputTokens: input.maxOutputTokens ?? 8_192,
              ...(input.temperature === undefined ? {} : { temperature: input.temperature })
            },
            controller.signal,
            (event) => this.#handleRuntimeEvent(agentRunId, event),
            (request, signal) => this.#handleToolRequest(agentRunId, request, signal)
          )
          const active: ActiveRun = {
            agentSessionId: input.agentSessionId,
            agentRunId,
            operationId,
            controller,
            handle,
            config,
            editorContext,
            authorizedModelRequestIds: new Set([modelRequestId]),
            pendingModelRequestIds: new Set([modelRequestId]),
            partialText: '',
            completion: Promise.resolve()
          }
          this.#active = active
          active.completion = this.#settleRun(active)
          this.options.log.info(
            { event: 'agent.run.started', agentSessionId: input.agentSessionId, agentRunId },
            'Agent run started'
          )
          return { agentRunId, completion: active.completion }
        })
    )
  }

  async steer(agentRunId: string, content: string): Promise<void> {
    return this.#queue(agentRunId, 'steer', content)
  }

  async followUp(agentRunId: string, content: string): Promise<void> {
    return this.#queue(agentRunId, 'follow_up', content)
  }

  async abort(agentRunId: string): Promise<void> {
    const active = this.#requireActive(agentRunId)
    active.controller.abort(
      new AgentRunCancellationError('user_stopped', 'Agent run stopped by user')
    )
    await active.completion
  }

  async close(): Promise<void> {
    const active = this.#active
    if (active === undefined) return
    active.controller.abort(new AgentRunCancellationError('project_closed', 'Project is closing'))
    await active.completion
  }

  recoverInterruptedRuns(): number {
    const now = this.#now().toISOString()
    const recovered = this.options.database.immediate((database) => {
      const rows = database
        .prepare(`SELECT agent_run_id, agent_session_id FROM agent_runs WHERE status = 'running'`)
        .all() as Array<{ agent_run_id: string; agent_session_id: string }>
      for (const row of rows) {
        database
          .prepare(
            `UPDATE agent_runs
                SET status = 'interrupted', error_json = ?, completed_at = ?, updated_at = ?
              WHERE agent_run_id = ? AND status = 'running'`
          )
          .run(JSON.stringify({ code: 'process_restarted' }), now, now, row.agent_run_id)
        insertEvent(database, {
          eventId: this.#createId(),
          sessionId: row.agent_session_id,
          runId: row.agent_run_id,
          type: 'run_interrupted',
          payload: { code: 'process_restarted' },
          modelRequestId: null,
          createdAt: now
        })
      }
      return rows.length
    })
    if (recovered > 0) {
      this.options.log.warn(
        { event: 'agent.run.recovered', count: recovered },
        'Recovered Agent runs left active by a terminated process'
      )
    }
    return recovered
  }

  async #queue(
    agentRunId: string,
    delivery: 'steer' | 'follow_up',
    rawContent: string
  ): Promise<void> {
    const active = this.#requireActive(agentRunId)
    if (active.controller.signal.aborted) {
      throw active.controller.signal.reason instanceof Error
        ? active.controller.signal.reason
        : new AgentRunCancellationError('user_stopped', 'Agent run was stopped')
    }
    const content = agentUserMessagePayloadSchema.shape.content.parse(rawContent)
    const timestamp = this.#now().getTime()
    const modelRequests = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    const modelRequestId = (
      await modelRequests.start({
        operation: 'agent',
        provider: active.config,
        request: { content, delivery },
        inputItems: 1,
        operationId: active.operationId,
        agentRunId: active.agentRunId,
        projectSessionId: this.options.projectSessionId
      })
    ).modelRequestId
    await this.#appendAndPublishEvent({
      sessionId: active.agentSessionId,
      runId: active.agentRunId,
      type: 'user_message',
      payload: agentUserMessagePayloadSchema.parse({ content, delivery, timestamp }),
      modelRequestId
    })
    active.pendingModelRequestIds.add(modelRequestId)
    active.authorizedModelRequestIds.add(modelRequestId)
    try {
      const command = {
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        modelRequestId,
        content,
        timestamp
      }
      if (delivery === 'steer') active.handle.steer(command)
      else active.handle.followUp(command)
    } catch (err) {
      this.options.log.error(
        { event: 'agent.run.queue_failed', err, agentRunId, modelRequestId, delivery },
        'Failed to queue an Agent message'
      )
      await modelRequests.abort(modelRequestId, 'queue_delivery_failed')
      active.pendingModelRequestIds.delete(modelRequestId)
      active.controller.abort(err)
      throw err
    }
  }

  async #handleRuntimeEvent(agentRunId: string, event: AgentRuntimeEvent): Promise<void> {
    const active = this.#requireActive(agentRunId)
    if (event.type === 'assistant_delta') {
      active.partialText = `${active.partialText}${event.delta}`.slice(0, 2_097_152)
      await this.#publishDelta(active.agentSessionId, active.agentRunId, event.delta)
      return
    }
    if (event.type === 'queue_updated') return
    if (event.type === 'model_call_requested') {
      await this.#authorizeToolContinuation(active, event.continuationId)
      return
    }
    if (!active.authorizedModelRequestIds.has(event.modelRequestId)) {
      throw new Error('Agent event refers to an unauthorized model request')
    }
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    if (event.type === 'model_call_finished') {
      if (event.outcome === 'succeeded') {
        await repository.succeed(event.modelRequestId, { metadata: event.metadata, outputItems: 1 })
      } else if (event.outcome === 'timed_out') {
        await repository.fail(event.modelRequestId, {
          code: 'provider_timeout',
          retryable: true
        })
      } else if (event.outcome === 'aborted') {
        await repository.abort(event.modelRequestId)
      } else {
        await repository.fail(event.modelRequestId, {
          code: 'provider_request_failed',
          retryable: event.httpStatus === 429 || (event.httpStatus ?? 0) >= 500,
          ...(event.httpStatus === undefined ? {} : { httpStatus: event.httpStatus })
        })
      }
      active.pendingModelRequestIds.delete(event.modelRequestId)
      return
    }
    await this.#appendAndPublishEvent({
      sessionId: active.agentSessionId,
      runId: active.agentRunId,
      type: 'assistant_message',
      payload: event.message,
      modelRequestId: event.modelRequestId
    })
    active.partialText = ''
  }

  async #authorizeToolContinuation(active: ActiveRun, continuationId: string): Promise<void> {
    if (active.controller.signal.aborted) {
      throw active.controller.signal.reason instanceof Error
        ? active.controller.signal.reason
        : new AgentRunCancellationError('user_stopped', 'Agent run was stopped')
    }
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    let modelRequestId: string | undefined
    try {
      modelRequestId = (
        await repository.start({
          operation: 'agent',
          provider: active.config,
          request: { delivery: 'tool_continuation', continuationId },
          inputItems: 1,
          operationId: active.operationId,
          agentRunId: active.agentRunId,
          projectSessionId: this.options.projectSessionId
        })
      ).modelRequestId
      active.authorizedModelRequestIds.add(modelRequestId)
      active.pendingModelRequestIds.add(modelRequestId)
      active.handle.authorizeModelCall({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        continuationId,
        modelRequestId
      })
      this.options.log.info(
        {
          event: 'agent.run.tool_continuation_authorized',
          agentRunId: active.agentRunId,
          modelRequestId,
          continuationId
        },
        'Authorized an Agent model call after tool execution'
      )
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.run.tool_continuation_authorization_failed',
          err,
          agentRunId: active.agentRunId,
          continuationId
        },
        'Failed to authorize an Agent model call after tool execution'
      )
      if (modelRequestId !== undefined) {
        await repository.abort(modelRequestId, 'authorization_delivery_failed')
        active.pendingModelRequestIds.delete(modelRequestId)
      }
      active.controller.abort(err)
      throw err
    }
  }

  async #handleToolRequest(
    agentRunId: string,
    request: AgentToolRequest,
    signal: AbortSignal
  ): Promise<AgentToolResponse> {
    const active = this.#requireActive(agentRunId)
    if (
      request.projectSessionId !== this.options.projectSessionId ||
      request.agentSessionId !== active.agentSessionId ||
      request.agentRunId !== active.agentRunId ||
      !active.authorizedModelRequestIds.has(request.modelRequestId)
    ) {
      this.options.log.error(
        {
          event: 'agent.tool.unauthorized',
          err: new Error('Agent tool request capability mismatch'),
          agentRunId,
          toolCallId: request.toolCallId,
          toolName: request.toolName
        },
        'Rejected an unauthorized Agent tool request'
      )
      return toolErrorResponse(request, 'unauthorized', 'Agent tool request is unauthorized', false)
    }
    if (signal.aborted) {
      return toolErrorResponse(request, 'aborted', 'Agent tool request was aborted', true)
    }
    const callPayload = agentToolCallPayloadSchema.parse({
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      args: request.args,
      timestamp: this.#now().getTime()
    })
    const toolCallEvent = await this.#appendAndPublishEvent({
      sessionId: active.agentSessionId,
      runId: active.agentRunId,
      type: 'tool_call',
      payload: callPayload,
      modelRequestId: request.modelRequestId
    })
    try {
      if (this.options.tools === undefined) {
        throw new AgentToolDomainError('unavailable', 'Agent read tools are unavailable', true)
      }
      const data = await this.options.tools.execute({
        toolName: request.toolName,
        args: request.args,
        editorContext: active.editorContext,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        toolCallId: request.toolCallId,
        toolCallEventId: toolCallEvent.agentEventId,
        modelRequestId: request.modelRequestId,
        signal
      })
      const provenance = extractToolProvenance(data)
      const resultPayload = agentToolResultPayloadSchema.parse({
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        isError: false,
        result: data,
        error: null,
        ...provenance,
        timestamp: this.#now().getTime()
      })
      await this.#appendAndPublishEvent({
        sessionId: active.agentSessionId,
        runId: active.agentRunId,
        type: 'tool_result',
        payload: resultPayload,
        modelRequestId: request.modelRequestId
      })
      return agentToolResponseSchema.parse({
        ...toolResponseCapability(request),
        ok: true,
        data
      })
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.tool.execution_failed',
          err,
          agentRunId,
          toolCallId: request.toolCallId,
          toolName: request.toolName
        },
        'Agent tool execution failed'
      )
      const safe = safeToolError(err, signal)
      const resultPayload = agentToolResultPayloadSchema.parse({
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        isError: true,
        result: null,
        error: { code: safe.code, message: safe.message },
        citationIds: [],
        knowledgeItemIds: [],
        parseRevisionIds: [],
        timestamp: this.#now().getTime()
      })
      await this.#appendAndPublishEvent({
        sessionId: active.agentSessionId,
        runId: active.agentRunId,
        type: 'tool_result',
        payload: resultPayload,
        modelRequestId: request.modelRequestId
      })
      return toolErrorResponse(request, safe.code, safe.message, safe.retryable)
    }
  }

  async #settleRun(active: ActiveRun): Promise<void> {
    try {
      await active.handle.completion
      if (active.pendingModelRequestIds.size > 0) {
        throw new Error('Agent run completed with unfinished model requests')
      }
      const event = await this.#finishRunAndAppendEvent({
        agentRunId: active.agentRunId,
        agentSessionId: active.agentSessionId,
        status: 'completed',
        error: null,
        eventPayload: { status: 'completed' }
      })
      this.options.log.info(
        { event: 'agent.run.completed', agentRunId: active.agentRunId, sequence: event.sequence },
        'Agent run completed'
      )
    } catch (err) {
      this.options.log.error(
        { event: 'agent.run.failed', err, agentRunId: active.agentRunId },
        'Agent run did not complete'
      )
      const termination = classifyRunFailure(err, active.controller.signal)
      this.options.log.warn(
        {
          event: 'agent.run.terminated',
          agentRunId: active.agentRunId,
          status: termination.status,
          code: termination.code
        },
        'Agent run terminated'
      )
      const partialModelRequestId = [...active.pendingModelRequestIds][0] ?? null
      await this.#abortPendingModelRequests(active)
      if (active.partialText.length > 0) {
        const payload: AgentAssistantMessagePayload = agentAssistantMessagePayloadSchema.parse({
          content: active.partialText,
          stopReason: termination.code === 'provider_timeout' ? 'error' : 'aborted',
          provider: active.config.providerId,
          model: active.config.model,
          metadata: emptyMetadata(active.config.model),
          timestamp: this.#now().getTime(),
          interrupted: termination.code !== 'provider_timeout'
        })
        await this.#appendAndPublishEvent({
          sessionId: active.agentSessionId,
          runId: active.agentRunId,
          type: 'assistant_message',
          payload,
          modelRequestId: partialModelRequestId
        })
      }
      await this.#finishRunAndAppendEvent({
        agentRunId: active.agentRunId,
        agentSessionId: active.agentSessionId,
        status: termination.status,
        error: { code: termination.code },
        eventPayload: { code: termination.code, status: termination.status }
      })
    } finally {
      if (this.#active === active) this.#active = undefined
    }
  }

  async #abortPendingModelRequests(active: ActiveRun): Promise<void> {
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    for (const modelRequestId of [...active.pendingModelRequestIds]) {
      try {
        await repository.abort(modelRequestId, 'agent_run_ended')
      } catch (err) {
        this.options.log.error(
          {
            event: 'agent.run.model_request_abort_failed',
            err,
            modelRequestId,
            agentRunId: active.agentRunId
          },
          'Failed to abort an unfinished Agent model request'
        )
      }
      active.pendingModelRequestIds.delete(modelRequestId)
    }
  }

  #insertRunAndUserEvent(input: {
    agentSessionId: string
    agentRunId: string
    config: Extract<ProviderConfig, { role: 'agent' }>
    editorContext: AgentEditorContext
    prompt: string
    now: Date
  }): void {
    const now = input.now.toISOString()
    this.options.database.immediate((database) => {
      database
        .prepare(
          `INSERT INTO agent_runs (
             agent_run_id, agent_session_id, status, provider_id, model_id,
             provider_fingerprint, model_fingerprint, editor_context_json,
             error_json, started_at, completed_at, created_at, updated_at
           ) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`
        )
        .run(
          input.agentRunId,
          input.agentSessionId,
          input.config.providerId,
          input.config.model,
          fingerprint({
            providerId: input.config.providerId,
            baseUrl: input.config.baseUrl,
            role: input.config.role
          }),
          fingerprint({ model: input.config.model, revision: input.config.modelRevision }),
          JSON.stringify(input.editorContext),
          now,
          now,
          now
        )
      insertEvent(database, {
        eventId: this.#createId(),
        sessionId: input.agentSessionId,
        runId: input.agentRunId,
        type: 'user_message',
        payload: agentUserMessagePayloadSchema.parse({
          content: input.prompt,
          delivery: 'prompt',
          timestamp: input.now.getTime()
        }),
        modelRequestId: null,
        createdAt: now
      })
      database
        .prepare('UPDATE agent_sessions SET updated_at = ? WHERE agent_session_id = ?')
        .run(now, input.agentSessionId)
    })
  }

  #linkInitialUserEvent(
    agentSessionId: string,
    agentRunId: string,
    modelRequestId: string
  ): AgentEventRecord {
    return this.options.database.immediate((database) => {
      const row = database
        .prepare(
          `SELECT agent_event_id, sequence, payload_json, created_at
             FROM agent_events
            WHERE agent_session_id = ? AND agent_run_id = ? AND type = 'user_message'
            ORDER BY sequence
            LIMIT 1`
        )
        .get(agentSessionId, agentRunId) as
        | { agent_event_id: string; sequence: number; payload_json: string; created_at: string }
        | undefined
      if (row === undefined) throw new Error('Initial Agent user event is missing')
      const result = database
        .prepare(
          `UPDATE agent_events
              SET model_request_id = ?
            WHERE agent_event_id = ? AND model_request_id IS NULL`
        )
        .run(modelRequestId, row.agent_event_id)
      if (result.changes !== 1) throw new Error('Initial Agent user event is already linked')
      return {
        agentEventId: row.agent_event_id,
        agentSessionId,
        agentRunId,
        sequence: row.sequence,
        type: 'user_message',
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        modelRequestId,
        createdAt: row.created_at
      }
    })
  }

  async #finishRunAndAppendEvent(input: {
    agentRunId: string
    agentSessionId: string
    status: 'completed' | 'interrupted' | 'failed'
    error: Record<string, unknown> | null
    eventPayload: Record<string, unknown>
  }): Promise<AgentEventRecord> {
    const now = this.#now().toISOString()
    const event = this.options.database.immediate((database) => {
      const result = database
        .prepare(
          `UPDATE agent_runs
              SET status = ?, error_json = ?, completed_at = ?, updated_at = ?
            WHERE agent_run_id = ? AND status = 'running'`
        )
        .run(
          input.status,
          input.error === null ? null : JSON.stringify(input.error),
          now,
          now,
          input.agentRunId
        )
      if (result.changes !== 1) throw new Error('Agent run is not active')
      const inserted = insertEvent(database, {
        eventId: this.#createId(),
        sessionId: input.agentSessionId,
        runId: input.agentRunId,
        type: input.status === 'completed' ? 'run_completed' : 'run_interrupted',
        payload: input.eventPayload,
        modelRequestId: null,
        createdAt: now
      })
      database
        .prepare('UPDATE agent_sessions SET updated_at = ? WHERE agent_session_id = ?')
        .run(now, input.agentSessionId)
      return inserted
    })
    await this.#publishDurable(event)
    return event
  }

  async #appendAndPublishEvent(input: {
    sessionId: string
    runId: string | null
    type: AgentEventType
    payload: Record<string, unknown>
    modelRequestId: string | null
  }): Promise<AgentEventRecord> {
    const createdAt = this.#now().toISOString()
    const event = this.options.database.immediate((database) => {
      const inserted = insertEvent(database, {
        eventId: this.#createId(),
        sessionId: input.sessionId,
        runId: input.runId,
        type: input.type,
        payload: input.payload,
        modelRequestId: input.modelRequestId,
        createdAt
      })
      database
        .prepare('UPDATE agent_sessions SET updated_at = ? WHERE agent_session_id = ?')
        .run(createdAt, input.sessionId)
      return inserted
    })
    await this.#publishDurable(event)
    return event
  }

  async #publishDurable(event: AgentEventRecord): Promise<void> {
    try {
      await this.options.publishEvent?.(event)
    } catch (err) {
      this.options.log.warn(
        {
          event: 'agent.event.delivery_failed',
          err,
          agentRunId: event.agentRunId,
          agentEventId: event.agentEventId,
          eventType: event.type
        },
        'Agent renderer delivery failed without changing durable run truth'
      )
    }
  }

  #assertCompatibleSession(agentSessionId: string): void {
    const row = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT pi_runtime_version, event_schema_version, status
               FROM agent_sessions WHERE agent_session_id = ?`
          )
          .get(agentSessionId) as
          | { pi_runtime_version: string; event_schema_version: number; status: string }
          | undefined
    )
    if (row === undefined) throw new Error('Agent session does not exist')
    if (row.status !== 'active') throw new Error('Agent session is archived')
    if (
      row.pi_runtime_version !== AGENT_RUNTIME_VERSION ||
      row.event_schema_version !== AGENT_EVENT_SCHEMA_VERSION
    ) {
      throw new Error('Agent session is incompatible with the current runtime')
    }
  }

  async #prepareRuntimeHistory(input: {
    agentSessionId: string
    agentRunId: string
    prompt: string
    maxOutputTokens: number
    signal: AbortSignal
  }): Promise<AgentHistoryMessage[]> {
    let history = this.#loadRuntimeHistory(input.agentSessionId, input.agentRunId)
    const tokenBudget = this.options.messageTokenBudget ?? agentMessageBudget(input.maxOutputTokens)
    const estimatedInputTokens = estimateAgentTokens(history) + estimateAgentTokens(input.prompt)
    if (estimatedInputTokens <= tokenBudget || this.#hasCompactionSummary(input.agentSessionId)) {
      return history
    }
    if (this.options.summarizeHistory === undefined) return history
    const source = this.#loadCompactionSource(input.agentSessionId, input.agentRunId)
    if (source === null) return history
    const summarized = await this.options.summarizeHistory({
      agentSessionId: input.agentSessionId,
      agentRunId: input.agentRunId,
      sourceText: source.text,
      coveredThroughSequence: source.coveredThroughSequence,
      estimatedInputTokens,
      signal: input.signal
    })
    const payload = agentCompactionSummaryPayloadSchema.parse({
      summary: summarized.summary,
      coveredThroughSequence: source.coveredThroughSequence,
      estimatedInputTokens,
      timestamp: this.#now().getTime()
    })
    await this.#appendAndPublishEvent({
      sessionId: input.agentSessionId,
      runId: input.agentRunId,
      type: 'compaction_summary',
      payload,
      modelRequestId: summarized.modelRequestId
    })
    this.options.log.info(
      {
        event: 'agent.compaction.completed',
        agentRunId: input.agentRunId,
        coveredThroughSequence: source.coveredThroughSequence,
        estimatedInputTokens
      },
      'Agent session history was compacted once'
    )
    history = this.#loadRuntimeHistory(input.agentSessionId, input.agentRunId)
    return history
  }

  #loadRuntimeHistory(agentSessionId: string, excludeRunId?: string): AgentHistoryMessage[] {
    const summary = this.#latestCompactionSummary(agentSessionId)
    const coveredThroughSequence = summary?.coveredThroughSequence ?? 0
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT type, payload_json
               FROM agent_events
              WHERE agent_session_id = ?
                AND type IN ('user_message', 'assistant_message')
                AND sequence > ?
                AND (? IS NULL OR agent_run_id IS NULL OR agent_run_id <> ?)
              ORDER BY sequence DESC
              LIMIT ?`
          )
          .all(
            agentSessionId,
            coveredThroughSequence,
            excludeRunId ?? null,
            excludeRunId ?? null,
            HISTORY_EVENT_LIMIT
          ) as Array<{
          type: 'user_message' | 'assistant_message'
          payload_json: string
        }>
    )
    const history: AgentHistoryMessage[] = []
    let bytes = 2
    if (summary !== null) {
      const message: AgentHistoryMessage = {
        role: 'user',
        content: `<writellm_session_summary>\n${summary.summary}\n</writellm_session_summary>`,
        timestamp: summary.timestamp
      }
      history.push(message)
      bytes += new TextEncoder().encode(JSON.stringify(message)).byteLength + 1
    }
    for (const row of rows.reverse()) {
      const parsed = JSON.parse(row.payload_json) as unknown
      let message: AgentHistoryMessage
      if (row.type === 'user_message') {
        const payload = agentUserMessagePayloadSchema.parse(parsed)
        message = { role: 'user', content: payload.content, timestamp: payload.timestamp }
      } else {
        const payload = agentAssistantMessagePayloadSchema.parse(parsed)
        if (payload.interrupted || payload.stopReason === 'toolUse') continue
        const { interrupted: _interrupted, ...complete } = payload
        message = { role: 'assistant', message: complete }
      }
      const messageBytes = new TextEncoder().encode(JSON.stringify(message)).byteLength + 1
      if (bytes + messageBytes > HISTORY_BYTE_LIMIT) continue
      history.push(message)
      bytes += messageBytes
    }
    return agentHistorySchema.parse(history)
  }

  #hasCompactionSummary(agentSessionId: string): boolean {
    return this.#latestCompactionSummary(agentSessionId) !== null
  }

  #latestCompactionSummary(agentSessionId: string): {
    summary: string
    coveredThroughSequence: number
    timestamp: number
  } | null {
    const row = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT payload_json FROM agent_events
            WHERE agent_session_id = ? AND type = 'compaction_summary'
            ORDER BY sequence DESC LIMIT 1`
          )
          .get(agentSessionId) as { payload_json: string } | undefined
    )
    return row === undefined
      ? null
      : agentCompactionSummaryPayloadSchema.parse(JSON.parse(row.payload_json))
  }

  #loadCompactionSource(
    agentSessionId: string,
    excludeRunId: string
  ): { text: string; coveredThroughSequence: number } | null {
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT sequence, type, payload_json
             FROM agent_events
            WHERE agent_session_id = ?
              AND type IN ('user_message', 'assistant_message')
              AND (agent_run_id IS NULL OR agent_run_id <> ?)
            ORDER BY sequence
            LIMIT ?`
          )
          .all(agentSessionId, excludeRunId, COMPACTION_SOURCE_EVENT_LIMIT) as Array<{
          sequence: number
          type: 'user_message' | 'assistant_message'
          payload_json: string
        }>
    )
    if (rows.length < 2) return null
    const fragments: string[] = []
    let bytes = 0
    let coveredThroughSequence = 0
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json) as Record<string, unknown>
      const content = typeof payload['content'] === 'string' ? payload['content'] : ''
      const fragment = `${row.type === 'user_message' ? 'USER' : 'ASSISTANT'}: ${content}\n`
      const fragmentBytes = new TextEncoder().encode(fragment).byteLength
      if (bytes + fragmentBytes > COMPACTION_SOURCE_TEXT_LIMIT) break
      fragments.push(fragment)
      bytes += fragmentBytes
      coveredThroughSequence = row.sequence
    }
    if (fragments.length < 2 || coveredThroughSequence === 0) return null
    return { text: fragments.join(''), coveredThroughSequence }
  }

  async #publishDelta(agentSessionId: string, agentRunId: string, delta: string): Promise<void> {
    try {
      await this.options.publishDelta?.({ agentSessionId, agentRunId, delta })
    } catch (err) {
      this.options.log.warn(
        { event: 'agent.delta.delivery_failed', err, agentRunId },
        'Agent delta delivery failed without changing durable run truth'
      )
    }
  }

  #requireActive(agentRunId: string): ActiveRun {
    const active = this.#active
    if (active === undefined || active.agentRunId !== agentRunId) {
      throw new Error('Agent run is not active')
    }
    return active
  }

  #assertSessionExists(agentSessionId: string): void {
    const exists = this.options.database.immediate((database) =>
      database
        .prepare('SELECT 1 FROM agent_sessions WHERE agent_session_id = ?')
        .pluck()
        .get(agentSessionId)
    )
    if (exists !== 1) throw new Error('Agent session does not exist')
  }
}

function insertEvent(
  database: import('better-sqlite3').Database,
  input: {
    eventId: string
    sessionId: string
    runId: string | null
    type: AgentEventType
    payload: Record<string, unknown>
    modelRequestId: string | null
    createdAt: string
  }
): AgentEventRecord {
  const sequence = Number(
    database
      .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_events WHERE agent_session_id = ?')
      .pluck()
      .get(input.sessionId)
  )
  const payloadJson = JSON.stringify(input.payload)
  if (new TextEncoder().encode(payloadJson).byteLength > 2_097_152) {
    throw new Error('Agent event payload exceeds the durable bound')
  }
  database
    .prepare(
      `INSERT INTO agent_events (
         agent_event_id, agent_session_id, agent_run_id, sequence, type,
         payload_json, model_request_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.eventId,
      input.sessionId,
      input.runId,
      sequence,
      input.type,
      payloadJson,
      input.modelRequestId,
      input.createdAt
    )
  return {
    agentEventId: input.eventId,
    agentSessionId: input.sessionId,
    agentRunId: input.runId,
    sequence,
    type: input.type,
    payload: input.payload,
    modelRequestId: input.modelRequestId,
    createdAt: input.createdAt
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function safeErrorCode(value: string | null): string | null {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code.slice(0, 200) : 'agent_run_failed'
  } catch {
    return 'agent_run_failed'
  }
}

function emptyMetadata(model: string): AgentAssistantMessagePayload['metadata'] {
  return {
    usage: {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      estimatedCostUsdMicros: null
    },
    responseIds: [],
    retryCount: 0,
    providerModelId: model
  }
}

type AgentRunTermination =
  | { status: 'failed'; code: 'provider_timeout' | 'run_failed' }
  | { status: 'interrupted'; code: 'user_stopped' | 'project_closed' | 'run_interrupted' }

class AgentRunCancellationError extends Error {
  constructor(
    readonly code: 'user_stopped' | 'project_closed',
    message: string
  ) {
    super(message)
    this.name = 'AgentRunCancellationError'
  }
}

function classifyRunFailure(error: unknown, signal: AbortSignal): AgentRunTermination {
  if (signal.aborted && signal.reason instanceof AgentRunCancellationError) {
    return { status: 'interrupted', code: signal.reason.code }
  }
  if (error instanceof Error && error.name === 'ProviderTimeoutError') {
    return { status: 'failed', code: 'provider_timeout' }
  }
  if (signal.aborted) return { status: 'interrupted', code: 'run_interrupted' }
  if (
    error instanceof Error &&
    (error.name === 'AbortError' ||
      /exited before responding|terminated|project is closing|worker.*closed/i.test(error.message))
  ) {
    return { status: 'interrupted', code: 'run_interrupted' }
  }
  return { status: 'failed', code: 'run_failed' }
}

function toolResponseCapability(request: AgentToolRequest) {
  return {
    type: 'tool_response' as const,
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName
  }
}

function toolErrorResponse(
  request: AgentToolRequest,
  code: Extract<AgentToolResponse, { ok: false }>['error']['code'],
  message: string,
  retryable: boolean
): AgentToolResponse {
  return agentToolResponseSchema.parse({
    ...toolResponseCapability(request),
    ok: false,
    error: { code, message, retryable }
  })
}

function safeToolError(
  err: unknown,
  signal: AbortSignal
): Extract<AgentToolResponse, { ok: false }>['error'] {
  if (signal.aborted) {
    return { code: 'aborted', message: 'Agent tool request was aborted', retryable: true }
  }
  if (err instanceof AgentToolDomainError) {
    return { code: err.code, message: err.message.slice(0, 1_000), retryable: err.retryable }
  }
  return { code: 'internal', message: 'Agent read tool failed', retryable: false }
}

function extractToolProvenance(data: unknown): {
  citationIds: string[]
  knowledgeItemIds: string[]
  parseRevisionIds: string[]
} {
  if (data === null || typeof data !== 'object') {
    return { citationIds: [], knowledgeItemIds: [], parseRevisionIds: [] }
  }
  const record = data as Record<string, unknown>
  const preview =
    record.preview !== null && typeof record.preview === 'object'
      ? (record.preview as Record<string, unknown>)
      : undefined
  const values = Array.isArray(record.hits)
    ? record.hits
    : Array.isArray(record.citations)
      ? record.citations
      : Array.isArray(preview?.citedSources)
        ? preview.citedSources
        : []
  const entries = values.filter(
    (value): value is Record<string, unknown> => value !== null && typeof value === 'object'
  )
  return {
    citationIds: uniqueStrings(entries.map((entry) => entry.citationId)),
    knowledgeItemIds: uniqueStrings(entries.map((entry) => entry.knowledgeItemId)),
    parseRevisionIds: uniqueStrings(entries.map((entry) => entry.parseRevisionId))
  }
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))].slice(
    0,
    20
  )
}
