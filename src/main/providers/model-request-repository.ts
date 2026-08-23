import { createHash, randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import type { ModelExecutionMetadata } from '../../shared/contracts/model-runtime'
import type { AgentThinkingLevel, ProviderConfig } from '../../shared/contracts/providers'
import type { ModelRequestOperationKind, ModelRequestStatus } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'

export interface ModelRequestCorrelation {
  operationId?: string
  jobId?: string
  agentRunId?: string
  projectSessionId?: string
}

export interface StartModelRequestInput extends ModelRequestCorrelation {
  operation: ModelRequestOperationKind
  provider: ProviderConfig
  request: unknown
  inputItems: number
  attemptCount?: number
  delivery?: 'skill_route'
  thinkingLevel?: AgentThinkingLevel
  retention?: ModelRequestRetention
}

export type ModelRequestRetention = 'standard' | 'metadata_only'

export interface SafeModelRequestError {
  code: string
  retryable: boolean
  httpStatus?: number
}

export interface CompleteModelRequestInput {
  metadata: ModelExecutionMetadata
  outputItems: number
}

export interface ModelRequestRecord {
  modelRequestId: string
  status: ModelRequestStatus
  retention: ModelRequestRetention
}

export class ModelRequestRepository {
  constructor(
    private readonly database: ProjectDatabase,
    private readonly log: Pick<Logger, 'info' | 'warn'>,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  async start(input: StartModelRequestInput): Promise<ModelRequestRecord> {
    if (!Number.isInteger(input.inputItems) || input.inputItems < 0) {
      throw new Error('inputItems must be a non-negative integer')
    }
    if (input.provider.role !== input.operation) {
      throw new Error('Model request operation does not match the provider role')
    }
    if (input.thinkingLevel !== undefined && input.operation !== 'agent') {
      throw new Error('Thinking level is only valid for Agent model requests')
    }
    if (
      input.attemptCount !== undefined &&
      (!Number.isInteger(input.attemptCount) || input.attemptCount < 1)
    ) {
      throw new Error('attemptCount must be a positive integer')
    }
    const modelRequestId = this.createId()
    const now = this.now().toISOString()
    const providerFingerprint = fingerprint({
      providerId: input.provider.providerId,
      ...(input.provider.role === 'image' ? {} : { baseUrl: input.provider.baseUrl }),
      model: input.provider.model,
      role: input.provider.role
    })
    const retention = input.retention ?? 'standard'
    const requestFingerprint = fingerprint(
      retention === 'metadata_only' ? { modelRequestId } : input.request
    )
    await this.database.kysely
      .insertInto('model_requests')
      .values({
        model_request_id: modelRequestId,
        operation_kind: input.operation,
        provider_id: input.provider.providerId,
        model_id: input.provider.model,
        provider_fingerprint: providerFingerprint,
        request_fingerprint: requestFingerprint,
        status: 'running',
        attempt_count: input.attemptCount ?? 1,
        retry_count: 0,
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cache_write_tokens: null,
        input_items: input.inputItems,
        output_items: null,
        estimated_cost_usd_micros: null,
        usage_json: '{}',
        response_ids_json: '[]',
        error_json: null,
        operation_id: input.operationId ?? null,
        job_id: input.jobId ?? null,
        agent_run_id: input.agentRunId ?? null,
        thinking_level: input.thinkingLevel ?? null,
        delivery: input.delivery ?? null,
        started_at: now,
        completed_at: null,
        duration_ms: null,
        created_at: now,
        updated_at: now
      })
      .execute()
    this.log.info(
      {
        event: 'model_request.started',
        modelRequestId,
        operation: input.operation,
        providerId: input.provider.providerId,
        modelId: input.provider.model,
        inputItems: input.inputItems,
        operationId: input.operationId,
        jobId: input.jobId,
        agentRunId: input.agentRunId,
        thinkingLevel: input.thinkingLevel,
        retention
      },
      'Model request started'
    )
    return { modelRequestId, status: 'running', retention }
  }

  recoverRunning(): number {
    const now = this.now().toISOString()
    const result = this.database.immediate((database) =>
      database
        .prepare(
          `UPDATE model_requests
              SET status = 'aborted', error_json = ?, completed_at = ?, updated_at = ?
            WHERE status = 'running'`
        )
        .run(JSON.stringify({ code: 'utility_process_lost', retryable: true }), now, now)
    )
    if (result.changes > 0) {
      this.log.warn(
        { event: 'model_request.running_recovered', count: result.changes },
        'Recovered model requests left running by a terminated utility'
      )
    }
    return result.changes
  }

  async succeed(
    modelRequestId: string,
    input: CompleteModelRequestInput,
    retention: ModelRequestRetention = 'standard'
  ): Promise<ModelRequestRecord> {
    const completedAt = this.now()
    const durationMs = await this.durationMs(modelRequestId, completedAt)
    const update = await this.database.kysely
      .updateTable('model_requests')
      .set({
        status: 'succeeded',
        retry_count: input.metadata.retryCount,
        input_tokens: input.metadata.usage.inputTokens,
        output_tokens: input.metadata.usage.outputTokens,
        cache_read_tokens: input.metadata.usage.cacheReadTokens,
        cache_write_tokens: input.metadata.usage.cacheWriteTokens,
        output_items: input.outputItems,
        estimated_cost_usd_micros: input.metadata.usage.estimatedCostUsdMicros,
        usage_json: JSON.stringify(input.metadata.usage),
        response_ids_json: JSON.stringify(
          retention === 'metadata_only' ? [] : input.metadata.responseIds
        ),
        completed_at: completedAt.toISOString(),
        duration_ms: durationMs,
        updated_at: completedAt.toISOString()
      })
      .where('model_request_id', '=', modelRequestId)
      .where('status', '=', 'running')
      .executeTakeFirst()
    assertTransition(update.numUpdatedRows, modelRequestId)
    this.log.info(
      {
        event: 'model_request.succeeded',
        modelRequestId,
        retryCount: input.metadata.retryCount,
        outputItems: input.outputItems
      },
      'Model request succeeded'
    )
    return { modelRequestId, status: 'succeeded', retention }
  }

  async fail(
    modelRequestId: string,
    error: SafeModelRequestError,
    metadata?: ModelExecutionMetadata,
    retention: ModelRequestRetention = 'standard'
  ): Promise<ModelRequestRecord> {
    return this.finish(modelRequestId, 'failed', error, metadata, retention)
  }

  async abort(
    modelRequestId: string,
    code = 'aborted',
    metadata?: ModelExecutionMetadata,
    retention: ModelRequestRetention = 'standard'
  ): Promise<ModelRequestRecord> {
    return this.finish(modelRequestId, 'aborted', { code, retryable: false }, metadata, retention)
  }

  private async finish(
    modelRequestId: string,
    status: 'failed' | 'aborted',
    error: SafeModelRequestError,
    metadata: ModelExecutionMetadata | undefined,
    retention: ModelRequestRetention
  ): Promise<ModelRequestRecord> {
    const completedAt = this.now()
    const safeError = parseSafeError(error)
    const durationMs = await this.durationMs(modelRequestId, completedAt)
    const update = await this.database.kysely
      .updateTable('model_requests')
      .set({
        status,
        error_json: JSON.stringify(safeError),
        ...(metadata === undefined
          ? {}
          : {
              retry_count: metadata.retryCount,
              input_tokens: metadata.usage.inputTokens,
              output_tokens: metadata.usage.outputTokens,
              cache_read_tokens: metadata.usage.cacheReadTokens,
              cache_write_tokens: metadata.usage.cacheWriteTokens,
              estimated_cost_usd_micros: metadata.usage.estimatedCostUsdMicros,
              usage_json: JSON.stringify(metadata.usage),
              response_ids_json: JSON.stringify(
                retention === 'metadata_only' ? [] : metadata.responseIds
              )
            }),
        completed_at: completedAt.toISOString(),
        duration_ms: durationMs,
        updated_at: completedAt.toISOString()
      })
      .where('model_request_id', '=', modelRequestId)
      .where('status', '=', 'running')
      .executeTakeFirst()
    assertTransition(update.numUpdatedRows, modelRequestId)
    this.log.warn(
      {
        event: `model_request.${status}`,
        modelRequestId,
        errorCode: safeError.code,
        ...(metadata === undefined ? {} : { retryCount: metadata.retryCount })
      },
      `Model request ${status}`
    )
    return { modelRequestId, status, retention }
  }

  private async durationMs(modelRequestId: string, completedAt: Date): Promise<number> {
    const row = await this.database.kysely
      .selectFrom('model_requests')
      .select('started_at')
      .where('model_request_id', '=', modelRequestId)
      .executeTakeFirst()
    if (row === undefined) throw new Error('Model request does not exist')
    return Math.max(0, completedAt.getTime() - new Date(row.started_at).getTime())
  }
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()))
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      throw new Error('Model request fingerprint input is not serializable')
    }
    return value
  }
  if (seen.has(value)) throw new Error('Model request fingerprint input contains a cycle')
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen))
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new Error('Model request fingerprint input must contain plain data')
    }
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        const member = (value as Record<string, unknown>)[key]
        if (member !== undefined) result[key] = canonicalize(member, seen)
        return result
      }, {})
  } finally {
    seen.delete(value)
  }
}

function parseSafeError(error: SafeModelRequestError): SafeModelRequestError {
  if (!/^[a-z0-9_.-]{1,100}$/.test(error.code)) throw new Error('Invalid model error code')
  if (
    error.httpStatus !== undefined &&
    (!Number.isInteger(error.httpStatus) || error.httpStatus < 100 || error.httpStatus > 599)
  ) {
    throw new Error('Invalid model error HTTP status')
  }
  return {
    code: error.code,
    retryable: error.retryable,
    ...(error.httpStatus === undefined ? {} : { httpStatus: error.httpStatus })
  }
}

function assertTransition(updated: bigint, modelRequestId: string): void {
  if (updated !== 1n) {
    throw new Error(`Model request ${modelRequestId} is not in a transitionable state`)
  }
}
