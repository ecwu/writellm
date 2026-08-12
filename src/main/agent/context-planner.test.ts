import { describe, expect, it } from 'vitest'
import type { AgentModelLimits } from '../../shared/contracts/agent'
import { estimateAgentTokens } from '../../shared/agent-context-budget'
import { AgentContextPlanner, AgentCurrentTurnTooLargeError } from './context-planner'

const limits: AgentModelLimits = {
  contextWindowTokens: 64_000,
  inputLimitTokens: 50_000,
  outputLimitTokens: 8_000,
  source: 'models_dev',
  catalogModelKey: 'test/model',
  resolvedAt: '2026-08-12T00:00:00.000Z'
}

describe('AgentContextPlanner', () => {
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
      currentRequest,
      uncheckpointedEventCount: 2,
      uncheckpointedPayloadBytes: 128
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
    expect(plan.compactionTargetTokens).toBe(
      Math.min(24_000, Math.floor(plan.conversationBudgetTokens * 0.5))
    )
  })

  it('uses the context window minus reserved output when it is lower than inputLimit', () => {
    const plan = new AgentContextPlanner().plan({
      modelLimits: { ...limits, contextWindowTokens: 20_000, inputLimitTokens: 30_000 },
      requestedOutputTokens: 6_000,
      systemPrompt: '',
      advertisedTools: [],
      history: [],
      currentRequest: 'short',
      uncheckpointedEventCount: 0,
      uncheckpointedPayloadBytes: 0
    })
    expect(plan.effectiveInputLimit).toBe(14_000)
  })

  it('forces compaction before the 200-event or 2-MiB envelope could hide short history', () => {
    const planner = new AgentContextPlanner()
    const base = {
      modelLimits: limits,
      requestedOutputTokens: 4_096,
      systemPrompt: 'system',
      advertisedTools: [],
      history: [{ role: 'user' as const, content: 'x', timestamp: 1 }],
      currentRequest: 'next'
    }

    expect(
      planner.plan({ ...base, uncheckpointedEventCount: 201, uncheckpointedPayloadBytes: 128 })
        .reasons
    ).toEqual(['runtime_envelope'])
    expect(
      planner.plan({
        ...base,
        uncheckpointedEventCount: 1,
        uncheckpointedPayloadBytes: 2 * 1024 * 1024 + 1
      }).reasons
    ).toEqual(['runtime_envelope'])
  })

  it('rejects a fixed context plus current request that cannot fit without truncating it', () => {
    expect(() =>
      new AgentContextPlanner().plan({
        modelLimits: { ...limits, contextWindowTokens: 12_000, inputLimitTokens: 12_000 },
        requestedOutputTokens: 4_096,
        systemPrompt: 'S'.repeat(10_000),
        advertisedTools: [{ description: 'T'.repeat(4_000) }],
        history: [],
        currentRequest: `不可截断🙂${'界'.repeat(8_000)}`,
        uncheckpointedEventCount: 0,
        uncheckpointedPayloadBytes: 0
      })
    ).toThrow(AgentCurrentTurnTooLargeError)
  })
})
