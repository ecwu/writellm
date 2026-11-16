import { completeModelCall } from '../agent/model-call-completion'
import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import { createAbortError, isAbortError } from '../../shared/abort-error'
import {
  serializeAgentDiagnosticError,
  agentDiagnosticSensitiveValues
} from '../../shared/agent-diagnostic-error'
import {
  NOTEBOOK_MAX_CHAT_BYTES,
  NOTEBOOK_MAX_CITATIONS,
  NOTEBOOK_MAX_MESSAGES,
  notebookChatTextBytes,
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
import type { CurrentIndexedSourceSnapshot, ProjectIndexService } from '../search/index-service'
import type { ReferenceLibraryService } from '../references/reference-library-service'
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
import {
  formatNotebookChatPrompt,
  NOTEBOOK_CHAT_SYSTEM_PROMPT
} from '../agent/prompts/notebook-chat'
import { executeCitationRead, executeKnowledgeSearch } from '../agent/knowledge-tools'
import { ToolContinuationRequests } from '../agent/tool-continuation-requests'

const NO_EVIDENCE_MESSAGE = '选中的资料中没有足够信息。'
const STOP_TIMEOUT_MS = 5_000
const HISTORY_MAX_BYTES = 64 * 1024
const CITATION_MARKER = /\[\[cite:(\d{1,3})\]\]/gu

interface ActiveNotebookTurn {
  turnId: string
  assistantMessageId: string
  controller: AbortController
  readonly completion: Promise<void>
  detached: boolean
  operationId: string
  agentRunId: string
  sourceIds: string[]
  config: Extract<ProviderConfig, { role: 'agent' }>
  thinkingLevel: AgentThinkingLevel
  handle: AgentSessionRunHandle | null
  toolContinuations: ToolContinuationRequests
  authorizedModelRequestIds: Set<string>
  pendingModelRequestIds: Set<string>
  citationsById: Map<string, NotebookChatCitation>
  finalMessage: AgentAssistantMessagePayload | null
}

export interface KnowledgeChatServiceOptions {
  notebookId?: string
  projectId: string
  projectSessionId: string
  database: ProjectDatabase
  retrieval: Pick<RetrievalService, 'search' | 'expand'>
  projectIndex: Pick<ProjectIndexService, 'currentIndexedSources'>
  listKnowledgeItems: () => KnowledgeItem[]
  references: ReferenceLibraryService
  agentCatalog: Pick<AgentProviderCatalogService, 'snapshot' | 'resolve'>
  runtime: AgentSessionRuntime
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
  readonly notebookId: string
  readonly #now: () => Date
  readonly #createId: () => string
  #revision = 0
  #phase: NotebookChatSnapshot['phase'] = 'idle'
  #messages: NotebookChatMessage[] = []
  #sourceScope: NotebookSourceScope = { mode: 'all', knowledgeItemIds: [] }
  #sourceReadiness: NotebookChatSnapshot['sourceReadiness'] = 'preparing'
  #availableKnowledgeItemIds: string[] = []
  #sourceReadSequence = 0
  #appliedSourceRead = 0
  #effectiveSourceIds: string[] | null = null
  #contextEpoch = 0
  #modelSelection: AgentModelSelection | null = null
  #thinkingLevel: AgentThinkingLevel = 'off'
  #assistantHistory = new Map<string, AgentAssistantMessagePayload>()
  #agentSessionId: string
  #lastError: string | null = null
  #startingTurn: AbortController | null = null
  #activeTurn: ActiveNotebookTurn | null = null
  #initialization: Promise<void> | undefined
  #closed = false

  constructor(private readonly options: KnowledgeChatServiceOptions) {
    this.notebookId = options.notebookId ?? randomUUID()
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
    this.#agentSessionId = this.#createId()
  }

  async snapshot(): Promise<NotebookChatSnapshot> {
    this.#assertOpen()
    await this.#initialize()
    this.#assertOpen()
    await this.#reconcileSources()
    this.#assertOpen()
    return this.#snapshot()
  }

  async setSources(rawScope: NotebookSourceScope): Promise<NotebookChatSnapshot> {
    this.#assertOpen()
    await this.#initialize()
    this.#assertConfigurable()
    const scope = notebookSourceScopeSchema.parse(rawScope)
    const normalized =
      scope.mode === 'all'
        ? scope
        : { mode: 'selected' as const, knowledgeItemIds: [...scope.knowledgeItemIds].sort() }
    if (await this.#reconcileSources({ selection: normalized })) {
      this.options.log.info(
        {
          event: 'knowledge.notebook.sources_changed',
          projectId: this.options.projectId,
          projectSessionId: this.options.projectSessionId,
          sourceMode: normalized.mode,
          sourceCount: this.#effectiveSourceIds?.length ?? 0,
          contextEpoch: this.#contextEpoch
        },
        'Notebook Knowledge sources changed'
      )
    }
    return this.#snapshot()
  }

  async setModel(modelSelection: AgentModelSelection): Promise<NotebookChatSnapshot> {
    this.#assertOpen()
    await this.#initialize()
    this.#assertConfigurable()
    const resolved = await this.options.agentCatalog.resolve(modelSelection)
    this.#assertConfigurable()
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
    this.#assertConfigurable()
    const modelSelection = this.#modelSelection
    if (modelSelection === null) throw new Error('Choose an Agent model first')
    const resolved = await this.options.agentCatalog.resolve(modelSelection)
    this.#assertConfigurable()
    if (this.#modelSelection !== modelSelection) {
      throw new Error('Notebook model changed. Retry the Thinking level change.')
    }
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
    if (this.#startingTurn !== null || this.#activeTurn !== null) {
      throw new Error('A Notebook answer is already in progress')
    }
    const controller = new AbortController()
    this.#startingTurn = controller
    try {
      await this.#initialize()
      controller.signal.throwIfAborted()
      await this.#reconcileSources({ signal: controller.signal })
      controller.signal.throwIfAborted()
      if (this.#modelSelection === null) {
        throw new Error('Configure and select an Agent model before asking a Notebook question')
      }
      const question = notebookChatStartTurnInputSchema.parse({
        notebookId: this.notebookId,
        projectSessionId: this.options.projectSessionId,
        content
      }).content
      const sourceIds = this.#sourceReadiness === 'ready' ? (this.#effectiveSourceIds ?? []) : []
      if (sourceIds.length === 0) throw new Error('Select at least one indexed Knowledge source')
      this.#assertCapacityFor(question)
      const contextEpoch = this.#contextEpoch
      const resolved = await this.options.agentCatalog.resolve(this.#modelSelection)
      controller.signal.throwIfAborted()
      if (
        contextEpoch !== this.#contextEpoch ||
        this.#sourceReadiness !== 'ready' ||
        !sameStrings(sourceIds, this.#effectiveSourceIds ?? [])
      ) {
        throw new Error('Notebook sources changed. Retry the question.')
      }
      this.#startingTurn = null
      return this.#beginTurn(question, [...sourceIds], resolved, controller)
    } finally {
      if (this.#startingTurn === controller) this.#startingTurn = null
    }
  }

  async #beginTurn(
    question: string,
    sourceIds: string[],
    resolved: ResolvedAgentCatalogModel,
    controller: AbortController
  ): Promise<NotebookChatStartTurnResult> {
    const thinkingLevel = clampResolvedAgentThinkingLevel(resolved, this.#thinkingLevel)
    const config = agentProviderConfigFromResolved(resolved)
    const history = boundedAgentHistory(this.#messages, this.#assistantHistory, this.#contextEpoch)

    const turnId = this.#createId()
    const userMessageId = this.#createId()
    const assistantMessageId = this.#createId()
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
      assistantMessageId,
      controller,
      completion: Promise.resolve().then(() => this.#runTurn(active, question, resolved, history)),
      detached: false,
      operationId: this.#createId(),
      agentRunId: this.#createId(),
      sourceIds,
      config,
      thinkingLevel,
      handle: null,
      toolContinuations: new ToolContinuationRequests(),
      authorizedModelRequestIds: new Set(),
      pendingModelRequestIds: new Set(),
      citationsById: new Map(),
      finalMessage: null
    }
    this.#activeTurn = active
    // error-handling: allow owner=notebook-chat reason=detached-completion
    void active.completion.catch(() => undefined)
    this.#bumpRevision()
    await this.#publishSnapshot()
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
    this.#closed = true
    await this.#cancelActive('project_close', false)
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
        notebookId: this.notebookId,
        projectId: this.options.projectId,
        projectSessionId: this.options.projectSessionId
      },
      'Notebook chat memory released'
    )
  }

  #initialize(): Promise<void> {
    this.#initialization ??= this.#loadDefaultModel()
    return this.#initialization
  }

  async #loadDefaultModel(): Promise<void> {
    try {
      const catalog = await this.options.agentCatalog.snapshot()
      if (this.#closed) return
      this.#modelSelection = catalog.defaultSelection
      if (this.#modelSelection !== null) {
        const resolved = await this.options.agentCatalog.resolve(this.#modelSelection)
        if (this.#closed) return
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

  async #reconcileSources({
    signal = new AbortController().signal,
    selection
  }: {
    signal?: AbortSignal
    selection?: NotebookSourceScope
  } = {}): Promise<boolean> {
    const read = ++this.#sourceReadSequence
    const indexed = await this.options.projectIndex.currentIndexedSources(signal)
    signal.throwIfAborted()
    if (selection === undefined) this.#assertOpen()
    else this.#assertConfigurable()

    const currentRead = read > this.#appliedSourceRead
    if (!currentRead && selection === undefined) return false
    const readiness = currentRead ? indexed.state : this.#sourceReadiness
    const availableIds = currentRead
      ? this.#indexedSourceIds(indexed)
      : this.#availableKnowledgeItemIds
    const requestedScope = selection ?? this.#sourceScope
    const available = new Set(availableIds)
    const selectedIds = requestedScope.knowledgeItemIds.filter((id) => available.has(id))
    if (selection !== undefined && selectedIds.length !== selection.knowledgeItemIds.length) {
      throw new Error('Only currently indexed Knowledge sources can be selected')
    }
    const scope: NotebookSourceScope =
      requestedScope.mode === 'selected' && readiness === 'ready'
        ? { mode: 'selected', knowledgeItemIds: selectedIds }
        : requestedScope
    const scopeChanged = !sameScope(this.#sourceScope, scope)
    const explicitChange = selection !== undefined && scopeChanged
    // An unavailable index cannot confirm that a source was removed.
    let effective = explicitChange ? null : this.#effectiveSourceIds
    if (readiness === 'ready') effective = scope.mode === 'all' ? availableIds : selectedIds
    const historyChanged =
      explicitChange ||
      (effective !== null &&
        this.#effectiveSourceIds !== null &&
        !sameStrings(this.#effectiveSourceIds, effective))
    const availabilityChanged =
      readiness !== this.#sourceReadiness ||
      !sameStrings(this.#availableKnowledgeItemIds, availableIds)

    if (historyChanged) this.#advanceSourceContext()
    if (currentRead) this.#appliedSourceRead = read
    this.#sourceReadiness = readiness
    this.#availableKnowledgeItemIds = availableIds
    this.#sourceScope = scope
    this.#effectiveSourceIds = effective
    if (explicitChange) this.#lastError = null
    if (availabilityChanged || scopeChanged || historyChanged) {
      this.#bumpRevision()
      await this.#publishSnapshot()
    }
    return explicitChange
  }

  #indexedSourceIds(indexed: CurrentIndexedSourceSnapshot): string[] {
    if (indexed.state !== 'ready') return []
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
    return indexed.sources
      .map((source) => source.knowledgeItemId)
      .filter((id) => existing.has(id))
      .sort()
  }

  async #runTurn(
    active: ActiveNotebookTurn,
    question: string,
    resolved: ResolvedAgentCatalogModel,
    history: AgentHistoryMessage[]
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
      active.pendingModelRequestIds.add(initialModelRequestId)
      active.controller.signal.throwIfAborted()
      active.authorizedModelRequestIds.add(initialModelRequestId)
      active.handle = this.options.runtime.beginSessionRun(
        active.config,
        agentCredentialFromResolved(resolved),
        {
          projectSessionId: this.options.projectSessionId,
          agentSessionId: this.#agentSessionId,
          agentRunId: active.agentRunId,
          modelRequestId: initialModelRequestId,
          systemPrompt: NOTEBOOK_CHAT_SYSTEM_PROMPT,
          history,
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
      const reason = active.controller.signal.reason
      const capacityError = reason instanceof NotebookChatCapacityError ? reason : null
      if (capacityError === null && (active.controller.signal.aborted || isAbortError(err))) {
        this.#stopAssistant(active)
      } else {
        const diagnostic = serializeAgentDiagnosticError(capacityError ?? err, 'notebook.run', {
          knownSensitiveValues: agentDiagnosticSensitiveValues(
            agentCredentialFromResolved(resolved)
          ),
          privateBodies: this.#messages.map((message) => message.content)
        })
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
        this.#failAssistant(active, diagnostic.message)
      }
    } finally {
      await active.toolContinuations.close()
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
      if (this.#activeTurn === active) {
        this.#activeTurn = null
        this.#phase = 'idle'
        this.#bumpRevision()
        if (!this.#closed) void this.#publishSnapshot()
      }
    }
  }

  async #handleRuntimeEvent(active: ActiveNotebookTurn, event: AgentRuntimeEvent): Promise<void> {
    if (event.type === 'model_trace_capture_requested') return
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
      this.options.log.info(
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
      await completeModelCall(repository, event, 'notebook')
      active.pendingModelRequestIds.delete(event.modelRequestId)
      return
    }
    if (event.type !== 'assistant_message') return
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
    const handle = active.handle
    if (handle === null) throw new Error('Notebook Agent runtime is unavailable')
    const repository = new ModelRequestRepository(
      this.options.database,
      this.options.log,
      this.#now,
      this.#createId
    )
    await active.toolContinuations.authorize({
      repository,
      log: this.options.log,
      request: {
        provider: active.config,
        thinkingLevel: active.thinkingLevel,
        operationId: active.operationId,
        agentRunId: active.agentRunId,
        projectSessionId: this.options.projectSessionId,
        retention: 'metadata_only'
      },
      continuationId,
      pendingModelRequestIds: active.pendingModelRequestIds,
      canSend: () =>
        this.#activeTurn === active && !active.detached && !active.controller.signal.aborted,
      send: (modelRequestId) => {
        handle.authorizeModelCall({
          projectSessionId: this.options.projectSessionId,
          agentSessionId: this.#agentSessionId,
          agentRunId: active.agentRunId,
          continuationId,
          modelRequestId,
          systemPrompt: NOTEBOOK_CHAT_SYSTEM_PROMPT,
          interactionMode: 'write'
        })
        active.authorizedModelRequestIds.add(modelRequestId)
      }
    })
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
          references: this.options.references,
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
        references: this.options.references,
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
      const diagnostic = serializeAgentDiagnosticError(err, 'notebook.tool', {
        privateBodies: this.#messages.map((message) => message.content)
      })
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
      return notebookToolError(
        request,
        'internal',
        diagnostic.message.slice(0, 1_000) || 'Unknown Knowledge tool error'
      )
    }
  }

  #applyDelta(active: ActiveNotebookTurn, delta: string): void {
    if (active.detached || this.#activeTurn !== active || active.controller.signal.aborted) return
    const message = this.#assistant(active.assistantMessageId)
    const nextContent = `${message.content}${delta}`
    const additionalBytes = Buffer.byteLength(nextContent) - Buffer.byteLength(message.content)
    if (!this.#hasChatCapacity(0, additionalBytes)) {
      const error = new NotebookChatCapacityError()
      active.controller.abort(error)
      throw error
    }
    message.content = nextContent
    this.#bumpRevision()
    void this.#publish(
      notebookChatEventSchema.parse({
        notebookId: this.notebookId,
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
    const additionalBytes = Buffer.byteLength(content) - Buffer.byteLength(message.content)
    if (!this.#hasChatCapacity(0, additionalBytes)) {
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

  #failAssistant(active: ActiveNotebookTurn, detail: string): void {
    if (active.detached || this.#activeTurn !== active) return
    const message = this.#assistant(active.assistantMessageId)
    message.status = 'failed'
    this.#lastError = detail || 'Notebook completed without an error diagnostic.'
  }

  async #cancelActive(reason: string, publishStopping: boolean): Promise<void> {
    const starting = this.#startingTurn
    this.#startingTurn = null
    starting?.abort(createAbortError('Notebook turn was cancelled'))
    const active = this.#activeTurn
    if (active === null) return
    this.#phase = 'stopping'
    this.#bumpRevision()
    active.controller.abort(reason)
    if (publishStopping && !this.#closed) void this.#publishSnapshot()
    let timer: ReturnType<typeof setTimeout> | undefined
    const completed = await Promise.race([
      active.completion.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), STOP_TIMEOUT_MS)
      })
    ]).finally(() => clearTimeout(timer))
    if (completed) return
    if (this.#activeTurn === active) {
      this.#stopAssistant(active)
      active.detached = true
      this.#activeTurn = null
      this.#phase = 'idle'
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

  #advanceSourceContext(): void {
    if (this.#messages.length === 0) return
    this.#contextEpoch += 1
    this.#assistantHistory.clear()
    const content = 'Sources changed'
    if (!this.#hasChatCapacity(1, Buffer.byteLength(content))) return
    this.#messages.push({
      messageId: this.#createId(),
      role: 'source_boundary',
      content,
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
    if (!this.#hasChatCapacity(2, Buffer.byteLength(content))) {
      throw new NotebookChatCapacityError()
    }
  }

  #hasChatCapacity(additionalMessages: number, additionalBytes: number): boolean {
    return (
      this.#messages.length + additionalMessages <= NOTEBOOK_MAX_MESSAGES &&
      notebookChatTextBytes(this.#messages) + additionalBytes <= NOTEBOOK_MAX_CHAT_BYTES
    )
  }

  #logCitationWarnings(
    active: ActiveNotebookTurn,
    content: string,
    citations: NotebookChatCitation[]
  ): void {
    const known = new Set(citations.map((citation) => citation.ordinal))
    let unknownCount = 0
    for (const match of content.matchAll(CITATION_MARKER)) {
      const ordinal = Number(match[1])
      if (!known.has(ordinal)) unknownCount += 1
    }
    if (unknownCount === 0) return
    this.options.log.warn(
      {
        event: 'security.notebook_citation_marker_rejected',
        projectId: this.options.projectId,
        projectSessionId: this.options.projectSessionId,
        turnId: active.turnId,
        messageId: active.assistantMessageId,
        unknownCount
      },
      'Notebook answer contained unregistered citation markers'
    )
  }

  #bumpRevision(): void {
    this.#revision += 1
  }

  #snapshot(): NotebookChatSnapshot {
    return notebookChatSnapshotSchema.parse({
      notebookId: this.notebookId,
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

  #publishSnapshot(): Promise<void> {
    const snapshot = this.#snapshot()
    return this.#publish(
      notebookChatEventSchema.parse({
        notebookId: this.notebookId,
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

  #assertConfigurable(): void {
    this.#assertOpen()
    if (this.#startingTurn !== null || this.#activeTurn !== null) {
      throw new Error('Stop the active Notebook answer first')
    }
  }
}

function boundedAgentHistory(
  messages: NotebookChatMessage[],
  assistantHistory: ReadonlyMap<string, AgentAssistantMessagePayload>,
  contextEpoch: number
): AgentHistoryMessage[] {
  const eligible = messages.filter(
    (message) => message.contextEpoch === contextEpoch && message.role !== 'source_boundary'
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
