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
  it('uses the exact model window without an additional safety buffer', () => {
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
    expect(plan).not.toHaveProperty('safetyBufferTokens')
    expect(plan.systemPromptTokens).toBe(estimateAgentTokens(systemPrompt))
    expect(plan.advertisedToolTokens).toBe(estimateAgentTokens(tools))
    expect(plan.currentRequestTokens).toBe(estimateAgentTokens(currentRequest))
    expect(plan.conversationBudgetTokens).toBe(
      plan.effectiveInputLimit -
        plan.systemPromptTokens -
        plan.advertisedToolTokens -
        plan.currentRequestTokens
    )
  })

  it('uses the smaller context window or provider input limit', () => {
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

  it('compacts only when model-visible history exceeds the exact conversation budget', () => {
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

    const oversized = planner.plan({
      modelLimits: { ...limits, contextWindowTokens: 1_048_576, inputLimitTokens: 1_000_000 },
      requestedOutputTokens: 8_000,
      systemPrompt: 'system',
      advertisedTools: [],
      history: [{ role: 'user', content: 'x'.repeat(4_100_000), timestamp: 1 }],
      currentRequest: 'next'
    })
    expect(oversized.requiresCompaction).toBe(true)
    expect(oversized.reasons).toEqual(['token_budget', 'message_bytes'])
  })

  it('compacts when the generic runtime history byte boundary is exceeded', () => {
    const history = [{ role: 'user' as const, content: '界'.repeat(800_000), timestamp: 1 }]
    const plan = new AgentContextPlanner().plan({
      modelLimits: { ...limits, contextWindowTokens: 4_000_000, inputLimitTokens: 4_000_000 },
      requestedOutputTokens: 8_000,
      systemPrompt: 'system',
      advertisedTools: [],
      history,
      currentRequest: 'next'
    })
    expect(plan.historyBytes).toBeGreaterThan(2_097_152)
    expect(plan.requiresCompaction).toBe(true)
    expect(plan.reasons).toContain('message_bytes')
  })

  it('rejects fixed context plus the current request when they cannot fit', () => {
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
