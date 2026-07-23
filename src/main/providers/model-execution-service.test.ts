import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import type {
  AgentModelRuntime,
  EmbeddingGateway,
  ImageGenerationGateway,
  RerankGateway
} from './gateways'
import { ModelExecutionService } from './model-execution-service'
import type { ProviderService } from './provider-service'

const directories: string[] = []
const log = pino({ level: 'silent' })

async function database(): Promise<ProjectDatabase> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-model-execution-'))
  directories.push(parent)
  const root = join(parent, 'project')
  await mkdir(root)
  return initializeProjectDatabase({
    projectRoot: root,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc401',
      createdAt: '2026-07-16T00:00:00.000Z'
    },
    applicationVersion: 'test',
    log
  })
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

function service(options?: {
  agent?: AgentModelRuntime
  images?: ImageGenerationGateway
}): ModelExecutionService {
  const configs: Record<'agent' | 'embedding' | 'rerank' | 'image', ProviderConfig> = {
    agent: {
      role: 'agent',
      providerId: 'openai-compatible',
      baseUrl: 'https://agent.example.test/v1',
      model: 'writer',
      modelRevision: 'writer-rev-1',
      timeoutMs: 1_000,
      embeddingDimension: null,
      batchLimit: 1,
      fileSizeLimitMb: null
    },
    embedding: {
      role: 'embedding',
      providerId: 'openai-compatible',
      baseUrl: 'https://embedding.example.test/v1',
      model: 'embedder',
      modelRevision: 'embedder-rev-1',
      timeoutMs: 1_000,
      embeddingDimension: 2,
      batchLimit: 10,
      fileSizeLimitMb: null
    },
    rerank: {
      role: 'rerank',
      providerId: 'cohere-compatible',
      baseUrl: 'https://rerank.example.test/v2',
      model: 'reranker',
      modelRevision: 'reranker-rev-1',
      timeoutMs: 1_000,
      embeddingDimension: null,
      batchLimit: 10,
      fileSizeLimitMb: null
    },
    image: {
      role: 'image',
      providerId: 'google-gemini',
      model: 'gemini-3.1-flash-image',
      timeoutMs: 120_000,
      embeddingDimension: null,
      batchLimit: 1,
      fileSizeLimitMb: null,
      defaultAspectRatio: 'auto',
      defaultImageSize: '1K'
    }
  }
  const providers = {
    withConfiguredProvider: async <T>(
      role: 'agent' | 'embedding' | 'rerank' | 'image',
      operation: (config: ProviderConfig, credential: string) => Promise<T>
    ) => operation(configs[role], 'runtime-secret')
  } as unknown as ProviderService
  const agent: AgentModelRuntime =
    options?.agent ??
    ({
      run: vi.fn(async () => ({
        text: 'draft',
        stopReason: 'stop',
        metadata: metadata('writer')
      }))
    } as AgentModelRuntime)
  const embeddings: EmbeddingGateway = {
    embedBatch: vi.fn(async (_config, credential) => {
      expect(credential).toBe('runtime-secret')
      return { embeddings: [[0, 1]], metadata: metadata('embedder') }
    })
  }
  const reranker: RerankGateway = {
    rerank: vi.fn(async () => ({
      ranking: [{ originalIndex: 0, score: 0.9 }],
      metadata: metadata('reranker')
    }))
  }
  const images: ImageGenerationGateway =
    options?.images ??
    ({
      generateImage: vi.fn(async () => ({
        dataBase64: 'aW1hZ2U=',
        mimeType: 'image/png',
        effectiveImageSize: '1K',
        metadata: metadata('gemini-3.1-flash-image')
      }))
    } as ImageGenerationGateway)
  return new ModelExecutionService({ providers, agent, embeddings, reranker, images, log })
}

describe('ModelExecutionService', () => {
  it('routes embedding through its dedicated gateway and durably records safe metadata', async () => {
    const project = await database()
    const result = await service().embedBatch(
      project,
      { values: ['PRIVATE-DOCUMENT'] },
      { operationId: 'operation-embedding' },
      new AbortController().signal
    )
    expect(result.embeddings).toEqual([[0, 1]])
    const row = await project.kysely
      .selectFrom('model_requests')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(row).toMatchObject({
      operation_kind: 'embedding',
      status: 'succeeded',
      input_items: 1,
      output_items: 1,
      operation_id: 'operation-embedding'
    })
    expect(JSON.stringify(row)).not.toContain('PRIVATE-DOCUMENT')
    expect(JSON.stringify(row)).not.toContain('runtime-secret')
    expect(JSON.stringify(row)).not.toContain('[0,1]')
    project.close()
  })

  it('rejects a query embedding provider contract change before recording or calling the gateway', async () => {
    const project = await database()
    const contractError = new Error('embedding contract changed')
    await expect(
      service().embedBatch(
        project,
        { values: ['query'] },
        { operationId: 'guarded-query' },
        new AbortController().signal,
        () => {
          throw contractError
        }
      )
    ).rejects.toBe(contractError)
    await expect(
      project.kysely.selectFrom('model_requests').select('model_request_id').execute()
    ).resolves.toEqual([])
    project.close()
  })

  it('records request-scoped image generation without persisting prompt or bytes', async () => {
    const project = await database()
    const result = await service().generateImage(
      project,
      { prompt: 'PRIVATE-IMAGE-PROMPT', aspectRatio: '16:9', imageSize: '1K' },
      {
        operationId: 'operation-image',
        agentRunId: 'agent-run-image',
        projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc402'
      },
      new AbortController().signal
    )
    expect(result).toMatchObject({ mimeType: 'image/png', modelRequestId: expect.any(String) })
    const row = await project.kysely
      .selectFrom('model_requests')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(row).toMatchObject({
      operation_kind: 'image',
      status: 'succeeded',
      input_items: 1,
      output_items: 1,
      operation_id: 'operation-image',
      agent_run_id: 'agent-run-image'
    })
    expect(JSON.stringify(row)).not.toContain('PRIVATE-IMAGE-PROMPT')
    expect(JSON.stringify(row)).not.toContain('aW1hZ2U=')
    project.close()
  })

  it('classifies provider errors, records failure, and preserves the original rejection', async () => {
    const project = await database()
    const providerError: Error & { status: number } = Object.assign(new Error('rate limited'), {
      status: 429
    })
    const agent: AgentModelRuntime = {
      run: vi.fn(async () => {
        throw providerError
      })
    }
    const execution = service({ agent })
    await expect(
      execution.runAgent(
        project,
        { systemPrompt: 'private system', prompt: 'private prompt', maxOutputTokens: 100 },
        { agentRunId: 'agent-run-1' },
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toBe(providerError)
    const row = await project.kysely
      .selectFrom('model_requests')
      .select(['status', 'error_json', 'agent_run_id'])
      .executeTakeFirstOrThrow()
    expect(row).toEqual({
      status: 'failed',
      error_json: JSON.stringify({ code: 'rate_limited', retryable: true, httpStatus: 429 }),
      agent_run_id: 'agent-run-1'
    })
    project.close()
  })

  it.each([
    [401, { code: 'invalid_auth', retryable: false, httpStatus: 401 }],
    [503, { code: 'provider_unavailable', retryable: true, httpStatus: 503 }]
  ] as const)('classifies HTTP %i without persisting a provider response body', async (status, safeError) => {
    const project = await database()
    const agent: AgentModelRuntime = {
      run: vi.fn(async () => {
        throw Object.assign(new Error('PRIVATE-PROVIDER-BODY'), { status })
      })
    }
    await expect(
      service({ agent }).runAgent(
        project,
        { systemPrompt: '', prompt: 'private prompt', maxOutputTokens: 100 },
        {},
        new AbortController().signal,
        () => undefined
      )
    ).rejects.toThrow('PRIVATE-PROVIDER-BODY')
    const row = await project.kysely
      .selectFrom('model_requests')
      .select(['error_json'])
      .executeTakeFirstOrThrow()
    expect(JSON.parse(row.error_json ?? '{}')).toEqual(safeError)
    expect(row.error_json).not.toContain('PRIVATE-PROVIDER-BODY')
    project.close()
  })
})

function metadata(providerModelId: string) {
  return {
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsdMicros: null
    },
    responseIds: ['response-1'],
    retryCount: 0,
    providerModelId
  }
}
