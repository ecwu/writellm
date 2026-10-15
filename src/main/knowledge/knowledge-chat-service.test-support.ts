import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, expect, vi } from 'vitest'
import type { AgentRuntimeEvent } from '../../shared/contracts/agent'
import type { AgentToolRequest, AgentToolResponse } from '../../shared/contracts/agent-tools'
import type { KnowledgeItem } from '../../shared/contracts/knowledge'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { ExpandedCitation } from '../../shared/contracts/search'
import type {
  AgentSessionRunHandle,
  AgentSessionRunInput,
  AgentSessionRuntime
} from '../providers/gateways'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type { CurrentIndexedSourceSnapshot } from '../search/index-service'
import { KnowledgeChatService, type KnowledgeChatServiceOptions } from './knowledge-chat-service'

const projectId = '019d0000-0000-7000-8000-000000000410'
const projectSessionId = '019d0000-0000-7000-8000-000000000411'
export const sourceA = '019d0000-0000-7000-8000-000000000412'
export const sourceB = '019d0000-0000-7000-8000-000000000413'
export const citationId = `citation-${'a'.repeat(40)}`
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

export async function harness(
  options: {
    evidence?: boolean
    sourceIds?: string[]
    answer?: string
    searchKnowledgeItemIds?: string[]
    readCitationIds?: string[]
    hitCount?: number
    reasoning?: boolean
    defaultThinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  } = {}
) {
  const sourceIds = options.sourceIds ?? [sourceA, sourceB]
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
      sources: sourceIds.map((knowledgeItemId) => ({
        knowledgeItemId,
        displayName: 'Source',
        extension: 'pdf'
      }))
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
  const serviceOptions: KnowledgeChatServiceOptions = {
    projectId,
    projectSessionId,
    database,
    retrieval: retrieval as never,
    projectIndex: {
      currentIndexedSources
    },
    listKnowledgeItems: () => sourceIds.map((id) => item(id, 'Source')),
    references: {
      list: () => [
        notebookReference(sourceA, 'sourceA2026', 'Source A'),
        notebookReference(sourceB, 'sourceB2026', 'Source B')
      ]
    } as never,
    agentCatalog: agentCatalog as never,
    runtime,
    log: logger
  }
  const service = new KnowledgeChatService(serviceOptions)
  return {
    serviceOptions,
    service,
    retrieval,
    currentIndexedSources,
    agentCatalog,
    runtime,
    logger,
    database
  }
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

export async function completed(service: KnowledgeChatService) {
  return vi.waitFor(async () => {
    const snapshot = await service.snapshot()
    expect(snapshot.phase).toBe('idle')
    expect(snapshot.messages.length).toBeGreaterThan(0)
    return snapshot
  })
}
