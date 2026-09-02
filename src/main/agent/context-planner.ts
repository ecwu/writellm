import type { AgentHistoryMessage, AgentModelLimits } from '../../shared/contracts/agent'
import { AGENT_MODEL_VISIBLE_TOOL_ENVELOPE } from '../../shared/agent-tool-specs'
import {
  AGENT_RUNTIME_HISTORY_MAX_BYTES,
  agentOutputLimit,
  estimateAgentTokens
} from '../../shared/agent-context-budget'

export interface AgentContextPlanInput {
  readonly modelLimits: AgentModelLimits
  readonly requestedOutputTokens: number
  readonly systemPrompt: string
  readonly history: readonly AgentHistoryMessage[]
  readonly currentRequest: string
  readonly advertisedTools?: unknown
}

export interface AgentContextPlan {
  /** The model's input window after reserving only its requested output. */
  readonly effectiveInputLimit: number
  readonly reservedOutputTokens: number
  readonly systemPromptTokens: number
  readonly advertisedToolTokens: number
  readonly historyTokens: number
  readonly historyBytes: number
  readonly currentRequestTokens: number
  /** Space left for history after the fixed prompt and the current request. */
  readonly conversationBudgetTokens: number
  readonly requiresCompaction: boolean
  readonly reasons: readonly ('token_budget' | 'message_bytes')[]
}

export class AgentCurrentTurnTooLargeError extends Error {
  readonly code = 'current_turn_too_large'

  readonly requiredTokens: number
  readonly availableTokens: number

  constructor(readonly plan: Omit<AgentContextPlan, 'requiresCompaction' | 'reasons'>) {
    const requiredTokens =
      plan.systemPromptTokens + plan.advertisedToolTokens + plan.currentRequestTokens
    super(
      `The current Agent turn needs approximately ${requiredTokens} tokens, but only ${plan.effectiveInputLimit} are available`
    )
    this.requiredTokens = requiredTokens
    this.availableTokens = plan.effectiveInputLimit
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
    const systemPromptTokens = estimateAgentTokens(input.systemPrompt)
    const advertisedToolTokens = estimateAgentTokens(
      input.advertisedTools ?? AGENT_MODEL_VISIBLE_TOOL_ENVELOPE
    )
    const historyTokens = estimateAgentTokens(input.history)
    const historyBytes = serializedHistoryBytes(input.history)
    const currentRequestTokens = estimateAgentTokens(input.currentRequest)
    const conversationBudgetTokens =
      effectiveInputLimit - systemPromptTokens - advertisedToolTokens - currentRequestTokens
    const base = {
      effectiveInputLimit,
      reservedOutputTokens,
      systemPromptTokens,
      advertisedToolTokens,
      historyTokens,
      historyBytes,
      currentRequestTokens,
      conversationBudgetTokens
    }
    if (conversationBudgetTokens <= 0) throw new AgentCurrentTurnTooLargeError(base)
    const reasons: Array<'token_budget' | 'message_bytes'> = []
    if (historyTokens > conversationBudgetTokens) reasons.push('token_budget')
    if (historyBytes > AGENT_RUNTIME_HISTORY_MAX_BYTES) reasons.push('message_bytes')
    return { ...base, requiresCompaction: reasons.length > 0, reasons }
  }
}

function serializedHistoryBytes(history: readonly AgentHistoryMessage[]): number {
  return new TextEncoder().encode(JSON.stringify(history)).byteLength
}
