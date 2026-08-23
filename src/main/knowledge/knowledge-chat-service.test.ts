import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { KnowledgeItem } from '../../shared/contracts/knowledge'
import type { ExpandedCitation } from '../../shared/contracts/search'
import { ProjectInteractiveModelLimiter } from '../agent/project-interactive-model-limiter'
import type { CurrentIndexedSourceSnapshot } from '../search/index-service'
import { KnowledgeChatService } from './knowledge-chat-service'

const projectId = '019d0000-0000-7000-8000-000000000410'
const projectSessionId = '019d0000-0000-7000-8000-000000000411'
const sourceA = '019d0000-0000-7000-8000-000000000412'
const sourceB = '019d0000-0000-7000-8000-000000000413'
const citationId = `citation-${'a'.repeat(40)}`
const log = pino({ level: 'silent' })

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

function expanded(): ExpandedCitation {
  return {
    citationId,
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

function harness(options: { evidence?: boolean; answer?: string } = {}) {
  const evidence = options.evidence ?? true
  const answer = options.answer ?? 'Grounded answer [[cite:1]] and fake [[cite:9]].'
  const retrieval = {
    search: vi.fn(async (_input: { query: string }) => ({
      mode: evidence ? 'fts' : 'none',
      rerankStatus: evidence ? 'not-configured' : 'disabled',
      hits: evidence ? [{ citationId }] : []
    })),
    expand: vi.fn(async () => (evidence ? [expanded()] : []))
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
      reasoning: false,
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
      defaultThinkingLevel: 'off'
    })),
    resolve: vi.fn(async () => resolved)
  }
  const modelExecution = {
    runAgentWithResolvedProvider: vi.fn(
      async (
        _database: unknown,
        _request: unknown,
        _correlation: unknown,
        _resolved: unknown,
        _signal: AbortSignal,
        onEvent: (event: { type: 'text-delta'; delta: string }) => void,
        _options: { retention: 'metadata_only' }
      ) => {
        onEvent({ type: 'text-delta', delta: 'Grounded ' })
        return {
          result: {
            text: answer,
            stopReason: 'stop',
            metadata: {
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
          },
          modelRequestId: '019d0000-0000-7000-8000-000000000416'
        }
      }
    )
  }
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
  const service = new KnowledgeChatService({
    projectId,
    projectSessionId,
    database: {} as never,
    retrieval: retrieval as never,
    projectIndex: {
      currentIndexedSources
    },
    listKnowledgeItems: () => [item(sourceA, 'Source A'), item(sourceB, 'Source B')],
    agentCatalog: agentCatalog as never,
    modelExecution: modelExecution as never,
    limiter: new ProjectInteractiveModelLimiter(projectId, log),
    log: logger
  })
  return { service, retrieval, currentIndexedSources, agentCatalog, modelExecution, logger }
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
    const { service, retrieval, modelExecution } = harness({ evidence: false })
    const initial = await service.snapshot()
    expect(initial.sourceScope).toEqual({ mode: 'all', knowledgeItemIds: [] })
    expect(initial.availableKnowledgeItemIds).toEqual([sourceA, sourceB])

    await service.startTurn('What does the evidence say?')
    const snapshot = await completed(service)
    expect(retrieval.search).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: expect.objectContaining({ knowledgeItemIds: [sourceA, sourceB] })
      }),
      expect.any(AbortSignal),
      { ftsMode: 'terms' }
    )
    expect(modelExecution.runAgentWithResolvedProvider).not.toHaveBeenCalled()
    expect(snapshot.messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: 'complete',
      content: '选中的资料中没有足够信息。'
    })
  })

  it('streams one metadata-only answer call and binds a per-message citation registry', async () => {
    const { service, modelExecution, logger } = harness()
    await service.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    await service.startTurn('Summarize the evidence.')
    const snapshot = await completed(service)
    const assistant = snapshot.messages.at(-1)
    expect(assistant).toMatchObject({
      role: 'assistant',
      status: 'complete',
      citations: [{ ordinal: 1, citationId, knowledgeItemId: sourceA }]
    })
    expect(modelExecution.runAgentWithResolvedProvider).toHaveBeenCalledTimes(1)
    expect(modelExecution.runAgentWithResolvedProvider.mock.calls[0]?.[6]).toEqual({
      retention: 'metadata_only'
    })
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security.notebook_citation_marker_rejected',
        unknownCount: 1
      }),
      expect.any(String)
    )
  })

  it('inserts a source boundary and excludes old questions from the next retrieval query', async () => {
    const { service, retrieval } = harness({ answer: 'First [[cite:1]].' })
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
    const secondQuery = retrieval.search.mock.calls[1]?.[0]?.query
    expect(secondQuery).toContain('New scope question')
    expect(secondQuery).not.toContain('Old scope question')
  })

  it('marks an active turn stopped and releases all memory on close', async () => {
    const { service, modelExecution } = harness()
    modelExecution.runAgentWithResolvedProvider.mockImplementationOnce(
      async (
        _database: unknown,
        _request: unknown,
        _correlation: unknown,
        _resolved: unknown,
        signal: AbortSignal
      ) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )
    await service.startTurn('Wait for me')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const stopped = await service.stopTurn()
    expect(stopped.phase).toBe('idle')
    expect(stopped.messages.at(-1)).toMatchObject({ role: 'assistant', status: 'stopped' })
    await service.close()
    await expect(service.snapshot()).rejects.toThrow('closed')
  })

  it('preserves an explicit source selection while a replacement index is preparing', async () => {
    const { service, currentIndexedSources } = harness()
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

  it('requires a configured model and reports retrieval failures without losing the question', async () => {
    const missingModel = harness()
    missingModel.agentCatalog.snapshot.mockResolvedValueOnce({
      presets: [],
      defaultSelection: null,
      defaultThinkingLevel: 'off'
    } as never)
    await expect(missingModel.service.startTurn('Can I ask?')).rejects.toThrow(
      'Configure and select an Agent model'
    )

    const failed = harness()
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
      expect.objectContaining({ err: retrievalError, event: 'knowledge.notebook.turn_failed' }),
      expect.any(String)
    )
  })
})
