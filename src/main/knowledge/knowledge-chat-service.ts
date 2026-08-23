import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import {
  NOTEBOOK_MAX_CHAT_BYTES,
  NOTEBOOK_MAX_CITATIONS,
  NOTEBOOK_MAX_EVIDENCE_BYTES,
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
import type { KnowledgeItem } from '../../shared/contracts/knowledge'
import type { AgentModelSelection } from '../../shared/contracts/providers'
import type { AgentStreamEvent } from '../../shared/contracts/model-runtime'
import type { ExpandedCitation } from '../../shared/contracts/search'
import type { ProjectDatabase } from '../project/project-database'
import type { RetrievalService } from '../search/retrieval-service'
import type { ProjectIndexService } from '../search/index-service'
import type { ModelExecutionService } from '../providers/model-execution-service'
import {
  agentCredentialFromResolved,
  agentModelLimitsFromResolved,
  agentProviderConfigFromResolved,
  type AgentProviderCatalogService,
  type ResolvedAgentCatalogModel
} from '../providers/agent-provider-catalog'
import type { ProjectInteractiveModelLimiter } from '../agent/project-interactive-model-limiter'
import {
  formatNotebookChatPrompt,
  NOTEBOOK_CHAT_SYSTEM_PROMPT
} from '../agent/prompts/notebook-chat'

const NO_EVIDENCE_MESSAGE = '选中的资料中没有足够信息。'
const STOP_TIMEOUT_MS = 5_000
const RETRIEVAL_QUERY_MAX_CHARS = 2_000
const HISTORY_MAX_BYTES = 64 * 1024
const CITATION_MARKER = /\[\[cite:(\d{1,3})\]\]/gu

interface ActiveNotebookTurn {
  turnId: string
  userMessageId: string
  assistantMessageId: string
  controller: AbortController
  completion: Promise<void>
  detached: boolean
}

export interface KnowledgeChatServiceOptions {
  projectId: string
  projectSessionId: string
  database: ProjectDatabase
  retrieval: Pick<RetrievalService, 'search' | 'expand'>
  projectIndex: Pick<ProjectIndexService, 'currentIndexedSources'>
  listKnowledgeItems: () => KnowledgeItem[]
  agentCatalog: Pick<AgentProviderCatalogService, 'snapshot' | 'resolve'>
  modelExecution: Pick<ModelExecutionService, 'runAgentWithResolvedProvider'>
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
  #lastError: string | null = null
  #activeTurn: ActiveNotebookTurn | null = null
  #initialized = false
  #closed = false

  constructor(private readonly options: KnowledgeChatServiceOptions) {
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
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
    await this.options.agentCatalog.resolve(modelSelection)
    this.#modelSelection = modelSelection
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
    this.#phase = 'retrieving'
    this.#lastError = null
    const active: ActiveNotebookTurn = {
      turnId,
      userMessageId,
      assistantMessageId,
      controller,
      completion: Promise.resolve(),
      detached: false
    }
    this.#activeTurn = active
    this.#bumpRevision()
    await this.#publishSnapshot()
    active.completion = this.#runTurn(active, question, sourceIds, this.#modelSelection)
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
      this.#modelSelection = (await this.options.agentCatalog.snapshot()).defaultSelection
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
    sourceIds: string[],
    modelSelection: AgentModelSelection
  ): Promise<void> {
    const startedAt = Date.now()
    try {
      const query = this.#retrievalQuery(question)
      const search = await this.options.retrieval.search(
        {
          projectSessionId: this.options.projectSessionId,
          query,
          filters: {
            knowledgeItemIds: sourceIds,
            fileExtensions: [],
            parseRevisionIds: []
          },
          limits: { fts: 100, vector: 100, fused: 50, results: NOTEBOOK_MAX_CITATIONS },
          rerank: true
        },
        active.controller.signal,
        { ftsMode: 'terms' }
      )
      active.controller.signal.throwIfAborted()
      const expanded =
        search.hits.length === 0
          ? []
          : await this.options.retrieval.expand(
              search.hits.map((hit) => hit.citationId),
              active.controller.signal
            )
      active.controller.signal.throwIfAborted()
      const evidence = boundedEvidence(expanded)
      if (evidence.length === 0) {
        this.#completeAssistant(active, NO_EVIDENCE_MESSAGE, [])
        this.options.log.info(
          {
            event: 'knowledge.notebook.turn_no_evidence',
            projectId: this.options.projectId,
            projectSessionId: this.options.projectSessionId,
            turnId: active.turnId,
            sourceCount: sourceIds.length,
            resultCount: search.hits.length,
            durationMs: Date.now() - startedAt
          },
          'Notebook turn completed without answer-model execution'
        )
        return
      }

      const resolved = await this.options.agentCatalog.resolve(modelSelection)
      active.controller.signal.throwIfAborted()
      this.#phase = 'generating'
      this.#bumpRevision()
      await this.#publishSnapshot()
      const citations = citationRegistry(evidence)
      const request = {
        systemPrompt: NOTEBOOK_CHAT_SYSTEM_PROMPT,
        prompt: formatNotebookChatPrompt({
          question,
          history: boundedHistory(
            this.#messages,
            this.#contextEpoch,
            active.userMessageId,
            active.assistantMessageId
          ),
          evidence
        }),
        maxOutputTokens: Math.min(8_192, resolved.model.maxTokens),
        temperature: 0.2
      }
      const operationId = this.#createId()
      const { result } = await this.options.modelExecution.runAgentWithResolvedProvider(
        this.options.database,
        request,
        {
          operationId,
          projectSessionId: this.options.projectSessionId
        },
        resolvedModelRuntime(resolved, this.#now()),
        active.controller.signal,
        (event) => this.#applyDelta(active, event),
        { retention: 'metadata_only' }
      )
      active.controller.signal.throwIfAborted()
      const text = result.text.trim()
      this.#completeAssistant(active, text.length === 0 ? NO_EVIDENCE_MESSAGE : text, citations)
      this.#logCitationWarnings(active, text, citations)
      this.options.log.info(
        {
          event: 'knowledge.notebook.turn_completed',
          projectId: this.options.projectId,
          projectSessionId: this.options.projectSessionId,
          turnId: active.turnId,
          sourceCount: sourceIds.length,
          evidenceCount: evidence.length,
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
      this.options.limiter.release(active.turnId)
      if (this.#activeTurn === active) {
        this.#activeTurn = null
        this.#phase = 'idle'
        this.#bumpRevision()
        if (!this.#closed) await this.#publishSnapshot()
      }
    }
  }

  #applyDelta(active: ActiveNotebookTurn, event: AgentStreamEvent): void {
    if (active.detached || this.#activeTurn !== active || active.controller.signal.aborted) return
    const message = this.#assistant(active.assistantMessageId)
    const nextContent = `${message.content}${event.delta}`
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
        delta: event.delta
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
    this.#messages.push({
      messageId: this.#createId(),
      role: 'source_boundary',
      content: 'Sources changed',
      contextEpoch: this.#contextEpoch,
      createdAt: this.#now().toISOString()
    })
  }

  #retrievalQuery(question: string): string {
    const activeUserMessageId = this.#activeTurn?.userMessageId
    const recent = this.#messages
      .filter(
        (message): message is Extract<NotebookChatMessage, { role: 'user' }> =>
          message.role === 'user' &&
          message.contextEpoch === this.#contextEpoch &&
          message.messageId !== activeUserMessageId
      )
      .slice(-2)
      .map((message) => message.content)
    return [question, ...recent.reverse()].join('\n').slice(0, RETRIEVAL_QUERY_MAX_CHARS)
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

function resolvedModelRuntime(resolved: ResolvedAgentCatalogModel, now: Date) {
  return {
    config: agentProviderConfigFromResolved(resolved),
    credential: agentCredentialFromResolved(resolved),
    modelLimits: agentModelLimitsFromResolved(resolved, now)
  }
}

function boundedEvidence(
  citations: ExpandedCitation[]
): Array<{ ordinal: number; citation: ExpandedCitation; text: string }> {
  const result: Array<{ ordinal: number; citation: ExpandedCitation; text: string }> = []
  let remaining = NOTEBOOK_MAX_EVIDENCE_BYTES
  for (const citation of citations.slice(0, NOTEBOOK_MAX_CITATIONS)) {
    if (remaining <= 0) break
    const text = truncateUtf8(citation.text.trim(), remaining)
    if (text.length === 0) continue
    result.push({ ordinal: result.length + 1, citation, text })
    remaining -= new TextEncoder().encode(text).byteLength
  }
  return result
}

function citationRegistry(
  evidence: Array<{ ordinal: number; citation: ExpandedCitation }>
): NotebookChatCitation[] {
  return evidence.map(({ ordinal, citation }) => ({
    ordinal,
    citationId: citation.citationId,
    knowledgeItemId: citation.knowledgeItemId,
    title: citation.title,
    page: citation.page ?? null,
    headingPath: citation.headingPath
  }))
}

function boundedHistory(
  messages: NotebookChatMessage[],
  contextEpoch: number,
  activeUserMessageId: string,
  activeAssistantMessageId: string
): NotebookChatMessage[] {
  const eligible = messages.filter(
    (message) =>
      message.contextEpoch === contextEpoch &&
      message.messageId !== activeUserMessageId &&
      message.messageId !== activeAssistantMessageId &&
      (message.role !== 'assistant' || message.status === 'complete')
  )
  const result: NotebookChatMessage[] = []
  let bytes = 0
  for (const message of eligible.reverse()) {
    const next = new TextEncoder().encode(message.content).byteLength
    if (bytes + next > HISTORY_MAX_BYTES) break
    result.unshift(message)
    bytes += next
  }
  return result
}

function truncateUtf8(value: string, limit: number): string {
  if (new TextEncoder().encode(value).byteLength <= limit) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const midpoint = Math.ceil((low + high) / 2)
    if (new TextEncoder().encode(value.slice(0, midpoint)).byteLength <= limit) low = midpoint
    else high = midpoint - 1
  }
  return value.slice(0, low).trimEnd()
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
