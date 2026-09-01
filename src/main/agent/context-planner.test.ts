import { describe, expect, it } from 'vitest'
import type { AgentModelLimits } from '../../shared/contracts/agent'
import { estimateAgentTokens } from '../../shared/agent-context-budget'
import {
  agentCompactionBudgets,
  AgentContextPlanner,
  AgentCurrentTurnTooLargeError
} from './context-planner'

const limits: AgentModelLimits = {
  contextWindowTokens: 64_000,
  inputLimitTokens: 50_000,
  outputLimitTokens: 8_000,
  source: 'models_dev',
  catalogModelKey: 'test/model',
  resolvedAt: '2026-08-12T00:00:00.000Z'
}

describe('AgentContextPlanner', () => {
  it('scales the checkpoint and raw-tail split for small and large conversation windows', () => {
    expect(agentCompactionBudgets(10_000)).toEqual({
      postCompactionBudgetTokens: 5_000,
      checkpointBudgetTokens: 1_875,
      recentTailBudgetTokens: 3_125
    })
    expect(agentCompactionBudgets(100_000)).toEqual({
      postCompactionBudgetTokens: 32_000,
      checkpointBudgetTokens: 12_000,
      recentTailBudgetTokens: 20_000
    })
  })

  it('budgets the final system prompt, exact tool envelope, history, CJK/emoji request, output, and safety reserve', () => {
    const systemPrompt = `System ${'技能'.repeat(800)}`
    const tools = [{ name: 'read', description: '🔎'.repeat(300), parameters: { type: 'object' } }]
    const currentRequest = `继续写作 ${'界🙂'.repeat(500)}`
    const history = [{ role: 'user' as const, content: 'Earlier turn', timestamp: 1 }]
    const plan = new AgentContextPlanner().plan({
      modelLimits: limits,
      requestedOutputTokens: 12_000,
      systemPrompt,
      advertisedTools: tools,
      history,
      currentRequest
    })

    expect(plan.effectiveInputLimit).toBe(50_000)
    expect(plan.reservedOutputTokens).toBe(8_000)
    expect(plan.safetyBufferTokens).toBe(4_096)
    expect(plan.systemPromptTokens).toBe(estimateAgentTokens(systemPrompt))
    expect(plan.advertisedToolTokens).toBe(estimateAgentTokens(tools))
    expect(plan.currentRequestTokens).toBe(estimateAgentTokens(currentRequest))
    expect(plan.conversationBudgetTokens).toBe(
      plan.effectiveInputLimit -
        plan.safetyBufferTokens -
        plan.systemPromptTokens -
        plan.advertisedToolTokens -
        plan.currentRequestTokens
    )
    expect(plan.postCompactionBudgetTokens).toBe(
      Math.min(32_000, Math.floor(plan.conversationBudgetTokens * 0.5))
    )
    expect(plan.checkpointBudgetTokens).toBe(
      Math.min(12_000, Math.floor(plan.postCompactionBudgetTokens * 0.375))
    )
    expect(plan.recentTailBudgetTokens).toBe(
      plan.postCompactionBudgetTokens - plan.checkpointBudgetTokens
    )
  })

  it('uses the context window minus reserved output when it is lower than inputLimit', () => {
    const plan = new AgentContextPlanner().plan({
      modelLimits: { ...limits, contextWindowTokens: 20_000, inputLimitTokens: 30_000 },
      requestedOutputTokens: 6_000,
      systemPrompt: '',
      advertisedTools: [],
      history: [],
      currentRequest: 'short'
    })
    expect(plan.effectiveInputLimit).toBe(14_000)
  })

  it('does not compact low-token history based on durable event count or payload size', () => {
    const planner = new AgentContextPlanner()
    const plan = planner.plan({
      modelLimits: limits,
      requestedOutputTokens: 4_096,
      systemPrompt: 'system',
      advertisedTools: [],
      history: [{ role: 'user' as const, content: 'x', timestamp: 1 }],
      currentRequest: 'next'
    })

    expect(plan.requiresCompaction).toBe(false)
    expect(plan.reasons).toEqual([])
  })

  it('keeps a 51,806-token conversation uncompressed in a 1M-token context window', () => {
    const plan = new AgentContextPlanner().plan({
      modelLimits: {
        ...limits,
        contextWindowTokens: 1_048_576,
        inputLimitTokens: 1_000_000
      },
      requestedOutputTokens: 8_000,
      systemPrompt: 'system',
      advertisedTools: [],
      history: [{ role: 'user', content: 'x'.repeat(51_806 * 4), timestamp: 1 }],
      currentRequest: 'Apply only the latest narrow edit.'
    })

    expect(plan.historyTokens).toBeGreaterThanOrEqual(51_806)
    expect(plan.historyTokens).toBeLessThan(52_000)
    expect(plan.requiresCompaction).toBe(false)
    expect(plan.reasons).toEqual([])
  })

  it('compacts only when model-visible history exceeds the final conversation budget', () => {
    const plan = new AgentContextPlanner().plan({
      modelLimits: { ...limits, contextWindowTokens: 1_048_576, inputLimitTokens: 1_000_000 },
      requestedOutputTokens: 8_000,
      systemPrompt: 'system',
      advertisedTools: [],
      history: [{ role: 'user', content: 'x'.repeat(4_100_000), timestamp: 1 }],
      currentRequest: 'next'
    })

    expect(plan.requiresCompaction).toBe(true)
    expect(plan.reasons).toEqual(['token_budget'])
  })

  it('rejects a fixed context plus current request that cannot fit without truncating it', () => {
    expect(() =>
      new AgentContextPlanner().plan({
        modelLimits: { ...limits, contextWindowTokens: 12_000, inputLimitTokens: 12_000 },
        requestedOutputTokens: 4_096,
        systemPrompt: 'S'.repeat(10_000),
        advertisedTools: [{ description: 'T'.repeat(4_000) }],
        history: [],
        currentRequest: `不可截断🙂${'界'.repeat(8_000)}`
      })
    ).toThrow(AgentCurrentTurnTooLargeError)
  })
})
