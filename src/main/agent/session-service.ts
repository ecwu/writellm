import { createHash, randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { ZodError } from 'zod'
import {
  AGENT_PENDING_MESSAGE_LIMIT,
  AGENT_PENDING_MESSAGE_MAX_BYTES,
  AGENT_EVENT_SCHEMA_VERSION,
  AGENT_RUNTIME_VERSION,
  agentAssistantMessagePayloadSchema,
  agentCompactionCheckpointPayloadSchema,
  agentCompactionFailedPayloadSchema,
  agentCompactionStartedPayloadSchema,
  agentEditorContextSchema,
  agentHistorySchema,
  agentRuntimeModelSchema,
  agentUserMessagePayloadSchema,
  type AgentAssistantMessagePayload,
  type AgentApprovalMode,
  type AgentCompactionTrigger,
  type AgentEditorContext,
  type AgentEventType,
  type AgentHistoryMessage,
  type AgentRuntimeModel,
  type AgentRuntimeEvent,
  type AgentModelLimits,
  type AgentUserMessagePayload
} from '../../shared/contracts/agent'
import {
  agentMessageBudget,
  agentOutputLimit,
  estimateAgentTokens
} from '../../shared/agent-context-budget'
import {
  AGENT_LIVE_PARTIAL_MAX_BYTES,
  AGENT_EVENT_PAGE_LIMIT,
  AGENT_EVENT_PAGE_MAX_BYTES,
  MAX_CONCURRENT_AGENT_RUNS,
  agentProjectActivitySnapshotSchema,
  agentEventPageSchema,
  agentEventRecordSchema,
  agentRunRecordSchema,
  agentSessionRecordSchema,
  type AgentEventPage,
  type AgentEventRecord,
  type AgentProjectActivitySnapshot,
  type AgentRunRecord,
  type AgentSessionRecord
} from '../../shared/contracts/agent-ipc'
import {
  AGENT_TOOL_DESCRIPTORS,
  AGENT_TOOL_RESULT_SCHEMA_VERSION,
  agentToolCallPayloadSchema,
  agentToolResponseSchema,
  agentToolResultPayloadSchema,
  askUserResultSchema,
  type AskUserAnswer,
  type AskUserArgs,
  type AskUserResult,
  type AgentToolRequest,
  type AgentToolResponse
} from '../../shared/contracts/agent-tools'
import {
  mutationProposalToolResultSchema,
  submitChangeResultSchema,
  type MutationProposalOutcome
} from '../../shared/contracts/agent-mutations'
import {
  agentThinkingLevelSchema,
  type AgentModelSelection,
  type AgentThinkingLevel,
  type ProviderConfig
} from '../../shared/contracts/providers'
import { skillRunSnapshotSchema, type SkillRunSnapshot } from '../../shared/contracts/skills'
import type { AgentRunInput, AgentRunResult } from '../../shared/contracts/model-runtime'
import { withLogContext } from '../observability/log-context'
import type { ProjectDatabase } from '../project/project-database'
import type { AgentSessionRunHandle, AgentSessionRuntime } from '../providers/gateways'
import { ModelRequestRepository } from '../providers/model-request-repository'
import type { ProviderService } from '../providers/provider-service'
import {
  agentCredentialFromResolved,
  agentProviderConfigFromResolved,
  clampResolvedAgentThinkingLevel,
  type AgentProviderCatalogService,
  type ResolvedAgentCatalogModel
} from '../providers/agent-provider-catalog'
import {
  SkillPromptBudgetError,
  type AgentContextBuilder,
  type AgentSkillPromptInput,
  type WritingSnapshot
} from './context'
import { virtualSkillPath } from '../skills/prompt'
import {
  SkillReadError,
  SkillRouteError,
  type SkillRunState,
  type WritingSkillRuntime
} from '../skills/skill-router'
import { AgentToolDomainError } from './read-tools'
import type { WritingTaskService } from './writing-task-service'
import type { AgentToolExecutor } from './tools'
import {
  buildSessionTitleContext,
  fallbackSessionTitle,
  isGenericSessionTitle,
  sanitizeGeneratedSessionTitle,
  type SessionTitleMessage
} from './session-title'
import {
  FALLBACK_AGENT_SYSTEM_PROMPT,
  formatSessionTitleInput,
  SESSION_TITLE_SYSTEM_PROMPT,
  TOOL_CONTINUATION_REQUEST
} from './prompts/task-prompts'
import {
  agentCompactionBudgets,
  AgentContextPlanner,
  AgentCurrentTurnTooLargeError,
  type AgentCompactionBudgets
} from './context-planner'
import type { ProjectInteractiveModelLimiter } from './project-interactive-model-limiter'
import {
  buildNextCompactionMaterial,
  latestSuccessfulCheckpoint,
  loadContinuousRuntimeHistory,
  loadRuntimeTailAfterSequence,
  uncheckpointedEnvelope
} from './context-checkpoint'

const AGENT_EVENT_PAGE_ENVELOPE_RESERVE_BYTES = 8 * 1024
const SESSION_TITLE_OUTPUT_TOKENS = 64
const SESSION_TITLE_REASONING_OUTPUT_TOKENS = 512

export interface StartedAgentRun {
  agentRunId: string
  completion: Promise<void>
}

interface ActiveRun {
  readonly agentSessionId: string
  readonly agentRunId: string
  readonly operationId: string
  readonly controller: AbortController
  handle: AgentSessionRunHandle | null
  phase: 'routing' | 'compacting' | 'running' | 'awaiting_input'
  readonly config: Extract<ProviderConfig, { role: 'agent' }>
  readonly editorContext: AgentEditorContext
  readonly approvalMode: AgentApprovalMode
  readonly thinkingLevel: AgentThinkingLevel
  readonly runtimeModel?: AgentRuntimeModel
  readonly modelLimits: AgentModelLimits
  readonly credential: string
  currentRequest: string
  readonly maxOutputTokens: number
  readonly temperature?: number
  readonly authorizedModelRequestIds: Set<string>
  readonly pendingModelRequestIds: Set<string>
  readonly pendingMessages: PendingFollowUpMessage[]
  readonly snapshots: Map<string, WritingSnapshot>
  skillSnapshot: SkillRunSnapshot
  skillState: SkillRunState | null
  skillPrompt: AgentSkillPromptInput
  systemPrompt: string
  partialText: string
  reviewPause: { proposalId: string; kind: string } | null
  pendingQuestion: PendingUserQuestion | null
  overflowRetryAttempted: boolean
  completion: Promise<void>
}

interface PendingUserQuestion {
  readonly toolCallId: string
  readonly modelRequestId: string
  readonly args: AskUserArgs
  readonly startedAt: string
  submitting: boolean
  readonly resolveAnswers: (result: AskUserResult) => void
  readonly rejectAnswers: (error: Error) => void
  readonly completion: Promise<{ ok: boolean }>
  readonly complete: (result: { ok: boolean }) => void
}

interface PendingFollowUpMessage {
  readonly pendingMessageId: string
  readonly modelRequestId: string
  readonly content: string
  readonly timestamp: number
  readonly queuedAt: string
  readonly systemPrompt: string
  readonly snapshot?: WritingSnapshot
}

interface ActiveCompaction {
  readonly compactionId: string
  readonly agentSessionId: string
  readonly trigger: 'manual'
  phase: 'planning' | 'summarizing'
  readonly startedAt: string
  readonly controller: AbortController
  completion: Promise<void>
}

interface StartingRun {
  readonly agentSessionId: string
  readonly agentRunId: string
  readonly startedAt: string
  readonly controller: AbortController
  completion: Promise<StartedAgentRun>
}

export interface AgentSessionServiceOptions {
  projectId: string
  projectSessionId: string
  database: ProjectDatabase
  providers: Pick<ProviderService, 'withConfiguredProvider'>
  agentCatalog?: Pick<AgentProviderCatalogService, 'resolve'>
  runtime: AgentSessionRuntime
  contextBuilder?: Pick<AgentContextBuilder, 'build'>
  skillRouter?: Pick<WritingSkillRuntime, 'route'> &
    Partial<
      Pick<WritingSkillRuntime, 'closePreparation' | 'displayNameForUri' | 'isPrepared' | 'read'>
    >
  tools?: AgentToolExecutor
  writingTasks?: Pick<WritingTaskService, 'activeCorrelation' | 'getView'>
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  publishEvent?: (event: AgentEventRecord) => void | Promise<void>
  publishDelta?: (event: {
    agentSessionId: string
    agentRunId: string
    delta: string
  }) => void | Promise<void>
  publishSession?: (event: {
    session: AgentSessionRecord
    titleGenerating: boolean
  }) => void | Promise<void>
  publishActivity?: (snapshot: AgentProjectActivitySnapshot) => void | Promise<void>
  generateTitle?: (input: {
    config: Extract<ProviderConfig, { role: 'agent' }>
    credential: string
    request: AgentRunInput
    modelLimits: AgentModelLimits
    signal: AbortSignal
  }) => Promise<AgentRunResult>
  summarizeHistory?: (input: {
    agentSessionId: string
    agentRunId: string | null
    compactionId: string
    trigger: AgentCompactionTrigger
    config: Extract<ProviderConfig, { role: 'agent' }>
    credential: string
    modelLimits: AgentModelLimits
    sourcePayloadJson: string
    coveredThroughSequence: number
    estimatedInputTokens: number
    maxOutputTokens: number
    signal: AbortSignal
  }) => Promise<{ summary: string; modelRequestId: string }>
  messageTokenBudget?: number
  now?: () => Date
  createId?: () => string
  defaultApprovalMode?: () => AgentApprovalMode
  resolveModelLimits?: (
    config: Extract<ProviderConfig, { role: 'agent' }>,
    signal: AbortSignal
  ) => Promise<AgentModelLimits>
  interactiveModelLimiter?: ProjectInteractiveModelLimiter
}

export class AgentSessionService {
  readonly #now: () => Date
  readonly #createId: () => string
  readonly #titleRequests = new Map<
    string,
    { controller: AbortController; completion: Promise<AgentSessionRecord> }
  >()
  readonly #startingRuns = new Map<string, StartingRun>()
  readonly #activeRuns = new Map<string, ActiveRun>()
  readonly #activeCompactions = new Map<string, ActiveCompaction>()
  readonly #workBySession = new Map<string, string>()
  readonly #contextPlanner = new AgentContextPlanner()

  constructor(private readonly options: AgentSessionServiceOptions) {
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  createSession(
    title = 'New conversation',
    approvalMode = this.options.defaultApprovalMode?.() ?? 'manual',
    modelSelection: AgentModelSelection | null = null,
    thinkingLevel: AgentThinkingLevel = 'off'
  ): AgentSessionRecord {
    const agentSessionId = this.#createId()
    const now = this.#now().toISOString()
    const normalizedTitle = title.trim().slice(0, 500) || 'New conversation'
    this.options.database.immediate((database) => {
      database
        .prepare(
          `INSERT INTO agent_sessions (
             agent_session_id, title, pi_runtime_version, event_schema_version,
             status, approval_mode, provider_preset_id, selected_model_id, thinking_level,
             skill_mode, skill_id,
             created_at, updated_at, archived_at
           ) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, 'auto', NULL, ?, ?, NULL)`
        )
        .run(
          agentSessionId,
          normalizedTitle,
          AGENT_RUNTIME_VERSION,
          AGENT_EVENT_SCHEMA_VERSION,
          approvalMode,
          modelSelection?.presetId ?? null,
          modelSelection?.modelId ?? null,
          thinkingLevel,
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
      approvalMode,
      workflowState: 'idle',
      modelSelection,
      thinkingLevel,
      createdAt: now,
      updatedAt: now,
      archivedAt: null
    })
  }

  listSessions(status: 'active' | 'archived' = 'active'): AgentSessionRecord[] {
    return this.#querySessions({ status, limit: 200 })
  }

  #querySessions(input: {
    status?: 'active' | 'archived'
    agentSessionId?: string
    limit: number
  }): AgentSessionRecord[] {
    const where: string[] = []
    const values: Array<string | number> = []
    if (input.status !== undefined) {
      where.push('status = ?')
      values.push(input.status)
    }
    if (input.agentSessionId !== undefined) {
      where.push('agent_session_id = ?')
      values.push(input.agentSessionId)
    }
    const whereSql = where.length === 0 ? '' : `WHERE ${where.join(' AND ')}`
    values.push(input.limit)
    return this.options.database.immediate((database) =>
      (
        database
          .prepare(
            `SELECT agent_session_id, title, pi_runtime_version, event_schema_version,
                    status, approval_mode, provider_preset_id, selected_model_id,
                    thinking_level,
                    created_at, updated_at, archived_at,
                    CASE
                      WHEN EXISTS (
                        SELECT 1 FROM agent_runs
                         WHERE agent_runs.agent_session_id = agent_sessions.agent_session_id
                           AND agent_runs.status = 'running'
                      ) THEN 'running'
                      WHEN EXISTS (
                        SELECT 1 FROM mutation_proposals
                         WHERE mutation_proposals.agent_session_id = agent_sessions.agent_session_id
                           AND mutation_proposals.status = 'generating'
                      ) THEN 'generating'
                      WHEN EXISTS (
                        SELECT 1 FROM mutation_proposals
                         WHERE mutation_proposals.agent_session_id = agent_sessions.agent_session_id
                           AND mutation_proposals.status = 'pending'
                      ) THEN 'awaiting_review'
                      ELSE 'idle'
                    END AS workflow_state
               FROM agent_sessions
              ${whereSql}
              ORDER BY updated_at DESC, agent_session_id DESC
              LIMIT ?`
          )
          .all(...values) as Array<{
          agent_session_id: string
          title: string
          pi_runtime_version: string
          event_schema_version: number
          status: 'active' | 'archived'
          approval_mode: AgentApprovalMode
          provider_preset_id: string | null
          selected_model_id: string | null
          thinking_level: AgentThinkingLevel
          workflow_state: 'idle' | 'running' | 'awaiting_review' | 'generating'
          created_at: string
          updated_at: string
          archived_at: string | null
        }>
      ).map((row) =>
        agentSessionRecordSchema.parse({
          agentSessionId: row.agent_session_id,
          title: row.title,
          status: row.status,
          compatible:
            row.pi_runtime_version === AGENT_RUNTIME_VERSION &&
            row.event_schema_version === AGENT_EVENT_SCHEMA_VERSION,
          approvalMode: row.approval_mode,
          workflowState: this.#sessionIsAwaitingInput(row.agent_session_id)
            ? 'awaiting_input'
            : this.#sessionIsCompacting(row.agent_session_id)
              ? 'compacting'
              : row.workflow_state,
          modelSelection:
            row.provider_preset_id === null || row.selected_model_id === null
              ? null
              : { presetId: row.provider_preset_id, modelId: row.selected_model_id },
          thinkingLevel: row.thinking_level,
          writingTask: this.options.writingTasks?.getView(row.agent_session_id, database) ?? null,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          archivedAt: row.archived_at
        })
      )
    )
  }

  async generateSessionTitle(agentSessionId: string): Promise<AgentSessionRecord> {
    this.#assertCompatibleSession(agentSessionId)
    this.#assertSessionIdle(agentSessionId, 'generating another title')
    const run = this.listRuns(agentSessionId, 1)[0]
    if (run === undefined) throw new Error('Send a message before generating a conversation title')
    const context = this.#loadSessionTitleContext(agentSessionId)
    if (context.length === 0) {
      throw new Error('Send a message before generating a conversation title')
    }
    const expectedTitle = this.#requireSessionRecord(agentSessionId).title
    const controller = new AbortController()
    const completion = this.#withSessionProvider(
      agentSessionId,
      async (config, credential, resolved) => {
        const modelLimits =
          (await this.options.resolveModelLimits?.(config, controller.signal)) ??
          legacyModelLimits()
        return this.#executeTitleRequest({
          agentSessionId,
          agentRunId: run.agentRunId,
          operationId: this.#createId(),
          config,
          credential,
          modelLimits,
          context,
          expectedTitle,
          controller,
          automatic: false,
          reasoningModel: resolved?.model.reasoning ?? false
        })
      }
    )
    return this.#trackTitleRequest(agentSessionId, controller, completion)
  }

  archiveSession(agentSessionId: string): AgentSessionRecord {
    const current = this.#requireSessionRecord(agentSessionId)
    if (current.status === 'archived') return current
    this.#assertSessionIdle(agentSessionId, 'archive')
    const now = this.#now().toISOString()
    this.options.database.immediate((database) => {
      const result = database
        .prepare(
          `UPDATE agent_sessions
              SET status = 'archived', archived_at = ?, updated_at = ?
            WHERE agent_session_id = ? AND status = 'active'`
        )
        .run(now, now, agentSessionId)
      if (result.changes !== 1) throw new Error('Agent session could not be archived')
    })
    const archived = this.#requireSessionRecord(agentSessionId)
    this.options.log.info(
      { event: 'agent.session.archived', agentSessionId },
      'Agent session archived'
    )
    void this.#publishSession(archived, false)
    return archived
  }

  restoreSession(agentSessionId: string): AgentSessionRecord {
    const current = this.#requireSessionRecord(agentSessionId)
    if (current.status === 'active') return current
    const now = this.#now().toISOString()
    this.options.database.immediate((database) => {
      const result = database
        .prepare(
          `UPDATE agent_sessions
              SET status = 'active', archived_at = NULL, updated_at = ?
            WHERE agent_session_id = ? AND status = 'archived'`
        )
        .run(now, agentSessionId)
      if (result.changes !== 1) throw new Error('Agent session could not be restored')
    })
    const restored = this.#requireSessionRecord(agentSessionId)
    this.options.log.info(
      { event: 'agent.session.restored', agentSessionId },
      'Agent session restored'
    )
    void this.#publishSession(restored, false)
    return restored
  }

  setApprovalMode(agentSessionId: string, mode: AgentApprovalMode): AgentSessionRecord {
    this.#assertCompatibleSession(agentSessionId)
    const now = this.#now().toISOString()
    this.options.database.immediate((database) => {
      database
        .prepare(
          'UPDATE agent_sessions SET approval_mode = ?, updated_at = ? WHERE agent_session_id = ?'
        )
        .run(mode, now, agentSessionId)
    })
    const session = this.listSessions().find((item) => item.agentSessionId === agentSessionId)
    if (session === undefined) throw new Error('Agent session does not exist')
    this.options.log.info(
      { event: 'agent.session.approval_mode_updated', agentSessionId, mode },
      'Agent session approval mode updated'
    )
    return session
  }

  setModelSelection(
    agentSessionId: string,
    selection: AgentModelSelection,
    thinkingLevel: AgentThinkingLevel = 'off'
  ): AgentSessionRecord {
    if (this.#workBySession.has(agentSessionId)) {
      throw new Error('Agent model cannot change while a run is active')
    }
    this.#assertCompatibleSession(agentSessionId)
    this.#assertConversationReady(agentSessionId)
    const now = this.#now().toISOString()
    this.options.database.immediate((database) => {
      database
        .prepare(
          `UPDATE agent_sessions
              SET provider_preset_id = ?, selected_model_id = ?, thinking_level = ?, updated_at = ?
            WHERE agent_session_id = ?`
        )
        .run(selection.presetId, selection.modelId, thinkingLevel, now, agentSessionId)
    })
    const session = this.listSessions().find((item) => item.agentSessionId === agentSessionId)
    if (session === undefined) throw new Error('Agent session does not exist')
    this.options.log.info(
      {
        event: 'agent.session.model_selection_updated',
        agentSessionId,
        presetId: selection.presetId,
        modelId: selection.modelId,
        thinkingLevel
      },
      'Agent session model selection updated'
    )
    return session
  }

  setThinkingLevel(agentSessionId: string, level: AgentThinkingLevel): AgentSessionRecord {
    if (this.#workBySession.has(agentSessionId)) {
      throw new Error('Agent Thinking level cannot change while a run is active')
    }
    this.#assertCompatibleSession(agentSessionId)
    this.#assertConversationReady(agentSessionId)
    const thinkingLevel = agentThinkingLevelSchema.parse(level)
    const now = this.#now().toISOString()
    this.options.database.immediate((database) => {
      database
        .prepare(
          'UPDATE agent_sessions SET thinking_level = ?, updated_at = ? WHERE agent_session_id = ?'
        )
        .run(thinkingLevel, now, agentSessionId)
    })
    const session = this.listSessions().find((item) => item.agentSessionId === agentSessionId)
    if (session === undefined) throw new Error('Agent session does not exist')
    this.options.log.info(
      { event: 'agent.session.thinking_level_updated', agentSessionId, thinkingLevel },
      'Agent session Thinking level updated'
    )
    return session
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
    const candidateRows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT agent_event_id, agent_session_id, agent_run_id, sequence, type,
                    length(CAST(payload_json AS BLOB)) AS payload_bytes, model_request_id,
                    created_at
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
          payload_bytes: number
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
        : this.options.database.immediate((database) => {
            const placeholders = selectedRows.map(() => '?').join(', ')
            const payloadRows = database
              .prepare(
                `SELECT agent_event_id, payload_json
                   FROM agent_events
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
    return this.options.database.immediate((database) =>
      (
        database
          .prepare(
            `SELECT run.agent_run_id, run.agent_session_id, run.status, run.provider_id, run.model_id,
                    run.provider_preset_id, run.provider_label, run.model_label, run.api_id,
                    run.approval_mode, run.thinking_level, run.model_limits_json,
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
      ).map((row) =>
        agentRunRecordSchema.parse({
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
          thinkingLevel: row.thinking_level,
          modelLimits: JSON.parse(row.model_limits_json),
          editorContext: JSON.parse(row.editor_context_json),
          skillSnapshot: skillRunSnapshotSchema.parse(JSON.parse(row.skill_snapshot_json)),
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
          errorCode: safeErrorCode(row.error_json),
          writingTaskId: row.writing_task_id,
          writingTaskStepId: row.writing_task_step_id,
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

  startRun(input: {
    agentSessionId: string
    prompt: string
    editorContext: AgentEditorContext
    systemPrompt?: string
    maxOutputTokens?: number
    temperature?: number
    operationId?: string
    reuseSkillSnapshot?: SkillRunSnapshot
    presentation?: AgentUserMessagePayload['presentation']
  }): Promise<StartedAgentRun> {
    try {
      const prompt = agentUserMessagePayloadSchema.shape.content.parse(input.prompt)
      const editorContext = agentEditorContextSchema.parse(input.editorContext)
      const operationId = input.operationId ?? this.#createId()
      const agentRunId = this.#createId()
      const controller = new AbortController()
      this.#assertCompatibleSession(input.agentSessionId)
      this.#assertConversationReady(input.agentSessionId)
      this.#reserveRunSlot(input.agentSessionId, agentRunId, controller)
      const starting: StartingRun = {
        agentSessionId: input.agentSessionId,
        agentRunId,
        startedAt: this.#now().toISOString(),
        controller,
        completion: Promise.resolve({ agentRunId, completion: Promise.resolve() })
      }
      this.#startingRuns.set(agentRunId, starting)
      void this.#publishActivitySnapshot()
      starting.completion = this.#startReservedRun({
        ...input,
        prompt,
        editorContext,
        operationId,
        agentRunId,
        controller
      }).finally(() => {
        this.#startingRuns.delete(agentRunId)
        if (!this.#activeRuns.has(agentRunId)) {
          this.#releaseRunSlot(input.agentSessionId, agentRunId)
        }
      })
      return starting.completion
    } catch (err) {
      return Promise.reject(err)
    }
  }

  async #startReservedRun(input: {
    agentSessionId: string
    prompt: string
    editorContext: AgentEditorContext
    systemPrompt?: string
    maxOutputTokens?: number
    temperature?: number
    reuseSkillSnapshot?: SkillRunSnapshot
    presentation?: AgentUserMessagePayload['presentation']
    operationId: string
    agentRunId: string
    controller: AbortController
  }): Promise<StartedAgentRun> {
    input.controller.signal.throwIfAborted()
    input.controller.signal.throwIfAborted()
    return withLogContext(
      {
        operationId: input.operationId,
        projectId: this.options.projectId,
        projectSessionId: this.options.projectSessionId,
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId
      },
      () =>
        this.#withSessionProvider(input.agentSessionId, async (config, credential, resolved) => {
          const modelLimits =
            (await this.options.resolveModelLimits?.(config, input.controller.signal)) ??
            legacyModelLimits()
          const maxOutputTokens = agentOutputLimit(input.maxOutputTokens ?? 8_192, modelLimits)
          agentMessageBudget(maxOutputTokens, modelLimits)
          const approvalMode = this.#sessionApprovalMode(input.agentSessionId)
          const storedThinkingLevel = this.#sessionThinkingLevel(input.agentSessionId)
          const thinkingLevel =
            resolved === undefined
              ? 'off'
              : clampResolvedAgentThinkingLevel(resolved, storedThinkingLevel)
          if (thinkingLevel !== storedThinkingLevel) {
            this.#reconcileThinkingLevel(input.agentSessionId, storedThinkingLevel, thinkingLevel)
          }
          const runtimeModel =
            resolved === undefined ? undefined : runtimeModelFromCatalog(resolved)
          const now = this.#now()
          const automaticTitle = this.#insertRunAndUserEvent({
            agentSessionId: input.agentSessionId,
            agentRunId: input.agentRunId,
            config,
            editorContext: input.editorContext,
            prompt: input.prompt,
            approvalMode,
            thinkingLevel,
            modelLimits,
            presentation: input.presentation,
            now
          })
          const active: ActiveRun = {
            agentSessionId: input.agentSessionId,
            agentRunId: input.agentRunId,
            operationId: input.operationId,
            controller: input.controller,
            handle: null,
            phase: 'routing',
            config,
            editorContext: input.editorContext,
            approvalMode,
            thinkingLevel,
            runtimeModel,
            modelLimits,
            credential,
            currentRequest: input.prompt,
            maxOutputTokens,
            ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
            authorizedModelRequestIds: new Set(),
            pendingModelRequestIds: new Set(),
            pendingMessages: [],
            snapshots: new Map(),
            skillSnapshot: pendingSkillSnapshot(),
            skillState: null,
            skillPrompt: { mode: 'auto', mandatory: '', references: [] },
            systemPrompt: input.systemPrompt ?? FALLBACK_AGENT_SYSTEM_PROMPT,
            partialText: '',
            reviewPause: null,
            pendingQuestion: null,
            overflowRetryAttempted: false,
            completion: Promise.resolve()
          }
          let markPrepared: () => void = () => undefined
          const prepared = new Promise<void>((resolve) => {
            markPrepared = resolve
          })
          active.completion = this.#prepareAndRun(active, {
            credential,
            prompt: input.prompt,
            reuseSkillSnapshot: input.reuseSkillSnapshot,
            maxOutputTokens,
            ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
            markPrepared
          })
            .catch((err) => {
              markPrepared()
              return this.#settleSetupFailure(active, err)
            })
            .finally(() => {
              if (this.#activeRuns.get(active.agentRunId) === active) {
                this.#activeRuns.delete(active.agentRunId)
              }
              this.#releaseRunSlot(active.agentSessionId, active.agentRunId)
            })
          this.#activeRuns.set(active.agentRunId, active)
          void this.#publishActivitySnapshot()
          void this.#publishSession(
            input.agentSessionId,
            automaticTitle !== null && this.options.generateTitle !== undefined
          )
          if (automaticTitle !== null) {
            if (this.options.generateTitle !== undefined) {
              const titleController = new AbortController()
              void this.#beginTitleRequest({
                agentSessionId: input.agentSessionId,
                agentRunId: input.agentRunId,
                operationId: input.operationId,
                config,
                credential,
                modelLimits,
                context: buildSessionTitleContext([
                  { sequence: 1, role: 'user', content: input.prompt }
                ]),
                expectedTitle: automaticTitle,
                controller: titleController,
                automatic: true,
                reasoningModel: resolved?.model.reasoning ?? false
              }).catch(() => undefined)
            }
          }
          this.options.log.info(
            {
              event: 'agent.run.started',
              agentSessionId: input.agentSessionId,
              agentRunId: input.agentRunId,
              phase: 'skill_preparation',
              thinkingLevel,
              activeCount: this.#workBySession.size,
              concurrencyLimit: MAX_CONCURRENT_AGENT_RUNS
            },
            'Agent run started and entered writing skill preparation'
          )
          // Legacy/test integrations without a skill runtime have no observable preparation phase.
          // Keep their existing ready-on-return contract while production returns immediately.
          if (this.options.skillRouter === undefined) await prepared
          return { agentRunId: input.agentRunId, completion: active.completion }
        })
    )
  }

  async #prepareAndRun(
    active: ActiveRun,
    input: {
      credential: string
      prompt: string
      reuseSkillSnapshot?: SkillRunSnapshot
      maxOutputTokens: number
      temperature?: number
      markPrepared: () => void
    }
  ): Promise<void> {
    if (this.options.skillRouter !== undefined) {
      try {
        const routed = await this.options.skillRouter.route({
          reuseSnapshot: input.reuseSkillSnapshot,
          userPrompt: input.prompt,
          config: active.config,
          credential: input.credential,
          modelLimits: active.modelLimits,
          database: this.options.database,
          operationId: active.operationId,
          agentRunId: active.agentRunId,
          projectSessionId: this.options.projectSessionId,
          signal: active.controller.signal,
          createId: this.#createId,
          now: this.#now
        })
        active.skillSnapshot = routed.snapshot
        active.skillPrompt = routed.prompt
        active.skillState = routed.state ?? null
      } catch (err) {
        throw new AgentRunSetupError(
          active.controller.signal.aborted
            ? 'user_stopped'
            : err instanceof SkillRouteError
              ? err.code
              : 'skill_route_failed',
          err
        )
      }
    } else {
      active.skillSnapshot = { ...active.skillSnapshot, routingStatus: 'not_needed' }
    }
    active.controller.signal.throwIfAborted()
    this.#updateSkillSnapshot(active.agentRunId, active.skillSnapshot)

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
          provider: active.config,
          request: {
            prompt: input.prompt,
            delivery: 'prompt'
          },
          thinkingLevel: active.thinkingLevel,
          inputItems: 1,
          operationId: active.operationId,
          agentRunId: active.agentRunId,
          projectSessionId: this.options.projectSessionId
        })
      ).modelRequestId
    } catch (err) {
      throw new AgentRunSetupError('model_request_start_failed', err)
    }
    active.authorizedModelRequestIds.add(modelRequestId)
    active.pendingModelRequestIds.add(modelRequestId)
    const initialEvent = this.#linkInitialUserEvent(
      active.agentSessionId,
      active.agentRunId,
      modelRequestId
    )
    await this.#publishDurable(initialEvent)

    let builtContext: ReturnType<AgentContextBuilder['build']> | undefined
    try {
      builtContext = this.options.contextBuilder?.build({
        prompt: input.prompt,
        editorContext: active.editorContext,
        snapshotId: modelRequestId,
        skillPrompt: active.skillPrompt
      })
    } catch (err) {
      throw new AgentRunSetupError(
        err instanceof SkillPromptBudgetError
          ? 'skill_prompt_budget_exceeded'
          : 'agent_context_failed',
        err
      )
    }
    if (builtContext?.skillPromptDropped === true) {
      active.skillSnapshot = {
        schemaVersion: 3,
        mode: 'auto',
        routingStatus: 'degraded',
        requestedSkills: [],
        skills: [],
        dependencies: [],
        resources: [],
        safeError: 'skill_prompt_budget_exceeded'
      }
      active.skillPrompt = { mode: 'auto', mandatory: '', references: [] }
    } else if (builtContext !== undefined) {
      this.#retainIncludedSkillResources(active, builtContext.includedSkillResources)
      active.snapshots.set(modelRequestId, builtContext.snapshot)
    }
    this.#updateSkillSnapshot(active.agentRunId, active.skillSnapshot)
    active.systemPrompt =
      builtContext?.systemPrompt ?? active.systemPrompt ?? FALLBACK_AGENT_SYSTEM_PROMPT
    let history: AgentHistoryMessage[]
    const currentRequest = builtContext?.userRequest ?? input.prompt
    active.currentRequest = currentRequest
    try {
      history = await this.#prepareRuntimeHistory({
        active,
        credential: input.credential,
        currentRequest,
        maxOutputTokens: input.maxOutputTokens
      })
    } catch (err) {
      throw new AgentRunSetupError(
        active.controller.signal.aborted
          ? 'user_stopped'
          : err instanceof AgentCurrentTurnTooLargeError
            ? 'current_turn_too_large'
            : err instanceof AgentCompactionRequiredError
              ? 'compaction_required'
              : 'agent_context_failed',
        err
      )
    }
    active.controller.signal.throwIfAborted()
    active.handle = this.options.runtime.beginSessionRun(
      active.config,
      input.credential,
      {
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        modelRequestId,
        systemPrompt: active.systemPrompt,
        history,
        prompt: currentRequest,
        maxOutputTokens: input.maxOutputTokens,
        modelLimits: active.modelLimits,
        thinkingLevel: active.thinkingLevel,
        ...(active.runtimeModel === undefined ? {} : { runtimeModel: active.runtimeModel }),
        ...(input.temperature === undefined ? {} : { temperature: input.temperature })
      },
      active.controller.signal,
      (event) => this.#handleRuntimeEvent(active.agentRunId, event),
      (request, signal) => this.#handleToolRequest(active.agentRunId, request, signal)
    )
    active.phase = 'running'
    input.markPrepared()
    this.options.log.info(
      {
        event: 'skill.route.completed',
        agentRunId: active.agentRunId,
        routingStatus: active.skillSnapshot.routingStatus,
        skillIds: active.skillSnapshot.skills.map((skill) => skill.skillId)
      },
      'Writing skill routing completed'
    )
    await this.#settleRun(active)
  }

  async #settleSetupFailure(active: ActiveRun, err: unknown): Promise<void> {
    this.options.log.error(
      { event: 'agent.run.setup_failed', err, agentRunId: active.agentRunId, phase: active.phase },
      'Agent run failed before provider generation started'
    )
    await this.#abortPendingModelRequests(active, 'agent_run_setup_failed')
    const cancellation = classifyRunFailure(err, active.controller.signal)
    const code = err instanceof AgentRunSetupError ? err.code : cancellation.code
    const status = active.controller.signal.aborted ? cancellation.status : 'failed'
    const current = this.requireRun(active.agentRunId)
    if (current.status !== 'running') return
    if (active.skillSnapshot.routingStatus === 'pending') {
      active.skillSnapshot = { ...active.skillSnapshot, routingStatus: 'failed', safeError: code }
      this.#updateSkillSnapshot(active.agentRunId, active.skillSnapshot)
    }
    // The initial user event is persisted at run start but normally published only after
    // routing; publish it here so a setup failure still shows the prompt in the timeline.
    const initialUserEvent = this.#unlinkedInitialUserEvent(
      active.agentSessionId,
      active.agentRunId
    )
    if (initialUserEvent !== null) await this.#publishDurable(initialUserEvent)
    await this.#finishRunAndAppendEvent({
      agentRunId: active.agentRunId,
      agentSessionId: active.agentSessionId,
      status,
      error: { code },
      eventPayload: { code, status }
    })
  }

  async steer(agentRunId: string, content: string): Promise<void> {
    return this.#queueSteer(agentRunId, content)
  }

  async followUp(agentRunId: string, content: string): Promise<void> {
    const active = this.#requireQueueableRun(agentRunId)
    const parsedContent = agentUserMessagePayloadSchema.shape.content.parse(content)
    if (active.pendingMessages.length >= AGENT_PENDING_MESSAGE_LIMIT) {
      throw new Error(`Up to ${AGENT_PENDING_MESSAGE_LIMIT} messages can wait in this run`)
    }
    const queuedBytes = active.pendingMessages.reduce(
      (total, message) => total + new TextEncoder().encode(message.content).byteLength,
      0
    )
    if (
      queuedBytes + new TextEncoder().encode(parsedContent).byteLength >
      AGENT_PENDING_MESSAGE_MAX_BYTES
    ) {
      throw new Error('Waiting messages cannot exceed 1 MiB in this run')
    }
    const timestamp = this.#now().getTime()
    const queuedAt = this.#now().toISOString()
    const pendingMessageId = this.#createId()
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    const modelRequestId = (
      await repository.start({
        operation: 'agent',
        provider: active.config,
        request: { content: parsedContent, delivery: 'follow_up' },
        thinkingLevel: active.thinkingLevel,
        inputItems: 1,
        operationId: active.operationId,
        agentRunId: active.agentRunId,
        projectSessionId: this.options.projectSessionId
      })
    ).modelRequestId
    const refreshedContext = this.options.contextBuilder?.build({
      prompt: parsedContent,
      editorContext: active.editorContext,
      snapshotId: modelRequestId,
      skillPrompt: active.skillPrompt
    })
    if (refreshedContext !== undefined) {
      this.#retainIncludedSkillResources(active, refreshedContext.includedSkillResources)
    }
    const pending: PendingFollowUpMessage = {
      pendingMessageId,
      modelRequestId,
      content: parsedContent,
      timestamp,
      queuedAt,
      systemPrompt: refreshedContext?.systemPrompt ?? active.systemPrompt,
      ...(refreshedContext === undefined ? {} : { snapshot: refreshedContext.snapshot })
    }
    active.pendingMessages.push(pending)
    active.pendingModelRequestIds.add(modelRequestId)
    active.authorizedModelRequestIds.add(modelRequestId)
    if (pending.snapshot !== undefined) active.snapshots.set(modelRequestId, pending.snapshot)
    try {
      active.handle.followUp({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        pendingMessageId,
        modelRequestId,
        content: parsedContent,
        timestamp,
        systemPrompt: pending.systemPrompt
      })
    } catch (err) {
      this.options.log.error(
        { event: 'agent.run.follow_up_queue_failed', err, agentRunId, modelRequestId },
        'Failed to queue an Agent Follow-up'
      )
      active.pendingMessages.splice(active.pendingMessages.indexOf(pending), 1)
      active.pendingModelRequestIds.delete(modelRequestId)
      active.authorizedModelRequestIds.delete(modelRequestId)
      active.snapshots.delete(modelRequestId)
      await repository.abort(modelRequestId, 'queue_delivery_failed')
      active.controller.abort(err)
      throw err
    }
    await this.#publishActivitySnapshot()
    this.options.log.info(
      {
        event: 'agent.run.follow_up_queued',
        agentRunId,
        pendingMessageId,
        modelRequestId,
        pendingCount: active.pendingMessages.length,
        pendingBytes: queuedBytes + new TextEncoder().encode(parsedContent).byteLength
      },
      'Queued an Agent Follow-up'
    )
  }

  async deletePendingFollowUp(agentRunId: string, pendingMessageId: string): Promise<void> {
    const active = this.#requireQueueableRun(agentRunId)
    const pending = this.#requirePendingMessage(active, pendingMessageId)
    const actionId = this.#createId()
    const outcome = await active.handle.queueAction({
      operation: 'delete_follow_up',
      projectSessionId: this.options.projectSessionId,
      agentSessionId: active.agentSessionId,
      agentRunId: active.agentRunId,
      actionId,
      pendingMessageId
    })
    if (outcome !== 'completed') throw new Error('The waiting message is already being processed')
    this.#removePendingMessage(active, pendingMessageId)
    await new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    ).abort(pending.modelRequestId, 'queue_deleted')
    active.pendingModelRequestIds.delete(pending.modelRequestId)
    active.authorizedModelRequestIds.delete(pending.modelRequestId)
    active.snapshots.delete(pending.modelRequestId)
    await this.#publishActivitySnapshot()
    this.options.log.info(
      {
        event: 'agent.run.follow_up_deleted',
        agentRunId,
        pendingMessageId,
        modelRequestId: pending.modelRequestId,
        pendingCount: active.pendingMessages.length
      },
      'Deleted a pending Agent Follow-up'
    )
  }

  async steerPendingFollowUp(agentRunId: string, pendingMessageId: string): Promise<void> {
    const active = this.#requireQueueableRun(agentRunId)
    const pending = this.#requirePendingMessage(active, pendingMessageId)
    const reservationId = this.#createId()
    const reserved = await active.handle.queueAction({
      operation: 'reserve_follow_up',
      projectSessionId: this.options.projectSessionId,
      agentSessionId: active.agentSessionId,
      agentRunId: active.agentRunId,
      actionId: reservationId,
      pendingMessageId
    })
    if (reserved !== 'completed') throw new Error('The waiting message is already being processed')
    this.#removePendingMessage(active, pendingMessageId)
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    await repository.abort(pending.modelRequestId, 'queue_promoted_to_steer')
    active.pendingModelRequestIds.delete(pending.modelRequestId)
    active.authorizedModelRequestIds.delete(pending.modelRequestId)
    active.snapshots.delete(pending.modelRequestId)
    let modelRequestId: string | undefined
    try {
      modelRequestId = (
        await repository.start({
          operation: 'agent',
          provider: active.config,
          request: { content: pending.content, delivery: 'steer' },
          thinkingLevel: active.thinkingLevel,
          inputItems: 1,
          operationId: active.operationId,
          agentRunId: active.agentRunId,
          projectSessionId: this.options.projectSessionId
        })
      ).modelRequestId
      active.pendingModelRequestIds.add(modelRequestId)
      active.authorizedModelRequestIds.add(modelRequestId)
      if (pending.snapshot !== undefined) active.snapshots.set(modelRequestId, pending.snapshot)
      await this.#appendAndPublishEvent({
        sessionId: active.agentSessionId,
        runId: active.agentRunId,
        type: 'user_message',
        payload: agentUserMessagePayloadSchema.parse({
          content: pending.content,
          delivery: 'steer',
          timestamp: pending.timestamp
        }),
        modelRequestId
      })
      const outcome = await active.handle.queueAction({
        operation: 'commit_follow_up_steer',
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        actionId: this.#createId(),
        reservationId,
        modelRequestId,
        systemPrompt: pending.systemPrompt
      })
      if (outcome !== 'completed') throw new Error('The waiting message could not be steered')
      await this.#publishActivitySnapshot()
      this.options.log.info(
        {
          event: 'agent.run.follow_up_promoted',
          agentRunId,
          pendingMessageId,
          modelRequestId,
          pendingCount: active.pendingMessages.length
        },
        'Promoted a pending Agent Follow-up to Steer'
      )
    } catch (err) {
      this.options.log.error(
        { event: 'agent.run.follow_up_steer_failed', err, agentRunId, pendingMessageId },
        'Failed to promote an Agent Follow-up to Steer'
      )
      if (modelRequestId !== undefined) {
        await repository.abort(modelRequestId, 'queue_promotion_failed')
        active.pendingModelRequestIds.delete(modelRequestId)
        active.authorizedModelRequestIds.delete(modelRequestId)
        active.snapshots.delete(modelRequestId)
      }
      active.controller.abort(err)
      throw err
    }
  }

  async abort(agentRunId: string): Promise<void> {
    const active = this.#activeRuns.get(agentRunId)
    if (active === undefined) {
      const run = this.requireRun(agentRunId)
      if (run.status !== 'running') return
      throw new Error('Agent run is not active')
    }
    active.controller.abort(
      new AgentRunCancellationError('user_stopped', 'Agent run stopped by user')
    )
    this.options.log.info(
      {
        event: 'agent.run.stop_requested',
        agentSessionId: active.agentSessionId,
        agentRunId,
        activeCount: this.#workBySession.size
      },
      'Agent run stop requested'
    )
    await active.completion
  }

  async answerUserQuestion(input: {
    agentSessionId: string
    agentRunId: string
    toolCallId: string
    answers: AskUserAnswer[]
  }): Promise<void> {
    const active = this.#requireActive(input.agentRunId)
    if (active.agentSessionId !== input.agentSessionId) {
      throw new Error('Agent clarification capability mismatch')
    }
    const pending = active.pendingQuestion
    if (pending === null || pending.toolCallId !== input.toolCallId) {
      throw new Error('Agent clarification is no longer pending')
    }
    if (pending.submitting) throw new Error('Agent clarification answer is already being submitted')
    const result = askUserResultSchema.parse({ answers: input.answers })
    if (result.answers.length !== pending.args.questions.length) {
      throw new Error('Every pending Agent question must be answered exactly once')
    }
    for (const [index, question] of pending.args.questions.entries()) {
      const answer = result.answers[index]
      if (answer?.questionId !== question.id) {
        throw new Error('Agent clarification answers must preserve question order and identity')
      }
      if (
        answer.kind === 'option' &&
        !question.options.some((option) => option.label === answer.value)
      ) {
        throw new Error('Agent clarification option is not available')
      }
    }
    pending.submitting = true
    await this.#publishActivitySnapshot()
    try {
      await this.#appendAndPublishEvent({
        sessionId: active.agentSessionId,
        runId: active.agentRunId,
        type: 'user_message',
        payload: agentUserMessagePayloadSchema.parse({
          content: clarificationHistoryMessage(result),
          delivery: 'clarification',
          timestamp: this.#now().getTime(),
          presentation: {
            kind: 'clarification_answer',
            toolCallId: pending.toolCallId
          }
        }),
        modelRequestId: pending.modelRequestId
      })
    } catch (err) {
      pending.submitting = false
      await this.#publishActivitySnapshot()
      throw err
    }
    this.options.log.info(
      {
        event: 'agent.question.answer_received',
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        toolCallId: pending.toolCallId,
        questionCount: pending.args.questions.length,
        answerKinds: result.answers.map((answer) => answer.kind),
        durationMs: Math.max(0, this.#now().getTime() - Date.parse(pending.startedAt))
      },
      'Received a bounded Agent clarification answer'
    )
    pending.resolveAnswers(result)
    const completion = await pending.completion
    if (!completion.ok) throw new Error('Agent clarification answer could not be delivered')
  }

  async compactSession(agentSessionId: string): Promise<{ compactionId: string }> {
    this.#assertCompatibleSession(agentSessionId)
    this.#assertSessionIdle(agentSessionId, 'compressing earlier conversation')
    this.#assertConversationReady(agentSessionId)
    if (buildNextCompactionMaterial({ database: this.options.database, agentSessionId }) === null) {
      throw new Error('This conversation does not yet have an earlier completed turn to compress')
    }
    const compactionId = this.#createId()
    const controller = new AbortController()
    this.#reserveWorkSlot(agentSessionId, compactionId, 'manual_compaction', controller)
    const active: ActiveCompaction = {
      compactionId,
      agentSessionId,
      trigger: 'manual',
      phase: 'planning',
      startedAt: this.#now().toISOString(),
      controller,
      completion: Promise.resolve()
    }
    this.#activeCompactions.set(compactionId, active)
    try {
      await this.#appendCompactionStarted({
        agentSessionId,
        agentRunId: null,
        compactionId,
        trigger: 'manual'
      })
    } catch (err) {
      this.#activeCompactions.delete(compactionId)
      this.#releaseWorkSlot(agentSessionId, compactionId, 'manual_compaction')
      throw err
    }
    active.completion = this.#executeManualCompaction(active).finally(() => {
      if (this.#activeCompactions.get(compactionId) === active) {
        this.#activeCompactions.delete(compactionId)
      }
      this.#releaseWorkSlot(agentSessionId, compactionId, 'manual_compaction')
      void this.#publishSession(agentSessionId, false)
    })
    void this.#publishActivitySnapshot()
    await this.#publishSession(agentSessionId, false)
    void active.completion.catch(() => undefined)
    return { compactionId }
  }

  async stopCompaction(agentSessionId: string, compactionId: string): Promise<void> {
    const active = this.#activeCompactions.get(compactionId)
    if (active === undefined || active.agentSessionId !== agentSessionId) {
      throw new Error('Conversation compaction is not active')
    }
    active.controller.abort(new Error('Conversation compaction stopped by user'))
    await active.completion
  }

  async #executeManualCompaction(active: ActiveCompaction): Promise<void> {
    try {
      await this.#withSessionProvider(active.agentSessionId, async (config, credential) => {
        const modelLimits =
          (await this.options.resolveModelLimits?.(config, active.controller.signal)) ??
          legacyModelLimits()
        const budgets = agentCompactionBudgets(agentMessageBudget(8_192, modelLimits))
        active.phase = 'summarizing'
        void this.#publishActivitySnapshot()
        const steps = await this.#runRollingCompaction({
          agentSessionId: active.agentSessionId,
          agentRunId: null,
          compactionId: active.compactionId,
          trigger: 'manual',
          config,
          credential,
          modelLimits,
          signal: active.controller.signal,
          maxSteps: 8,
          ...budgets
        })
        if (steps === 0)
          throw new Error('Conversation compaction had no complete head to summarize')
      })
      this.options.log.info(
        {
          event: 'agent.compaction.manual_completed',
          agentSessionId: active.agentSessionId,
          compactionId: active.compactionId
        },
        'Manual Agent context compaction completed'
      )
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.compaction.manual_failed',
          err,
          agentSessionId: active.agentSessionId,
          compactionId: active.compactionId
        },
        'Manual Agent context compaction failed'
      )
      await this.#appendCompactionFailed({
        agentSessionId: active.agentSessionId,
        agentRunId: null,
        compactionId: active.compactionId,
        trigger: 'manual',
        code: active.controller.signal.aborted ? 'aborted' : 'compaction_failed',
        retryable: !active.controller.signal.aborted,
        aborted: active.controller.signal.aborted
      })
    }
  }

  async close(): Promise<void> {
    const cancellation = new AgentRunCancellationError('project_closed', 'Project is closing')
    const startingRuns = [...this.#startingRuns.values()]
    for (const starting of startingRuns) starting.controller.abort(cancellation)
    for (const active of this.#activeRuns.values()) active.controller.abort(cancellation)
    const titleRequests = [...this.#titleRequests.values()]
    for (const request of titleRequests) {
      request.controller.abort(new Error('Project is closing'))
    }
    const compactions = [...this.#activeCompactions.values()]
    for (const compaction of compactions) {
      compaction.controller.abort(new Error('Project is closing'))
    }
    await Promise.allSettled(startingRuns.map((starting) => starting.completion))
    const activeRuns = [...this.#activeRuns.values()]
    for (const active of activeRuns) active.controller.abort(cancellation)
    await Promise.allSettled([
      ...activeRuns.map((active) => active.completion),
      ...titleRequests.map((request) => request.completion),
      ...compactions.map((compaction) => compaction.completion)
    ])
  }

  projectActivitySnapshot(): AgentProjectActivitySnapshot {
    const activeRuns = [...this.#activeRuns.values()].map((active) => {
      const persisted = this.requireRun(active.agentRunId)
      return {
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        phase: active.phase,
        partialText: truncateUtf8(active.partialText, AGENT_LIVE_PARTIAL_MAX_BYTES),
        pendingMessages: active.pendingMessages.map((message) => ({
          pendingMessageId: message.pendingMessageId,
          content: message.content,
          queuedAt: message.queuedAt
        })),
        pendingQuestion:
          active.pendingQuestion === null
            ? null
            : {
                toolCallId: active.pendingQuestion.toolCallId,
                questions: active.pendingQuestion.args.questions,
                submitting: active.pendingQuestion.submitting,
                startedAt: active.pendingQuestion.startedAt
              },
        startedAt: persisted.startedAt
      }
    })
    const startingRuns = [...this.#startingRuns.values()]
      .filter((starting) => !this.#activeRuns.has(starting.agentRunId))
      .map((starting) => ({
        agentSessionId: starting.agentSessionId,
        agentRunId: starting.agentRunId,
        phase: 'routing' as const,
        partialText: '',
        pendingMessages: [],
        startedAt: starting.startedAt
      }))
    const compactions = [...this.#activeCompactions.values()].map((compaction) => ({
      compactionId: compaction.compactionId,
      agentSessionId: compaction.agentSessionId,
      trigger: compaction.trigger,
      phase: compaction.phase,
      startedAt: compaction.startedAt
    }))
    return agentProjectActivitySnapshotSchema.parse({
      limit: MAX_CONCURRENT_AGENT_RUNS,
      activeCount: this.#workBySession.size,
      runs: [...startingRuns, ...activeRuns],
      compactions
    })
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
    this.#recoverInterruptedCompactions()
    return recovered
  }

  #recoverInterruptedCompactions(): number {
    const now = this.#now()
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT started.agent_session_id, started.agent_run_id,
                    json_extract(started.payload_json, '$.compactionId') AS compaction_id,
                    json_extract(started.payload_json, '$.trigger') AS trigger
               FROM agent_events AS started
              WHERE started.type = 'compaction_started'
                AND NOT EXISTS (
                  SELECT 1 FROM agent_events AS terminal
                   WHERE terminal.agent_session_id = started.agent_session_id
                     AND (
                       terminal.type = 'compaction_failed'
                       OR (
                         terminal.type = 'compaction_summary'
                         AND json_extract(terminal.payload_json, '$.finalStep') = 1
                       )
                     )
                     AND json_extract(terminal.payload_json, '$.compactionId') =
                         json_extract(started.payload_json, '$.compactionId')
                )`
          )
          .all() as Array<{
          agent_session_id: string
          agent_run_id: string | null
          compaction_id: string
          trigger: AgentCompactionTrigger
        }>
    )
    for (const row of rows) {
      this.options.database.immediate((database) => {
        insertEvent(database, {
          eventId: this.#createId(),
          sessionId: row.agent_session_id,
          runId: row.agent_run_id,
          type: 'compaction_failed',
          payload: agentCompactionFailedPayloadSchema.parse({
            schemaVersion: 2,
            compactionId: row.compaction_id,
            trigger: row.trigger,
            code: 'process_restarted',
            retryable: true,
            aborted: true,
            timestamp: now.getTime()
          }),
          modelRequestId: null,
          createdAt: now.toISOString()
        })
      })
    }
    if (rows.length > 0) {
      this.options.log.warn(
        { event: 'agent.compaction.recovered', count: rows.length },
        'Recovered interrupted Agent context compactions'
      )
    }
    return rows.length
  }

  async recordApprovalDecision(input: {
    agentSessionId: string
    agentRunId: string
    proposalId: string
    decision: 'approved' | 'rejected'
    continueRequested: boolean
  }): Promise<void> {
    const run = this.requireRun(input.agentRunId)
    if (run.agentSessionId !== input.agentSessionId) {
      throw new Error('Approval decision does not belong to the Agent run')
    }
    await this.#appendAndPublishEvent({
      sessionId: input.agentSessionId,
      runId: input.agentRunId,
      type: 'approval_decision',
      payload: {
        schemaVersion: 2,
        proposalId: input.proposalId,
        decision: input.decision,
        continueRequested: input.continueRequested,
        actor: 'user',
        timestamp: this.#now().getTime()
      },
      modelRequestId: null
    })
  }

  #requireQueueableRun(agentRunId: string): ActiveRun & { handle: AgentSessionRunHandle } {
    const active = this.#requireActive(agentRunId)
    if (active.phase !== 'running' || active.handle === null) {
      throw new Error(
        active.phase === 'compacting'
          ? 'Earlier conversation is still being summarized'
          : 'Writing skill selection is still in progress'
      )
    }
    if (active.reviewPause !== null) {
      throw new Error('Agent conversation is waiting for review')
    }
    if (active.controller.signal.aborted) {
      throw active.controller.signal.reason instanceof Error
        ? active.controller.signal.reason
        : new AgentRunCancellationError('user_stopped', 'Agent run was stopped')
    }
    return active as ActiveRun & { handle: AgentSessionRunHandle }
  }

  #requirePendingMessage(active: ActiveRun, pendingMessageId: string): PendingFollowUpMessage {
    const pending = active.pendingMessages.find(
      (message) => message.pendingMessageId === pendingMessageId
    )
    if (pending === undefined) throw new Error('The waiting message is no longer pending')
    return pending
  }

  #removePendingMessage(active: ActiveRun, pendingMessageId: string): void {
    const index = active.pendingMessages.findIndex(
      (message) => message.pendingMessageId === pendingMessageId
    )
    if (index >= 0) active.pendingMessages.splice(index, 1)
  }

  async #queueSteer(agentRunId: string, rawContent: string): Promise<void> {
    const active = this.#requireQueueableRun(agentRunId)
    const handle = active.handle
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
        request: { content, delivery: 'steer' },
        thinkingLevel: active.thinkingLevel,
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
      payload: agentUserMessagePayloadSchema.parse({ content, delivery: 'steer', timestamp }),
      modelRequestId
    })
    active.pendingModelRequestIds.add(modelRequestId)
    active.authorizedModelRequestIds.add(modelRequestId)
    const refreshedContext = this.options.contextBuilder?.build({
      prompt: content,
      editorContext: active.editorContext,
      snapshotId: modelRequestId,
      skillPrompt: active.skillPrompt
    })
    if (refreshedContext !== undefined) {
      this.#retainIncludedSkillResources(active, refreshedContext.includedSkillResources)
      active.snapshots.set(modelRequestId, refreshedContext.snapshot)
      active.systemPrompt = refreshedContext.systemPrompt
    }
    try {
      const command = {
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        modelRequestId,
        content,
        timestamp,
        systemPrompt: refreshedContext?.systemPrompt ?? active.systemPrompt
      }
      handle.steer(command)
    } catch (err) {
      this.options.log.error(
        { event: 'agent.run.steer_failed', err, agentRunId, modelRequestId },
        'Failed to steer an Agent message'
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
      active.partialText = truncateUtf8(
        `${active.partialText}${event.delta}`,
        AGENT_LIVE_PARTIAL_MAX_BYTES
      )
      if (
        active.skillState !== null &&
        this.options.skillRouter?.isPrepared !== undefined &&
        !this.options.skillRouter.isPrepared(active.skillState)
      ) {
        return
      }
      await this.#publishDelta(active.agentSessionId, active.agentRunId, event.delta)
      return
    }
    if (event.type === 'queue_updated') return
    if (event.type === 'queue_action_completed') return
    if (event.type === 'follow_up_consumption_requested') {
      await this.#authorizeFollowUpConsumption(active, event)
      return
    }
    if (event.type === 'model_call_requested') {
      await this.#authorizeToolContinuation(active, event.continuationId)
      return
    }
    if (!active.authorizedModelRequestIds.has(event.modelRequestId)) {
      throw new Error('Agent event refers to an unauthorized model request')
    }
    if (event.type === 'model_call_retrying') {
      this.options.log.warn(
        {
          event: 'agent.provider_retry.scheduled',
          agentRunId: active.agentRunId,
          modelRequestId: event.modelRequestId,
          completedAttempts: event.completedAttempts,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          reasonCode: event.reasonCode
        },
        'Agent provider retry scheduled'
      )
      return
    }
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    if (event.type === 'tool_attempted' || event.type === 'tool_preflight_failed') {
      const { type, modelRequestId, ...payload } = event
      if (event.type === 'tool_preflight_failed') {
        this.options.log.warn(
          {
            event: 'agent.tool.preflight_failed',
            agentRunId: active.agentRunId,
            modelRequestId,
            toolName: event.requestedToolName,
            phase: event.phase,
            code: event.diagnostic?.code,
            paths: event.diagnostic?.paths,
            pathCount: event.diagnostic?.paths.length ?? 0,
            durationMs: event.durationMs
          },
          'Agent tool failed before Main dispatch'
        )
      }
      await this.#appendAndPublishEvent({
        sessionId: active.agentSessionId,
        runId: active.agentRunId,
        type,
        payload,
        modelRequestId
      })
      return
    }
    if (event.type === 'model_call_finished') {
      if (event.outcome === 'succeeded') {
        await repository.succeed(event.modelRequestId, { metadata: event.metadata, outputItems: 1 })
      } else if (event.outcome === 'timed_out') {
        await repository.fail(event.modelRequestId, {
          code: 'provider_timeout',
          retryable: true
        })
      } else if (event.outcome === 'aborted') {
        await repository.abort(event.modelRequestId, 'aborted', event.metadata)
      } else {
        await repository.fail(
          event.modelRequestId,
          {
            code: event.failureCode ?? 'provider_request_failed',
            retryable:
              event.retryable ?? (event.httpStatus === 429 || (event.httpStatus ?? 0) >= 500),
            ...(event.httpStatus === undefined ? {} : { httpStatus: event.httpStatus })
          },
          event.metadata
        )
      }
      active.pendingModelRequestIds.delete(event.modelRequestId)
      return
    }
    if (
      event.message.stopReason !== 'toolUse' &&
      active.skillState !== null &&
      this.options.skillRouter?.isPrepared !== undefined &&
      !this.options.skillRouter.isPrepared(active.skillState)
    ) {
      this.#failUnfulfilledSkillRequest(active)
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

  async #authorizeFollowUpConsumption(
    active: ActiveRun,
    event: Extract<AgentRuntimeEvent, { type: 'follow_up_consumption_requested' }>
  ): Promise<void> {
    if (active.handle === null) throw new Error('Agent runtime is unavailable')
    const pending = this.#requirePendingMessage(active, event.pendingMessageId)
    if (pending.modelRequestId !== event.modelRequestId) {
      throw new Error('Agent Follow-up consumption capability mismatch')
    }
    await this.#appendAndPublishEvent({
      sessionId: active.agentSessionId,
      runId: active.agentRunId,
      type: 'user_message',
      payload: agentUserMessagePayloadSchema.parse({
        content: pending.content,
        delivery: 'follow_up',
        timestamp: pending.timestamp
      }),
      modelRequestId: pending.modelRequestId
    })
    this.#removePendingMessage(active, pending.pendingMessageId)
    active.handle.authorizeFollowUpConsumption({
      projectSessionId: this.options.projectSessionId,
      agentSessionId: active.agentSessionId,
      agentRunId: active.agentRunId,
      consumptionId: event.consumptionId,
      pendingMessageId: pending.pendingMessageId,
      modelRequestId: pending.modelRequestId
    })
    await this.#publishActivitySnapshot()
    this.options.log.info(
      {
        event: 'agent.run.follow_up_consumed',
        agentRunId: active.agentRunId,
        pendingMessageId: pending.pendingMessageId,
        modelRequestId: pending.modelRequestId
      },
      'Authorized a consumed Agent Follow-up'
    )
  }

  #failUnfulfilledSkillRequest(active: ActiveRun): never {
    const error = new AgentSkillPreparationError(
      'skill_request_unfulfilled',
      'The Agent answered before loading every requested Writing Skill'
    )
    active.partialText = ''
    active.skillSnapshot = {
      ...active.skillSnapshot,
      routingStatus: 'failed',
      safeError: error.code
    }
    this.#updateSkillSnapshot(active.agentRunId, active.skillSnapshot)
    this.options.log.warn(
      {
        event: 'skill.selection.rejected',
        err: error,
        agentRunId: active.agentRunId,
        code: error.code,
        requestedCount: active.skillSnapshot.requestedSkills.length,
        loadedCount: active.skillSnapshot.skills.length
      },
      'Agent response rejected because requested Writing Skills were not loaded'
    )
    throw error
  }

  async #authorizeToolContinuation(active: ActiveRun, continuationId: string): Promise<void> {
    if (active.phase !== 'running' || active.handle === null) {
      throw new Error('Agent continuation is unavailable during writing skill selection')
    }
    const handle = active.handle
    if (active.reviewPause !== null) {
      throw new Error('Agent continuation is blocked while review is pending')
    }
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
          request: {
            delivery: 'tool_continuation',
            continuationId
          },
          thinkingLevel: active.thinkingLevel,
          inputItems: 1,
          operationId: active.operationId,
          agentRunId: active.agentRunId,
          projectSessionId: this.options.projectSessionId
        })
      ).modelRequestId
      active.authorizedModelRequestIds.add(modelRequestId)
      active.pendingModelRequestIds.add(modelRequestId)
      const refreshedContext = this.options.contextBuilder?.build({
        prompt: TOOL_CONTINUATION_REQUEST,
        editorContext: active.editorContext,
        snapshotId: modelRequestId,
        skillPrompt: active.skillPrompt
      })
      if (refreshedContext !== undefined) {
        this.#retainIncludedSkillResources(active, refreshedContext.includedSkillResources)
        active.snapshots.set(modelRequestId, refreshedContext.snapshot)
        active.systemPrompt = refreshedContext.systemPrompt
      }
      handle.authorizeModelCall({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        continuationId,
        modelRequestId,
        systemPrompt: refreshedContext?.systemPrompt ?? active.systemPrompt
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
    const toolStartedAt = this.#now().getTime()
    const skillDisplayName =
      request.toolName === 'read_writing_skill' &&
      active.skillState !== null &&
      this.options.skillRouter?.displayNameForUri !== undefined
        ? this.options.skillRouter.displayNameForUri(active.skillState, request.args.uri)
        : null
    const callArgs =
      request.toolName === 'read_writing_skill'
        ? safeSkillActivityProjection(request.args.uri, skillDisplayName ?? 'Writing Skill')
        : request.args
    const callPayload = agentToolCallPayloadSchema.parse({
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      contractVersion: AGENT_TOOL_DESCRIPTORS[request.toolName].contractVersion,
      args: callArgs,
      timestamp: toolStartedAt
    })
    const toolCallEvent = await this.#appendAndPublishEvent({
      sessionId: active.agentSessionId,
      runId: active.agentRunId,
      type: 'tool_call',
      payload: callPayload,
      modelRequestId: request.modelRequestId
    })
    const deadlineSignal =
      request.toolName === 'ask_user'
        ? null
        : AbortSignal.timeout(AGENT_TOOL_DESCRIPTORS[request.toolName].deadlineMs)
    const toolSignal = deadlineSignal === null ? signal : AbortSignal.any([signal, deadlineSignal])
    try {
      let data: unknown
      if (request.toolName === 'ask_user') {
        data = await this.#waitForUserAnswer(active, request, toolSignal)
      } else if (request.toolName === 'read_writing_skill') {
        if (
          this.options.skillRouter === undefined ||
          this.options.skillRouter.read === undefined ||
          active.skillState === null
        ) {
          throw new AgentToolDomainError('unavailable', 'Writing Skills are unavailable', true)
        }
        const read = await this.options.skillRouter.read(
          active.skillState,
          request.args.uri,
          request.modelRequestId,
          toolSignal
        )
        active.skillSnapshot = read.snapshot
        active.skillPrompt = read.prompt
        this.#updateSkillSnapshot(active.agentRunId, read.snapshot)
        data = read.data
      } else if (this.options.tools === undefined) {
        throw new AgentToolDomainError('unavailable', 'Agent read tools are unavailable', true)
      } else {
        if (
          active.skillState !== null &&
          this.options.skillRouter?.isPrepared !== undefined &&
          !this.options.skillRouter.isPrepared(active.skillState)
        ) {
          throw new AgentToolDomainError(
            'conflict',
            'Load the requested Writing Skills and pending dependencies before downstream tools',
            true
          )
        }
        if (
          active.skillState !== null &&
          this.options.skillRouter?.closePreparation !== undefined
        ) {
          this.options.skillRouter.closePreparation(active.skillState)
        }
        data = await this.options.tools.execute({
          toolName: request.toolName,
          args: request.args,
          editorContext: active.editorContext,
          agentSessionId: active.agentSessionId,
          agentRunId: active.agentRunId,
          toolCallId: request.toolCallId,
          toolCallEventId: toolCallEvent.agentEventId,
          modelRequestId: request.modelRequestId,
          snapshot: active.snapshots.get(request.modelRequestId),
          signal: toolSignal
        })
      }
      const tools = this.options.tools
      const proposal = mutationProposalToolResultSchema.safeParse(data)
      if (proposal.success) {
        // The approval decision reads the session's current mode rather than the
        // run-start snapshot so mid-run mode changes apply to the next proposal.
        const currentApprovalMode = this.#sessionApprovalMode(active.agentSessionId)
        const shouldAutoApprove =
          tools?.shouldAutoApprove?.(
            active.agentSessionId,
            proposal.data.proposalId,
            currentApprovalMode
          ) ?? false
        if (shouldAutoApprove) {
          if (tools?.approveProposalAutomatically === undefined) {
            throw new AgentToolDomainError('unavailable', 'Automatic approval is unavailable', true)
          }
          this.options.log.info(
            {
              event: 'agent.approval.auto_started',
              proposalId: proposal.data.proposalId,
              kind: proposal.data.kind,
              mode: currentApprovalMode
            },
            'Automatic Agent proposal approval started'
          )
          const outcome = await tools.approveProposalAutomatically(
            active.agentSessionId,
            proposal.data.proposalId,
            true
          )
          data = submitResultFromOutcome(
            outcome,
            tools.getProposal?.(active.agentSessionId, outcome.effectiveProposalId),
            {
              createdSectionRefs: proposal.data.createdSectionRefs,
              createdBlockRefs: proposal.data.createdBlockRefs
            }
          )
        } else {
          data = submitChangeResultSchema.parse({
            proposal: {
              proposalId: proposal.data.proposalId,
              kind: proposal.data.kind,
              status: 'pending'
            },
            application: {
              status: 'not_applied',
              ...(proposal.data.createdSectionRefs === undefined
                ? {}
                : { createdSectionRefs: proposal.data.createdSectionRefs }),
              ...(proposal.data.createdBlockRefs === undefined
                ? {}
                : { createdBlockRefs: proposal.data.createdBlockRefs })
            },
            continuation: 'pause_for_review',
            warnings: []
          })
          active.reviewPause = {
            proposalId: proposal.data.proposalId,
            kind: proposal.data.kind
          }
        }
      }
      const provenance = extractToolProvenance(data)
      const resultPayload = agentToolResultPayloadSchema.parse({
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        contractVersion: AGENT_TOOL_DESCRIPTORS[request.toolName].contractVersion,
        isError: false,
        result: request.toolName === 'read_writing_skill' ? skillResultProjection(data) : data,
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
      const response = agentToolResponseSchema.parse({
        ...toolResponseCapability(request),
        schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
        ok: true,
        data
      })
      if (request.toolName === 'ask_user') {
        this.#completePendingUserQuestion(active, request.toolCallId, true)
      }
      return response
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
      const safe = safeToolError(err, request.toolName, signal, deadlineSignal)
      const structured = structuredToolError(
        safe.code,
        safe.message,
        safe.retryable,
        request.toolName,
        safe.recoveryUri
      )
      this.options.log.warn(
        {
          event: 'agent.tool.safe_failure_projected',
          agentRunId,
          modelRequestId: request.modelRequestId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          phase: 'dispatched',
          code: structured.code,
          category: structured.category,
          recoveryAction: structured.recovery.action,
          recoveryTool: structured.recovery.tool,
          durationMs: Math.max(0, this.#now().getTime() - toolStartedAt)
        },
        'Projected a safe Agent tool failure'
      )
      const resultPayload = agentToolResultPayloadSchema.parse({
        toolCallId: request.toolCallId,
        toolName: request.toolName,
        contractVersion: AGENT_TOOL_DESCRIPTORS[request.toolName].contractVersion,
        isError: true,
        result: null,
        error: {
          code: structured.code,
          message: structured.message,
          retryable: safe.retryable,
          operationId: active.operationId,
          category: structured.category,
          recovery: structured.recovery
        },
        citationIds: [],
        knowledgeItemIds: [],
        parseRevisionIds: [],
        timestamp: this.#now().getTime()
      })
      try {
        await this.#appendAndPublishEvent({
          sessionId: active.agentSessionId,
          runId: active.agentRunId,
          type: 'tool_result',
          payload: resultPayload,
          modelRequestId: request.modelRequestId
        })
        return toolErrorResponse(request, safe.code, safe.message, safe.retryable, safe.recoveryUri)
      } finally {
        if (request.toolName === 'ask_user') {
          this.#completePendingUserQuestion(active, request.toolCallId, false)
        }
      }
    }
  }

  async #waitForUserAnswer(
    active: ActiveRun,
    request: Extract<AgentToolRequest, { toolName: 'ask_user' }>,
    signal: AbortSignal
  ): Promise<AskUserResult> {
    if (active.pendingQuestion !== null) {
      throw new AgentToolDomainError(
        'conflict',
        'Another Agent clarification is already pending',
        false
      )
    }
    let resolveAnswers: (result: AskUserResult) => void = () => undefined
    let rejectAnswers: (error: Error) => void = () => undefined
    const answers = new Promise<AskUserResult>((resolve, reject) => {
      resolveAnswers = resolve
      rejectAnswers = reject
    })
    let complete: (result: { ok: boolean }) => void = () => undefined
    const completion = new Promise<{ ok: boolean }>((resolve) => {
      complete = resolve
    })
    const pending: PendingUserQuestion = {
      toolCallId: request.toolCallId,
      modelRequestId: request.modelRequestId,
      args: request.args,
      startedAt: this.#now().toISOString(),
      submitting: false,
      resolveAnswers,
      rejectAnswers,
      completion,
      complete
    }
    const onAbort = (): void => {
      const error = new Error('Agent clarification wait was aborted', {
        cause: signal.reason
      })
      error.name = 'AbortError'
      pending.rejectAnswers(error)
    }
    active.pendingQuestion = pending
    active.phase = 'awaiting_input'
    signal.addEventListener('abort', onAbort, { once: true })
    await this.#publishActivitySnapshot()
    void this.#publishSession(active.agentSessionId, false)
    this.options.log.info(
      {
        event: 'agent.question.wait_started',
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        modelRequestId: request.modelRequestId,
        toolCallId: request.toolCallId,
        questionCount: request.args.questions.length
      },
      'Agent run is waiting for user clarification'
    )
    if (signal.aborted) onAbort()
    try {
      return await answers
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  #completePendingUserQuestion(active: ActiveRun, toolCallId: string, ok: boolean): void {
    const pending = active.pendingQuestion
    if (pending === null || pending.toolCallId !== toolCallId) return
    active.pendingQuestion = null
    if (!active.controller.signal.aborted) active.phase = 'running'
    pending.complete({ ok })
    void this.#publishActivitySnapshot()
    void this.#publishSession(active.agentSessionId, false)
    this.options.log.info(
      {
        event: ok ? 'agent.question.wait_completed' : 'agent.question.wait_cancelled',
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        modelRequestId: pending.modelRequestId,
        toolCallId: pending.toolCallId,
        questionCount: pending.args.questions.length,
        durationMs: Math.max(0, this.#now().getTime() - Date.parse(pending.startedAt))
      },
      ok
        ? 'Agent clarification resumed the run'
        : 'Agent clarification wait ended without an answer'
    )
  }

  async #settleRun(active: ActiveRun): Promise<void> {
    const handle = active.handle
    if (handle === null) throw new Error('Agent runtime did not start')
    try {
      const result = await handle.completion
      if (result.outcome === 'awaiting_review') {
        if (active.reviewPause === null) {
          throw new Error('Agent review pause completed without a pending proposal')
        }
        await this.#abortPendingModelRequests(active, 'review_pause')
        const event = await this.#finishRunAndAppendEvent({
          agentRunId: active.agentRunId,
          agentSessionId: active.agentSessionId,
          status: 'completed',
          error: null,
          eventPayload: {
            status: 'completed',
            outcome: 'awaiting_review',
            proposalId: active.reviewPause.proposalId,
            proposalKind: active.reviewPause.kind
          }
        })
        this.options.log.info(
          {
            event: 'agent.run.review_wait_started',
            agentRunId: active.agentRunId,
            proposalId: active.reviewPause.proposalId,
            proposalKind: active.reviewPause.kind,
            sequence: event.sequence
          },
          'Agent run is waiting for proposal review'
        )
        return
      }
      if (active.pendingModelRequestIds.size > 0) {
        throw new Error('Agent run completed with unfinished model requests')
      }
      if (
        active.skillState !== null &&
        this.options.skillRouter?.isPrepared !== undefined &&
        !this.options.skillRouter.isPrepared(active.skillState)
      ) {
        this.#failUnfulfilledSkillRequest(active)
      }
      if (active.skillSnapshot.routingStatus === 'available') {
        active.skillSnapshot = { ...active.skillSnapshot, routingStatus: 'not_needed' }
        this.#updateSkillSnapshot(active.agentRunId, active.skillSnapshot)
      }
      const event = await this.#finishRunAndAppendEvent({
        agentRunId: active.agentRunId,
        agentSessionId: active.agentSessionId,
        status: 'completed',
        error: null,
        eventPayload: { status: 'completed', outcome: 'finished' }
      })
      this.options.log.info(
        { event: 'agent.run.completed', agentRunId: active.agentRunId, sequence: event.sequence },
        'Agent run completed'
      )
    } catch (caught) {
      let err = caught
      this.options.log.error(
        { event: 'agent.run.failed', err, agentRunId: active.agentRunId },
        'Agent run did not complete'
      )
      if (
        active.skillState !== null &&
        this.options.skillRouter?.isPrepared !== undefined &&
        !this.options.skillRouter.isPrepared(active.skillState)
      ) {
        active.partialText = ''
      }
      if (isContextOverflowError(err)) {
        const activityOccurred = this.#runHasReplayUnsafeActivity(active)
        if (!activityOccurred && !active.overflowRetryAttempted) {
          active.overflowRetryAttempted = true
          try {
            await this.#restartAfterContextOverflow(active)
            return await this.#settleRun(active)
          } catch (recoveryErr) {
            this.options.log.error(
              {
                event: 'agent.run.context_overflow_recovery_failed',
                err: recoveryErr,
                agentRunId: active.agentRunId
              },
              'Agent context overflow recovery failed'
            )
            err = new AgentRunContextOverflowError('context_overflow', recoveryErr)
          }
        } else {
          err = new AgentRunContextOverflowError(
            activityOccurred ? 'context_overflow_after_activity' : 'context_overflow',
            err
          )
        }
      }
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
      await this.#abortPendingModelRequests(active, 'agent_run_ended')
      if (active.partialText.length > 0) {
        const payload: AgentAssistantMessagePayload = agentAssistantMessagePayloadSchema.parse({
          content: active.partialText,
          stopReason:
            termination.code === 'provider_timeout' ||
            termination.code === 'provider_retries_exhausted'
              ? 'error'
              : 'aborted',
          provider: active.config.providerId,
          model: active.config.model,
          metadata: emptyMetadata(active.config.model),
          timestamp: this.#now().getTime(),
          interrupted:
            termination.code !== 'provider_timeout' &&
            termination.code !== 'provider_retries_exhausted'
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
      if (this.#activeRuns.get(active.agentRunId) === active) {
        this.#activeRuns.delete(active.agentRunId)
      }
      this.#releaseRunSlot(active.agentSessionId, active.agentRunId)
    }
  }

  #runHasReplayUnsafeActivity(active: ActiveRun): boolean {
    if (active.partialText.length > 0) return true
    return this.options.database.immediate((database) => {
      const event = database
        .prepare(
          `SELECT 1 FROM agent_events
            WHERE agent_run_id = ?
              AND (
                (type = 'assistant_message'
                  AND length(COALESCE(json_extract(payload_json, '$.content'), '')) > 0)
                OR type IN (
                  'tool_attempted', 'tool_preflight_failed', 'tool_call', 'tool_result',
                  'approval_decision'
                )
              )
            LIMIT 1`
        )
        .pluck()
        .get(active.agentRunId)
      if (event === 1) return true
      return (
        database
          .prepare('SELECT 1 FROM mutation_proposals WHERE agent_run_id = ? LIMIT 1')
          .pluck()
          .get(active.agentRunId) === 1
      )
    })
  }

  async #restartAfterContextOverflow(active: ActiveRun): Promise<void> {
    await this.#abortPendingModelRequests(active, 'context_overflow_retry')
    const historyBefore = loadContinuousRuntimeHistory(
      this.options.database,
      active.agentSessionId,
      active.agentRunId
    )
    const checkpoint = latestSuccessfulCheckpoint(this.options.database, active.agentSessionId)
    const envelope = uncheckpointedEnvelope(
      this.options.database,
      active.agentSessionId,
      checkpoint?.coveredThroughSequence ?? 0,
      active.agentRunId
    )
    const plan = this.#contextPlanner.plan({
      modelLimits: active.modelLimits,
      requestedOutputTokens: active.maxOutputTokens,
      systemPrompt: active.systemPrompt,
      history: historyBefore,
      currentRequest: active.currentRequest,
      uncheckpointedEventCount: envelope.eventCount,
      uncheckpointedPayloadBytes: envelope.payloadBytes
    })
    const compactionId = this.#createId()
    active.phase = 'compacting'
    void this.#publishActivitySnapshot()
    await this.#appendCompactionStarted({
      agentSessionId: active.agentSessionId,
      agentRunId: active.agentRunId,
      compactionId,
      trigger: 'provider_overflow'
    })
    let steps: number
    try {
      steps = await this.#runRollingCompaction({
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        compactionId,
        trigger: 'provider_overflow',
        config: active.config,
        credential: active.credential,
        modelLimits: active.modelLimits,
        signal: active.controller.signal,
        maxSteps: 4,
        postCompactionBudgetTokens: plan.postCompactionBudgetTokens,
        checkpointBudgetTokens: plan.checkpointBudgetTokens,
        recentTailBudgetTokens: plan.recentTailBudgetTokens
      })
      if (steps === 0) throw new Error('Provider overflow recovery found no history to compact')
    } catch (err) {
      await this.#appendCompactionFailed({
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        compactionId,
        trigger: 'provider_overflow',
        code: active.controller.signal.aborted ? 'aborted' : 'compaction_failed',
        retryable: !active.controller.signal.aborted,
        aborted: active.controller.signal.aborted
      })
      throw err
    }
    const fullHistory = loadContinuousRuntimeHistory(
      this.options.database,
      active.agentSessionId,
      active.agentRunId
    )
    const history = boundHistoryByCompleteTurns(fullHistory, plan.conversationBudgetTokens)
    if (historyProjectionChanged(fullHistory, history)) {
      throw new AgentCompactionRequiredError(
        new Error('Provider overflow recovery would omit uncompacted conversation history')
      )
    }
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    const modelRequestId = (
      await repository.start({
        operation: 'agent',
        provider: active.config,
        request: { prompt: active.currentRequest, delivery: 'prompt', retry: 'context_overflow' },
        thinkingLevel: active.thinkingLevel,
        inputItems: 1,
        operationId: active.operationId,
        agentRunId: active.agentRunId,
        projectSessionId: this.options.projectSessionId
      })
    ).modelRequestId
    active.authorizedModelRequestIds.add(modelRequestId)
    active.pendingModelRequestIds.add(modelRequestId)
    const snapshot = active.snapshots.values().next().value as WritingSnapshot | undefined
    if (snapshot !== undefined) active.snapshots.set(modelRequestId, snapshot)
    active.handle = this.options.runtime.beginSessionRun(
      active.config,
      active.credential,
      {
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        modelRequestId,
        systemPrompt: active.systemPrompt,
        history: agentHistorySchema.parse(history),
        prompt: active.currentRequest,
        maxOutputTokens: active.maxOutputTokens,
        modelLimits: active.modelLimits,
        thinkingLevel: active.thinkingLevel,
        ...(active.runtimeModel === undefined ? {} : { runtimeModel: active.runtimeModel }),
        ...(active.temperature === undefined ? {} : { temperature: active.temperature })
      },
      active.controller.signal,
      (event) => this.#handleRuntimeEvent(active.agentRunId, event),
      (request, signal) => this.#handleToolRequest(active.agentRunId, request, signal)
    )
    active.phase = 'running'
    void this.#publishActivitySnapshot()
    this.options.log.info(
      {
        event: 'agent.run.context_overflow_retried',
        agentRunId: active.agentRunId,
        modelRequestId
      },
      'Agent run retried once after a pre-activity context overflow'
    )
  }

  async #abortPendingModelRequests(active: ActiveRun, reason: string): Promise<void> {
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    for (const modelRequestId of [...active.pendingModelRequestIds]) {
      try {
        await repository.abort(modelRequestId, reason)
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
    if (active.pendingMessages.length > 0) {
      active.pendingMessages.length = 0
      void this.#publishActivitySnapshot()
    }
  }

  #insertRunAndUserEvent(input: {
    agentSessionId: string
    agentRunId: string
    config: Extract<ProviderConfig, { role: 'agent' }>
    editorContext: AgentEditorContext
    prompt: string
    approvalMode: AgentApprovalMode
    thinkingLevel: AgentThinkingLevel
    modelLimits: AgentModelLimits
    presentation?: AgentUserMessagePayload['presentation']
    now: Date
  }): string | null {
    const now = input.now.toISOString()
    return this.options.database.immediate((database) => {
      const session = database
        .prepare(
          `SELECT title,
                  NOT EXISTS (
                    SELECT 1 FROM agent_events
                     WHERE agent_events.agent_session_id = agent_sessions.agent_session_id
                       AND agent_events.type = 'user_message'
                  ) AS is_first_prompt
             FROM agent_sessions
            WHERE agent_session_id = ?`
        )
        .get(input.agentSessionId) as { title: string; is_first_prompt: number } | undefined
      if (session === undefined) throw new Error('Agent session does not exist')
      const automaticTitle =
        session.is_first_prompt === 1 && isGenericSessionTitle(session.title)
          ? fallbackSessionTitle(input.prompt)
          : null
      const taskCorrelation = this.options.writingTasks?.activeCorrelation(
        input.agentSessionId,
        database
      )
      database
        .prepare(
          `INSERT INTO agent_runs (
             agent_run_id, agent_session_id, status, provider_id, model_id,
             provider_preset_id, provider_label, model_label, api_id,
             provider_fingerprint, model_fingerprint, approval_mode, thinking_level, model_limits_json,
             editor_context_json, skill_snapshot_json, writing_task_id, writing_task_step_id,
             error_json, started_at, completed_at, created_at, updated_at
           ) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`
        )
        .run(
          input.agentRunId,
          input.agentSessionId,
          input.config.providerId,
          input.config.model,
          input.config.presetId ?? null,
          input.config.providerName ?? input.config.providerId,
          input.config.modelName ?? input.config.model,
          input.config.api ?? 'openai-completions',
          fingerprint({
            providerId: input.config.providerId,
            baseUrl: input.config.baseUrl,
            role: input.config.role,
            api: input.config.api ?? 'openai-completions',
            presetId: input.config.presetId ?? null
          }),
          fingerprint({
            model: input.config.model,
            revision: input.config.modelRevision,
            api: input.config.api ?? 'openai-completions'
          }),
          input.approvalMode,
          input.thinkingLevel,
          JSON.stringify(input.modelLimits),
          JSON.stringify(input.editorContext),
          JSON.stringify(pendingSkillSnapshot()),
          taskCorrelation?.taskId ?? null,
          taskCorrelation?.stepId ?? null,
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
          timestamp: input.now.getTime(),
          ...(input.presentation === undefined ? {} : { presentation: input.presentation })
        }),
        modelRequestId: null,
        createdAt: now
      })
      if (automaticTitle === null) {
        database
          .prepare('UPDATE agent_sessions SET updated_at = ? WHERE agent_session_id = ?')
          .run(now, input.agentSessionId)
      } else {
        database
          .prepare('UPDATE agent_sessions SET title = ?, updated_at = ? WHERE agent_session_id = ?')
          .run(automaticTitle, now, input.agentSessionId)
      }
      return automaticTitle
    })
  }

  #updateSkillSnapshot(agentRunId: string, snapshot: SkillRunSnapshot): void {
    const parsed = skillRunSnapshotSchema.parse(snapshot)
    this.options.database.immediate((database) => {
      const result = database
        .prepare(
          'UPDATE agent_runs SET skill_snapshot_json = ?, updated_at = ? WHERE agent_run_id = ?'
        )
        .run(JSON.stringify(parsed), this.#now().toISOString(), agentRunId)
      if (result.changes !== 1) throw new Error('Agent run does not exist')
    })
  }

  #retainIncludedSkillResources(active: ActiveRun, includedPaths: readonly string[]): void {
    const included = new Set(includedPaths)
    const resources = active.skillSnapshot.resources.filter((resource) =>
      included.has(virtualSkillPath(resource.skillId, resource.commit, resource.relativePath))
    )
    const references = active.skillPrompt.references.filter((reference) =>
      included.has(reference.path)
    )
    if (
      resources.length === active.skillSnapshot.resources.length &&
      references.length === active.skillPrompt.references.length
    ) {
      return
    }
    active.skillSnapshot = { ...active.skillSnapshot, resources }
    active.skillPrompt = { ...active.skillPrompt, references }
    this.#updateSkillSnapshot(active.agentRunId, active.skillSnapshot)
  }

  #beginTitleRequest(input: {
    agentSessionId: string
    agentRunId: string
    operationId: string
    config: Extract<ProviderConfig, { role: 'agent' }>
    credential: string
    modelLimits: AgentModelLimits
    context: string
    expectedTitle: string
    controller: AbortController
    automatic: boolean
    reasoningModel: boolean
  }): Promise<AgentSessionRecord> {
    if (this.#titleRequests.has(input.agentSessionId)) {
      return Promise.reject(new Error('Conversation title is already being generated'))
    }
    const completion = this.#executeTitleRequest(input)
    return this.#trackTitleRequest(input.agentSessionId, input.controller, completion)
  }

  #trackTitleRequest(
    agentSessionId: string,
    controller: AbortController,
    completion: Promise<AgentSessionRecord>
  ): Promise<AgentSessionRecord> {
    if (this.#titleRequests.has(agentSessionId)) {
      controller.abort(new Error('Conversation title is already being generated'))
      return Promise.reject(new Error('Conversation title is already being generated'))
    }
    this.#titleRequests.set(agentSessionId, { controller, completion })
    void completion
      .finally(() => {
        const active = this.#titleRequests.get(agentSessionId)
        if (active?.completion === completion) this.#titleRequests.delete(agentSessionId)
      })
      .catch(() => undefined)
    return completion
  }

  async #executeTitleRequest(input: {
    agentSessionId: string
    agentRunId: string
    operationId: string
    config: Extract<ProviderConfig, { role: 'agent' }>
    credential: string
    modelLimits: AgentModelLimits
    context: string
    expectedTitle: string
    controller: AbortController
    automatic: boolean
    reasoningModel: boolean
  }): Promise<AgentSessionRecord> {
    const generate = this.options.generateTitle
    if (generate === undefined) return this.#requireSessionRecord(input.agentSessionId)
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    let modelRequestId: string | undefined
    const startedAt = Date.now()
    try {
      modelRequestId = (
        await repository.start({
          operation: 'agent',
          provider: input.config,
          request: {
            purpose: 'session_title',
            systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
            context: input.context
          },
          inputItems: 1,
          operationId: input.operationId,
          agentRunId: input.agentRunId,
          projectSessionId: this.options.projectSessionId
        })
      ).modelRequestId
      this.options.log.info(
        {
          event: 'agent.session.title_generation_started',
          agentSessionId: input.agentSessionId,
          agentRunId: input.agentRunId,
          modelRequestId,
          automatic: input.automatic,
          inputCharacters: Array.from(input.context).length
        },
        'Agent session title generation started'
      )
      const result = await generate({
        config: input.config,
        credential: input.credential,
        request: {
          systemPrompt: SESSION_TITLE_SYSTEM_PROMPT,
          prompt: formatSessionTitleInput(input.context),
          maxOutputTokens: input.reasoningModel
            ? SESSION_TITLE_REASONING_OUTPUT_TOKENS
            : SESSION_TITLE_OUTPUT_TOKENS,
          ...(input.reasoningModel ? {} : { temperature: 0 })
        },
        modelLimits: input.modelLimits,
        signal: input.controller.signal
      })
      const title = sanitizeGeneratedSessionTitle(result.text)
      if (title.length === 0) throw new Error('Agent title model returned an empty title')
      await repository.succeed(modelRequestId, {
        metadata: result.metadata,
        outputItems: 1
      })
      const now = this.#now().toISOString()
      const changes = this.options.database.immediate(
        (database) =>
          database
            .prepare(
              `UPDATE agent_sessions
                SET title = ?, updated_at = ?
              WHERE agent_session_id = ? AND status = 'active' AND title = ?`
            )
            .run(title, now, input.agentSessionId, input.expectedTitle).changes
      )
      const session = this.#requireSessionRecord(input.agentSessionId)
      this.options.log.info(
        {
          event:
            changes === 1
              ? 'agent.session.title_generation_completed'
              : 'agent.session.title_generation_superseded',
          agentSessionId: input.agentSessionId,
          agentRunId: input.agentRunId,
          modelRequestId,
          automatic: input.automatic,
          outputCharacters: Array.from(title).length,
          durationMs: Date.now() - startedAt
        },
        changes === 1
          ? 'Agent session title generation completed'
          : 'Agent session title generation was superseded by newer state'
      )
      await this.#publishSession(session, false)
      return session
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.session.title_generation_failed',
          err,
          agentSessionId: input.agentSessionId,
          agentRunId: input.agentRunId,
          modelRequestId,
          automatic: input.automatic,
          durationMs: Date.now() - startedAt
        },
        'Agent session title generation failed'
      )
      if (modelRequestId !== undefined) {
        try {
          if (input.controller.signal.aborted) {
            await repository.abort(modelRequestId, 'session_title_cancelled')
          } else {
            await repository.fail(modelRequestId, {
              code: 'session_title_failed',
              retryable: false
            })
          }
        } catch (recordErr) {
          this.options.log.error(
            {
              event: 'agent.session.title_generation_record_failed',
              err: recordErr,
              agentSessionId: input.agentSessionId,
              modelRequestId
            },
            'Failed to record Agent session title request outcome'
          )
        }
      }
      const session = this.#requireSessionRecord(input.agentSessionId)
      await this.#publishSession(session, false)
      if (input.automatic) return session
      throw new Error('Conversation title could not be generated', { cause: err })
    }
  }

  #loadSessionTitleContext(agentSessionId: string): string {
    const rows = this.options.database.immediate((database) => {
      const first = database
        .prepare(
          `SELECT sequence, 'user' AS role,
                  substr(json_extract(payload_json, '$.content'), 1, 16384) AS content
             FROM agent_events
            WHERE agent_session_id = ? AND type = 'user_message'
            ORDER BY sequence
            LIMIT 1`
        )
        .get(agentSessionId) as SessionTitleMessage | undefined
      const summary = database
        .prepare(
          `SELECT sequence, 'summary' AS role,
                  substr(json_extract(payload_json, '$.summary'), 1, 16384) AS content
             FROM agent_events
            WHERE agent_session_id = ? AND type = 'compaction_summary'
            ORDER BY sequence DESC
            LIMIT 1`
        )
        .get(agentSessionId) as SessionTitleMessage | undefined
      const recent = database
        .prepare(
          `SELECT sequence,
                  CASE type WHEN 'user_message' THEN 'user' ELSE 'assistant' END AS role,
                  substr(json_extract(payload_json, '$.content'), 1, 16384) AS content
             FROM agent_events
            WHERE agent_session_id = ? AND type IN ('user_message', 'assistant_message')
            ORDER BY sequence DESC
            LIMIT 24`
        )
        .all(agentSessionId) as SessionTitleMessage[]
      return [first, summary, ...recent.reverse()].filter(
        (row): row is SessionTitleMessage =>
          row !== undefined && typeof row.content === 'string' && row.content.length > 0
      )
    })
    return buildSessionTitleContext(rows)
  }

  #requireSessionRecord(agentSessionId: string): AgentSessionRecord {
    const session = this.#querySessions({ agentSessionId, limit: 1 })[0]
    if (session === undefined) throw new Error('Agent session does not exist')
    return session
  }

  #assertSessionIdle(agentSessionId: string, action: string): void {
    const session = this.#requireSessionRecord(agentSessionId)
    if (this.#titleRequests.has(agentSessionId)) {
      throw new Error(`Conversation title must finish before ${action}`)
    }
    if (this.#workBySession.has(agentSessionId) || session.workflowState === 'running') {
      throw new Error(`Agent run must finish before ${action}`)
    }
    if (session.workflowState === 'generating') {
      throw new Error(`Image generation must finish before ${action}`)
    }
    if (session.workflowState === 'awaiting_review') {
      throw new Error(`Review the pending proposal before ${action}`)
    }
  }

  async #publishSession(
    sessionOrId: AgentSessionRecord | string,
    titleGenerating: boolean
  ): Promise<void> {
    const agentSessionId =
      typeof sessionOrId === 'string' ? sessionOrId : sessionOrId.agentSessionId
    try {
      const session =
        typeof sessionOrId === 'string' ? this.#requireSessionRecord(sessionOrId) : sessionOrId
      await this.options.publishSession?.({ session, titleGenerating })
    } catch (err) {
      this.options.log.warn(
        {
          event: 'agent.session.delivery_failed',
          err,
          agentSessionId
        },
        'Agent session renderer delivery failed without changing durable truth'
      )
    }
  }

  async #withSessionProvider<T>(
    agentSessionId: string,
    operation: (
      config: Extract<ProviderConfig, { role: 'agent' }>,
      credential: string,
      resolved?: ResolvedAgentCatalogModel
    ) => Promise<T>
  ): Promise<T> {
    const selection = this.#sessionModelSelection(agentSessionId)
    if (selection !== null && this.options.agentCatalog !== undefined) {
      const resolved = await this.options.agentCatalog.resolve(selection)
      return operation(
        agentProviderConfigFromResolved(resolved),
        agentCredentialFromResolved(resolved),
        resolved
      )
    }
    return this.options.providers.withConfiguredProvider('agent', (config, credential) =>
      operation(config, credential)
    )
  }

  #sessionModelSelection(agentSessionId: string): AgentModelSelection | null {
    const row = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT provider_preset_id, selected_model_id
               FROM agent_sessions
              WHERE agent_session_id = ?`
          )
          .get(agentSessionId) as
          | { provider_preset_id: string | null; selected_model_id: string | null }
          | undefined
    )
    if (row === undefined) throw new Error('Agent session does not exist')
    if (row.provider_preset_id === null || row.selected_model_id === null) return null
    return { presetId: row.provider_preset_id, modelId: row.selected_model_id }
  }

  #sessionThinkingLevel(agentSessionId: string): AgentThinkingLevel {
    const value = this.options.database.immediate((database) =>
      database
        .prepare('SELECT thinking_level FROM agent_sessions WHERE agent_session_id = ?')
        .pluck()
        .get(agentSessionId)
    )
    return agentThinkingLevelSchema.parse(value)
  }

  #reconcileThinkingLevel(
    agentSessionId: string,
    requested: AgentThinkingLevel,
    effective: AgentThinkingLevel
  ): void {
    const now = this.#now().toISOString()
    this.options.database.immediate((database) => {
      database
        .prepare(
          'UPDATE agent_sessions SET thinking_level = ?, updated_at = ? WHERE agent_session_id = ?'
        )
        .run(effective, now, agentSessionId)
    })
    this.options.log.info(
      {
        event: 'agent.session.thinking_level_clamped',
        agentSessionId,
        requestedThinkingLevel: requested,
        thinkingLevel: effective
      },
      'Agent session Thinking level was clamped to current model capabilities'
    )
  }

  #unlinkedInitialUserEvent(agentSessionId: string, agentRunId: string): AgentEventRecord | null {
    return this.options.database.immediate((database) => {
      const row = database
        .prepare(
          `SELECT agent_event_id, sequence, payload_json, created_at
             FROM agent_events
            WHERE agent_session_id = ? AND agent_run_id = ? AND type = 'user_message'
              AND model_request_id IS NULL
            ORDER BY sequence
            LIMIT 1`
        )
        .get(agentSessionId, agentRunId) as
        | { agent_event_id: string; sequence: number; payload_json: string; created_at: string }
        | undefined
      if (row === undefined) return null
      return {
        agentEventId: row.agent_event_id,
        agentSessionId,
        agentRunId,
        sequence: row.sequence,
        type: 'user_message',
        payload: JSON.parse(row.payload_json) as Record<string, unknown>,
        modelRequestId: null,
        createdAt: row.created_at
      }
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
    await this.#publishSession(this.#requireSessionRecord(input.agentSessionId), false)
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

  #assertConversationReady(agentSessionId: string): void {
    const blocker = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT status
               FROM mutation_proposals
              WHERE agent_session_id = ?
                AND status IN ('pending', 'generating')
              ORDER BY CASE status WHEN 'generating' THEN 0 ELSE 1 END, created_at
              LIMIT 1`
          )
          .get(agentSessionId) as { status: 'pending' | 'generating' } | undefined
    )
    if (blocker?.status === 'generating') {
      throw new Error('Agent conversation is waiting for image generation')
    }
    if (blocker?.status === 'pending') {
      throw new Error('Agent conversation is waiting for review')
    }
  }

  async #prepareRuntimeHistory(input: {
    active: ActiveRun
    credential: string
    currentRequest: string
    maxOutputTokens: number
  }): Promise<AgentHistoryMessage[]> {
    const active = input.active
    let history = loadContinuousRuntimeHistory(
      this.options.database,
      active.agentSessionId,
      active.agentRunId
    )
    const checkpoint = latestSuccessfulCheckpoint(this.options.database, active.agentSessionId)
    const envelope = uncheckpointedEnvelope(
      this.options.database,
      active.agentSessionId,
      checkpoint?.coveredThroughSequence ?? 0,
      active.agentRunId
    )
    let plan = this.#contextPlanner.plan({
      modelLimits: active.modelLimits,
      requestedOutputTokens: input.maxOutputTokens,
      systemPrompt: active.systemPrompt,
      history,
      currentRequest: input.currentRequest,
      uncheckpointedEventCount: envelope.eventCount,
      uncheckpointedPayloadBytes: envelope.payloadBytes
    })
    if (this.options.messageTokenBudget !== undefined) {
      const conversationBudgetTokens = Math.min(
        plan.conversationBudgetTokens,
        this.options.messageTokenBudget
      )
      plan = {
        ...plan,
        conversationBudgetTokens,
        ...agentCompactionBudgets(conversationBudgetTokens),
        requiresCompaction:
          plan.requiresCompaction || plan.historyTokens > this.options.messageTokenBudget
      }
    }
    if (!plan.requiresCompaction) return agentHistorySchema.parse(history)

    const compactionId = this.#createId()
    active.phase = 'compacting'
    void this.#publishActivitySnapshot()
    await this.#appendCompactionStarted({
      agentSessionId: active.agentSessionId,
      agentRunId: active.agentRunId,
      compactionId,
      trigger: 'auto_threshold'
    })
    let compactionError: unknown = null
    try {
      const steps = await this.#runRollingCompaction({
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        compactionId,
        trigger: 'auto_threshold',
        config: active.config,
        credential: input.credential,
        modelLimits: active.modelLimits,
        signal: active.controller.signal,
        maxSteps: 4,
        postCompactionBudgetTokens: plan.postCompactionBudgetTokens,
        checkpointBudgetTokens: plan.checkpointBudgetTokens,
        recentTailBudgetTokens: plan.recentTailBudgetTokens
      })
      if (steps === 0) throw new Error('No complete historical turn was available for compaction')
    } catch (err) {
      compactionError = err
      this.options.log.error(
        { event: 'agent.compaction.failed', err, agentRunId: active.agentRunId, compactionId },
        'Automatic Agent context compaction failed'
      )
      await this.#appendCompactionFailed({
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        compactionId,
        trigger: 'auto_threshold',
        code: active.controller.signal.aborted ? 'aborted' : 'compaction_failed',
        retryable: !active.controller.signal.aborted,
        aborted: active.controller.signal.aborted
      })
      if (active.controller.signal.aborted) throw err
    } finally {
      active.phase = 'routing'
      void this.#publishActivitySnapshot()
    }
    history = loadContinuousRuntimeHistory(
      this.options.database,
      active.agentSessionId,
      active.agentRunId
    )
    const bounded = boundHistoryByCompleteTurns(history, plan.conversationBudgetTokens)
    if (historyProjectionChanged(history, bounded)) {
      const err = new AgentCompactionRequiredError(
        compactionError ?? new Error('Compacted history still exceeds the safe runtime envelope')
      )
      this.options.log.error(
        {
          event: 'agent.compaction.unsafe_omission_rejected',
          err,
          agentRunId: active.agentRunId,
          retainedMessages: bounded.length,
          omittedMessages: Math.max(0, history.length - bounded.length)
        },
        'Agent context stopped before omitting uncheckpointed conversation history'
      )
      throw err
    }
    return agentHistorySchema.parse(history)
  }

  async #runRollingCompaction(
    input: {
      agentSessionId: string
      agentRunId: string | null
      compactionId: string
      trigger: AgentCompactionTrigger
      config: Extract<ProviderConfig, { role: 'agent' }>
      credential: string
      modelLimits: AgentModelLimits
      signal: AbortSignal
      maxSteps: number
    } & AgentCompactionBudgets
  ): Promise<number> {
    const summarize = this.options.summarizeHistory
    if (summarize === undefined) throw new Error('Agent context compaction is unavailable')
    if (input.postCompactionBudgetTokens <= 0 || input.checkpointBudgetTokens <= 0) {
      throw new AgentCompactionRequiredError(
        new Error('The selected model has no safe post-compaction history budget')
      )
    }
    const sourceTokenBudget = agentMessageBudget(input.checkpointBudgetTokens, input.modelLimits)
    let completedSteps = 0
    for (let stepIndex = 1; stepIndex <= input.maxSteps; stepIndex += 1) {
      input.signal.throwIfAborted()
      const material = buildNextCompactionMaterial({
        database: this.options.database,
        agentSessionId: input.agentSessionId,
        ...(input.agentRunId === null ? {} : { excludeRunId: input.agentRunId }),
        sourceTokenBudget
      })
      if (material === null) {
        const remaining = loadContinuousRuntimeHistory(
          this.options.database,
          input.agentSessionId,
          input.agentRunId ?? undefined
        )
        if (
          completedSteps > 0 &&
          estimateAgentTokens(remaining) <= input.postCompactionBudgetTokens
        ) {
          break
        }
        throw new AgentCompactionRequiredError(
          new Error('No complete historical turn fits the compaction model input budget')
        )
      }
      const estimatedTokensBefore = estimateAgentTokens(material.sourcePayloadJson)
      const summarized = await summarize({
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId,
        compactionId: input.compactionId,
        trigger: input.trigger,
        config: input.config,
        credential: input.credential,
        modelLimits: input.modelLimits,
        sourcePayloadJson: material.sourcePayloadJson,
        coveredThroughSequence: material.coveredThroughSequence,
        estimatedInputTokens: estimatedTokensBefore,
        maxOutputTokens: input.checkpointBudgetTokens,
        signal: input.signal
      })
      const summary = boundCheckpointSummary(
        summarized.summary.trim().slice(0, 32_768),
        input.checkpointBudgetTokens
      )
      if (summary.length === 0) throw new Error('Agent compaction returned an empty summary')
      const tail = loadRuntimeTailAfterSequence(
        this.options.database,
        input.agentSessionId,
        material.coveredThroughSequence,
        input.agentRunId ?? undefined
      )
      const checkpointTokens = estimateAgentTokens(summary)
      const tailTokens = estimateAgentTokens(tail)
      const estimatedTokensAfter = checkpointTokens + tailTokens
      const fitsPostCompactionBudget = estimatedTokensAfter <= input.postCompactionBudgetTokens
      const fitsReservedTail = tailTokens <= input.recentTailBudgetTokens
      const finalStep =
        fitsPostCompactionBudget && (fitsReservedTail || !material.hasMoreCompactionCandidate)
      const payload = agentCompactionCheckpointPayloadSchema.parse({
        schemaVersion: 3,
        handoffMode: 'bounded_conversation_memory',
        compactionId: input.compactionId,
        trigger: input.trigger,
        stepIndex,
        finalStep,
        previousCheckpointEventId: material.previousCheckpoint?.eventId ?? null,
        coveredFromSequence: material.coveredFromSequence,
        coveredThroughSequence: material.coveredThroughSequence,
        summary,
        proposalOutcomes: material.proposalOutcomes,
        approvalDecisions: material.approvalDecisions,
        citationIds: material.citationIds,
        toolOutcomes: material.toolOutcomes,
        estimatedTokensBefore,
        estimatedTokensAfter,
        checkpointTokens,
        tailTokens,
        postCompactionBudgetTokens: input.postCompactionBudgetTokens,
        checkpointBudgetTokens: input.checkpointBudgetTokens,
        recentTailBudgetTokens: input.recentTailBudgetTokens,
        timestamp: this.#now().getTime()
      })
      await this.#appendAndPublishEvent({
        sessionId: input.agentSessionId,
        runId: input.agentRunId,
        type: 'compaction_summary',
        payload,
        modelRequestId: summarized.modelRequestId
      })
      completedSteps = stepIndex
      this.options.log.info(
        {
          event: 'agent.compaction.step_completed',
          agentRunId: input.agentRunId,
          compactionId: input.compactionId,
          stepIndex,
          finalStep,
          coveredThroughSequence: material.coveredThroughSequence,
          estimatedTokensBefore,
          estimatedTokensAfter
        },
        'Agent rolling context checkpoint step completed'
      )
      if (finalStep) break
      if (!material.hasMoreCompactionCandidate || stepIndex === input.maxSteps) {
        throw new AgentCompactionRequiredError(
          new Error('The newest complete historical turn exceeds the safe compaction budget')
        )
      }
    }
    return completedSteps
  }

  async #appendCompactionStarted(input: {
    agentSessionId: string
    agentRunId: string | null
    compactionId: string
    trigger: AgentCompactionTrigger
  }): Promise<void> {
    await this.#appendAndPublishEvent({
      sessionId: input.agentSessionId,
      runId: input.agentRunId,
      type: 'compaction_started',
      payload: agentCompactionStartedPayloadSchema.parse({
        schemaVersion: 2,
        compactionId: input.compactionId,
        trigger: input.trigger,
        phase: 'planning',
        timestamp: this.#now().getTime()
      }),
      modelRequestId: null
    })
  }

  async #appendCompactionFailed(input: {
    agentSessionId: string
    agentRunId: string | null
    compactionId: string
    trigger: AgentCompactionTrigger
    code: string
    retryable: boolean
    aborted: boolean
  }): Promise<void> {
    await this.#appendAndPublishEvent({
      sessionId: input.agentSessionId,
      runId: input.agentRunId,
      type: 'compaction_failed',
      payload: agentCompactionFailedPayloadSchema.parse({
        schemaVersion: 2,
        compactionId: input.compactionId,
        trigger: input.trigger,
        code: input.code,
        retryable: input.retryable,
        aborted: input.aborted,
        timestamp: this.#now().getTime()
      }),
      modelRequestId: null
    })
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
    const active = this.#activeRuns.get(agentRunId)
    if (active === undefined) {
      throw new Error('Agent run is not active')
    }
    return active
  }

  #reserveRunSlot(agentSessionId: string, agentRunId: string, controller: AbortController): void {
    this.#reserveWorkSlot(agentSessionId, agentRunId, 'run', controller)
  }

  #reserveWorkSlot(
    agentSessionId: string,
    workId: string,
    kind: 'run' | 'manual_compaction',
    controller: AbortController
  ): void {
    if (this.#workBySession.has(agentSessionId)) {
      this.options.log.warn(
        {
          event: 'agent.work.slot_rejected',
          agentSessionId,
          workId,
          kind,
          reason: 'conversation_active',
          activeCount: this.#workBySession.size,
          concurrencyLimit: MAX_CONCURRENT_AGENT_RUNS
        },
        'Agent work slot rejected because the conversation is already active'
      )
      throw new Error('Agent work is already active in this conversation')
    }
    if (this.#workBySession.size >= MAX_CONCURRENT_AGENT_RUNS) {
      this.options.log.warn(
        {
          event: 'agent.work.slot_rejected',
          agentSessionId,
          workId,
          kind,
          reason: 'project_capacity',
          activeCount: this.#workBySession.size,
          concurrencyLimit: MAX_CONCURRENT_AGENT_RUNS
        },
        'Agent work slot rejected because the project reached its concurrency limit'
      )
      throw new Error(
        `Up to ${MAX_CONCURRENT_AGENT_RUNS} Agent tasks can work at once. Stop one or wait for it to finish.`
      )
    }
    controller.signal.throwIfAborted()
    this.options.interactiveModelLimiter?.acquire({
      workId,
      ownerId: agentSessionId,
      kind: kind === 'run' ? 'agent_run' : 'agent_compaction',
      signal: controller.signal
    })
    this.#workBySession.set(agentSessionId, workId)
    this.options.log.info(
      {
        event: 'agent.work.slot_acquired',
        agentSessionId,
        workId,
        kind,
        activeCount: this.#workBySession.size,
        concurrencyLimit: MAX_CONCURRENT_AGENT_RUNS
      },
      'Agent work slot acquired'
    )
  }

  #releaseRunSlot(agentSessionId: string, agentRunId: string): void {
    this.#releaseWorkSlot(agentSessionId, agentRunId, 'run')
  }

  #releaseWorkSlot(
    agentSessionId: string,
    workId: string,
    kind: 'run' | 'manual_compaction'
  ): void {
    if (this.#workBySession.get(agentSessionId) !== workId) return
    this.#workBySession.delete(agentSessionId)
    this.options.interactiveModelLimiter?.release(workId)
    void this.#publishActivitySnapshot()
    this.options.log.info(
      {
        event: 'agent.work.slot_released',
        agentSessionId,
        workId,
        kind,
        activeCount: this.#workBySession.size,
        concurrencyLimit: MAX_CONCURRENT_AGENT_RUNS
      },
      'Agent work slot released'
    )
  }

  async #publishActivitySnapshot(): Promise<void> {
    try {
      await this.options.publishActivity?.(this.projectActivitySnapshot())
    } catch (err) {
      this.options.log.warn(
        { event: 'agent.activity.delivery_failed', err, activeCount: this.#workBySession.size },
        'Agent project activity delivery failed without changing run truth'
      )
    }
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

  #sessionIsCompacting(agentSessionId: string): boolean {
    return (
      [...this.#activeCompactions.values()].some(
        (compaction) => compaction.agentSessionId === agentSessionId
      ) ||
      [...this.#activeRuns.values()].some(
        (run) => run.agentSessionId === agentSessionId && run.phase === 'compacting'
      )
    )
  }

  #sessionIsAwaitingInput(agentSessionId: string): boolean {
    return [...this.#activeRuns.values()].some(
      (run) => run.agentSessionId === agentSessionId && run.pendingQuestion !== null
    )
  }

  #sessionApprovalMode(agentSessionId: string): AgentApprovalMode {
    const mode = this.options.database.immediate((database) =>
      database
        .prepare('SELECT approval_mode FROM agent_sessions WHERE agent_session_id = ?')
        .pluck()
        .get(agentSessionId)
    )
    if (mode !== 'manual' && mode !== 'section_auto' && mode !== 'yolo') {
      throw new Error('Agent session approval mode is invalid')
    }
    return mode
  }
}

function legacyModelLimits(): AgentModelLimits {
  return {
    contextWindowTokens: 131_072,
    inputLimitTokens: null,
    outputLimitTokens: null,
    source: 'legacy_fallback',
    catalogModelKey: null,
    resolvedAt: null
  }
}

function runtimeModelFromCatalog(resolved: ResolvedAgentCatalogModel): AgentRuntimeModel {
  const model = resolved.model
  const compat =
    model.compat === undefined
      ? undefined
      : (JSON.parse(JSON.stringify(model.compat)) as Record<string, unknown>)
  return agentRuntimeModelSchema.parse({
    id: model.id,
    name: model.name,
    api: model.api,
    provider: model.provider,
    baseUrl: resolved.auth.auth.baseUrl ?? model.baseUrl,
    reasoning: model.reasoning,
    ...(model.thinkingLevelMap === undefined ? {} : { thinkingLevelMap: model.thinkingLevelMap }),
    input: model.input,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    ...(compat === undefined ? {} : { compat })
  })
}

function pendingSkillSnapshot(): SkillRunSnapshot {
  return skillRunSnapshotSchema.parse({
    schemaVersion: 3,
    mode: 'auto',
    routingStatus: 'pending',
    requestedSkills: [],
    skills: [],
    dependencies: [],
    resources: [],
    safeError: null
  })
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
  | {
      status: 'failed'
      code:
        | 'provider_timeout'
        | 'provider_retries_exhausted'
        | 'context_overflow'
        | 'context_overflow_after_activity'
        | 'compaction_required'
        | 'tool_batch_context_exhausted'
        | 'skill_request_unfulfilled'
        | 'run_failed'
    }
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

class AgentRunSetupError extends Error {
  constructor(
    readonly code: string,
    cause: unknown
  ) {
    super(code, { cause })
    this.name = 'AgentRunSetupError'
  }
}

class AgentRunContextOverflowError extends Error {
  constructor(
    readonly code: 'context_overflow' | 'context_overflow_after_activity',
    cause: unknown
  ) {
    super(code, { cause })
    this.name = 'AgentRunContextOverflowError'
  }
}

class AgentSkillPreparationError extends Error {
  constructor(
    readonly code: 'skill_request_unfulfilled',
    message: string
  ) {
    super(message)
    this.name = 'AgentSkillPreparationError'
  }
}

class AgentCompactionRequiredError extends Error {
  readonly code = 'compaction_required'

  constructor(cause: unknown) {
    super('Conversation history could not be compacted without losing user requirements', { cause })
    this.name = 'AgentCompactionRequiredError'
  }
}

function classifyRunFailure(error: unknown, signal: AbortSignal): AgentRunTermination {
  if (signal.aborted && signal.reason instanceof AgentRunCancellationError) {
    return { status: 'interrupted', code: signal.reason.code }
  }
  if (error instanceof Error && error.name === 'ProviderTimeoutError') {
    return { status: 'failed', code: 'provider_timeout' }
  }
  if (error instanceof Error && error.name === 'ProviderRetriesExhaustedError') {
    return { status: 'failed', code: 'provider_retries_exhausted' }
  }
  if (error instanceof AgentRunContextOverflowError) {
    return { status: 'failed', code: error.code }
  }
  if (error instanceof AgentCompactionRequiredError) {
    return { status: 'failed', code: error.code }
  }
  if (error instanceof AgentSkillPreparationError) {
    return { status: 'failed', code: error.code }
  }
  if (hasErrorCode(error, 'skill_request_unfulfilled')) {
    return { status: 'failed', code: 'skill_request_unfulfilled' }
  }
  if (hasErrorCode(error, 'tool_batch_context_exhausted')) {
    return { status: 'failed', code: 'tool_batch_context_exhausted' }
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

function hasErrorCode(error: unknown, expected: string, depth = 0): boolean {
  if (depth > 6 || error === null || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; cause?: unknown }
  return candidate.code === expected || hasErrorCode(candidate.cause, expected, depth + 1)
}

function isContextOverflowError(error: unknown, depth = 0): boolean {
  if (depth > 6 || error === null || typeof error !== 'object') return false
  const candidate = error as {
    name?: unknown
    message?: unknown
    code?: unknown
    status?: unknown
    statusCode?: unknown
    cause?: unknown
  }
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : ''
  const message = typeof candidate.message === 'string' ? candidate.message.toLowerCase() : ''
  const status = candidate.statusCode ?? candidate.status
  if (
    code.includes('context_length') ||
    code.includes('context_window') ||
    /context (?:length|window).*(?:exceed|overflow|too long)|maximum context|too many tokens/u.test(
      message
    ) ||
    (status === 400 && /context|token limit/u.test(message))
  ) {
    return true
  }
  return isContextOverflowError(candidate.cause, depth + 1)
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
  retryable: boolean,
  recoveryUri?: string
): AgentToolResponse {
  return agentToolResponseSchema.parse({
    ...toolResponseCapability(request),
    schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
    ok: false,
    error: structuredToolError(code, message, retryable, request.toolName, recoveryUri)
  })
}

function clarificationHistoryMessage(result: AskUserResult): string {
  return `The user supplied these clarification answers. Treat them as user decisions for the requested task:\n${JSON.stringify(result.answers)}`
}

function safeToolError(
  err: unknown,
  toolName: AgentToolRequest['toolName'],
  signal: AbortSignal,
  deadlineSignal: AbortSignal | null
): {
  code: Extract<AgentToolResponse, { ok: false }>['error']['code']
  message: string
  retryable: boolean
  recoveryUri?: string
} {
  if (deadlineSignal?.aborted && !signal.aborted) {
    return { code: 'deadline_exceeded', message: 'Agent tool deadline exceeded', retryable: true }
  }
  if (signal.aborted) {
    return { code: 'aborted', message: 'Agent tool request was aborted', retryable: true }
  }
  if (err instanceof AgentToolDomainError) {
    return { code: err.code, message: err.message.slice(0, 1_000), retryable: err.retryable }
  }
  if (err instanceof SkillReadError) {
    return {
      code: err.code,
      message: err.message.slice(0, 1_000),
      retryable: false,
      ...(err.recoveryUri === undefined ? {} : { recoveryUri: err.recoveryUri })
    }
  }
  if (err instanceof ZodError) {
    const issue = err.issues[0]
    const path = issue?.path.length ? ` at /${issue.path.join('/')}` : ''
    return {
      code: 'invalid_arguments',
      message:
        `Invalid arguments for ${toolName}${path}: ${issue?.message ?? 'the input shape is invalid'}`.slice(
          0,
          1_000
        ),
      retryable: false
    }
  }
  if (toolName === 'generate_image') {
    const httpStatus = findToolErrorHttpStatus(err)
    const providerCode = findToolErrorProviderCode(err)
    const suffix = [
      httpStatus === undefined ? undefined : `HTTP ${httpStatus}`,
      providerCode
    ].filter((value): value is string => value !== undefined)
    const detail = suffix.length === 0 ? '' : ` (${suffix.join(' / ')})`
    const retryable =
      httpStatus === 408 || httpStatus === 429 || (httpStatus !== undefined && httpStatus >= 500)
    return {
      code: 'unavailable',
      message: retryable
        ? `Image provider is temporarily unavailable${detail}`
        : `Image provider rejected the generation request${detail}; verify the image API key, model access, and provider settings`,
      retryable
    }
  }
  return { code: 'internal', message: 'Agent tool failed', retryable: false }
}

function truncateUtf8(value: string, maximumBytes: number): string {
  if (Buffer.byteLength(value) <= maximumBytes) return value
  let low = 0
  let high = Math.min(value.length, maximumBytes)
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2)
    if (Buffer.byteLength(value.slice(0, midpoint)) <= maximumBytes) low = midpoint
    else high = midpoint - 1
  }
  if (
    low > 0 &&
    low < value.length &&
    value.charCodeAt(low - 1) >= 0xd800 &&
    value.charCodeAt(low - 1) <= 0xdbff &&
    value.charCodeAt(low) >= 0xdc00 &&
    value.charCodeAt(low) <= 0xdfff
  ) {
    low -= 1
  }
  return value.slice(0, low)
}

function boundHistoryByCompleteTurns(
  history: readonly AgentHistoryMessage[],
  tokenBudget: number
): AgentHistoryMessage[] {
  const checkpoint = isCheckpointHistoryMessage(history[0]) ? history[0] : undefined
  const tail = checkpoint === undefined ? history : history.slice(1)
  const turns: AgentHistoryMessage[][] = []
  for (const message of tail) {
    if (message.role === 'user' || turns.length === 0) turns.push([])
    turns.at(-1)?.push(message)
  }
  const selected: AgentHistoryMessage[][] = []
  const checkpointTokens = checkpoint === undefined ? 0 : estimateAgentTokens(checkpoint)
  const checkpointBytes =
    checkpoint === undefined ? 0 : Buffer.byteLength(JSON.stringify(checkpoint))
  let keepCheckpoint =
    checkpoint !== undefined && checkpointTokens <= tokenBudget && checkpointBytes + 3 <= 2_097_152
  const needsOmissionMarker =
    estimateAgentTokens(history) > tokenBudget ||
    Buffer.byteLength(JSON.stringify(history)) > 2_097_152 ||
    history.length > 200
  const omissionMarker: AgentHistoryMessage | undefined = needsOmissionMarker
    ? {
        role: 'user',
        content:
          '<WRITELLM_CONTEXT_OMISSION instructionSemantics="false" authority="none">Older complete turns were omitted by deterministic context fallback. Raw Agent events remain authoritative.</WRITELLM_CONTEXT_OMISSION>',
        timestamp: 0
      }
    : undefined
  const markerTokens = omissionMarker === undefined ? 0 : estimateAgentTokens(omissionMarker)
  const markerBytes =
    omissionMarker === undefined ? 0 : Buffer.byteLength(JSON.stringify(omissionMarker))
  if (keepCheckpoint && checkpointTokens + markerTokens > tokenBudget) keepCheckpoint = false
  let tokens = keepCheckpoint ? checkpointTokens : 0
  let bytes = keepCheckpoint ? checkpointBytes + 3 : 2
  let messages = keepCheckpoint ? 1 : 0
  if (omissionMarker !== undefined && markerTokens <= tokenBudget - tokens) {
    tokens += markerTokens
    bytes += markerBytes + 1
    messages += 1
  }
  for (const turn of turns.reverse()) {
    const turnTokens = estimateAgentTokens(turn)
    const turnBytes = Buffer.byteLength(JSON.stringify(turn)) + 1
    if (
      tokens + turnTokens > tokenBudget ||
      bytes + turnBytes > 2_097_152 ||
      messages + turn.length > 200
    ) {
      break
    }
    selected.push(turn)
    tokens += turnTokens
    bytes += turnBytes
    messages += turn.length
  }
  return [
    ...(keepCheckpoint && checkpoint !== undefined ? [checkpoint] : []),
    ...(omissionMarker !== undefined && messages > selected.flat().length + (keepCheckpoint ? 1 : 0)
      ? [omissionMarker]
      : []),
    ...selected.reverse().flat()
  ]
}

function historyProjectionChanged(
  original: readonly AgentHistoryMessage[],
  projected: readonly AgentHistoryMessage[]
): boolean {
  return (
    original.length !== projected.length ||
    projected.some((message, index) => message !== original[index])
  )
}

function isCheckpointHistoryMessage(
  message: AgentHistoryMessage | undefined
): message is Extract<AgentHistoryMessage, { role: 'user' }> {
  return message?.role === 'user' && message.content.startsWith('<WRITELLM_CONTEXT_CHECKPOINT ')
}

function boundCheckpointSummary(summary: string, tokenBudget: number): string {
  if (estimateAgentTokens(summary) <= tokenBudget) return summary
  const characters = Array.from(summary)
  let low = 1
  let high = characters.length
  let best = 1
  while (low <= high) {
    const count = Math.floor((low + high) / 2)
    const firstCount = Math.max(1, Math.floor(count * 0.65))
    const candidate = `${characters.slice(0, firstCount).join('')}\n[checkpoint shortened deterministically]\n${characters.slice(-(count - firstCount)).join('')}`
    if (estimateAgentTokens(candidate) <= tokenBudget) {
      best = count
      low = count + 1
    } else {
      high = count - 1
    }
  }
  const firstCount = Math.max(1, Math.floor(best * 0.65))
  return `${characters.slice(0, firstCount).join('')}\n[checkpoint shortened deterministically]\n${characters.slice(-(best - firstCount)).join('')}`
}

function findToolErrorHttpStatus(error: unknown, depth = 0): number | undefined {
  if (depth > 6 || error === null || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; cause?: unknown }
  const status = candidate.statusCode ?? candidate.status
  if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
    return status
  }
  return findToolErrorHttpStatus(candidate.cause, depth + 1)
}

function findToolErrorProviderCode(error: unknown, depth = 0): string | undefined {
  if (depth > 6 || error === null || typeof error !== 'object') return undefined
  const candidate = error as { providerCode?: unknown; cause?: unknown }
  if (
    typeof candidate.providerCode === 'string' &&
    /^[A-Z][A-Z0-9_]{1,127}$/.test(candidate.providerCode)
  ) {
    return candidate.providerCode
  }
  return findToolErrorProviderCode(candidate.cause, depth + 1)
}

function structuredToolError(
  code: Extract<AgentToolResponse, { ok: false }>['error']['code'],
  message: string,
  retryable: boolean,
  toolName: AgentToolRequest['toolName'],
  recoveryUri?: string
): Extract<AgentToolResponse, { ok: false }>['error'] {
  const refreshTool = recoveryToolFor(toolName)
  switch (code) {
    case 'invalid_arguments':
      if (/citation|source label/iu.test(message)) {
        return {
          code,
          category: 'validation',
          message: actionableToolErrorMessage(
            message,
            'Call search_knowledge, then read_citations, copy the returned provenance, and retry once.'
          ),
          recovery: { action: 'refresh_context', tool: 'search_knowledge', maxAttempts: 1 }
        }
      }
      return {
        code,
        category: 'validation',
        message: actionableToolErrorMessage(message, 'Fix the named fields and retry once.'),
        recovery: { action: 'fix_arguments', maxAttempts: 1 }
      }
    case 'unauthorized':
      if (toolName === 'read_writing_skill' && recoveryUri !== undefined) {
        return {
          code,
          category: 'authorization',
          message: actionableToolErrorMessage(
            message,
            `Call read_writing_skill with recovery.uri and retry once.`
          ),
          recovery: {
            action: 'refresh_context',
            tool: 'read_writing_skill',
            maxAttempts: 1,
            uri: recoveryUri
          }
        }
      }
      return {
        code,
        category: 'authorization',
        message: actionableToolErrorMessage(message, 'Do not retry this operation.'),
        recovery: { action: 'do_not_retry' }
      }
    case 'not_found':
    case 'conflict':
      return {
        code,
        category: code === 'conflict' ? 'conflict' : 'precondition',
        message: actionableToolErrorMessage(
          message,
          `Call ${refreshTool}, copy the refreshed values, and retry once.`
        ),
        recovery: {
          action: 'refresh_context',
          tool: refreshTool,
          maxAttempts: 1,
          ...(recoveryUri === undefined ? {} : { uri: recoveryUri })
        }
      }
    case 'stale_cursor':
      return {
        code,
        category: 'conflict',
        message: actionableToolErrorMessage(
          message,
          `Call ${toolName} without a cursor and restart once.`
        ),
        recovery: { action: 'restart_pagination', tool: toolName, maxAttempts: 1 }
      }
    case 'result_too_large':
      return {
        code,
        category: 'precondition',
        message: actionableToolErrorMessage(message, 'Reduce the requested page or result size.'),
        recovery: { action: 'reduce_scope' }
      }
    case 'deadline_exceeded':
      return {
        code,
        category: 'transient',
        message: actionableToolErrorMessage(message, 'Retry this operation once.'),
        recovery: { action: 'retry', maxAttempts: 1 }
      }
    case 'aborted':
      return {
        code,
        category: 'cancelled',
        message: actionableToolErrorMessage(message, 'Do not retry automatically.'),
        recovery: { action: 'do_not_retry' }
      }
    case 'unavailable':
      return {
        code,
        category: 'transient',
        message: actionableToolErrorMessage(
          message,
          retryable ? 'Retry this operation once.' : 'Ask the user to verify provider access.'
        ),
        recovery: {
          action: retryable ? 'retry' : 'ask_user',
          maxAttempts: retryable ? 1 : undefined
        }
      }
    case 'internal':
      return {
        code,
        category: 'internal',
        message: actionableToolErrorMessage(
          message,
          'Do not retry automatically; report the failure.'
        ),
        recovery: { action: 'do_not_retry' }
      }
  }
}

function recoveryToolFor(toolName: AgentToolRequest['toolName']): AgentToolRequest['toolName'] {
  if (toolName === 'submit_section_change' || toolName === 'generate_image') return 'read_section'
  if (toolName === 'submit_outline_change') return 'read_outline'
  if (toolName === 'record_review_issues' || toolName === 'update_review_issues') {
    return 'list_review_issues'
  }
  if (toolName === 'create_writing_task' || toolName === 'update_writing_task') {
    return 'get_writing_task'
  }
  if (toolName === 'read_writing_skill') return 'read_writing_skill'
  if (toolName === 'read_citations') return 'search_knowledge'
  return toolName
}

function actionableToolErrorMessage(message: string, next: string): string {
  const trimmed = message.trim().replace(/[.\s]+$/u, '')
  return `${trimmed}. Next: ${next}`.slice(0, 1_000)
}

function submitResultFromOutcome(
  outcome: MutationProposalOutcome,
  proposal?: {
    appliedBriefVersion: number | null
    appliedOutlineVersion: number | null
    appliedRevisionId: string | null
  },
  idMapping?: {
    createdSectionRefs?: Record<string, string>
    createdBlockRefs?: Record<string, string>
  }
) {
  const status =
    outcome.outcome === 'applied'
      ? 'applied'
      : outcome.outcome === 'already_satisfied'
        ? 'satisfied'
        : outcome.outcome === 'rejected'
          ? 'rejected'
          : 'conflicted'
  const applicationStatus =
    outcome.outcome === 'applied'
      ? 'applied'
      : outcome.outcome === 'already_satisfied'
        ? 'no_change'
        : outcome.outcome === 'conflict'
          ? 'conflict'
          : 'not_applied'
  return submitChangeResultSchema.parse({
    proposal: {
      proposalId: outcome.effectiveProposalId,
      kind: outcome.kind,
      status
    },
    application: {
      status: applicationStatus,
      ...(proposal?.appliedBriefVersion === null || proposal?.appliedBriefVersion === undefined
        ? {}
        : { resultingBriefVersion: proposal.appliedBriefVersion }),
      ...(proposal?.appliedOutlineVersion === null || proposal?.appliedOutlineVersion === undefined
        ? {}
        : { resultingOutlineVersion: proposal.appliedOutlineVersion }),
      ...(proposal?.appliedRevisionId === null || proposal?.appliedRevisionId === undefined
        ? {}
        : { resultingRevisionId: proposal.appliedRevisionId }),
      ...(idMapping?.createdSectionRefs === undefined
        ? {}
        : { createdSectionRefs: idMapping.createdSectionRefs }),
      ...(idMapping?.createdBlockRefs === undefined
        ? {}
        : { createdBlockRefs: idMapping.createdBlockRefs })
    },
    continuation: 'continue',
    warnings:
      outcome.message === null
        ? []
        : [{ code: `proposal_${outcome.outcome}`, message: outcome.message }]
  })
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

function skillResultProjection(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== 'object') return {}
  const value = data as Record<string, unknown>
  const project = (entry: unknown): Record<string, unknown> | null => {
    if (entry === null || typeof entry !== 'object') return null
    const record = entry as Record<string, unknown>
    return {
      skillId: record.skillId,
      displayName: record.displayName,
      commit: record.commit,
      relativePath: record.relativePath,
      sha256: record.sha256,
      byteSize: record.byteSize
    }
  }
  return {
    ...project(value),
    references: Array.isArray(value.references)
      ? value.references.map(project).filter((entry) => entry !== null)
      : [],
    dependencies: Array.isArray(value.dependencies)
      ? value.dependencies
          .map((entry) => {
            const projected = project(entry)
            if (projected === null) return null
            const record = entry as Record<string, unknown>
            return {
              ...projected,
              references: Array.isArray(record.references)
                ? record.references.map(project).filter((reference) => reference !== null)
                : []
            }
          })
          .filter((entry) => entry !== null)
      : []
  }
}

function safeSkillActivityProjection(
  uri: string,
  displayName: string
): { displayName: string; relativePath: string } {
  const match = /^writellm:\/\/skills\/[^/]+\/[a-f0-9]{40}\/(.+)$/u.exec(uri)
  const relativePath =
    match?.[1]
      ?.split('/')
      .map((part) => {
        try {
          return decodeURIComponent(part)
        } catch {
          return part
        }
      })
      .join('/') ?? 'SKILL.md'
  return { displayName, relativePath }
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string'))].slice(
    0,
    20
  )
}
