import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'
import {
  boundAgentContextByTokens,
  agentMessageBudget,
  agentOutputLimit,
  AgentModelCapacityError,
  contextWouldTruncate,
  estimateAgentTokens,
  groupAgentTurns
} from './agent-context-budget'

const user = (content: string, timestamp: number): AgentMessage => ({
  role: 'user',
  content,
  timestamp
})

describe('Agent token context budget', () => {
  it('estimates CJK conservatively rather than using the ASCII ratio', () => {
    expect(estimateAgentTokens('abcd')).toBe(1)
    expect(estimateAgentTokens('写作助手')).toBe(4)
    expect(estimateAgentTokens('🙂')).toBe(2)
  })

  it('retains newest complete turns and omits older turns under pressure', () => {
    const messages = [user('a'.repeat(12_000), 1), user('b'.repeat(12_000), 2), user('newest', 3)]
    expect(contextWouldTruncate(messages, 4_096)).toBe(true)
    const bounded = boundAgentContextByTokens(messages, 4_096)
    expect(groupAgentTurns(bounded)).toHaveLength(2)
    expect(bounded.at(-1)).toMatchObject({ role: 'user', content: 'newest' })
  })

  it('never throws for an oversized current CJK turn and remains within budget', () => {
    const bounded = boundAgentContextByTokens([user('界'.repeat(20_000), 1)], 4_096)
    expect(bounded).toHaveLength(1)
    expect(estimateAgentTokens(bounded)).toBeLessThanOrEqual(4_096)
  })

  it('combines input, output, context, and fixed safety reserves without clamping upward', () => {
    const limits = {
      contextWindowTokens: 32_000,
      inputLimitTokens: 12_000,
      outputLimitTokens: 2_000,
      source: 'models_dev' as const,
      catalogModelKey: 'example/model',
      resolvedAt: '2026-07-22T00:00:00.000Z'
    }
    expect(agentOutputLimit(8_192, limits)).toBe(2_000)
    expect(agentMessageBudget(2_000, limits)).toBe(12_000)
    expect(() =>
      agentMessageBudget(8_192, { ...limits, contextWindowTokens: 20_000, inputLimitTokens: null })
    ).toThrow(AgentModelCapacityError)
  })
})
