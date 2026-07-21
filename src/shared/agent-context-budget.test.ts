import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'
import {
  boundAgentContextByTokens,
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
})
