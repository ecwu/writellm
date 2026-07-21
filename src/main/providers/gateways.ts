import type {
  AgentRunInput,
  AgentRunResult,
  AgentStreamEvent,
  EmbeddingBatchInput,
  EmbeddingBatchResult,
  RerankInput,
  RerankResult
} from '../../shared/contracts/model-runtime'
import type {
  AgentHistoryMessage,
  AgentModelCallAuthorization,
  AgentQueueCommand,
  AgentRuntimeEvent
} from '../../shared/contracts/agent'
import type { AgentToolRequest, AgentToolResponse } from '../../shared/contracts/agent-tools'
import type { ProviderConfig } from '../../shared/contracts/providers'

export interface AgentModelRuntime {
  run(
    config: ProviderConfig,
    credential: string,
    input: AgentRunInput,
    signal: AbortSignal,
    onEvent: (event: AgentStreamEvent) => void,
    projectSessionId?: string
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
  temperature?: number
}

export interface AgentSessionRunHandle {
  readonly requestId: string
  readonly completion: Promise<void>
  steer(command: Omit<AgentQueueCommand, 'operation' | 'requestId'>): void
  followUp(command: Omit<AgentQueueCommand, 'operation' | 'requestId'>): void
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
