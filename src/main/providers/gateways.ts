import type {
  AgentRunInput,
  AgentRunResult,
  AgentStreamEvent,
  EmbeddingBatchInput,
  EmbeddingBatchResult,
  ImageGenerationInput,
  ImageGenerationResult,
  RerankInput,
  RerankResult
} from '../../shared/contracts/model-runtime'
import type {
  AgentFollowUpConsumptionAuthorization,
  AgentHistoryMessage,
  AgentRuntimeModel,
  AgentModelLimits,
  AgentModelCallAuthorization,
  AgentQueueActionCommand,
  AgentQueueCommand,
  AgentRuntimeEvent,
  AgentSessionRunResult
} from '../../shared/contracts/agent'
import type { AgentToolRequest, AgentToolResponse } from '../../shared/contracts/agent-tools'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type { AgentThinkingLevel } from '../../shared/contracts/providers'

type WithoutRequestId<T> = T extends unknown ? Omit<T, 'requestId'> : never

export interface AgentModelRuntime {
  run(
    config: ProviderConfig,
    credential: string,
    input: AgentRunInput,
    signal: AbortSignal,
    onEvent: (event: AgentStreamEvent) => void,
    projectSessionId?: string,
    modelLimits?: AgentModelLimits
  ): Promise<AgentRunResult>
}

export interface AgentSessionRunInput {
  projectSessionId: string
  agentSessionId: string
  agentRunId: string
  modelRequestId: string
  systemPrompt: string
  history: AgentHistoryMessage[]
  prompt: string
  maxOutputTokens: number
  modelLimits?: AgentModelLimits
  thinkingLevel?: AgentThinkingLevel
  runtimeModel?: AgentRuntimeModel
  temperature?: number
}

export interface AgentSessionRunHandle {
  readonly requestId: string
  readonly completion: Promise<AgentSessionRunResult>
  steer(
    command: Omit<Extract<AgentQueueCommand, { operation: 'steer' }>, 'operation' | 'requestId'>
  ): void
  followUp(
    command: Omit<Extract<AgentQueueCommand, { operation: 'follow_up' }>, 'operation' | 'requestId'>
  ): void
  queueAction(command: WithoutRequestId<AgentQueueActionCommand>): Promise<'completed' | 'stale'>
  authorizeFollowUpConsumption(
    command: Omit<AgentFollowUpConsumptionAuthorization, 'operation' | 'requestId'>
  ): void
  authorizeModelCall(command: Omit<AgentModelCallAuthorization, 'operation' | 'requestId'>): void
}

export interface AgentSessionRuntime {
  beginSessionRun(
    config: ProviderConfig,
    credential: string,
    input: AgentSessionRunInput,
    signal: AbortSignal,
    onEvent: (event: AgentRuntimeEvent) => void | Promise<void>,
    onToolRequest?: (request: AgentToolRequest, signal: AbortSignal) => Promise<AgentToolResponse>
  ): AgentSessionRunHandle
}

export interface EmbeddingGateway {
  embedBatch(
    config: ProviderConfig,
    credential: string,
    input: EmbeddingBatchInput,
    signal: AbortSignal,
    projectSessionId?: string
  ): Promise<EmbeddingBatchResult>
}

export interface RerankGateway {
  rerank(
    config: ProviderConfig,
    credential: string,
    input: RerankInput,
    signal: AbortSignal,
    projectSessionId?: string
  ): Promise<RerankResult>
}

export interface ImageGenerationGateway {
  generateImage(
    config: ProviderConfig,
    credential: string | undefined,
    input: ImageGenerationInput,
    signal: AbortSignal,
    projectSessionId: string
  ): Promise<ImageGenerationResult>
}
