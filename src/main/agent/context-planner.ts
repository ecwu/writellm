import type { AgentHistoryMessage, AgentModelLimits } from '../../shared/contracts/agent'
import { AGENT_MODEL_VISIBLE_TOOL_ENVELOPE } from '../../shared/agent-tool-specs'
import { agentOutputLimit, estimateAgentTokens } from '../../shared/agent-context-budget'

export const AGENT_POST_COMPACTION_MAX_TOKENS = 32_000
export const AGENT_CHECKPOINT_MAX_TOKENS = 12_000

export interface AgentCompactionBudgets {
  readonly postCompactionBudgetTokens: number
  readonly checkpointBudgetTokens: number
  readonly recentTailBudgetTokens: number
}

export interface AgentContextPlanInput {
  readonly modelLimits: AgentModelLimits
  readonly requestedOutputTokens: number
  readonly systemPrompt: string
  readonly history: readonly AgentHistoryMessage[]
  readonly currentRequest: string
  readonly advertisedTools?: unknown
}

export interface AgentContextPlan {
  readonly effectiveInputLimit: number
  readonly reservedOutputTokens: number
  readonly safetyBufferTokens: number
  readonly systemPromptTokens: number
  readonly advertisedToolTokens: number
  readonly historyTokens: number
  readonly currentRequestTokens: number
  readonly conversationBudgetTokens: number
  readonly postCompactionBudgetTokens: number
  readonly checkpointBudgetTokens: number
  readonly recentTailBudgetTokens: number
  readonly requiresCompaction: boolean
  readonly reasons: readonly 'token_budget'[]
}

export class AgentCurrentTurnTooLargeError extends Error {
  readonly code = 'current_turn_too_large'

  constructor(readonly plan: Omit<AgentContextPlan, 'requiresCompaction' | 'reasons'>) {
    super('The current request and fixed Agent context exceed the selected model input limit')
    this.name = 'AgentCurrentTurnTooLargeError'
  }
}

export class AgentContextPlanner {
  plan(input: AgentContextPlanInput): AgentContextPlan {
    const reservedOutputTokens = agentOutputLimit(input.requestedOutputTokens, input.modelLimits)
    const effectiveInputLimit = Math.floor(
      Math.min(
        input.modelLimits.inputLimitTokens ?? Number.POSITIVE_INFINITY,
        input.modelLimits.contextWindowTokens - reservedOutputTokens
      )
    )
    const safetyBufferTokens = clamp(Math.floor(effectiveInputLimit * 0.05), 4_096, 16_384)
    const systemPromptTokens = estimateAgentTokens(input.systemPrompt)
    const advertisedToolTokens = estimateAgentTokens(
      input.advertisedTools ?? AGENT_MODEL_VISIBLE_TOOL_ENVELOPE
    )
    const historyTokens = estimateAgentTokens(input.history)
    const currentRequestTokens = estimateAgentTokens(input.currentRequest)
    const conversationBudgetTokens =
      effectiveInputLimit -
      safetyBufferTokens -
      systemPromptTokens -
      advertisedToolTokens -
      currentRequestTokens
    const compactionBudgets = agentCompactionBudgets(conversationBudgetTokens)
    const base = {
      effectiveInputLimit,
      reservedOutputTokens,
      safetyBufferTokens,
      systemPromptTokens,
      advertisedToolTokens,
      historyTokens,
      currentRequestTokens,
      conversationBudgetTokens,
      ...compactionBudgets
    }
    if (conversationBudgetTokens <= 0) throw new AgentCurrentTurnTooLargeError(base)
    const reasons: Array<'token_budget'> = []
    if (historyTokens > conversationBudgetTokens) reasons.push('token_budget')
    return { ...base, requiresCompaction: reasons.length > 0, reasons }
  }
}

export function agentCompactionBudgets(conversationBudgetTokens: number): AgentCompactionBudgets {
  const postCompactionBudgetTokens = Math.max(
    0,
    Math.min(AGENT_POST_COMPACTION_MAX_TOKENS, Math.floor(conversationBudgetTokens * 0.5))
  )
  const checkpointBudgetTokens =
    postCompactionBudgetTokens === 0
      ? 0
      : Math.max(
          1,
          Math.min(AGENT_CHECKPOINT_MAX_TOKENS, Math.floor(postCompactionBudgetTokens * 0.375))
        )
  return {
    postCompactionBudgetTokens,
    checkpointBudgetTokens,
    recentTailBudgetTokens: postCompactionBudgetTokens - checkpointBudgetTokens
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
