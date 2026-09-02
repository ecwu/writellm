import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'
import {
  AgentContextBudgetController,
  AgentCurrentTurnTooLargeError,
  AgentModelCapacityError,
  agentMessageBudget,
  agentOutputLimit,
  agentRuntimeMessageBudget,
  boundAgentContextByTokens,
  contextWouldTruncate,
  estimateAgentTokens,
  groupAgentTurns
} from './agent-context-budget'
import { agentModelVisibleToolSpecs, agentToolEnvelope } from './agent-tool-specs'

const user = (content: string, timestamp: number): AgentMessage => ({
  role: 'user',
  content,
  timestamp
})

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
}

function assistant(
  timestamp: number,
  content: Extract<AgentMessage, { role: 'assistant' }>['content'],
  stopReason: Extract<AgentMessage, { role: 'assistant' }>['stopReason'] = 'toolUse'
): Extract<AgentMessage, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'openai-compatible',
    model: 'writer-model',
    usage,
    stopReason,
    timestamp
  }
}

function toolResult(input: {
  id: string
  name?: string
  text: string
  timestamp: number
  details?: unknown
}): Extract<AgentMessage, { role: 'toolResult' }> {
  return {
    role: 'toolResult',
    toolCallId: input.id,
    toolName: input.name ?? 'read_section',
    content: [{ type: 'text', text: input.text }],
    details: input.details,
    isError: false,
    timestamp: input.timestamp
  }
}

function readCall(id: string, timestamp: number, name = 'read_section') {
  return assistant(timestamp, [
    { type: 'toolCall', id, name, arguments: { sectionId: 'section-id', limit: 20 } }
  ])
}

describe('Agent token context budget', () => {
  it('estimates CJK and emoji without assuming the ASCII ratio', () => {
    expect(estimateAgentTokens('abcd')).toBe(1)
    expect(estimateAgentTokens('写作助手')).toBe(4)
    expect(estimateAgentTokens('🙂')).toBe(2)
  })

  it('uses all model input space released by inactive tool groups', () => {
    const limits = {
      contextWindowTokens: 32_768,
      inputLimitTokens: null,
      outputLimitTokens: 4_096,
      source: 'manual_override' as const,
      catalogModelKey: null,
      resolvedAt: null
    }
    const budget = (groups: Parameters<typeof agentModelVisibleToolSpecs>[1]) =>
      agentRuntimeMessageBudget({
        maxOutputTokens: 4_096,
        limits,
        systemPrompt: 'Write safely.',
        advertisedTools: agentToolEnvelope(agentModelVisibleToolSpecs('writing', groups))
      })
    expect(budget([])).toBeGreaterThan(
      budget(['review', 'writing_task', 'brief', 'writing_rules', 'outline', 'section', 'image'])
    )
  })

  it('retains the newest complete turn while omitting older turns', () => {
    const messages = [
      user('a'.repeat(12_000), 1),
      assistant(2, [{ type: 'text', text: 'old answer' }], 'stop'),
      user('b'.repeat(12_000), 3),
      assistant(4, [{ type: 'text', text: 'middle answer' }], 'stop'),
      user('newest', 5)
    ]
    expect(contextWouldTruncate(messages, 4_096)).toBe(true)
    const bounded = boundAgentContextByTokens(messages, 4_096)
    expect(groupAgentTurns(bounded)).toHaveLength(2)
    expect(bounded.at(-1)).toMatchObject({ role: 'user', content: 'newest' })
  })

  it('drops oversized old turns and keeps the latest atomic batch raw when it fits', () => {
    const oldResult = toolResult({
      id: 'tool-old',
      name: 'search_knowledge',
      text: 'PRIVATE SOURCE BODY '.repeat(5_000),
      timestamp: 3,
      details: {
        schemaVersion: 2,
        ok: true,
        data: {
          citationIds: [`citation-${'a'.repeat(40)}`],
          title: '/Users/private/source.pdf',
          body: 'must not survive'
        }
      }
    })
    const latestResult = toolResult({
      id: 'tool-latest',
      text: JSON.stringify({
        revisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
        blocks: [{ blockId: 'block-rq3', blockHash: 'b'.repeat(64), text: 'RQ3 body' }]
      }),
      timestamp: 7
    })
    const bounded = boundAgentContextByTokens(
      [
        user('Old request', 1),
        readCall('tool-old', 2, 'search_knowledge'),
        oldResult,
        assistant(4, [{ type: 'text', text: 'old answer' }], 'stop'),
        user('Polish RQ1 through RQ3', 5),
        readCall('tool-latest', 6),
        latestResult
      ],
      4_096
    )
    const serialized = JSON.stringify(bounded)
    expect(serialized).not.toContain('historical_projection')
    expect(serialized).not.toContain('PRIVATE SOURCE BODY')
    expect(serialized).not.toContain('/Users/private')
    expect(serialized).not.toContain('must not survive')
    expect(serialized).toContain('RQ3 body')
  })

  it('keeps the retained history suffix contiguous when an intervening turn is oversized', () => {
    const bounded = boundAgentContextByTokens(
      [
        user('old turn', 1),
        assistant(2, [{ type: 'text', text: 'old answer' }], 'stop'),
        user(`oversized turn ${'界'.repeat(20_000)}`, 3),
        assistant(4, [{ type: 'text', text: 'oversized answer' }], 'stop'),
        user('current request', 5)
      ],
      4_096
    )
    const serialized = JSON.stringify(bounded)
    expect(serialized).toContain('current request')
    expect(serialized).not.toContain('oversized turn')
    expect(serialized).not.toContain('old turn')
  })

  it('keeps a parallel latest read batch atomic', () => {
    const call = assistant(2, [
      { type: 'toolCall', id: 'read-a', name: 'read_section', arguments: {} },
      { type: 'toolCall', id: 'read-b', name: 'read_section', arguments: {} }
    ])
    const bounded = boundAgentContextByTokens(
      [
        user('Read both sections', 1),
        call,
        toolResult({ id: 'read-a', text: 'first body', timestamp: 3 }),
        toolResult({ id: 'read-b', text: 'second body', timestamp: 4 })
      ],
      4_096
    )
    expect(bounded.slice(-3).map((message) => message.role)).toEqual([
      'assistant',
      'toolResult',
      'toolResult'
    ])
  })

  it('projects every oversized read batch independently without a retry counter', () => {
    const events: string[] = []
    const controller = new AgentContextBudgetController(4_096, (event) => events.push(event.type))
    const first = [
      user('Polish RQ3', 1),
      readCall('read-large', 2),
      toolResult({ id: 'read-large', text: 'large body '.repeat(8_000), timestamp: 3 })
    ]
    const projected = controller.transform(first)
    expect(JSON.stringify(projected)).toContain('active_batch_retry')
    expect(JSON.stringify(projected)).toContain('requiredTokens')
    expect(JSON.stringify(projected)).toContain('availableTokens')
    expect(JSON.stringify(projected)).not.toContain('maxAttempts')
    expect(JSON.stringify(projected)).not.toContain('large body')
    expect(events).toEqual(['active_batch_retry'])

    const second = controller.transform([
      ...projected,
      readCall('read-large-again', 4),
      toolResult({ id: 'read-large-again', text: 'still large '.repeat(8_000), timestamp: 5 })
    ])
    expect(JSON.stringify(second)).toContain('read-large-again')
    expect(JSON.stringify(second)).not.toContain('still large')
    expect(events).toEqual(['active_batch_retry', 'active_batch_retry'])
  })

  it('never projects an oversized mutation/effect result', () => {
    const mutation = toolResult({
      id: 'tool-proposal',
      name: 'submit_section_change',
      text: 'proposal '.repeat(8_000),
      timestamp: 3
    })
    expect(() =>
      boundAgentContextByTokens(
        [
          user('Apply a change', 1),
          assistant(2, [
            { type: 'toolCall', id: 'tool-proposal', name: 'submit_section_change', arguments: {} }
          ]),
          mutation
        ],
        4_096
      )
    ).toThrow(AgentCurrentTurnTooLargeError)
  })

  it('rejects an oversized current user request instead of truncating it', () => {
    expect(() => boundAgentContextByTokens([user('界'.repeat(20_000), 1)], 4_096)).toThrow(
      AgentCurrentTurnTooLargeError
    )
  })

  it('combines exact input and output limits without the former fixed reserve', () => {
    const limits = {
      contextWindowTokens: 32_000,
      inputLimitTokens: 12_000,
      outputLimitTokens: 2_000,
      source: 'models_dev' as const,
      catalogModelKey: 'example/model',
      resolvedAt: '2026-07-22T00:00:00.000Z'
    }
    expect(agentOutputLimit(8_192, limits)).toBe(2_000)
    expect(agentMessageBudget(2_000, { ...limits })).toBe(12_000)
    expect(agentMessageBudget(8_192, { ...limits, contextWindowTokens: 5_000 })).toBe(3_000)
    expect(() =>
      agentMessageBudget(8_192, {
        ...limits,
        contextWindowTokens: 5_000,
        inputLimitTokens: null,
        outputLimitTokens: null
      })
    ).toThrow(AgentModelCapacityError)
  })
})
