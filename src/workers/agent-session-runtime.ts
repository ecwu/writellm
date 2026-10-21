import {
  agentToolEnvelope,
  agentModelVisibleToolSpecs,
  type AgentModelVisibleToolSpec
} from '../shared/agent-tool-specs'
import {
  AgentContextBudgetController,
  agentRuntimeMessageBudget
} from '../shared/agent-context-budget'
import type { AgentRunStart } from '../shared/contracts/agent'
import { buildAgentProviderModel } from './agent-provider-runtime'

export interface PreparedAgentSessionRuntime {
  readonly model: ReturnType<typeof buildAgentProviderModel>
  readonly initialTools: readonly AgentModelVisibleToolSpec[]
  readonly activeToolGroups: AgentRunStart['activeToolGroups']
  readonly currentRuntimeMessageBudgetTokens: number
  readonly contextBudget: AgentContextBudgetController
}

/**
 * Build the immutable runtime inputs before the Agent instance is created.
 * This stage has no process or provider side effects, which keeps model/tool
 * advertisement and context budgeting easy to verify independently.
 */
export function prepareAgentSessionRuntime(request: AgentRunStart): PreparedAgentSessionRuntime {
  const model = buildAgentProviderModel({
    config: request.config,
    runtimeModel: request.runtimeModel,
    modelLimits: request.modelLimits,
    maxOutputTokens: request.maxOutputTokens
  })
  const initialTools = agentModelVisibleToolSpecs(
    request.toolProfile,
    request.activeToolGroups,
    request.interactionMode
  )
  const currentRuntimeMessageBudgetTokens =
    request.runtimeMessageBudgetTokens ??
    agentRuntimeMessageBudget({
      maxOutputTokens: request.maxOutputTokens,
      limits: request.modelLimits,
      systemPrompt: request.systemPrompt,
      advertisedTools: agentToolEnvelope(initialTools)
    })
  return {
    model,
    initialTools,
    activeToolGroups: request.activeToolGroups,
    currentRuntimeMessageBudgetTokens,
    contextBudget: new AgentContextBudgetController(currentRuntimeMessageBudgetTokens)
  }
}
