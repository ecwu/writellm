import type {
  AgentRunInput,
  AgentRunResult,
  AgentStreamEvent,
  EmbeddingBatchInput,
  EmbeddingBatchResult,
  RerankInput,
  RerankResult
} from '../../shared/contracts/model-runtime'
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
