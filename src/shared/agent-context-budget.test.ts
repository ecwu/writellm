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

  it('rejects an oversized current CJK turn instead of recursively truncating strings', () => {
    expect(() => boundAgentContextByTokens([user('界'.repeat(20_000), 1)], 4_096)).toThrow(
      'current Agent turn exceeds'
    )
  })

  it('replaces oversized current-turn read output with typed facts but never rewrites mutation output', () => {
    const readResult = {
      role: 'toolResult' as const,
      toolCallId: 'tool-read',
      toolName: 'search_knowledge',
      content: [{ type: 'text' as const, text: 'PRIVATE SOURCE BODY '.repeat(5_000) }],
      details: {
        citationIds: [`citation-${'a'.repeat(40)}`],
        knowledgeItemIds: ['019c6a5c-8d34-7a8e-a602-3d37a52dc421'],
        title: '/Users/private/source.pdf',
        body: 'must not survive'
      },
      isError: false,
      timestamp: 2
    } satisfies AgentMessage
    const bounded = boundAgentContextByTokens([user('current request', 1), readResult], 4_096)
    expect(estimateAgentTokens(bounded)).toBeLessThanOrEqual(4_096)
    expect(JSON.stringify(bounded)).toContain(`citation-${'a'.repeat(40)}`)
    expect(JSON.stringify(bounded)).not.toContain('PRIVATE SOURCE BODY')
    expect(JSON.stringify(bounded)).not.toContain('/Users/private')
    expect(JSON.stringify(bounded)).not.toContain('must not survive')

    const proposalResult = {
      ...readResult,
      toolCallId: 'tool-proposal',
      toolName: 'submit_section_change'
    } satisfies AgentMessage
    expect(() =>
      boundAgentContextByTokens([user('current request', 1), proposalResult], 4_096)
    ).toThrow('current Agent turn exceeds')
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
