import type { Logger } from 'pino'
import {
  agentRunInputSchema,
  embeddingBatchInputSchema,
  imageGenerationInputSchema,
  rerankInputSchema,
  type AgentRunInput,
  type AgentRunResult,
  type AgentStreamEvent,
  type EmbeddingBatchInput,
  type EmbeddingBatchResult,
  type ImageGenerationInput,
  type ImageGenerationResult,
  type RerankInput,
  type RerankResult
} from '../../shared/contracts/model-runtime'
import type { ProjectDatabase } from '../project/project-database'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type {
  AgentModelRuntime,
  EmbeddingGateway,
  ImageGenerationGateway,
  RerankGateway
} from './gateways'
import {
  ModelRequestRepository,
  type ModelRequestCorrelation,
  type SafeModelRequestError
} from './model-request-repository'
import type { ProviderService } from './provider-service'
import type { ModelMetadataService } from './model-metadata-service'
import type { AgentModelLimits } from '../../shared/contracts/agent'
import { AgentTraceRepository } from '../agent/trace-repository'
import {
  effectiveGoogleGeminiImageSize,
  effectiveGoogleVertexImageSize
} from '../../shared/contracts/providers'

export interface ModelExecutionServiceOptions {
  providers: ProviderService
  agent: AgentModelRuntime
  embeddings: EmbeddingGateway
  reranker: RerankGateway
  images?: ImageGenerationGateway
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  modelMetadata?: ModelMetadataService
}

function legacyLimits(config: ProviderConfig): AgentModelLimits {
  return {
    contextWindowTokens:
      config.role === 'agent' ? (config.contextWindowTokens ?? 131_072) : 131_072,
    inputLimitTokens: null,
    outputLimitTokens: null,
    source:
      config.role === 'agent' && config.contextWindowTokens != null
        ? 'manual_override'
        : 'legacy_fallback',
    catalogModelKey: null,
    resolvedAt: null
  }
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
      async (config, credential) => {
        if (config.role !== 'agent') throw new Error('Agent provider role is required')
        const limits =
          (await this.options.modelMetadata?.resolve(config, signal)) ?? legacyLimits(config)
        return this.options.agent.run(
          config,
          credential,
          input,
          signal,
          onEvent,
          correlation.projectSessionId,
          limits
        )
      },
      (result) => ({ metadata: result.metadata, outputItems: result.text.length === 0 ? 0 : 1 })
    )
  }

  async runAgentWithResolvedProvider(
    database: ProjectDatabase,
    rawInput: AgentRunInput,
    correlation: ModelRequestCorrelation,
    resolved: {
      config: Extract<ProviderConfig, { role: 'agent' }>
      credential: string
      modelLimits: AgentModelLimits
    },
    signal: AbortSignal,
    onEvent: (event: AgentStreamEvent) => void = () => undefined,
    options: {
      retention?: 'standard' | 'metadata_only'
      tracePurpose?: 'compaction'
      agentSessionId?: string
      compactionId?: string
      compactionSource?: unknown
    } = {}
  ): Promise<{ result: AgentRunResult; modelRequestId: string }> {
    const input = agentRunInputSchema.parse(rawInput)
    const repository = new ModelRequestRepository(database, this.options.log)
    const record = await repository.start({
      operation: 'agent',
      provider: resolved.config,
      request: input,
      inputItems: 1,
      ...(options.retention === undefined ? {} : { retention: options.retention }),
      ...correlation
    })
    const trace =
      options.tracePurpose === undefined
        ? undefined
        : new AgentTraceRepository(database, this.options.log)
    if (trace !== undefined && options.compactionSource !== undefined) {
      trace.capture({
        modelRequestId: record.modelRequestId,
        purpose: 'compaction',
        apiId: resolved.config.api ?? 'openai-completions',
        traceId:
          options.compactionId ??
          correlation.agentRunId ??
          correlation.operationId ??
          record.modelRequestId,
        spanId: record.modelRequestId,
        ...(options.agentSessionId === undefined ? {} : { agentSessionId: options.agentSessionId }),
        ...(correlation.agentRunId === undefined ? {} : { agentRunId: correlation.agentRunId }),
        ...(options.compactionId === undefined ? {} : { compactionId: options.compactionId }),
        physicalAttempt: 1,
        documents: [{ kind: 'compaction_source', value: options.compactionSource }]
      })
    }
    try {
      const result = await this.options.agent.run(
        resolved.config,
        resolved.credential,
        input,
        signal,
        onEvent,
        correlation.projectSessionId,
        resolved.modelLimits,
        trace === undefined
          ? undefined
          : {
              context: {
                modelRequestId: record.modelRequestId,
                purpose: options.tracePurpose as 'compaction',
                traceId:
                  options.compactionId ??
                  correlation.agentRunId ??
                  correlation.operationId ??
                  record.modelRequestId,
                spanId: record.modelRequestId,
                ...(options.agentSessionId === undefined
                  ? {}
                  : { agentSessionId: options.agentSessionId }),
                ...(correlation.agentRunId === undefined
                  ? {}
                  : { agentRunId: correlation.agentRunId }),
                ...(options.compactionId === undefined
                  ? {}
                  : { compactionId: options.compactionId })
              },
              capture: (capture) => {
                trace.capture(capture)
              }
            }
      )
      if (trace?.exists(record.modelRequestId)) {
        trace.complete({
          modelRequestId: record.modelRequestId,
          physicalAttemptCount: result.metadata.retryCount + 1
        })
      }
      await repository.succeed(
        record.modelRequestId,
        {
          metadata: result.metadata,
          outputItems: result.text.length === 0 ? 0 : 1
        },
        record.retention
      )
      return { result, modelRequestId: record.modelRequestId }
    } catch (err) {
      this.options.log.error(
        {
          event: 'model_execution.failed',
          err,
          modelRequestId: record.modelRequestId,
          role: 'agent'
        },
        'Resolved Agent model execution failed'
      )
      try {
        if (signal.aborted || isAbortError(err)) {
          await repository.abort(record.modelRequestId, 'aborted', undefined, record.retention)
        } else {
          await repository.fail(
            record.modelRequestId,
            classifySafeError(err),
            undefined,
            record.retention
          )
        }
      } catch (recordErr) {
        this.options.log.error(
          {
            event: 'model_execution.record_failure.failed',
            err: recordErr,
            modelRequestId: record.modelRequestId,
            role: 'agent'
          },
          'Failed to persist resolved Agent model execution failure'
        )
      }
      if (trace?.exists(record.modelRequestId)) {
        trace.fail({
          modelRequestId: record.modelRequestId,
          physicalAttemptCount: 1,
          failureCode:
            err instanceof Error && 'code' in err && typeof err.code === 'string'
              ? err.code
              : 'provider_request_failed'
        })
      }
      throw err
    }
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

  async generateImage(
    database: ProjectDatabase,
    rawInput: ImageGenerationInput,
    correlation: ModelRequestCorrelation & { projectSessionId: string },
    signal: AbortSignal
  ): Promise<ImageGenerationResult & { modelRequestId: string }> {
    if (this.options.images === undefined)
      throw new Error('Image generation gateway is unavailable')
    const images = this.options.images
    const input = imageGenerationInputSchema.parse(rawInput)
    const repository = new ModelRequestRepository(database, this.options.log)
    return this.options.providers.withConfiguredProvider('image', async (config, credential) => {
      const record = await repository.start({
        operation: 'image',
        provider: config,
        request: input,
        inputItems: 1,
        ...correlation
      })
      const trace =
        correlation.agentRunId === undefined ||
        !database.immediate(
          (native) =>
            native
              .prepare('SELECT 1 FROM agent_runs WHERE agent_run_id = ?')
              .pluck()
              .get(correlation.agentRunId) === 1
        )
          ? undefined
          : new AgentTraceRepository(database, this.options.log)
      if (trace !== undefined) {
        trace.capture({
          modelRequestId: record.modelRequestId,
          purpose: 'agent_image',
          apiId: config.providerId,
          traceId: correlation.agentRunId as string,
          spanId: record.modelRequestId,
          agentRunId: correlation.agentRunId as string,
          physicalAttempt: 1,
          documents: [
            { kind: 'harness_request', value: input },
            { kind: 'provider_request', value: imageProviderPayload(config, input) }
          ]
        })
      }
      try {
        const result = await images.generateImage(
          config,
          credential,
          input,
          signal,
          correlation.projectSessionId
        )
        await repository.succeed(record.modelRequestId, {
          metadata: result.metadata,
          outputItems: 1
        })
        if (trace !== undefined) {
          trace.capture({
            modelRequestId: record.modelRequestId,
            purpose: 'agent_image',
            apiId: config.providerId,
            traceId: correlation.agentRunId as string,
            spanId: record.modelRequestId,
            agentRunId: correlation.agentRunId,
            physicalAttempt: 1,
            documents: [
              {
                kind: 'provider_response',
                value: {
                  mimeType: result.mimeType,
                  effectiveImageSize: result.effectiveImageSize,
                  metadata: result.metadata,
                  binary: {
                    omitted: true,
                    byteSize: Buffer.from(result.dataBase64, 'base64').byteLength
                  }
                }
              }
            ]
          })
          trace.complete({ modelRequestId: record.modelRequestId, physicalAttemptCount: 1 })
        }
        return { ...result, modelRequestId: record.modelRequestId }
      } catch (err) {
        this.options.log.error(
          {
            event: 'model_execution.failed',
            err,
            modelRequestId: record.modelRequestId,
            role: 'image'
          },
          'Image model execution failed'
        )
        if (trace?.exists(record.modelRequestId)) {
          trace.fail({
            modelRequestId: record.modelRequestId,
            physicalAttemptCount: 1,
            failureCode: 'image_generation_failed'
          })
        }
        if (signal.aborted || isAbortError(err)) await repository.abort(record.modelRequestId)
        else await repository.fail(record.modelRequestId, classifySafeError(err))
        throw err
      }
    })
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

function imageProviderPayload(config: ProviderConfig, input: ImageGenerationInput): unknown {
  if (config.role !== 'image') throw new Error('Image provider role is required')
  if (config.providerId === 'google-gemini') {
    return {
      model: config.model,
      input: input.prompt,
      response_format: {
        type: 'image',
        mime_type: 'image/jpeg',
        ...(input.aspectRatio === 'auto' ? {} : { aspect_ratio: input.aspectRatio }),
        image_size: effectiveGoogleGeminiImageSize(config.model, input.imageSize)
      }
    }
  }
  if (config.providerId === 'google-vertex') {
    return {
      model: config.model,
      contents: input.prompt,
      config: {
        candidateCount: 1,
        responseModalities: ['TEXT', 'IMAGE'],
        imageConfig: {
          ...(input.aspectRatio === 'auto' ? {} : { aspectRatio: input.aspectRatio }),
          imageSize: effectiveGoogleVertexImageSize(config.model, input.imageSize)
        }
      }
    }
  }
  if (config.providerId === 'openai') {
    return {
      model: config.model,
      prompt: input.prompt,
      n: 1,
      quality: 'auto',
      output_format: 'png',
      size:
        input.aspectRatio === 'auto'
          ? 'auto'
          : input.aspectRatio === '1:1'
            ? input.imageSize === '1K'
              ? '1024x1024'
              : '2048x2048'
            : input.imageSize === '1K'
              ? '1280x720'
              : '2048x1152'
    }
  }
  return {
    model: config.model,
    prompt: input.prompt,
    n: 1,
    response_format: 'b64_json',
    aspect_ratio: input.aspectRatio,
    resolution: input.imageSize.toLowerCase()
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
