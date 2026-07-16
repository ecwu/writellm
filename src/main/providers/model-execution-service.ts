import type { Logger } from 'pino'
import {
  agentRunInputSchema,
  embeddingBatchInputSchema,
  rerankInputSchema,
  type AgentRunInput,
  type AgentRunResult,
  type AgentStreamEvent,
  type EmbeddingBatchInput,
  type EmbeddingBatchResult,
  type RerankInput,
  type RerankResult
} from '../../shared/contracts/model-runtime'
import type { ProjectDatabase } from '../project/project-database'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { AgentModelRuntime, EmbeddingGateway, RerankGateway } from './gateways'
import {
  ModelRequestRepository,
  type ModelRequestCorrelation,
  type SafeModelRequestError
} from './model-request-repository'
import type { ProviderService } from './provider-service'

export interface ModelExecutionServiceOptions {
  providers: ProviderService
  agent: AgentModelRuntime
  embeddings: EmbeddingGateway
  reranker: RerankGateway
  log: Pick<Logger, 'info' | 'warn' | 'error'>
}

export class ModelExecutionService {
  constructor(private readonly options: ModelExecutionServiceOptions) {}

  recoverRunning(database: ProjectDatabase): number {
    return new ModelRequestRepository(database, this.options.log).recoverRunning()
  }

  runAgent(
    database: ProjectDatabase,
    rawInput: AgentRunInput,
    correlation: ModelRequestCorrelation,
    signal: AbortSignal,
    onEvent: (event: AgentStreamEvent) => void
  ): Promise<AgentRunResult> {
    const input = agentRunInputSchema.parse(rawInput)
    return this.execute(
      database,
      'agent',
      input,
      1,
      correlation,
      signal,
      (config, credential) =>
        this.options.agent.run(
          config,
          credential,
          input,
          signal,
          onEvent,
          correlation.projectSessionId
        ),
      (result) => ({ metadata: result.metadata, outputItems: result.text.length === 0 ? 0 : 1 })
    )
  }

  embedBatch(
    database: ProjectDatabase,
    rawInput: EmbeddingBatchInput,
    correlation: ModelRequestCorrelation,
    signal: AbortSignal,
    configGuard?: (config: ProviderConfig) => void
  ): Promise<EmbeddingBatchResult> {
    const input = embeddingBatchInputSchema.parse(rawInput)
    return this.execute(
      database,
      'embedding',
      input,
      input.values.length,
      correlation,
      signal,
      (config, credential) =>
        this.options.embeddings.embedBatch(
          config,
          credential,
          input,
          signal,
          correlation.projectSessionId
        ),
      (result) => ({ metadata: result.metadata, outputItems: result.embeddings.length }),
      configGuard
    )
  }

  rerank(
    database: ProjectDatabase,
    rawInput: RerankInput,
    correlation: ModelRequestCorrelation,
    signal: AbortSignal
  ): Promise<RerankResult> {
    const input = rerankInputSchema.parse(rawInput)
    return this.execute(
      database,
      'rerank',
      input,
      input.documents.length,
      correlation,
      signal,
      (config, credential) =>
        this.options.reranker.rerank(
          config,
          credential,
          input,
          signal,
          correlation.projectSessionId
        ),
      (result) => ({ metadata: result.metadata, outputItems: result.ranking.length })
    )
  }

  private async execute<T>(
    database: ProjectDatabase,
    role: 'agent' | 'embedding' | 'rerank',
    request: unknown,
    inputItems: number,
    correlation: ModelRequestCorrelation,
    signal: AbortSignal,
    operation: (config: ProviderConfig, credential: string) => Promise<T>,
    completion: (result: T) => {
      metadata: AgentRunResult['metadata']
      outputItems: number
    },
    configGuard?: (config: ProviderConfig) => void
  ): Promise<T> {
    const repository = new ModelRequestRepository(database, this.options.log)
    return this.options.providers.withConfiguredProvider(role, async (config, credential) => {
      configGuard?.(config)
      const record = await repository.start({
        operation: role,
        provider: config,
        request,
        inputItems,
        ...correlation
      })
      try {
        const result = await operation(config, credential)
        await repository.succeed(record.modelRequestId, completion(result))
        return result
      } catch (err) {
        this.options.log.error(
          { event: 'model_execution.failed', err, modelRequestId: record.modelRequestId, role },
          'Model execution failed'
        )
        try {
          if (signal.aborted || isAbortError(err)) {
            await repository.abort(record.modelRequestId)
          } else {
            await repository.fail(record.modelRequestId, classifySafeError(err))
          }
        } catch (recordErr) {
          this.options.log.error(
            {
              event: 'model_execution.record_failure.failed',
              err: recordErr,
              modelRequestId: record.modelRequestId,
              role
            },
            'Failed to persist model execution failure'
          )
        }
        throw err
      }
    })
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function classifySafeError(error: unknown): SafeModelRequestError {
  const status = findHttpStatus(error)
  if (status === 401 || status === 403) {
    return { code: 'invalid_auth', retryable: false, httpStatus: status }
  }
  if (status === 429) return { code: 'rate_limited', retryable: true, httpStatus: status }
  if (status !== undefined && status >= 500) {
    return { code: 'provider_unavailable', retryable: true, httpStatus: status }
  }
  return {
    code: 'provider_request_failed',
    retryable: false,
    ...(status ? { httpStatus: status } : {})
  }
}

function findHttpStatus(error: unknown, depth = 0): number | undefined {
  if (depth > 5 || error === null || typeof error !== 'object') return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown; cause?: unknown }
  const value = candidate.statusCode ?? candidate.status
  if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
    return value
  }
  return findHttpStatus(candidate.cause, depth + 1)
}
