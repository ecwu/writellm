import type { Logger } from 'pino'
import { serializeAgentDiagnosticError } from '../../shared/agent-diagnostic-error'
import type { ProjectDatabase } from '../project/project-database'
import type {
  AgentEventType,
  AgentApprovalMode,
  AgentInteractionMode
} from '../../shared/contracts/agent'
import type { AgentThinkingLevel } from '../../shared/contracts/providers'
import {
  AGENT_EVENT_PAGE_LIMIT,
  AGENT_EVENT_PAGE_MAX_BYTES,
  agentEventPageSchema,
  agentEventRecordSchema,
  agentRunRecordSchema,
  type AgentEventPage,
  type AgentEventRecord,
  type AgentRunRecord
} from '../../shared/contracts/agent-ipc'
import { readRunError } from './session-event-utils'

const AGENT_EVENT_PAGE_ENVELOPE_RESERVE_BYTES = 8 * 1024

export class AgentSessionQueries {
  constructor(
    private readonly database: ProjectDatabase,
    private readonly log: Pick<Logger, 'warn'>
  ) {}
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
    const candidateRows = this.database.read(
      (database) =>
        database
          .prepare(
            `SELECT agent_event_id, agent_session_id, agent_run_id, sequence, type,
                    length(CAST(payload_json AS BLOB)) AS payload_bytes, model_request_id,
                    source_event_id, source_session_id, forkable,
                    created_at
               FROM agent_conversation_history
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
          payload_bytes: number
          source_event_id: string | null
          source_session_id: string | null
          forkable: number
          model_request_id: string | null
          created_at: string
        }>
    )
    const selectedRows: typeof candidateRows = []
    let selectedPayloadBytes = 0
    for (const row of candidateRows) {
      if (
        selectedRows.length > 0 &&
        selectedPayloadBytes + row.payload_bytes + AGENT_EVENT_PAGE_ENVELOPE_RESERVE_BYTES >
          AGENT_EVENT_PAGE_MAX_BYTES
      ) {
        break
      }
      selectedRows.push(row)
      selectedPayloadBytes += row.payload_bytes
      if (selectedRows.length >= boundedLimit) break
    }
    const payloadById =
      selectedRows.length === 0
        ? new Map<string, string>()
        : this.database.read((database) => {
            const placeholders = selectedRows.map(() => '?').join(', ')
            const payloadRows = database
              .prepare(
                `SELECT agent_event_id, payload_json
                   FROM agent_conversation_history
                  WHERE agent_event_id IN (${placeholders})`
              )
              .all(...selectedRows.map((row) => row.agent_event_id)) as Array<{
              agent_event_id: string
              payload_json: string
            }>
            return new Map(payloadRows.map((row) => [row.agent_event_id, row.payload_json]))
          })
    const pageEvents: AgentEventRecord[] = []
    let returnedBytes = 0
    for (const row of selectedRows) {
      const payloadJson = payloadById.get(row.agent_event_id)
      if (payloadJson === undefined) throw new Error('Selected Agent event payload is missing')
      const event = agentEventRecordSchema.parse({
        inheritedFrom:
          row.source_event_id === null
            ? null
            : {
                agentSessionId: row.source_session_id,
                agentEventId: row.source_event_id
              },
        forkable: row.forkable === 1,
        agentEventId: row.agent_event_id,
        agentSessionId: row.agent_session_id,
        agentRunId: row.agent_run_id,
        sequence: row.sequence,
        type: row.type,
        payload: JSON.parse(payloadJson) as Record<string, unknown>,
        modelRequestId: row.model_request_id,
        createdAt: row.created_at
      })
      const eventBytes = Buffer.byteLength(JSON.stringify(event))
      if (
        pageEvents.length > 0 &&
        returnedBytes + eventBytes >
          AGENT_EVENT_PAGE_MAX_BYTES - AGENT_EVENT_PAGE_ENVELOPE_RESERVE_BYTES
      ) {
        break
      }
      pageEvents.push(event)
      returnedBytes += eventBytes
      if (pageEvents.length >= boundedLimit) break
    }
    return agentEventPageSchema.parse({
      events: pageEvents,
      nextAfterSequence: pageEvents.at(-1)?.sequence ?? Math.max(0, Math.floor(afterSequence)),
      hasMore: candidateRows.length > pageEvents.length,
      returnedBytes
    })
  }

  listRuns(agentSessionId: string, limit = 200): AgentRunRecord[] {
    this.#assertSessionExists(agentSessionId)
    const boundedLimit = Math.min(200, Math.max(1, Math.floor(limit)))
    return this.database.read((database) =>
      (
        database
          .prepare(
            `SELECT run.agent_run_id, run.agent_session_id, run.status, run.provider_id, run.model_id,
                    run.provider_preset_id, run.provider_label, run.model_label, run.api_id,
                    run.approval_mode, run.interaction_mode, run.thinking_level, run.model_limits_json,
                    run.editor_context_json, run.error_json, run.skill_snapshot_json,
                    run.writing_task_id, run.writing_task_step_id,
                    skill_route.model_request_id AS skill_route_model_request_id,
                    skill_route.input_tokens AS skill_route_input_tokens,
                    skill_route.output_tokens AS skill_route_output_tokens,
                    skill_route.cache_read_tokens AS skill_route_cache_read_tokens,
                    skill_route.cache_write_tokens AS skill_route_cache_write_tokens,
                    skill_route.estimated_cost_usd_micros AS skill_route_estimated_cost_usd_micros,
                    skill_route.retry_count AS skill_route_retry_count,
                    run.started_at, run.completed_at, run.updated_at
               FROM agent_runs AS run
               LEFT JOIN model_requests AS skill_route
                 ON skill_route.model_request_id = run.skill_route_model_request_id
                AND skill_route.delivery = 'skill_route'
              WHERE run.agent_session_id = ?
              ORDER BY run.started_at DESC, run.agent_run_id DESC
              LIMIT ?`
          )
          .all(agentSessionId, boundedLimit) as Array<{
          agent_run_id: string
          agent_session_id: string
          status: 'running' | 'completed' | 'interrupted' | 'failed'
          provider_id: string
          model_id: string
          provider_preset_id: string | null
          provider_label: string
          model_label: string
          api_id: string
          approval_mode: AgentApprovalMode
          interaction_mode: AgentInteractionMode
          thinking_level: AgentThinkingLevel
          model_limits_json: string
          editor_context_json: string
          error_json: string | null
          skill_snapshot_json: string
          writing_task_id: string | null
          writing_task_step_id: string | null
          skill_route_model_request_id: string | null
          skill_route_input_tokens: number | null
          skill_route_output_tokens: number | null
          skill_route_cache_read_tokens: number | null
          skill_route_cache_write_tokens: number | null
          skill_route_estimated_cost_usd_micros: number | null
          skill_route_retry_count: number | null
          started_at: string
          completed_at: string | null
          updated_at: string
        }>
      ).map((row) => {
        let error: ReturnType<typeof readRunError>
        try {
          error = readRunError(row.error_json)
        } catch (err) {
          // JSON parser messages can quote stored private text. Preserve identity and stack safely.
          serializeAgentDiagnosticError(err, 'agent.history', {
            privateBodies: err instanceof Error ? [err.message] : []
          })
          this.log.warn(
            {
              event: 'agent.history.error_record_invalid',
              err,
              agentSessionId,
              agentRunId: row.agent_run_id
            },
            'Agent run error record is invalid; history remains readable'
          )
          error = { errorCode: 'agent_run_failed', errorDetails: null }
        }
        return agentRunRecordSchema.parse({
          agentRunId: row.agent_run_id,
          agentSessionId: row.agent_session_id,
          status: row.status,
          providerId: row.provider_id,
          modelId: row.model_id,
          providerPresetId: row.provider_preset_id,
          providerLabel: row.provider_label || row.provider_id,
          modelLabel: row.model_label || row.model_id,
          api: row.api_id,
          approvalMode: row.approval_mode,
          interactionMode: row.interaction_mode,
          thinkingLevel: row.thinking_level,
          modelLimits: JSON.parse(row.model_limits_json),
          editorContext: JSON.parse(row.editor_context_json),
          skillSnapshot: JSON.parse(row.skill_snapshot_json),
          skillRouteUsage:
            row.skill_route_model_request_id === null
              ? null
              : {
                  inputTokens: row.skill_route_input_tokens,
                  outputTokens: row.skill_route_output_tokens,
                  cacheReadTokens: row.skill_route_cache_read_tokens,
                  cacheWriteTokens: row.skill_route_cache_write_tokens,
                  estimatedCostUsdMicros: row.skill_route_estimated_cost_usd_micros,
                  retryCount: row.skill_route_retry_count ?? 0
                },
          ...error,
          writingTaskId: row.writing_task_id,
          writingTaskStepId: row.writing_task_step_id,
          startedAt: row.started_at,
          completedAt: row.completed_at,
          updatedAt: row.updated_at
        })
      })
    )
  }

  requireRun(agentRunId: string): AgentRunRecord {
    const row = this.database.read(
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

  #assertSessionExists(agentSessionId: string): void {
    const exists = this.database.read((database) =>
      database
        .prepare('SELECT 1 FROM agent_sessions WHERE agent_session_id = ?')
        .pluck()
        .get(agentSessionId)
    )
    if (exists !== 1) throw new Error('Agent session does not exist')
  }
}
