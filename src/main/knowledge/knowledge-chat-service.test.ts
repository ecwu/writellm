import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeEvent } from '../../shared/contracts/agent'
import type { AgentToolRequest, AgentToolResponse } from '../../shared/contracts/agent-tools'
import type { KnowledgeItem } from '../../shared/contracts/knowledge'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { ExpandedCitation } from '../../shared/contracts/search'
import { ProjectInteractiveModelLimiter } from '../agent/project-interactive-model-limiter'
import type {
  AgentSessionRunHandle,
  AgentSessionRunInput,
  AgentSessionRuntime
} from '../providers/gateways'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { CurrentIndexedSourceSnapshot } from '../search/index-service'
import { KnowledgeChatService } from './knowledge-chat-service'

const projectId = '019d0000-0000-7000-8000-000000000410'
const projectSessionId = '019d0000-0000-7000-8000-000000000411'
const sourceA = '019d0000-0000-7000-8000-000000000412'
const sourceB = '019d0000-0000-7000-8000-000000000413'
const citationId = `citation-${'a'.repeat(40)}`
const log = pino({ level: 'silent' })
const roots: string[] = []
const databases: ProjectDatabase[] = []

afterEach(async () => {
  for (const database of databases.splice(0)) database.close()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function item(knowledgeItemId: string, displayName: string): KnowledgeItem {
  return {
    knowledgeItemId,
    originalName: `${displayName}.pdf`,
    displayName,
    state: 'stored',
    errorCode: null,
    mimeType: 'application/pdf',
    extension: 'pdf',
    byteSize: 100,
    bytesCopied: 100,
    sha256: 'a'.repeat(64),
    parseState: 'succeeded',
    normalizationState: 'published',
    activeParseRevisionId: '019d0000-0000-7000-8000-000000000414',
    activeNormalizationRunId: '019d0000-0000-7000-8000-000000000415',
    blockCount: 1,
    assetCount: 0,
    activatedAt: '2026-08-23T00:00:00.000Z',
    createdAt: '2026-08-23T00:00:00.000Z',
    updatedAt: '2026-08-23T00:00:00.000Z'
  }
}

function expanded(id = citationId): ExpandedCitation {
  return {
    citationId: id,
    knowledgeItemId: sourceA,
    parseRevisionId: '019d0000-0000-7000-8000-000000000414',
    chunkId: `chunk-${'b'.repeat(40)}`,
    title: 'Evidence source',
    text: 'The source says that grounded answers need evidence.',
    page: 0,
    headingPath: ['Evidence'],
    sourceBlockIds: [`kb_${'c'.repeat(32)}`],
    assetRefs: [],
    sources: []
  }
}

function metadata() {
  return {
    usage: {
      inputTokens: 10,
      outputTokens: 8,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsdMicros: null
    },
    responseIds: ['external-response'],
    retryCount: 0,
    providerModelId: 'gpt-test'
  }
}

class NotebookRuntime implements AgentSessionRuntime {
  readonly calls: AgentSessionRunInput[] = []
  block = false

  constructor(
    private readonly evidence: boolean,
    private readonly answer: string,
    private readonly searchKnowledgeItemIds: string[] = [],
    private readonly readCitationIds: string[] = [citationId]
  ) {}

  beginSessionRun(
    _config: ProviderConfig,
    _credential: string,
    input: AgentSessionRunInput,
    signal: AbortSignal,
    onEvent: (event: AgentRuntimeEvent) => void | Promise<void>,
    onToolRequest?: (request: AgentToolRequest, signal: AbortSignal) => Promise<AgentToolResponse>
  ): AgentSessionRunHandle {
    this.calls.push(input)
    let authorize: ((modelRequestId: string) => void) | null = null
    const finishModelCall = (modelRequestId: string) =>
      onEvent({
        type: 'model_call_finished',
        modelRequestId,
        outcome: 'succeeded',
        metadata: metadata()
      })
    const nextModelRequest = async (): Promise<string> => {
      const modelRequestId = new Promise<string>((resolve) => {
        authorize = resolve
      })
      await onEvent({
        type: 'model_call_requested',
        continuationId: randomUUID(),
        reason: 'tool_continuation'
      })
      return modelRequestId
    }
    const completion = this.block
      ? new Promise<never>((_, reject) =>
          signal.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            { once: true }
          )
        )
      : (async () => {
          if (onToolRequest === undefined) throw new Error('Notebook tool bridge is missing')
          await Promise.resolve()
          const base = (modelRequestId: string) => ({
            type: 'tool_request' as const,
            requestId: randomUUID(),
            projectSessionId: input.projectSessionId,
            agentSessionId: input.agentSessionId,
            agentRunId: input.agentRunId,
            modelRequestId
          })
          await onEvent({
            type: 'tool_attempted',
            modelRequestId: input.modelRequestId,
            toolCallId: 'search-1',
            requestedToolName: 'search_knowledge',
            argsHash: 'a'.repeat(64),
            argumentShape: '{}',
            timestamp: Date.now()
          })
          const search = await onToolRequest(
            {
              ...base(input.modelRequestId),
              toolCallId: 'search-1',
              toolName: 'search_knowledge',
              args: {
                query: 'evidence',
                knowledgeItemIds: this.searchKnowledgeItemIds,
                fileExtensions: [],
                parseRevisionIds: [],
                limit: 10,
                rerank: true
              }
            },
            signal
          )
          if (!search.ok) throw new Error(search.error.message)
          await finishModelCall(input.modelRequestId)
          let finalModelRequestId = await nextModelRequest()
          if (search.ok && this.evidence && this.readCitationIds.length > 0) {
            await onEvent({
              type: 'tool_attempted',
              modelRequestId: finalModelRequestId,
              toolCallId: 'read-1',
              requestedToolName: 'read_citations',
              argsHash: 'b'.repeat(64),
              argumentShape: '{}',
              timestamp: Date.now()
            })
            const read = await onToolRequest(
              {
                ...base(finalModelRequestId),
                toolCallId: 'read-1',
                toolName: 'read_citations',
                args: { citationIds: this.readCitationIds, requests: [] }
              },
              signal
            )
            if (!read.ok) throw new Error(read.error.message)
            await finishModelCall(finalModelRequestId)
            finalModelRequestId = await nextModelRequest()
          }
          const answer = this.evidence ? this.answer : '选中的资料中没有足够信息。'
          await onEvent({ type: 'assistant_delta', delta: answer.slice(0, 8) })
          await onEvent({
            type: 'assistant_message',
            modelRequestId: finalModelRequestId,
            message: {
              content: answer,
              stopReason: 'stop',
              provider: 'openai-compatible',
              model: 'gpt-test',
              responseId: 'external-response',
              metadata: metadata(),
              timestamp: Date.now(),
              interrupted: false
            }
          })
          await finishModelCall(finalModelRequestId)
          return { outcome: 'finished' as const }
        })()
    return {
      requestId: randomUUID(),
      completion,
      steer: () => undefined,
      followUp: () => undefined,
      queueAction: async () => 'completed',
      authorizeFollowUpConsumption: () => undefined,
      authorizeModelCall: (command) => {
        const resolve = authorize
        authorize = null
        if (resolve === null) throw new Error('Unexpected Notebook continuation authorization')
        resolve(command.modelRequestId)
      }
    }
  }
}

async function harness(
  options: {
    evidence?: boolean
    answer?: string
    searchKnowledgeItemIds?: string[]
    readCitationIds?: string[]
    hitCount?: number
    reasoning?: boolean
    defaultThinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  } = {}
) {
  const evidence = options.evidence ?? true
  const hitCount = options.hitCount ?? (evidence ? 1 : 0)
  const answer = options.answer ?? 'Grounded answer [[cite:1]] and fake [[cite:9]].'
  const retrieval = {
    search: vi.fn(async (_input: { query: string }) => ({
      mode: evidence ? 'fts' : 'none',
      rerankStatus: evidence ? 'not-configured' : 'disabled',
      hits: Array.from({ length: hitCount }, (_, index) => {
        const hitCitationId = `citation-${index.toString(16).padStart(40, '0')}`
        return {
          citationId: hitCount === 1 ? citationId : hitCitationId,
          knowledgeItemId: sourceA,
          parseRevisionId: '019d0000-0000-7000-8000-000000000414',
          chunkId: `chunk-${'b'.repeat(40)}`,
          title: 'Evidence source',
          snippet: 'Grounded evidence',
          page: 0,
          headingPath: ['Evidence'],
          sourceBlockIds: [`kb_${'c'.repeat(32)}`]
        }
      })
    })),
    expand: vi.fn(async (ids: string[]) => (evidence ? ids.map((id) => expanded(id)) : []))
  }
  const resolved = {
    presetId: 'builtin:openai',
    presetName: 'OpenAI',
    providerId: 'openai',
    timeoutMs: 60_000,
    model: {
      id: 'gpt-test',
      name: 'GPT Test',
      api: 'openai-responses',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      reasoning: options.reasoning ?? false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 131_072,
      maxTokens: 8_192
    },
    auth: { auth: { apiKey: 'secret' } }
  }
  const agentCatalog = {
    snapshot: vi.fn(async () => ({
      presets: [],
      defaultSelection: { presetId: 'builtin:openai', modelId: 'gpt-test' },
      defaultThinkingLevel: options.defaultThinkingLevel ?? 'off'
    })),
    resolve: vi.fn(async () => resolved)
  }
  const runtime = new NotebookRuntime(
    evidence,
    answer,
    options.searchKnowledgeItemIds,
    options.readCitationIds
  )
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const currentIndexedSources = vi.fn(
    async (): Promise<CurrentIndexedSourceSnapshot> => ({
      state: 'ready',
      generationId: 'generation',
      sources: [
        { knowledgeItemId: sourceA, displayName: 'Source A', extension: 'pdf' },
        { knowledgeItemId: sourceB, displayName: 'Source B', extension: 'pdf' }
      ]
    })
  )
  const root = await mkdtemp(join(tmpdir(), 'writellm-notebook-agent-'))
  roots.push(root)
  const projectRoot = join(root, 'Notebook.writellm')
  await mkdir(projectRoot)
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId,
      createdAt: '2026-08-23T00:00:00.000Z'
    },
    applicationVersion: 'test',
    log
  })
  databases.push(database)
  const service = new KnowledgeChatService({
    projectId,
    projectSessionId,
    database,
    retrieval: retrieval as never,
    projectIndex: {
      currentIndexedSources
    },
    listKnowledgeItems: () => [item(sourceA, 'Source A'), item(sourceB, 'Source B')],
    references: {
      list: () => [
        notebookReference(sourceA, 'sourceA2026', 'Source A'),
        notebookReference(sourceB, 'sourceB2026', 'Source B')
      ]
    } as never,
    agentCatalog: agentCatalog as never,
    runtime,
    limiter: new ProjectInteractiveModelLimiter(projectId, log),
    log: logger
  })
  return { service, retrieval, currentIndexedSources, agentCatalog, runtime, logger, database }
}

function notebookReference(knowledgeItemId: string, citationKey: string, title: string) {
  return {
    referenceId: knowledgeItemId,
    citationKey,
    title,
    creators: [],
    containerTitle: null,
    issuedYear: 2026,
    evidenceAvailable: true,
    knowledgeItemIds: [knowledgeItemId]
  }
}

async function completed(service: KnowledgeChatService) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = await service.snapshot()
    if (snapshot.phase === 'idle' && snapshot.messages.length > 0) return snapshot
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('Notebook turn did not settle')
}

describe('KnowledgeChatService', () => {
  it('defaults to all indexed sources and skips the answer model when evidence is absent', async () => {
    const { service, retrieval, runtime } = await harness({ evidence: false })
    const initial = await service.snapshot()
    expect(initial.sourceScope).toEqual({ mode: 'all', knowledgeItemIds: [] })
    expect(initial.availableKnowledgeItemIds).toEqual([sourceA, sourceB])

    await service.startTurn('What does the evidence say?')
    const snapshot = await completed(service)
    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ knowledgeItemIds: [sourceA, sourceB] })
      }),
      expect.any(AbortSignal)
    )
    expect(runtime.calls).toHaveLength(1)
    expect(snapshot.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'complete',
      content: '选中的资料中没有足够信息。'
    })
  })

  it('streams one metadata-only answer call and binds a per-message citation registry', async () => {
    const { service, runtime, logger, database } = await harness()
    await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    await service.startTurn('Summarize the evidence.')
    const snapshot = await completed(service)
    const assistant = snapshot.messages.at(-1)
    expect(assistant).toMatchObject({
      role: 'assistant',
      status: 'complete',
      citations: [{ ordinal: 1, citationId, knowledgeItemId: sourceA }]
    })
    expect(runtime.calls).toHaveLength(1)
    expect(runtime.calls[0]).toMatchObject({
      toolProfile: 'notebook_knowledge',
      thinkingLevel: 'off'
    })
    const modelRequests = await database.kysely.selectFrom('model_requests').selectAll().execute()
    expect(modelRequests).toHaveLength(3)
    expect(modelRequests.every((request) => request.response_ids_json === '[]')).toBe(true)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security.notebook_citation_marker_rejected',
        unknownCount: 1
      }),
      expect.any(String)
    )
  })

  it('inserts a source boundary and excludes old questions from the next retrieval query', async () => {
    const { service, runtime } = await harness({ answer: 'First [[cite:1]].' })
    await service.startTurn('Old scope question')
    await completed(service)
    await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    const afterChange = await service.snapshot()
    expect(afterChange.messages.at(-1)).toMatchObject({
      role: 'source_boundary',
      content: 'Sources changed'
    })
    await service.startTurn('New scope question')
    await completed(service)
    expect(runtime.calls[1]?.history).toEqual([])
  })

  it('marks an active turn stopped and releases all memory on close', async () => {
    const { service, runtime } = await harness()
    runtime.block = true
    await service.startTurn('Wait for me')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const stopped = await service.stopTurn()
    expect(stopped.phase).toBe('idle')
    expect(stopped.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'stopped' })
    await service.close()
    await expect(service.snapshot()).rejects.toThrow('closed')
  })

  it('preserves an explicit source selection while a replacement index is preparing', async () => {
    const { service, currentIndexedSources } = await harness()
    await service.snapshot()
    await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    currentIndexedSources.mockResolvedValueOnce({ state: 'preparing' })

    const preparing = await service.snapshot()
    expect(preparing.sourceScope).toEqual({ mode: 'selected', knowledgeItemIds: [sourceA] })
    expect(preparing.availableKnowledgeItemIds).toEqual([])

    const ready = await service.snapshot()
    expect(ready.sourceScope).toEqual({ mode: 'selected', knowledgeItemIds: [sourceA] })
    expect(ready.availableKnowledgeItemIds).toEqual([sourceA, sourceB])
  })

  it('rejects out-of-scope searches and citations that were not registered by this run', async () => {
    const outside = await harness({ searchKnowledgeItemIds: [sourceB] })
    await outside.service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    await outside.service.startTurn('Search outside the scope')
    const outsideSnapshot = await completed(outside.service)
    expect(outsideSnapshot.messages.at(-1)).toMatchObject({ status: 'failed' })
    expect(outside.retrieval.search).not.toHaveBeenCalled()

    const forgedCitation = `citation-${'f'.repeat(40)}`
    const forged = await harness({ readCitationIds: [forgedCitation] })
    await forged.service.startTurn('Read an unregistered citation')
    const forgedSnapshot = await completed(forged.service)
    expect(forgedSnapshot.messages.at(-1)).toMatchObject({ status: 'failed' })
    expect(forged.retrieval.expand).not.toHaveBeenCalled()
  })

  it('clamps the inherited effort and rejects unsupported local effort without changing defaults', async () => {
    const fixture = await harness()
    fixture.agentCatalog.snapshot.mockResolvedValueOnce({
      presets: [],
      defaultSelection: { presetId: 'builtin:openai', modelId: 'gpt-test' },
      defaultThinkingLevel: 'high'
    })

    const initial = await fixture.service.snapshot()
    expect(initial.thinkingLevel).toBe('off')
    await expect(fixture.service.setThinkingLevel('high')).rejects.toThrow('unavailable')
    expect(fixture.agentCatalog.snapshot).toHaveBeenCalledTimes(1)
  })

  it('keeps a supported local effort and passes it through the shared runtime', async () => {
    const fixture = await harness({ reasoning: true, defaultThinkingLevel: 'medium' })
    expect((await fixture.service.snapshot()).thinkingLevel).toBe('medium')
    expect((await fixture.service.setThinkingLevel('high')).thinkingLevel).toBe('high')
    await fixture.service.startTurn('Use high effort')
    await completed(fixture.service)
    expect(fixture.runtime.calls[0]?.thinkingLevel).toBe('high')
    expect(fixture.agentCatalog.snapshot).toHaveBeenCalledTimes(1)
  })

  it('keeps only the newest complete pairs within the 64 KiB Agent history budget', async () => {
    const fixture = await harness({ answer: 'x'.repeat(40_000), readCitationIds: [] })
    await fixture.service.startTurn('First bounded history question')
    await completed(fixture.service)
    await fixture.service.startTurn('Second bounded history question')
    await completed(fixture.service)
    await fixture.service.startTurn('Third bounded history question')
    await completed(fixture.service)

    expect(fixture.runtime.calls[1]?.history).toHaveLength(2)
    expect(fixture.runtime.calls[2]?.history).toHaveLength(2)
    expect(fixture.runtime.calls[2]?.history[0]).toMatchObject({
      role: 'user',
      content: 'Second bounded history question'
    })
  })

  it('registers at most twelve unique citation ordinals and leaves forged markers inactive', async () => {
    const fixture = await harness({
      hitCount: 20,
      readCitationIds: [],
      answer: 'Bounded [[cite:1]] [[cite:12]] [[cite:13]].'
    })
    await fixture.service.startTurn('Find many sources')
    const snapshot = await completed(fixture.service)
    const assistant = snapshot.messages.at(-1)
    expect(assistant?.role).toBe('assistant')
    if (assistant?.role !== 'assistant') throw new Error('Expected Notebook answer')
    expect(assistant.citations).toHaveLength(12)
    expect(assistant.citations.map((citation) => citation.ordinal)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12
    ])
    expect(fixture.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security.notebook_citation_marker_rejected',
        unknownCount: 1
      }),
      expect.any(String)
    )
  })

  it('requires a configured model and reports retrieval failures without losing the question', async () => {
    const missingModel = await harness()
    missingModel.agentCatalog.snapshot.mockResolvedValueOnce({
      presets: [],
      defaultSelection: null,
      defaultThinkingLevel: 'off'
    } as never)
    await expect(missingModel.service.startTurn('Can I ask?')).rejects.toThrow(
      'Configure and select an Agent model'
    )

    const failed = await harness()
    const retrievalError = new Error('retrieval failed')
    failed.retrieval.search.mockRejectedValueOnce(retrievalError)
    await failed.service.startTurn('Keep this question visible')
    const snapshot = await completed(failed.service)
    expect(snapshot.messages).toEqual([
      expect.objectContaining({ role: 'user', content: 'Keep this question visible' }),
      expect.objectContaining({ role: 'assistant', status: 'failed' })
    ])
    expect(snapshot.lastError).toContain('could not answer')
    expect(failed.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: retrievalError, event: 'knowledge.notebook.tool_failed' }),
      expect.any(String)
    )
  })
})
