import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import {
  NOTEBOOK_MAX_CHAT_BYTES,
  NOTEBOOK_MAX_CITATIONS,
  NOTEBOOK_MAX_MESSAGES,
  NOTEBOOK_MAX_SOURCES,
  notebookChatEventSchema,
  notebookChatSnapshotSchema,
  notebookChatStartTurnInputSchema,
  notebookChatStartTurnResultSchema,
  notebookSourceScopeSchema,
  type NotebookChatCitation,
  type NotebookChatEvent,
  type NotebookChatMessage,
  type NotebookChatSnapshot,
  type NotebookChatStartTurnResult,
  type NotebookSourceScope
} from '../../shared/contracts/notebook'
import {
  agentHistorySchema,
  type AgentAssistantMessagePayload,
  type AgentHistoryMessage,
  type AgentRuntimeEvent
} from '../../shared/contracts/agent'
import {
  AGENT_TOOL_RESULT_SCHEMA_VERSION,
  agentToolResponseSchema,
  type AgentToolRequest,
  type AgentToolResponse
} from '../../shared/contracts/agent-tools'
import type { KnowledgeItem } from '../../shared/contracts/knowledge'
import type {
  AgentModelSelection,
  AgentThinkingLevel,
  ProviderConfig
} from '../../shared/contracts/providers'
import type { ProjectDatabase } from '../project/project-database'
import type { RetrievalService } from '../search/retrieval-service'
import type { ProjectIndexService } from '../search/index-service'
import {
  agentCredentialFromResolved,
  agentModelLimitsFromResolved,
  agentProviderConfigFromResolved,
  agentRuntimeModelFromResolved,
  clampResolvedAgentThinkingLevel,
  type AgentProviderCatalogService,
  type ResolvedAgentCatalogModel
} from '../providers/agent-provider-catalog'
import type { AgentSessionRunHandle, AgentSessionRuntime } from '../providers/gateways'
import { ModelRequestRepository } from '../providers/model-request-repository'
import type { ProjectInteractiveModelLimiter } from '../agent/project-interactive-model-limiter'
import {
  formatNotebookChatPrompt,
  NOTEBOOK_CHAT_SYSTEM_PROMPT
} from '../agent/prompts/notebook-chat'
import { executeCitationRead, executeKnowledgeSearch } from '../agent/knowledge-tools'

const NO_EVIDENCE_MESSAGE = '选中的资料中没有足够信息。'
const STOP_TIMEOUT_MS = 5_000
const HISTORY_MAX_BYTES = 64 * 1024
const CITATION_MARKER = /\[\[cite:(\d{1,3})\]\]/gu

interface ActiveNotebookTurn {
  turnId: string
  userMessageId: string
  assistantMessageId: string
  controller: AbortController
  completion: Promise<void>
  detached: boolean
  operationId: string
  agentRunId: string
  sourceIds: string[]
  config: Extract<ProviderConfig, { role: 'agent' }>
  thinkingLevel: AgentThinkingLevel
  handle: AgentSessionRunHandle | null
  authorizedModelRequestIds: Set<string>
  pendingModelRequestIds: Set<string>
  citationsById: Map<string, NotebookChatCitation>
  finalMessage: AgentAssistantMessagePayload | null
}

export interface KnowledgeChatServiceOptions {
  projectId: string
  projectSessionId: string
  database: ProjectDatabase
  retrieval: Pick<RetrievalService, 'search' | 'expand'>
  projectIndex: Pick<ProjectIndexService, 'currentIndexedSources'>
  listKnowledgeItems: () => KnowledgeItem[]
  agentCatalog: Pick<AgentProviderCatalogService, 'snapshot' | 'resolve'>
  runtime: AgentSessionRuntime
  limiter: ProjectInteractiveModelLimiter
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  publish?: (event: NotebookChatEvent) => void | Promise<void>
  now?: () => Date
  createId?: () => string
}

export class NotebookChatCapacityError extends Error {
  constructor() {
    super('Notebook reached its temporary chat limit. Clear the chat to continue.')
    this.name = 'NotebookChatCapacityError'
  }
}

export class KnowledgeChatService {
  readonly #now: () => Date
  readonly #createId: () => string
  #revision = 0
  #phase: NotebookChatSnapshot['phase'] = 'idle'
  #messages: NotebookChatMessage[] = []
  #sourceScope: NotebookSourceScope = { mode: 'all', knowledgeItemIds: [] }
  #sourceReadiness: NotebookChatSnapshot['sourceReadiness'] = 'preparing'
  #availableKnowledgeItemIds: string[] = []
  #effectiveSourceIds: string[] | null = null
  #contextEpoch = 0
  #modelSelection: AgentModelSelection | null = null
  #thinkingLevel: AgentThinkingLevel = 'off'
  #assistantHistory = new Map<string, AgentAssistantMessagePayload>()
  #agentSessionId: string
  #lastError: string | null = null
  #activeTurn: ActiveNotebookTurn | null = null
  #initialized = false
  #closed = false

  constructor(private readonly options: KnowledgeChatServiceOptions) {
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
    this.#agentSessionId = this.#createId()
  }

  async snapshot(): Promise<NotebookChatSnapshot> {
    this.#assertOpen()
    await this.#initialize()
    await this.#reconcileSources()
    return this.#snapshot()
  }

  async setSources(rawScope: NotebookSourceScope): Promise<NotebookChatSnapshot> {
    this.#assertOpen()
    await this.#initialize()
    if (this.#activeTurn !== null) throw new Error('Stop the active Notebook answer first')
    const scope = notebookSourceScopeSchema.parse(rawScope)
    await this.#refreshAvailableSources()
    const available = new Set(this.#availableKnowledgeItemIds)
    if (scope.mode === 'selected' && scope.knowledgeItemIds.some((id) => !available.has(id))) {
      throw new Error('Only currently indexed Knowledge sources can be selected')
    }
    const normalized =
      scope.mode === 'all'
        ? scope
        : { mode: 'selected' as const, knowledgeItemIds: [...scope.knowledgeItemIds].sort() }
    if (sameScope(this.#sourceScope, normalized)) return this.#snapshot()
    this.#sourceScope = normalized
    this.#effectiveSourceIds = this.#resolveEffectiveSourceIds()
    this.#appendSourceBoundary()
    this.#lastError = null
    this.#bumpRevision()
    await this.#publishSnapshot()
    this.options.log.info(
      {
        event: 'knowledge.notebook.sources_changed',
        projectId: this.options.projectId,
        projectSessionId: this.options.projectSessionId,
        sourceMode: normalized.mode,
        sourceCount: this.#effectiveSourceIds.length,
        contextEpoch: this.#contextEpoch
      },
      'Notebook Knowledge sources changed'
    )
    return this.#snapshot()
  }

  async setModel(modelSelection: AgentModelSelection): Promise<NotebookChatSnapshot> {
    this.#assertOpen()
    await this.#initialize()
    if (this.#activeTurn !== null) throw new Error('Stop the active Notebook answer first')
    const resolved = await this.options.agentCatalog.resolve(modelSelection)
    this.#modelSelection = modelSelection
    this.#thinkingLevel = clampResolvedAgentThinkingLevel(resolved, this.#thinkingLevel)
    this.#lastError = null
    this.#bumpRevision()
    await this.#publishSnapshot()
    return this.#snapshot()
  }

  async setThinkingLevel(level: AgentThinkingLevel): Promise<NotebookChatSnapshot> {
    this.#assertOpen()
    await this.#initialize()
    if (this.#activeTurn !== null) throw new Error('Stop the active Notebook answer first')
    if (this.#modelSelection === null) throw new Error('Choose an Agent model first')
    const resolved = await this.options.agentCatalog.resolve(this.#modelSelection)
    if (clampResolvedAgentThinkingLevel(resolved, level) !== level) {
      throw new Error('Selected Thinking level is unavailable for this Agent model')
    }
    this.#thinkingLevel = level
    this.#lastError = null
    this.#bumpRevision()
    await this.#publishSnapshot()
    return this.#snapshot()
  }

  async startTurn(content: string): Promise<NotebookChatStartTurnResult> {
    this.#assertOpen()
    await this.#initialize()
    await this.#reconcileSources()
    if (this.#activeTurn !== null) throw new Error('A Notebook answer is already in progress')
    if (this.#modelSelection === null) {
      throw new Error('Configure and select an Agent model before asking a Notebook question')
    }
    const question = notebookChatStartTurnInputSchema.parse({
      projectSessionId: this.options.projectSessionId,
      content
    }).content
    const sourceIds = this.#resolveEffectiveSourceIds()
    if (sourceIds.length === 0) throw new Error('Select at least one indexed Knowledge source')
    this.#assertCapacityFor(question)
    const resolved = await this.options.agentCatalog.resolve(this.#modelSelection)
    const thinkingLevel = clampResolvedAgentThinkingLevel(resolved, this.#thinkingLevel)
    const config = agentProviderConfigFromResolved(resolved)

    const turnId = this.#createId()
    const userMessageId = this.#createId()
    const assistantMessageId = this.#createId()
    const controller = new AbortController()
    this.options.limiter.acquire({
      workId: turnId,
      ownerId: this.options.projectSessionId,
      kind: 'notebook_turn',
      signal: controller.signal
    })
    const createdAt = this.#now().toISOString()
    this.#messages.push(
      {
        messageId: userMessageId,
        role: 'user',
        content: question,
        contextEpoch: this.#contextEpoch,
        createdAt
      },
      {
        messageId: assistantMessageId,
        role: 'assistant',
        content: '',
        status: 'streaming',
        citations: [],
        contextEpoch: this.#contextEpoch,
        createdAt
      }
    )
    this.#thinkingLevel = thinkingLevel
    this.#phase = 'thinking'
    this.#lastError = null
    const active: ActiveNotebookTurn = {
      turnId,
      userMessageId,
      assistantMessageId,
      controller,
      completion: Promise.resolve(),
      detached: false,
      operationId: this.#createId(),
      agentRunId: this.#createId(),
      sourceIds,
      config,
      thinkingLevel,
      handle: null,
      authorizedModelRequestIds: new Set(),
      pendingModelRequestIds: new Set(),
      citationsById: new Map(),
      finalMessage: null
    }
    this.#activeTurn = active
    this.#bumpRevision()
    await this.#publishSnapshot()
    active.completion = this.#runTurn(active, question, resolved)
    void active.completion.catch(() => undefined)
    return notebookChatStartTurnResultSchema.parse({ turnId, snapshot: this.#snapshot() })
  }

  async stopTurn(): Promise<NotebookChatSnapshot> {
    this.#assertOpen()
    await this.#cancelActive('user_stop', true)
    return this.#snapshot()
  }

  async clear(): Promise<NotebookChatSnapshot> {
    this.#assertOpen()
    await this.#cancelActive('clear', false)
    this.#messages = []
    this.#assistantHistory.clear()
    this.#contextEpoch = 0
    this.#lastError = null
    this.#phase = 'idle'
    this.#bumpRevision()
    await this.#publishSnapshot()
    this.options.log.info(
      {
        event: 'knowledge.notebook.cleared',
        projectId: this.options.projectId,
        projectSessionId: this.options.projectSessionId
      },
      'Notebook chat cleared'
    )
    return this.#snapshot()
  }

  async close(): Promise<void> {
    if (this.#closed) return
    await this.#cancelActive('project_close', false)
    this.#closed = true
    this.#messages = []
    this.#sourceScope = { mode: 'all', knowledgeItemIds: [] }
    this.#availableKnowledgeItemIds = []
    this.#effectiveSourceIds = null
    this.#modelSelection = null
    this.#thinkingLevel = 'off'
    this.#assistantHistory.clear()
    this.#lastError = null
    this.options.log.info(
      {
        event: 'knowledge.notebook.closed',
        projectId: this.options.projectId,
        projectSessionId: this.options.projectSessionId
      },
      'Notebook chat memory released'
    )
  }

  async #initialize(): Promise<void> {
    if (this.#initialized) return
    this.#initialized = true
    try {
      const catalog = await this.options.agentCatalog.snapshot()
      this.#modelSelection = catalog.defaultSelection
      if (this.#modelSelection !== null) {
        const resolved = await this.options.agentCatalog.resolve(this.#modelSelection)
        this.#thinkingLevel = clampResolvedAgentThinkingLevel(
          resolved,
          catalog.defaultThinkingLevel ?? 'medium'
        )
      }
    } catch (err) {
      this.options.log.error(
        {
          event: 'knowledge.notebook.model_default_failed',
          err,
          projectId: this.options.projectId,
          projectSessionId: this.options.projectSessionId
        },
        'Failed to resolve the default Notebook model'
      )
    }
  }

  async #reconcileSources(): Promise<void> {
    const previous = this.#effectiveSourceIds
    await this.#refreshAvailableSources()
    const effective = this.#resolveEffectiveSourceIds()
    if (previous === null) {
      this.#effectiveSourceIds = effective
      return
    }
    if (sameStrings(previous, effective)) return
    if (this.#sourceScope.mode === 'selected' && this.#sourceReadiness === 'ready') {
      const available = new Set(this.#availableKnowledgeItemIds)
      this.#sourceScope = {
        mode: 'selected',
        knowledgeItemIds: this.#sourceScope.knowledgeItemIds.filter((id) => available.has(id))
      }
    }
    this.#effectiveSourceIds = effective
    this.#appendSourceBoundary()
    this.#bumpRevision()
    await this.#publishSnapshot()
  }

  async #refreshAvailableSources(): Promise<void> {
    const controller = new AbortController()
    const indexed = await this.options.projectIndex.currentIndexedSources(controller.signal)
    this.#sourceReadiness = indexed.state
    if (indexed.state !== 'ready') {
      this.#availableKnowledgeItemIds = []
      return
    }
    const existing = new Set(
      this.options
        .listKnowledgeItems()
        .filter(
          (item) =>
            item.state === 'stored' &&
            item.activeParseRevisionId !== null &&
            item.normalizationState === 'published'
        )
        .map((item) => item.knowledgeItemId)
    )
    this.#availableKnowledgeItemIds = indexed.sources
      .map((source) => source.knowledgeItemId)
      .filter((id) => existing.has(id))
      .slice(0, NOTEBOOK_MAX_SOURCES)
      .sort()
  }

  #resolveEffectiveSourceIds(): string[] {
    if (this.#sourceScope.mode === 'all') return [...this.#availableKnowledgeItemIds]
    const available = new Set(this.#availableKnowledgeItemIds)
    return this.#sourceScope.knowledgeItemIds.filter((id) => available.has(id)).sort()
  }

  async #runTurn(
    active: ActiveNotebookTurn,
    question: string,
    resolved: ResolvedAgentCatalogModel
  ): Promise<void> {
    const startedAt = Date.now()
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    try {
      active.controller.signal.throwIfAborted()
      const initialModelRequestId = (
        await repository.start({
          operation: 'agent',
          provider: active.config,
          request: { delivery: 'prompt' },
          thinkingLevel: active.thinkingLevel,
          inputItems: 1,
          operationId: active.operationId,
          agentRunId: active.agentRunId,
          projectSessionId: this.options.projectSessionId,
          retention: 'metadata_only'
        })
      ).modelRequestId
      active.authorizedModelRequestIds.add(initialModelRequestId)
      active.pendingModelRequestIds.add(initialModelRequestId)
      active.handle = this.options.runtime.beginSessionRun(
        active.config,
        agentCredentialFromResolved(resolved),
        {
          projectSessionId: this.options.projectSessionId,
          agentSessionId: this.#agentSessionId,
          agentRunId: active.agentRunId,
          modelRequestId: initialModelRequestId,
          systemPrompt: NOTEBOOK_CHAT_SYSTEM_PROMPT,
          history: boundedAgentHistory(
            this.#messages,
            this.#assistantHistory,
            this.#contextEpoch,
            active.userMessageId,
            active.assistantMessageId
          ),
          prompt: formatNotebookChatPrompt({ question }),
          maxOutputTokens: Math.min(8_192, resolved.model.maxTokens),
          modelLimits: agentModelLimitsFromResolved(resolved, this.#now()),
          toolProfile: 'notebook_knowledge',
          thinkingLevel: active.thinkingLevel,
          runtimeModel: agentRuntimeModelFromResolved(resolved)
        },
        active.controller.signal,
        (event) => this.#handleRuntimeEvent(active, event),
        (request, signal) => this.#handleToolRequest(active, request, signal)
      )
      await active.handle.completion
      active.controller.signal.throwIfAborted()
      const finalMessage = active.finalMessage
      if (finalMessage === null) throw new Error('Notebook Agent completed without an answer')
      const text = finalMessage.content.trim()
      const citations = [...active.citationsById.values()].sort((a, b) => a.ordinal - b.ordinal)
      this.#completeAssistant(active, text.length === 0 ? NO_EVIDENCE_MESSAGE : text, citations)
      this.#assistantHistory.set(active.assistantMessageId, finalMessage)
      this.#logCitationWarnings(active, text, citations)
      this.options.log.info(
        {
          event: 'knowledge.notebook.turn_completed',
          projectId: this.options.projectId,
          projectSessionId: this.options.projectSessionId,
          turnId: active.turnId,
          sourceCount: active.sourceIds.length,
          citationCount: citations.length,
          durationMs: Date.now() - startedAt
        },
        'Notebook turn completed'
      )
    } catch (err) {
      if (active.detached) return
      if (active.controller.signal.aborted || isAbortError(err)) {
        this.#stopAssistant(active)
      } else {
        this.options.log.error(
          {
            event: 'knowledge.notebook.turn_failed',
            err,
            projectId: this.options.projectId,
            projectSessionId: this.options.projectSessionId,
            turnId: active.turnId,
            durationMs: Date.now() - startedAt
          },
          'Notebook turn failed'
        )
        this.#failAssistant(active)
      }
    } finally {
      for (const modelRequestId of active.pendingModelRequestIds) {
        await repository
          .abort(modelRequestId, active.controller.signal.aborted ? 'aborted' : 'runtime_ended')
          .catch((err) =>
            this.options.log.error(
              { event: 'knowledge.notebook.model_request_cleanup_failed', err, modelRequestId },
              'Notebook model request cleanup failed'
            )
          )
      }
      active.pendingModelRequestIds.clear()
      this.options.limiter.release(active.turnId)
      if (this.#activeTurn === active) {
        this.#activeTurn = null
        this.#phase = 'idle'
        this.#bumpRevision()
        if (!this.#closed) await this.#publishSnapshot()
      }
    }
  }

  async #handleRuntimeEvent(active: ActiveNotebookTurn, event: AgentRuntimeEvent): Promise<void> {
    if (active.detached || this.#activeTurn !== active) return
    if (event.type === 'assistant_delta') {
      if (this.#phase !== 'generating') {
        this.#phase = 'generating'
        this.#bumpRevision()
        await this.#publishSnapshot()
      }
      this.#applyDelta(active, event.delta)
      return
    }
    if (event.type === 'model_call_requested') {
      await this.#authorizeToolContinuation(active, event.continuationId)
      return
    }
    if (event.type === 'model_call_retrying') {
      this.options.log.warn(
        {
          event: 'knowledge.notebook.provider_retry_scheduled',
          turnId: active.turnId,
          modelRequestId: event.modelRequestId,
          completedAttempts: event.completedAttempts,
          maxAttempts: event.maxAttempts,
          delayMs: event.delayMs,
          reasonCode: event.reasonCode
        },
        'Notebook Agent provider retry scheduled'
      )
      return
    }
    if (event.type === 'tool_attempted' || event.type === 'tool_preflight_failed') {
      if (this.#phase !== 'retrieving') {
        this.#phase = 'retrieving'
        this.#bumpRevision()
        await this.#publishSnapshot()
      }
      if (event.type === 'tool_preflight_failed') {
        this.options.log.warn(
          {
            event: 'knowledge.notebook.tool_preflight_failed',
            turnId: active.turnId,
            modelRequestId: event.modelRequestId,
            toolName: event.requestedToolName,
            code: event.diagnostic?.code
          },
          'Notebook Agent tool failed before Main dispatch'
        )
      }
      return
    }
    if (event.type === 'queue_updated' || event.type === 'queue_action_completed') return
    if (event.type === 'follow_up_consumption_requested') {
      throw new Error('Notebook Agent does not accept queued messages')
    }
    if (!active.authorizedModelRequestIds.has(event.modelRequestId)) {
      throw new Error('Notebook Agent event refers to an unauthorized model request')
    }
    if (event.type === 'model_call_finished') {
      const repository = new ModelRequestRepository(
        this.options.database,
        this.options.log,
        this.#now,
        this.#createId
      )
      if (event.outcome === 'succeeded') {
        await repository.succeed(
          event.modelRequestId,
          { metadata: event.metadata, outputItems: 1 },
          'metadata_only'
        )
      } else if (event.outcome === 'aborted') {
        await repository.abort(event.modelRequestId, 'aborted', event.metadata, 'metadata_only')
      } else {
        await repository.fail(
          event.modelRequestId,
          {
            code:
              event.outcome === 'timed_out'
                ? 'provider_timeout'
                : (event.failureCode ?? 'provider_request_failed'),
            retryable:
              event.outcome === 'timed_out' ||
              event.retryable === true ||
              event.httpStatus === 429 ||
              (event.httpStatus ?? 0) >= 500,
            ...(event.httpStatus === undefined ? {} : { httpStatus: event.httpStatus })
          },
          event.metadata,
          'metadata_only'
        )
      }
      active.pendingModelRequestIds.delete(event.modelRequestId)
      return
    }
    if (event.message.stopReason === 'toolUse') return
    const { responseId: _responseId, ...message } = event.message
    active.finalMessage = {
      ...message,
      metadata: { ...message.metadata, responseIds: [] }
    }
  }

  async #authorizeToolContinuation(
    active: ActiveNotebookTurn,
    continuationId: string
  ): Promise<void> {
    if (active.handle === null) throw new Error('Notebook Agent runtime is unavailable')
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
        request: { delivery: 'tool_continuation' },
        thinkingLevel: active.thinkingLevel,
        inputItems: 1,
        operationId: active.operationId,
        agentRunId: active.agentRunId,
        projectSessionId: this.options.projectSessionId,
        retention: 'metadata_only'
      })
    ).modelRequestId
    active.authorizedModelRequestIds.add(modelRequestId)
    active.pendingModelRequestIds.add(modelRequestId)
    try {
      active.handle.authorizeModelCall({
        projectSessionId: this.options.projectSessionId,
        agentSessionId: this.#agentSessionId,
        agentRunId: active.agentRunId,
        continuationId,
        modelRequestId,
        systemPrompt: NOTEBOOK_CHAT_SYSTEM_PROMPT,
        interactionMode: 'write'
      })
    } catch (err) {
      await repository.abort(modelRequestId, 'authorization_delivery_failed')
      active.pendingModelRequestIds.delete(modelRequestId)
      throw err
    }
  }

  async #handleToolRequest(
    active: ActiveNotebookTurn,
    request: AgentToolRequest,
    signal: AbortSignal
  ): Promise<AgentToolResponse> {
    if (
      this.#activeTurn !== active ||
      request.projectSessionId !== this.options.projectSessionId ||
      request.agentSessionId !== this.#agentSessionId ||
      request.agentRunId !== active.agentRunId ||
      !active.authorizedModelRequestIds.has(request.modelRequestId)
    ) {
      this.options.log.error(
        {
          event: 'knowledge.notebook.tool_unauthorized',
          err: new Error('Notebook Agent tool capability mismatch'),
          turnId: active.turnId,
          toolCallId: request.toolCallId,
          toolName: request.toolName
        },
        'Rejected an unauthorized Notebook Agent tool request'
      )
      return notebookToolError(request, 'unauthorized', 'Notebook tool request is unauthorized')
    }
    if (signal.aborted) return notebookToolError(request, 'aborted', 'Notebook tool was aborted')
    if (request.toolName !== 'search_knowledge' && request.toolName !== 'read_citations') {
      return notebookToolError(
        request,
        'unauthorized',
        'Notebook Agent can only search and read selected Knowledge sources'
      )
    }
    const startedAt = Date.now()
    try {
      if (request.toolName === 'search_knowledge') {
        const allowed = new Set(active.sourceIds)
        const requestedIds = request.args.knowledgeItemIds
        if (requestedIds.some((id) => !allowed.has(id))) {
          return notebookToolError(
            request,
            'unauthorized',
            'Notebook search is outside the selected source scope'
          )
        }
        const result = await executeKnowledgeSearch({
          retrieval: this.options.retrieval,
          projectSessionId: this.options.projectSessionId,
          args: request.args,
          signal,
          forcedKnowledgeItemIds: requestedIds.length === 0 ? active.sourceIds : requestedIds
        })
        const hits = result.hits.map((hit) => {
          let citation = active.citationsById.get(hit.citationId)
          if (citation === undefined && active.citationsById.size < NOTEBOOK_MAX_CITATIONS) {
            citation = {
              ordinal: active.citationsById.size + 1,
              citationId: hit.citationId,
              knowledgeItemId: hit.knowledgeItemId,
              title: hit.title,
              page: hit.page ?? null,
              headingPath: hit.headingPath
            }
            active.citationsById.set(hit.citationId, citation)
          }
          return {
            ...hit,
            ...(citation === undefined ? {} : { citationOrdinal: citation.ordinal })
          }
        })
        this.options.log.info(
          {
            event: 'knowledge.notebook.tool_completed',
            turnId: active.turnId,
            toolName: request.toolName,
            resultCount: hits.length,
            citationCount: active.citationsById.size,
            durationMs: Date.now() - startedAt
          },
          'Notebook Agent Knowledge search completed'
        )
        return notebookToolSuccess(request, { ...result, hits })
      }

      const requestedIds = [
        ...request.args.citationIds,
        ...request.args.requests.map((item) => item.citationId)
      ]
      if (requestedIds.some((citationId) => !active.citationsById.has(citationId))) {
        return notebookToolError(
          request,
          'unauthorized',
          'Notebook citation was not returned by this turn search'
        )
      }
      const result = await executeCitationRead({
        retrieval: this.options.retrieval,
        args: request.args,
        signal
      })
      const allowed = new Set(active.sourceIds)
      if (result.citations.some((citation) => !allowed.has(citation.knowledgeItemId))) {
        throw new Error('Notebook citation expansion crossed the selected source scope')
      }
      const citations = result.citations.map((citation) => ({
        ...citation,
        citationOrdinal: active.citationsById.get(citation.citationId)?.ordinal
      }))
      this.options.log.info(
        {
          event: 'knowledge.notebook.tool_completed',
          turnId: active.turnId,
          toolName: request.toolName,
          resultCount: citations.length,
          durationMs: Date.now() - startedAt
        },
        'Notebook Agent citation read completed'
      )
      return notebookToolSuccess(request, { ...result, citations })
    } catch (err) {
      this.options.log.error(
        {
          event: 'knowledge.notebook.tool_failed',
          err,
          turnId: active.turnId,
          toolName: request.toolName,
          durationMs: Date.now() - startedAt
        },
        'Notebook Agent Knowledge tool failed'
      )
      return notebookToolError(request, 'internal', 'Notebook Knowledge tool failed')
    }
  }

  #applyDelta(active: ActiveNotebookTurn, delta: string): void {
    if (active.detached || this.#activeTurn !== active || active.controller.signal.aborted) return
    const message = this.#assistant(active.assistantMessageId)
    const nextContent = `${message.content}${delta}`
    if (this.#chatBytes(nextContent.length - message.content.length) > NOTEBOOK_MAX_CHAT_BYTES) {
      active.controller.abort('notebook_capacity')
      throw new NotebookChatCapacityError()
    }
    message.content = nextContent
    this.#bumpRevision()
    void this.#publish(
      notebookChatEventSchema.parse({
        kind: 'delta',
        projectSessionId: this.options.projectSessionId,
        revision: this.#revision,
        turnId: active.turnId,
        messageId: active.assistantMessageId,
        delta
      })
    )
  }

  #completeAssistant(
    active: ActiveNotebookTurn,
    content: string,
    citations: NotebookChatCitation[]
  ): void {
    if (active.detached || this.#activeTurn !== active) return
    const message = this.#assistant(active.assistantMessageId)
    const existingBytes = new TextEncoder().encode(message.content).byteLength
    const nextBytes = new TextEncoder().encode(content).byteLength
    if (this.#chatBytes(nextBytes - existingBytes) > NOTEBOOK_MAX_CHAT_BYTES) {
      throw new NotebookChatCapacityError()
    }
    message.content = content
    message.status = 'complete'
    message.citations = citations
    this.#lastError = null
  }

  #stopAssistant(active: ActiveNotebookTurn): void {
    if (active.detached || this.#activeTurn !== active) return
    const message = this.#assistant(active.assistantMessageId)
    message.status = 'stopped'
    this.#lastError = null
  }

  #failAssistant(active: ActiveNotebookTurn): void {
    if (active.detached || this.#activeTurn !== active) return
    const message = this.#assistant(active.assistantMessageId)
    message.status = 'failed'
    this.#lastError = 'Notebook could not answer that question. Try again or choose another model.'
  }

  async #cancelActive(reason: string, publishStopping: boolean): Promise<void> {
    const active = this.#activeTurn
    if (active === null) return
    this.#phase = 'stopping'
    this.#bumpRevision()
    if (publishStopping && !this.#closed) await this.#publishSnapshot()
    active.controller.abort(reason)
    const completed = await Promise.race([
      active.completion.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), STOP_TIMEOUT_MS))
    ])
    if (completed) return
    if (this.#activeTurn === active) {
      this.#stopAssistant(active)
      active.detached = true
      this.#activeTurn = null
      this.#phase = 'idle'
      this.options.limiter.release(active.turnId)
      this.#bumpRevision()
    }
    this.options.log.warn(
      {
        event: 'knowledge.notebook.turn_cleanup_timeout',
        projectId: this.options.projectId,
        projectSessionId: this.options.projectSessionId,
        turnId: active.turnId
      },
      'Notebook turn cleanup exceeded the bounded wait'
    )
  }

  #appendSourceBoundary(): void {
    if (this.#messages.length === 0) return
    if (this.#messages.length >= NOTEBOOK_MAX_MESSAGES) throw new NotebookChatCapacityError()
    this.#contextEpoch += 1
    this.#assistantHistory.clear()
    this.#messages.push({
      messageId: this.#createId(),
      role: 'source_boundary',
      content: 'Sources changed',
      contextEpoch: this.#contextEpoch,
      createdAt: this.#now().toISOString()
    })
  }

  #assistant(messageId: string): Extract<NotebookChatMessage, { role: 'assistant' }> {
    const message = this.#messages.find((candidate) => candidate.messageId === messageId)
    if (message?.role !== 'assistant') throw new Error('Notebook assistant message is unavailable')
    return message
  }

  #assertCapacityFor(content: string): void {
    if (this.#messages.length + 2 > NOTEBOOK_MAX_MESSAGES) throw new NotebookChatCapacityError()
    const additionalBytes = new TextEncoder().encode(content).byteLength
    if (this.#chatBytes(additionalBytes) > NOTEBOOK_MAX_CHAT_BYTES) {
      throw new NotebookChatCapacityError()
    }
  }

  #chatBytes(additionalBytes = 0): number {
    return (
      additionalBytes +
      this.#messages.reduce(
        (total, message) => total + new TextEncoder().encode(message.content).byteLength,
        0
      )
    )
  }

  #logCitationWarnings(
    active: ActiveNotebookTurn,
    content: string,
    citations: NotebookChatCitation[]
  ): void {
    const known = new Set(citations.map((citation) => citation.ordinal))
    const seen = new Set<number>()
    let unknownCount = 0
    let duplicateCount = 0
    for (const match of content.matchAll(CITATION_MARKER)) {
      const ordinal = Number(match[1])
      if (!known.has(ordinal)) unknownCount += 1
      else if (seen.has(ordinal)) duplicateCount += 1
      else seen.add(ordinal)
    }
    if (unknownCount === 0 && duplicateCount === 0) return
    this.options.log.warn(
      {
        event: 'security.notebook_citation_marker_rejected',
        projectId: this.options.projectId,
        projectSessionId: this.options.projectSessionId,
        turnId: active.turnId,
        messageId: active.assistantMessageId,
        unknownCount,
        duplicateCount
      },
      'Notebook answer contained unregistered or duplicate citation markers'
    )
  }

  #bumpRevision(): void {
    this.#revision += 1
  }

  #snapshot(): NotebookChatSnapshot {
    return notebookChatSnapshotSchema.parse({
      projectSessionId: this.options.projectSessionId,
      revision: this.#revision,
      phase: this.#phase,
      activeTurnId: this.#activeTurn?.turnId ?? null,
      sourceScope: this.#sourceScope,
      sourceReadiness: this.#sourceReadiness,
      availableKnowledgeItemIds: this.#availableKnowledgeItemIds,
      modelSelection: this.#modelSelection,
      thinkingLevel: this.#thinkingLevel,
      contextEpoch: this.#contextEpoch,
      messages: this.#messages,
      lastError: this.#lastError
    })
  }

  async #publishSnapshot(): Promise<void> {
    const snapshot = this.#snapshot()
    await this.#publish(
      notebookChatEventSchema.parse({
        kind: 'snapshot',
        projectSessionId: this.options.projectSessionId,
        revision: this.#revision,
        snapshot
      })
    )
  }

  async #publish(event: NotebookChatEvent): Promise<void> {
    try {
      await this.options.publish?.(event)
    } catch (err) {
      this.options.log.warn(
        {
          event: 'knowledge.notebook.delivery_failed',
          err,
          projectId: this.options.projectId,
          projectSessionId: this.options.projectSessionId,
          revision: event.revision,
          eventKind: event.kind
        },
        'Notebook event delivery failed without changing in-memory truth'
      )
    }
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error('Notebook chat is closed')
  }
}

function boundedAgentHistory(
  messages: NotebookChatMessage[],
  assistantHistory: ReadonlyMap<string, AgentAssistantMessagePayload>,
  contextEpoch: number,
  activeUserMessageId: string,
  activeAssistantMessageId: string
): AgentHistoryMessage[] {
  const eligible = messages.filter(
    (message) =>
      message.contextEpoch === contextEpoch &&
      message.messageId !== activeUserMessageId &&
      message.messageId !== activeAssistantMessageId &&
      message.role !== 'source_boundary'
  )
  const pairs: AgentHistoryMessage[][] = []
  for (let index = 0; index < eligible.length - 1; index += 1) {
    const user = eligible[index]
    const assistant = eligible[index + 1]
    if (
      user?.role !== 'user' ||
      assistant?.role !== 'assistant' ||
      assistant.status !== 'complete'
    ) {
      continue
    }
    const payload = assistantHistory.get(assistant.messageId)
    if (payload === undefined) continue
    const { interrupted: _interrupted, ...message } = payload
    pairs.push([
      { role: 'user', content: user.content, timestamp: new Date(user.createdAt).getTime() },
      { role: 'assistant', message }
    ])
    index += 1
  }
  const result: AgentHistoryMessage[] = []
  for (const pair of pairs.reverse()) {
    const candidate = [...pair, ...result]
    if (new TextEncoder().encode(JSON.stringify(candidate)).byteLength > HISTORY_MAX_BYTES) break
    result.unshift(...pair)
  }
  return agentHistorySchema.parse(result)
}

function notebookToolSuccess(request: AgentToolRequest, data: unknown): AgentToolResponse {
  return agentToolResponseSchema.parse({
    type: 'tool_response',
    schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName,
    ok: true,
    data
  })
}

function notebookToolError(
  request: AgentToolRequest,
  code: 'unauthorized' | 'aborted' | 'internal',
  message: string
): AgentToolResponse {
  return agentToolResponseSchema.parse({
    type: 'tool_response',
    schemaVersion: AGENT_TOOL_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName,
    ok: false,
    error: {
      code,
      category:
        code === 'unauthorized' ? 'authorization' : code === 'aborted' ? 'cancelled' : 'internal',
      message,
      recovery: { action: 'do_not_retry' }
    }
  })
}

function sameScope(left: NotebookSourceScope, right: NotebookSourceScope): boolean {
  return left.mode === right.mode && sameStrings(left.knowledgeItemIds, right.knowledgeItemIds)
}

function sameStrings(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
