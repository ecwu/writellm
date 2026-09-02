import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
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
  agentModelRetryPayloadSchema,
  agentUserMessagePayloadSchema,
  type AgentAssistantMessagePayload,
  type AgentApprovalMode,
  type AgentCompactionTrigger,
  type AgentEditorContext,
  type AgentEventType,
  type AgentHistoryMessage,
  type AgentInteractionMode,
  type AgentRuntimeModel,
  type AgentRuntimeEvent,
  type AgentModelLimits,
  type AgentModelRetryFailureStage,
  type AgentUserMessagePayload,
  type WritingToolGroup
} from '../../shared/contracts/agent'
import {
  agentMessageBudget,
  agentOutputLimit,
  agentRuntimeMessageBudget,
  estimateAgentTokens
} from '../../shared/agent-context-budget'
import {
  activeAgentToolSetAllows,
  agentModelVisibleToolSpecs,
  agentToolEnvelope
} from '../../shared/agent-tool-specs'
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
  submitChangeResultSchema
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
  agentRuntimeModelFromResolved,
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
import { AgentTraceRepository } from './trace-repository'
import {
  AgentCompactionSourceLimitError,
  buildNextCompactionMaterial,
  loadContinuousRuntimeHistory,
  loadRuntimeTailAfterSequence
} from './context-checkpoint'
import {
  legacyModelLimits,
  pendingSkillSnapshot,
  insertEvent,
  fingerprint,
  safeErrorCode,
  emptyMetadata
} from './session-event-utils'
import {
  AgentRunCancellationError,
  AgentRunSetupError,
  AgentRunContextOverflowError,
  AgentCompactionRequiredError,
  AgentRunContinuationLostError,
  classifyRunFailure,
  compactionFailurePayload,
  isContextOverflowError,
  toolResponseCapability,
  toolErrorResponse,
  clarificationHistoryMessage,
  safeToolError,
  structuredToolError,
  submitResultFromOutcome
} from './session-run-errors'
import {
  truncateUtf8,
  boundHistoryByCompleteTurns,
  historyProjectionChanged,
  boundCheckpointSummary
} from './session-history'
import {
  extractToolProvenance,
  skillResultProjection,
  safeSkillActivityProjection
} from './session-projections'

const AGENT_EVENT_PAGE_ENVELOPE_RESERVE_BYTES = 8 * 1024
const SESSION_TITLE_OUTPUT_TOKENS = 64
const SESSION_TITLE_REASONING_OUTPUT_TOKENS = 512
const AGENT_RUN_FINALIZATION_EVENT_THRESHOLD = 180
const AGENT_FINALIZATION_INSTRUCTION =
  'This is the final model call for this run. No tools are available. Return the best complete answer you can now, including the evidence already gathered and any unfinished items. Do not claim unfinished work is complete.'

function citationRecoveryStateAfterToolResult(
  current: 'none' | 'searched' | 'expanded',
  toolName: AgentToolRequest['toolName'],
  data: unknown
): 'none' | 'searched' | 'expanded' {
  if (current === 'expanded' || data === null || typeof data !== 'object') return current
  const result = data as Record<string, unknown>
  if (
    toolName === 'read_citations' &&
    Array.isArray(result['citations']) &&
    result['citations'].length > 0
  ) {
    return 'expanded'
  }
  if (
    toolName === 'search_knowledge' &&
    Array.isArray(result['hits']) &&
    result['hits'].length > 0
  ) {
    return 'searched'
  }
  return current
}

function safeJsonObject(value: string | undefined): Record<string, unknown> | null {
  if (value === undefined) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

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
  phase: 'routing' | 'compacting' | 'running' | 'awaiting_input' | 'retry_available'
  readonly config: Extract<ProviderConfig, { role: 'agent' }>
  readonly editorContext: AgentEditorContext
  readonly approvalMode: AgentApprovalMode
  readonly interactionMode: AgentInteractionMode
  readonly thinkingLevel: AgentThinkingLevel
  readonly runtimeModel?: AgentRuntimeModel
  readonly modelLimits: AgentModelLimits
  readonly credential: string
  currentRequest: string
  readonly maxOutputTokens: number
  readonly temperature?: number
  readonly authorizedModelRequestIds: Set<string>
  readonly pendingModelRequestIds: Set<string>
  readonly skillToolModelRequestIds: Set<string>
  readonly nonSkillToolModelRequestIds: Set<string>
  readonly pendingMessages: PendingFollowUpMessage[]
  activeToolGroups: WritingToolGroup[]
  citationRecoveryState: 'none' | 'searched' | 'expanded'
  readonly snapshots: Map<string, WritingSnapshot>
  skillSnapshot: SkillRunSnapshot
  skillState: SkillRunState | null
  skillPrompt: AgentSkillPromptInput
  skillFallbackPrompt: AgentSkillPromptInput
  skillTraceToolCallId?: string
  systemPrompt: string
  partialText: string
  reviewPause: { proposalId: string; kind: string } | null
  pendingQuestion: PendingUserQuestion | null
  retryCapability: {
    capabilityId: string
    sourceModelRequestId: string
    reasonCode: 'network' | 'rate_limited' | 'server_error' | 'stream_ended'
    failureStage: AgentModelRetryFailureStage
    contextFingerprint: string
    label: 'retry_request' | 'continue'
  } | null
  overflowRetryAttempted: boolean
  finalizationStarted: boolean
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

type ModelCallFinishedEvent = Extract<AgentRuntimeEvent, { type: 'model_call_finished' }>

function traceCompletion(event: ModelCallFinishedEvent): {
  modelRequestId: string
  physicalAttemptCount: number
  httpStatus?: number
  ttftMs?: number
  totalDurationMs?: number
} {
  return {
    modelRequestId: event.modelRequestId,
    physicalAttemptCount: event.physicalAttemptCount ?? event.metadata.retryCount + 1,
    ...(event.httpStatus === undefined ? {} : { httpStatus: event.httpStatus }),
    ...(event.ttftMs === undefined ? {} : { ttftMs: event.ttftMs }),
    ...(event.totalDurationMs === undefined ? {} : { totalDurationMs: event.totalDurationMs })
  }
}

function traceFailure(
  event: ModelCallFinishedEvent,
  failureCode: string
): ReturnType<typeof traceCompletion> & { failureCode: string } {
  return { ...traceCompletion(event), failureCode }
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
    Partial<Pick<WritingSkillRuntime, 'closePreparation' | 'displayNameForUri' | 'read'>>
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
    modelRequestId: string
    agentSessionId: string
    agentRunId: string
    operationId: string
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
             status, approval_mode, interaction_mode, provider_preset_id, selected_model_id, thinking_level,
             skill_mode, skill_id,
             created_at, updated_at, archived_at
           ) VALUES (?, ?, ?, ?, 'active', ?, 'write', ?, ?, ?, 'auto', NULL, ?, ?, NULL)`
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
      interactionMode: 'write',
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
                    status, approval_mode, interaction_mode, provider_preset_id, selected_model_id,
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
          interaction_mode: AgentInteractionMode
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
          interactionMode: row.interaction_mode,
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

  setInteractionMode(agentSessionId: string, mode: AgentInteractionMode): AgentSessionRecord {
    if (this.#workBySession.has(agentSessionId)) {
      throw new Error('Agent interaction mode cannot change while work is active')
    }
    this.#assertCompatibleSession(agentSessionId)
    const now = this.#now().toISOString()
    this.options.database.immediate((database) => {
      const result = database
        .prepare(
          'UPDATE agent_sessions SET interaction_mode = ?, updated_at = ? WHERE agent_session_id = ?'
        )
        .run(mode, now, agentSessionId)
      if (result.changes !== 1) throw new Error('Agent session does not exist')
    })
    const session = this.#requireSessionRecord(agentSessionId)
    this.options.log.info(
      { event: 'agent.session.interaction_mode_updated', agentSessionId, mode },
      'Agent session interaction mode updated'
    )
    void this.#publishSession(session, false)
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
          interactionMode: row.interaction_mode,
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
    presentation?: AgentUserMessagePayload['presentation']
    interactionMode?: AgentInteractionMode
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
    presentation?: AgentUserMessagePayload['presentation']
    interactionMode?: AgentInteractionMode
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
          const approvalMode = this.#sessionApprovalMode(input.agentSessionId)
          const interactionMode =
            input.interactionMode ?? this.#sessionInteractionMode(input.agentSessionId)
          const storedThinkingLevel = this.#sessionThinkingLevel(input.agentSessionId)
          const thinkingLevel =
            resolved === undefined
              ? 'off'
              : clampResolvedAgentThinkingLevel(resolved, storedThinkingLevel)
          if (thinkingLevel !== storedThinkingLevel) {
            this.#reconcileThinkingLevel(input.agentSessionId, storedThinkingLevel, thinkingLevel)
          }
          const runtimeModel =
            resolved === undefined ? undefined : agentRuntimeModelFromResolved(resolved)
          const now = this.#now()
          const automaticTitle = this.#insertRunAndUserEvent({
            agentSessionId: input.agentSessionId,
            agentRunId: input.agentRunId,
            config,
            editorContext: input.editorContext,
            prompt: input.prompt,
            approvalMode,
            interactionMode,
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
            interactionMode,
            thinkingLevel,
            runtimeModel,
            modelLimits,
            credential,
            currentRequest: input.prompt,
            maxOutputTokens,
            ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
            authorizedModelRequestIds: new Set(),
            pendingModelRequestIds: new Set(),
            skillToolModelRequestIds: new Set(),
            nonSkillToolModelRequestIds: new Set(),
            pendingMessages: [],
            activeToolGroups: [],
            citationRecoveryState: 'none',
            snapshots: new Map(),
            skillSnapshot: pendingSkillSnapshot(),
            skillState: null,
            skillPrompt: { mode: 'auto', mandatory: '', references: [] },
            skillFallbackPrompt: { mode: 'auto', mandatory: '', references: [] },
            systemPrompt: input.systemPrompt ?? FALLBACK_AGENT_SYSTEM_PROMPT,
            partialText: '',
            reviewPause: null,
            pendingQuestion: null,
            retryCapability: null,
            overflowRetryAttempted: false,
            finalizationStarted: false,
            completion: Promise.resolve()
          }
          let markPrepared: () => void = () => undefined
          const prepared = new Promise<void>((resolve) => {
            markPrepared = resolve
          })
          active.completion = this.#prepareAndRun(active, {
            credential,
            prompt: input.prompt,
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
              interactionMode,
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
      maxOutputTokens: number
      temperature?: number
      markPrepared: () => void
    }
  ): Promise<void> {
    if (this.options.skillRouter !== undefined && active.interactionMode !== 'ask') {
      try {
        const routed = await this.options.skillRouter.route({
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
        active.skillFallbackPrompt = routed.fallbackPrompt ?? {
          mode: 'auto',
          mandatory: '',
          references: []
        }
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
        skillPrompt: active.skillPrompt,
        interactionMode: active.interactionMode
      })
    } catch (err) {
      if (
        err instanceof SkillPromptBudgetError &&
        active.skillSnapshot.mode === 'explicit' &&
        active.skillSnapshot.routingStatus === 'selected'
      ) {
        this.options.log.warn(
          {
            event: 'skill.selection.degraded',
            err,
            agentRunId: active.agentRunId,
            code: 'skill_prompt_budget_exceeded',
            requestedCount: active.skillSnapshot.requestedSkills.length,
            selectedCount: active.skillSnapshot.skills.length,
            dependencyCount: active.skillSnapshot.dependencies.length
          },
          'Requested Writing Skill injection was dropped because the final context exceeded budget'
        )
        active.skillSnapshot = {
          schemaVersion: 3,
          mode: 'explicit',
          routingStatus: 'degraded',
          requestedSkills: [],
          skills: [],
          dependencies: [],
          resources: [],
          safeError: 'skill_prompt_budget_exceeded'
        }
        active.skillPrompt = active.skillFallbackPrompt
        try {
          builtContext = this.options.contextBuilder?.build({
            prompt: input.prompt,
            editorContext: active.editorContext,
            snapshotId: modelRequestId,
            skillPrompt: active.skillPrompt,
            interactionMode: active.interactionMode
          })
        } catch (fallbackError) {
          throw new AgentRunSetupError('agent_context_failed', fallbackError)
        }
      } else {
        throw new AgentRunSetupError(
          err instanceof SkillPromptBudgetError
            ? 'skill_prompt_budget_exceeded'
            : 'agent_context_failed',
          err
        )
      }
    }
    if (builtContext?.skillPromptDropped === true) {
      if (active.skillSnapshot.mode !== 'explicit') {
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
              ? err.code
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
        toolProfile: 'writing',
        interactionMode: active.interactionMode,
        activeToolGroups: active.activeToolGroups,
        runtimeMessageBudgetTokens: this.#runtimeMessageBudget(
          active,
          active.systemPrompt,
          active.activeToolGroups
        ),
        traceCapture: true,
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
    const active = this.#requireQueueableRun(agentRunId, true)
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
      skillPrompt: active.skillPrompt,
      interactionMode: active.interactionMode
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

  async retryRequest(agentRunId: string, capabilityId: string): Promise<void> {
    const active = this.#requireActive(agentRunId)
    const capability = active.retryCapability
    if (
      active.phase !== 'retry_available' ||
      active.handle === null ||
      capability === null ||
      capability.capabilityId !== capabilityId
    ) {
      throw new Error('Agent request retry capability is no longer available')
    }
    if (active.reviewPause !== null || active.pendingQuestion !== null) {
      throw new Error('Agent request cannot be retried while a user decision is pending')
    }
    const source = this.options.database.immediate((database) =>
      database
        .prepare(
          `SELECT status, error_json
             FROM model_requests
            WHERE model_request_id = ? AND agent_run_id = ? AND operation_kind = 'agent'`
        )
        .get(capability.sourceModelRequestId, active.agentRunId)
    ) as { status: string; error_json: string | null } | undefined
    const sourceError = source?.error_json === null ? null : safeJsonObject(source?.error_json)
    if (
      source?.status !== 'failed' ||
      sourceError?.['retryable'] !== true ||
      active.pendingModelRequestIds.has(capability.sourceModelRequestId)
    ) {
      throw new Error('Agent request retry source is not a settled retryable failure')
    }
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    const targetModelRequestId = (
      await repository.start({
        operation: 'agent',
        provider: active.config,
        request: {
          delivery: 'retry_last_request',
          sourceModelRequestId: capability.sourceModelRequestId,
          stage: capability.failureStage,
          contextFingerprint: capability.contextFingerprint
        },
        thinkingLevel: active.thinkingLevel,
        inputItems: 0,
        operationId: active.operationId,
        agentRunId: active.agentRunId,
        projectSessionId: this.options.projectSessionId
      })
    ).modelRequestId
    active.authorizedModelRequestIds.add(targetModelRequestId)
    active.pendingModelRequestIds.add(targetModelRequestId)
    await this.#appendAndPublishEvent({
      sessionId: active.agentSessionId,
      runId: active.agentRunId,
      type: 'model_retry',
      payload: agentModelRetryPayloadSchema.parse({
        schemaVersion: 1,
        sourceModelRequestId: capability.sourceModelRequestId,
        targetModelRequestId,
        reasonCode: capability.reasonCode,
        failureStage: capability.failureStage,
        contextFingerprint: capability.contextFingerprint,
        actor: 'user',
        timestamp: this.#now().getTime()
      }),
      modelRequestId: targetModelRequestId
    })
    active.retryCapability = null
    active.phase = 'running'
    active.partialText = ''
    await this.#publishActivitySnapshot()
    try {
      active.handle.authorizeModelRetry({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        capabilityId,
        sourceModelRequestId: capability.sourceModelRequestId,
        targetModelRequestId
      })
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.model_retry.delivery_failed',
          err,
          agentRunId,
          sourceModelRequestId: capability.sourceModelRequestId,
          targetModelRequestId
        },
        'Failed to authorize Agent model retry'
      )
      await repository.abort(targetModelRequestId, 'retry_delivery_failed')
      active.pendingModelRequestIds.delete(targetModelRequestId)
      active.controller.abort(err)
      throw err
    }
    this.options.log.info(
      {
        event: 'agent.model_retry.authorized',
        agentRunId,
        sourceModelRequestId: capability.sourceModelRequestId,
        targetModelRequestId,
        failureStage: capability.failureStage
      },
      'Authorized Agent model retry from the original request anchor'
    )
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
    let hasCompactionCandidate = true
    try {
      hasCompactionCandidate =
        buildNextCompactionMaterial({ database: this.options.database, agentSessionId }) !== null
    } catch (err) {
      if (!(err instanceof AgentCompactionSourceLimitError)) throw err
    }
    if (!hasCompactionCandidate) {
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
        ...compactionFailurePayload(err, active.controller.signal.aborted),
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
        retry:
          active.retryCapability === null
            ? null
            : {
                capabilityId: active.retryCapability.capabilityId,
                sourceModelRequestId: active.retryCapability.sourceModelRequestId,
                reasonCode: active.retryCapability.reasonCode,
                failureStage: active.retryCapability.failureStage,
                label: active.retryCapability.label
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

  #requireQueueableRun(
    agentRunId: string,
    allowRetryAvailable = false
  ): ActiveRun & { handle: AgentSessionRunHandle } {
    const active = this.#requireActive(agentRunId)
    if (
      (active.phase !== 'running' &&
        !(allowRetryAvailable && active.phase === 'retry_available')) ||
      active.handle === null
    ) {
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
      skillPrompt: active.skillPrompt,
      interactionMode: active.interactionMode
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
    if (event.type === 'model_trace_capture_requested') {
      const trace = new AgentTraceRepository(
        this.options.database,
        this.options.log,
        this.#now,
        this.#createId
      )
      const toolCallId = event.documents
        .map((document) => document.metadata?.toolCallId)
        .find((value): value is string => typeof value === 'string')
      trace.capture({
        modelRequestId: event.modelRequestId,
        purpose: event.purpose,
        apiId: event.apiId,
        traceId: active.agentRunId,
        spanId: event.modelRequestId,
        ...(event.parentModelRequestId === undefined
          ? {}
          : { parentSpanId: event.parentModelRequestId }),
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        ...(toolCallId === undefined ? {} : { toolCallId }),
        physicalAttempt: event.physicalAttempt,
        documents: event.documents
      })
      if (
        event.purpose === 'tool_continuation' &&
        active.skillTraceToolCallId !== undefined &&
        event.documents.some((document) => document.kind === 'harness_request')
      ) {
        trace.capture({
          modelRequestId: event.modelRequestId,
          purpose: event.purpose,
          apiId: event.apiId,
          traceId: active.agentRunId,
          spanId: event.modelRequestId,
          agentSessionId: active.agentSessionId,
          agentRunId: active.agentRunId,
          toolCallId: active.skillTraceToolCallId,
          physicalAttempt: trace.nextDocumentOccurrence(event.modelRequestId, 'skill_content'),
          documents: [
            {
              kind: 'skill_content',
              value: {
                snapshot: active.skillSnapshot,
                injectedPrompt: active.skillPrompt
              },
              metadata: { nextModelRequestId: event.modelRequestId }
            }
          ]
        })
        active.skillTraceToolCallId = undefined
      }
      return
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
    if (event.type === 'model_retry_available') {
      if (active.pendingModelRequestIds.has(event.modelRequestId)) {
        throw new Error('Agent model retry was offered before the source request settled')
      }
      if (active.reviewPause !== null || active.pendingQuestion !== null) {
        throw new Error('Agent model retry conflicts with a pending user decision')
      }
      active.phase = 'retry_available'
      active.retryCapability = {
        capabilityId: event.capabilityId,
        sourceModelRequestId: event.modelRequestId,
        reasonCode: event.reasonCode,
        failureStage: event.failureStage,
        contextFingerprint: event.contextFingerprint,
        label: event.label
      }
      await this.#publishActivitySnapshot()
      this.options.log.warn(
        {
          event: 'agent.model_retry.available',
          agentRunId: active.agentRunId,
          modelRequestId: event.modelRequestId,
          reasonCode: event.reasonCode,
          failureStage: event.failureStage
        },
        'Agent request can be retried from its in-memory request anchor'
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
      const trace = new AgentTraceRepository(
        this.options.database,
        this.options.log,
        this.#now,
        this.#createId
      )
      if (event.outcome === 'succeeded') {
        await repository.succeed(event.modelRequestId, { metadata: event.metadata, outputItems: 1 })
        if (trace.exists(event.modelRequestId)) trace.complete(traceCompletion(event))
      } else if (event.outcome === 'timed_out') {
        await repository.fail(event.modelRequestId, {
          code: 'provider_timeout',
          retryable: true
        })
        if (trace.exists(event.modelRequestId)) {
          trace.fail(traceFailure(event, 'provider_timeout'))
        }
      } else if (event.outcome === 'aborted') {
        await repository.abort(event.modelRequestId, 'aborted', event.metadata)
        if (trace.exists(event.modelRequestId)) trace.fail(traceFailure(event, 'aborted'))
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
        if (trace.exists(event.modelRequestId)) {
          trace.fail(traceFailure(event, event.failureCode ?? 'provider_request_failed'))
        }
      }
      active.pendingModelRequestIds.delete(event.modelRequestId)
      return
    }
    if (event.type !== 'assistant_message') return
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
    if (active.finalizationStarted) {
      throw new AgentRunContinuationLostError(
        new Error('Agent requested another tool continuation after finalization started')
      )
    }
    const eventCount = Number(
      this.options.database.immediate((database) =>
        database
          .prepare('SELECT COUNT(*) FROM agent_events WHERE agent_run_id = ?')
          .pluck()
          .get(active.agentRunId)
      )
    )
    const finalize = eventCount >= AGENT_RUN_FINALIZATION_EVENT_THRESHOLD
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
        skillPrompt: active.skillPrompt,
        interactionMode: active.interactionMode
      })
      if (refreshedContext !== undefined) {
        this.#retainIncludedSkillResources(active, refreshedContext.includedSkillResources)
        active.snapshots.set(modelRequestId, refreshedContext.snapshot)
        active.systemPrompt = refreshedContext.systemPrompt
      }
      const baseSystemPrompt = refreshedContext?.systemPrompt ?? active.systemPrompt
      const systemPrompt = finalize
        ? `${baseSystemPrompt.slice(0, 65_536 - AGENT_FINALIZATION_INSTRUCTION.length - 2)}\n\n${AGENT_FINALIZATION_INSTRUCTION}`
        : baseSystemPrompt
      if (finalize) {
        active.finalizationStarted = true
        this.options.log.info(
          {
            event: 'agent.run.finalization_started',
            agentRunId: active.agentRunId,
            modelRequestId,
            continuationId,
            eventCount
          },
          'Agent run reached its event limit and started a final tool-free model call'
        )
      }
      handle.authorizeModelCall({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: active.agentSessionId,
        agentRunId: active.agentRunId,
        continuationId,
        modelRequestId,
        systemPrompt,
        interactionMode: active.interactionMode,
        activeToolGroups: active.activeToolGroups,
        runtimeMessageBudgetTokens: this.#runtimeMessageBudget(
          active,
          systemPrompt,
          active.activeToolGroups,
          finalize
        ),
        finalize
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
          traceId: active.agentRunId,
          agentSessionId: active.agentSessionId,
          err: new Error('Agent tool request capability mismatch'),
          agentRunId,
          modelRequestId: request.modelRequestId,
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
    if (
      !activeAgentToolSetAllows(
        'writing',
        active.activeToolGroups,
        request.toolName,
        active.interactionMode
      )
    ) {
      this.options.log.warn(
        {
          event: 'agent.tool.inactive_group_rejected',
          traceId: active.agentRunId,
          agentSessionId: active.agentSessionId,
          agentRunId,
          modelRequestId: request.modelRequestId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          activeToolGroups: active.activeToolGroups
        },
        'Rejected an Agent tool outside the active writing tool groups'
      )
      return toolErrorResponse(
        request,
        'unauthorized',
        'Agent tool is not active for this run',
        false
      )
    }
    const toolStartedAt = this.#now().getTime()
    const skillToolRequest = request.toolName === 'read_writing_skill'
    const mixedToolBatch = skillToolRequest
      ? active.nonSkillToolModelRequestIds.has(request.modelRequestId)
      : active.skillToolModelRequestIds.has(request.modelRequestId)
    if (!mixedToolBatch) {
      const requestIds = skillToolRequest
        ? active.skillToolModelRequestIds
        : active.nonSkillToolModelRequestIds
      requestIds.add(request.modelRequestId)
    }
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
      if (mixedToolBatch) {
        throw new AgentToolDomainError(
          'conflict',
          'Writing Skill reads cannot be mixed with other tools in one assistant response',
          true
        )
      }
      let data: unknown
      if (request.toolName === 'ask_user') {
        data = await this.#waitForUserAnswer(active, request, toolSignal)
      } else if (request.toolName === 'activate_tool_groups') {
        const requested = request.args.groups
        const alreadyActive = requested.filter((group) => active.activeToolGroups.includes(group))
        const activated = requested.filter((group) => !active.activeToolGroups.includes(group))
        const activeGroups = [...active.activeToolGroups, ...activated]
        try {
          this.#runtimeMessageBudget(active, active.systemPrompt, activeGroups)
        } catch (err) {
          throw new AgentToolDomainError(
            'unavailable',
            'The selected model cannot safely fit the requested writing tool groups',
            false,
            { cause: err }
          )
        }
        active.activeToolGroups = activeGroups
        data = { activated, alreadyActive, activeGroups }
        this.options.log.info(
          {
            event: 'agent.tool_groups.activated',
            agentRunId: active.agentRunId,
            activated,
            alreadyActive,
            activeToolGroups: activeGroups
          },
          'Activated writing tool groups for the current Agent run'
        )
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
        active.skillTraceToolCallId = request.toolCallId
        this.#updateSkillSnapshot(active.agentRunId, read.snapshot)
        data = read.data
        const trace = new AgentTraceRepository(
          this.options.database,
          this.options.log,
          this.#now,
          this.#createId
        )
        trace.capture({
          modelRequestId: request.modelRequestId,
          purpose: 'tool_continuation',
          apiId: active.runtimeModel?.api ?? active.config.api ?? 'openai-completions',
          traceId: active.agentRunId,
          spanId: request.modelRequestId,
          agentSessionId: active.agentSessionId,
          agentRunId: active.agentRunId,
          toolCallId: request.toolCallId,
          physicalAttempt: trace.nextDocumentOccurrence(request.modelRequestId, 'skill_content'),
          documents: [
            {
              kind: 'skill_content',
              value: {
                skillId: read.data.skillId,
                displayName: read.data.displayName,
                commit: read.data.commit,
                relativePath: read.data.relativePath,
                sha256: read.data.sha256,
                byteSize: read.data.byteSize,
                content: read.data.content
              }
            }
          ]
        })
      } else if (this.options.tools === undefined) {
        throw new AgentToolDomainError('unavailable', 'Agent read tools are unavailable', true)
      } else {
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
      active.citationRecoveryState = citationRecoveryStateAfterToolResult(
        active.citationRecoveryState,
        request.toolName,
        data
      )
      if (request.toolName === 'ask_user') {
        this.#completePendingUserQuestion(active, request.toolCallId, true)
      }
      return response
    } catch (err) {
      this.options.log.error(
        {
          event: 'agent.tool.execution_failed',
          traceId: active.agentRunId,
          agentSessionId: active.agentSessionId,
          err,
          agentRunId,
          modelRequestId: request.modelRequestId,
          toolCallId: request.toolCallId,
          toolName: request.toolName
        },
        'Agent tool execution failed'
      )
      const safe = safeToolError(err, request.toolName, signal, deadlineSignal)
      const citationRecoveryState = /citation|source label/iu.test(safe.message)
        ? active.citationRecoveryState
        : 'none'
      const structured = structuredToolError(
        safe.code,
        safe.message,
        safe.retryable,
        request.toolName,
        safe.recoveryUri,
        citationRecoveryState
      )
      this.options.log.warn(
        {
          event: 'agent.tool.safe_failure_projected',
          traceId: active.agentRunId,
          agentSessionId: active.agentSessionId,
          agentRunId,
          modelRequestId: request.modelRequestId,
          toolCallId: request.toolCallId,
          toolName: request.toolName,
          phase: 'dispatched',
          code: structured.code,
          category: structured.category,
          citationRecoveryState,
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
        return toolErrorResponse(
          request,
          safe.code,
          safe.message,
          safe.retryable,
          safe.recoveryUri,
          citationRecoveryState
        )
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
        throw new AgentRunContinuationLostError(
          new Error('Agent run completed with authorized model requests that were not consumed')
        )
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
    const plan = this.#contextPlanner.plan({
      modelLimits: active.modelLimits,
      requestedOutputTokens: active.maxOutputTokens,
      systemPrompt: active.systemPrompt,
      history: historyBefore,
      currentRequest: active.currentRequest,
      advertisedTools: this.#activeToolEnvelope(active.activeToolGroups, active.interactionMode)
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
        ...compactionFailurePayload(err, active.controller.signal.aborted),
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
        toolProfile: 'writing',
        interactionMode: active.interactionMode,
        activeToolGroups: active.activeToolGroups,
        runtimeMessageBudgetTokens: this.#runtimeMessageBudget(
          active,
          active.systemPrompt,
          active.activeToolGroups
        ),
        traceCapture: true,
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
    interactionMode: AgentInteractionMode
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
             provider_fingerprint, model_fingerprint, approval_mode, interaction_mode, thinking_level, model_limits_json,
             editor_context_json, skill_snapshot_json, writing_task_id, writing_task_step_id,
             error_json, started_at, completed_at, created_at, updated_at
           ) VALUES (?, ?, 'running', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL, ?, ?)`
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
          input.interactionMode,
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
        modelRequestId,
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId,
        operationId: input.operationId,
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
      const trace = new AgentTraceRepository(
        this.options.database,
        this.options.log,
        this.#now,
        this.#createId
      )
      if (trace.exists(modelRequestId)) {
        trace.complete({
          modelRequestId,
          physicalAttemptCount: result.metadata.retryCount + 1
        })
      }
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
        const trace = new AgentTraceRepository(
          this.options.database,
          this.options.log,
          this.#now,
          this.#createId
        )
        if (trace.exists(modelRequestId)) {
          trace.fail({
            modelRequestId,
            physicalAttemptCount: 1,
            failureCode:
              err instanceof Error && 'code' in err && typeof err.code === 'string'
                ? err.code
                : 'session_title_failed'
          })
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
    let plan = this.#contextPlanner.plan({
      modelLimits: active.modelLimits,
      requestedOutputTokens: input.maxOutputTokens,
      systemPrompt: active.systemPrompt,
      history,
      currentRequest: input.currentRequest,
      advertisedTools: this.#activeToolEnvelope(active.activeToolGroups, active.interactionMode)
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
        ...compactionFailurePayload(err, active.controller.signal.aborted),
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

  #activeToolEnvelope(
    activeToolGroups: readonly WritingToolGroup[],
    interactionMode: AgentInteractionMode
  ): unknown[] {
    return agentToolEnvelope(
      agentModelVisibleToolSpecs('writing', activeToolGroups, interactionMode)
    )
  }

  #runtimeMessageBudget(
    active: Pick<ActiveRun, 'maxOutputTokens' | 'modelLimits' | 'interactionMode'>,
    systemPrompt: string,
    activeToolGroups: readonly WritingToolGroup[],
    finalize = false
  ): number {
    return agentRuntimeMessageBudget({
      maxOutputTokens: active.maxOutputTokens,
      limits: active.modelLimits,
      systemPrompt,
      advertisedTools: finalize
        ? []
        : this.#activeToolEnvelope(activeToolGroups, active.interactionMode)
    })
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
      let material: ReturnType<typeof buildNextCompactionMaterial>
      try {
        material = buildNextCompactionMaterial({
          database: this.options.database,
          agentSessionId: input.agentSessionId,
          ...(input.agentRunId === null ? {} : { excludeRunId: input.agentRunId }),
          sourceTokenBudget
        })
      } catch (err) {
        if (err instanceof AgentCompactionSourceLimitError) {
          this.options.log.warn(
            {
              event: 'agent.compaction.source_limit_rejected',
              err,
              agentRunId: input.agentRunId,
              compactionId: input.compactionId,
              reason: err.reason
            },
            'Agent compaction rejected a source run that cannot be summarized atomically'
          )
          throw new AgentCompactionRequiredError(err)
        }
        throw err
      }
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
      const estimatedTokensBefore = material.estimatedPromptTokens
      this.options.log.info(
        {
          event: 'agent.compaction.projection_completed',
          agentRunId: input.agentRunId,
          compactionId: input.compactionId,
          stepIndex,
          sourceEventCount: material.sourceEventCount,
          rawPayloadBytes: material.sourcePayloadBytes,
          projectedPromptCharacters: material.projectedPromptCharacters,
          estimatedPromptTokens: material.estimatedPromptTokens,
          discardedObservationCharacters: material.discardedObservationCharacters,
          deduplicatedObservationCount: material.deduplicatedObservationCount,
          retainedContinuationFactCount: material.retainedContinuationFactCount
        },
        'Projected bounded writing continuation facts for Agent compaction'
      )
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

  #sessionInteractionMode(agentSessionId: string): AgentInteractionMode {
    const mode = this.options.database.immediate((database) =>
      database
        .prepare('SELECT interaction_mode FROM agent_sessions WHERE agent_session_id = ?')
        .pluck()
        .get(agentSessionId)
    )
    if (mode !== 'ask' && mode !== 'plan' && mode !== 'write') {
      throw new Error('Agent session interaction mode is invalid')
    }
    return mode
  }
}
