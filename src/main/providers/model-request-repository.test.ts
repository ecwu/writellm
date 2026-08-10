import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import { ModelRequestRepository } from './model-request-repository'

const directories: string[] = []
const log = pino({ level: 'silent' })
const provider: ProviderConfig = {
  role: 'agent',
  providerId: 'openai-compatible',
  baseUrl: 'https://api.example.test/v1',
  model: 'writer-model',
  modelRevision: 'writer-rev-1',
  timeoutMs: 1_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null
}

async function database(): Promise<ProjectDatabase> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-model-request-'))
  directories.push(parent)
  const root = join(parent, 'project')
  await mkdir(root)
  return initializeProjectDatabase({
    projectRoot: root,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc099',
      createdAt: '2026-07-16T00:00:00.000Z'
    },
    applicationVersion: 'test',
    log
  })
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true })))
})

describe('ModelRequestRepository', () => {
  it('persists bounded metadata and fingerprints without content, responses, or vectors', async () => {
    const project = await database()
    const times = [new Date('2026-07-16T10:00:00.000Z'), new Date('2026-07-16T10:00:00.125Z')]
    const repository = new ModelRequestRepository(
      project,
      log,
      () => times.shift() ?? new Date('2026-07-16T10:00:00.125Z'),
      () => '019c6a5c-8d34-7a8e-a602-3d37a52dc100'
    )
    const record = await repository.start({
      operation: 'agent',
      provider,
      request: { prompt: 'PRIVATE-PROMPT', nested: { answer: 'PRIVATE-RESPONSE' } },
      inputItems: 1,
      operationId: 'operation-1'
    })
    await repository.succeed(record.modelRequestId, {
      metadata: {
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          cacheReadTokens: 2,
          cacheWriteTokens: 0,
          estimatedCostUsdMicros: null
        },
        responseIds: ['response-1'],
        retryCount: 1,
        providerModelId: 'writer-model'
      },
      outputItems: 1
    })

    const row = await project.kysely
      .selectFrom('model_requests')
      .selectAll()
      .executeTakeFirstOrThrow()
    expect(row).toMatchObject({
      status: 'succeeded',
      provider_id: 'openai-compatible',
      model_id: 'writer-model',
      retry_count: 1,
      input_tokens: 10,
      output_tokens: 4,
      duration_ms: 125,
      operation_id: 'operation-1'
    })
    expect(row.provider_fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(row.request_fingerprint).toMatch(/^[a-f0-9]{64}$/)
    const serialized = JSON.stringify(row)
    expect(serialized).not.toContain('PRIVATE-PROMPT')
    expect(serialized).not.toContain('PRIVATE-RESPONSE')
    expect(serialized).not.toContain('embedding')
    project.close()
  })

  it('allows one terminal transition and persists only a safe error classification', async () => {
    const project = await database()
    const repository = new ModelRequestRepository(project, log)
    const record = await repository.start({
      operation: 'agent',
      provider,
      request: { prompt: 'secret' },
      inputItems: 1
    })
    await repository.fail(
      record.modelRequestId,
      {
        code: 'rate_limited',
        retryable: true,
        httpStatus: 429
      },
      {
        usage: {
          inputTokens: 10,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          estimatedCostUsdMicros: null
        },
        responseIds: [],
        retryCount: 4,
        providerModelId: 'writer-model'
      }
    )
    await expect(repository.abort(record.modelRequestId)).rejects.toThrow('transitionable')
    const row = await project.kysely
      .selectFrom('model_requests')
      .select(['status', 'error_json', 'retry_count'])
      .executeTakeFirstOrThrow()
    expect(row).toEqual({
      status: 'failed',
      error_json: JSON.stringify({ code: 'rate_limited', retryable: true, httpStatus: 429 }),
      retry_count: 4
    })
    project.close()
  })
})
