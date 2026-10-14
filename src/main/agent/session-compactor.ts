import type { AgentSessionServiceOptions } from './session-service'
import type { AgentDiagnosticError } from '../../shared/agent-diagnostic-error'
import {
  serializeAgentDiagnosticError,
  agentDiagnosticSensitiveValues
} from '../../shared/agent-diagnostic-error'
import {
  AGENT_IMAGES_MAX_BASE64,
  imageDataBytes,
  type AgentImageContent
} from '../../shared/contracts/agent-attachments'
import {
  agentCompactionCheckpointV4PayloadSchema,
  agentCompactionStartedPayloadSchema,
  agentCompactionFailedPayloadSchema,
  agentHistorySchema,
  type AgentCompactionTrigger,
  type AgentModelLimits,
  type AgentRuntimeModel,
  type AgentHistoryMessage,
  type AgentEventType
} from '../../shared/contracts/agent'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { AgentEventRecord } from '../../shared/contracts/agent-ipc'
import {
  AGENT_RUNTIME_HISTORY_MAX_BYTES,
  agentMessageBudget,
  agentOutputLimit,
  estimateAgentTokens
} from '../../shared/agent-context-budget'
import { buildNextCompactionMaterial, checkpointHistoryMessage } from './context-checkpoint'
import { fitCheckpointSummary } from './session-history'

type CompactorOptions = Pick<
  AgentSessionServiceOptions,
  'database' | 'log' | 'summarizeHistory'
> & {
  now: () => Date
  loadImages: (
    agentSessionId: string,
    attachmentIds?: readonly string[]
  ) => Promise<AgentImageContent[]>
  assertImageModel: (model: AgentRuntimeModel, hasImages: boolean) => void
  appendAndPublishEvent: (input: {
    sessionId: string
    runId: string | null
    type: AgentEventType
    payload: Record<string, unknown>
    modelRequestId: string | null
  }) => Promise<AgentEventRecord>
}

export class AgentSessionCompactor {
  constructor(private readonly options: CompactorOptions) {}
  async run(input: {
    agentSessionId: string
    agentRunId: string | null
    compactionId: string
    trigger: AgentCompactionTrigger
    config: Extract<ProviderConfig, { role: 'agent' }>
    credential: string
    modelLimits: AgentModelLimits
    runtimeModel: AgentRuntimeModel
    signal: AbortSignal
    conversationBudgetTokens: number
    estimatedHistoryTokensBefore: number
    requestedOutputTokens: number
    currentImageBytes?: number
  }): Promise<boolean> {
    const summarize = this.options.summarizeHistory
    if (summarize === undefined) throw new Error('Agent context compaction is unavailable')
    input.signal.throwIfAborted()
    const timestamp = this.options.now().getTime()
    const checkpoint = {
      eventId: input.compactionId,
      summary: '',
      coveredThroughSequence: Number.MAX_SAFE_INTEGER,
      timestamp,
      schemaVersion: 4 as const,
      handoffMode: 'bounded_conversation_memory' as const,
      omittedEventCount: Number.MAX_SAFE_INTEGER,
      estimatedTokensBefore: null,
      estimatedTokensAfter: null
    }
    const wrapper = checkpointHistoryMessage(checkpoint)
    const wrapperTokens = estimateAgentTokens(wrapper)
    const summaryCapacity = input.conversationBudgetTokens - wrapperTokens
    if (summaryCapacity <= 0) {
      throw new Error(
        `Agent context summary needs more than ${wrapperTokens} tokens for its checkpoint envelope, but only ${input.conversationBudgetTokens} history tokens are available`
      )
    }
    const outputTokens = Math.min(
      agentOutputLimit(input.requestedOutputTokens, input.modelLimits),
      summaryCapacity
    )
    const material = buildNextCompactionMaterial({
      database: this.options.database,
      agentSessionId: input.agentSessionId,
      ...(input.agentRunId === null ? {} : { excludeRunId: input.agentRunId }),
      sourceTokenBudget: agentMessageBudget(outputTokens, input.modelLimits),
      recentTailMaxImageBytes: AGENT_IMAGES_MAX_BASE64 - (input.currentImageBytes ?? 0),
      recentTailTokenBudget: Math.max(
        0,
        input.conversationBudgetTokens - outputTokens - estimateAgentTokens(wrapper)
      ),
      recentTailMaxBytes: Math.max(
        0,
        AGENT_RUNTIME_HISTORY_MAX_BYTES -
          Buffer.byteLength(JSON.stringify(wrapper)) -
          outputTokens * 4
      )
    })
    if (material === null) return false
    this.options.log.info(
      {
        event: 'agent.compaction.projection_completed',
        agentRunId: input.agentRunId,
        compactionId: input.compactionId,
        sourceEventCount: material.sourceEventCount,
        sourcePayloadBytes: material.sourcePayloadBytes,
        omittedEventCount: material.omittedEventCount,
        estimatedPromptTokens: material.estimatedPromptTokens
      },
      'Projected old conversation prefix for one summary'
    )
    const source = JSON.parse(material.sourcePayloadJson) as {
      recentTurns: Array<Array<{ attachmentIds?: string[] }>>
    }
    const images: AgentImageContent[] = []
    for (const event of source.recentTurns.flat()) {
      images.push(...(await this.options.loadImages(input.agentSessionId, event.attachmentIds)))
    }
    this.options.assertImageModel(input.runtimeModel, images.length > 0)
    if (imageDataBytes(images) > AGENT_IMAGES_MAX_BASE64)
      throw new Error('Summary images exceed 32 MiB')
    const summarized = await summarize({
      agentSessionId: input.agentSessionId,
      agentRunId: input.agentRunId,
      compactionId: input.compactionId,
      trigger: input.trigger,
      config: input.config,
      credential: input.credential,
      modelLimits: input.modelLimits,
      sourcePayloadJson: material.sourcePayloadJson,
      images,
      coveredThroughSequence: material.coveredThroughSequence,
      estimatedInputTokens: material.estimatedPromptTokens,
      maxOutputTokens: outputTokens,
      signal: input.signal
    }).catch((err: unknown) => {
      const source = JSON.parse(material.sourcePayloadJson) as {
        recentTurns: Array<Array<{ content?: unknown }>>
      }
      serializeAgentDiagnosticError(err, 'compaction', {
        knownSensitiveValues: agentDiagnosticSensitiveValues(input.credential),
        privateBodies: [
          material.sourcePayloadJson,
          material.previousCheckpoint?.summary ?? '',
          ...source.recentTurns
            .flat()
            .flatMap((event) => (typeof event.content === 'string' ? [event.content] : []))
        ]
      })
      throw err
    })
    input.signal.throwIfAborted()
    checkpoint.coveredThroughSequence = material.coveredThroughSequence
    checkpoint.omittedEventCount =
      material.omittedEventCount + (material.previousCheckpoint?.omittedEventCount ?? 0)
    const historyWithSummary = (summary: string): AgentHistoryMessage[] => [
      checkpointHistoryMessage({ ...checkpoint, summary }),
      ...material.retainedTail
    ]
    const summary = fitCheckpointSummary(summarized.summary.trim(), (candidate) => {
      const history = historyWithSummary(candidate)
      return (
        estimateAgentTokens(history) <= input.conversationBudgetTokens &&
        agentHistorySchema.safeParse(history).success
      )
    })
    if (summary.length === 0)
      throw new Error('Agent compaction returned no summary that fits the model input window')
    const payload = agentCompactionCheckpointV4PayloadSchema.parse({
      schemaVersion: 4,
      compactionId: input.compactionId,
      trigger: input.trigger,
      previousCheckpointEventId: material.previousCheckpoint?.eventId ?? null,
      coveredFromSequence: material.coveredFromSequence,
      coveredThroughSequence: material.coveredThroughSequence,
      summary,
      omittedEventCount: checkpoint.omittedEventCount,
      estimatedTokensBefore: input.estimatedHistoryTokensBefore,
      estimatedTokensAfter: estimateAgentTokens(historyWithSummary(summary)),
      timestamp
    })
    await this.options.appendAndPublishEvent({
      sessionId: input.agentSessionId,
      runId: input.agentRunId,
      type: 'compaction_summary',
      payload,
      modelRequestId: summarized.modelRequestId
    })
    this.options.log.info(
      {
        event: 'agent.compaction.completed',
        agentRunId: input.agentRunId,
        compactionId: input.compactionId,
        coveredThroughSequence: payload.coveredThroughSequence,
        omittedEventCount: payload.omittedEventCount,
        estimatedTokensBefore: payload.estimatedTokensBefore,
        estimatedTokensAfter: payload.estimatedTokensAfter
      },
      'Agent context checkpoint completed'
    )
    return true
  }

  async started(input: {
    agentSessionId: string
    agentRunId: string | null
    compactionId: string
    trigger: AgentCompactionTrigger
  }): Promise<void> {
    await this.options.appendAndPublishEvent({
      sessionId: input.agentSessionId,
      runId: input.agentRunId,
      type: 'compaction_started',
      payload: agentCompactionStartedPayloadSchema.parse({
        schemaVersion: 2,
        compactionId: input.compactionId,
        trigger: input.trigger,
        phase: 'planning',
        timestamp: this.options.now().getTime()
      }),
      modelRequestId: null
    })
  }

  async failed(input: {
    agentSessionId: string
    agentRunId: string | null
    compactionId: string
    trigger: AgentCompactionTrigger
    code: string
    retryable: boolean
    aborted: boolean
    diagnostic?: AgentDiagnosticError
  }): Promise<void> {
    await this.options.appendAndPublishEvent({
      sessionId: input.agentSessionId,
      runId: input.agentRunId,
      type: 'compaction_failed',
      payload: agentCompactionFailedPayloadSchema.parse({
        schemaVersion: 2,
        compactionId: input.compactionId,
        trigger: input.trigger,
        code: input.code,
        retryable: input.retryable,
        aborted: input.aborted,
        ...(input.diagnostic === undefined ? {} : { diagnostic: input.diagnostic }),
        timestamp: this.options.now().getTime()
      }),
      modelRequestId: null
    })
  }
}
