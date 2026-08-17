import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { describe, expect, it } from 'vitest'
import {
  AgentContextBudgetController,
  AgentCurrentTurnTooLargeError,
  AgentModelCapacityError,
  AgentToolBatchContextExhaustedError,
  agentMessageBudget,
  agentOutputLimit,
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
  it('estimates CJK conservatively rather than using the ASCII ratio', () => {
    expect(estimateAgentTokens('abcd')).toBe(1)
    expect(estimateAgentTokens('写作助手')).toBe(4)
    expect(estimateAgentTokens('🙂')).toBe(2)
  })

  it('retains the current request and newest complete turn while omitting older completed turns', () => {
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

  it('keeps the newest assistant/tool-result batch complete and projects only older read batches', () => {
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
      timestamp: 5
    })
    const bounded = boundAgentContextByTokens(
      [
        user('Polish RQ1 through RQ3', 1),
        readCall('tool-old', 2, 'search_knowledge'),
        oldResult,
        readCall('tool-latest', 4),
        latestResult
      ],
      4_096
    )
    const serialized = JSON.stringify(bounded)
    expect(serialized).toContain('historical_projection')
    expect(serialized).toContain(`citation-${'a'.repeat(40)}`)
    expect(serialized).not.toContain('PRIVATE SOURCE BODY')
    expect(serialized).not.toContain('/Users/private')
    expect(serialized).not.toContain('must not survive')
    expect(serialized).toContain('block-rq3')
    expect(serialized).toContain('RQ3 body')
    expect(serialized).toContain('b'.repeat(64))
  })

  it('keeps a parallel latest tool batch atomic', () => {
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
    expect(JSON.stringify(bounded)).not.toContain('historical_projection')
  })

  it('projects one oversized active read batch for a smaller retry and recovers on a small batch', () => {
    const events: string[] = []
    const controller = new AgentContextBudgetController(4_096, (event) => events.push(event.type))
    const first = [
      user('Polish RQ3', 1),
      readCall('read-large', 2),
      toolResult({ id: 'read-large', text: 'large body '.repeat(8_000), timestamp: 3 })
    ]
    const projected = controller.transform(first)
    expect(JSON.stringify(projected)).toContain('active_batch_retry')
    expect(JSON.stringify(projected)).toContain('"contentAvailable":false')
    expect(JSON.stringify(projected)).toContain('"maxAttempts":1')
    expect(JSON.stringify(projected)).not.toContain('large body')
    expect(events).toEqual(['active_batch_retry'])

    const recovered = controller.transform([
      ...first,
      readCall('read-small', 4),
      toolResult({ id: 'read-small', text: 'bounded RQ3 body', timestamp: 5 })
    ])
    expect(JSON.stringify(recovered)).toContain('bounded RQ3 body')
    expect(events).toEqual(['active_batch_retry', 'active_batch_recovered'])
    expect(controller.terminalError()).toBeNull()
  })

  it('fails after a second oversized read batch and never projects mutation output', () => {
    const controller = new AgentContextBudgetController(4_096)
    const first = [
      user('Polish RQ3', 1),
      readCall('read-large', 2),
      toolResult({ id: 'read-large', text: 'large body '.repeat(8_000), timestamp: 3 })
    ]
    controller.transform(first)
    expect(() =>
      controller.transform([
        ...first,
        readCall('read-large-again', 4),
        toolResult({ id: 'read-large-again', text: 'still large '.repeat(8_000), timestamp: 5 })
      ])
    ).toThrow(AgentToolBatchContextExhaustedError)
    expect(controller.terminalError()).toBeInstanceOf(AgentToolBatchContextExhaustedError)

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
            {
              type: 'toolCall',
              id: 'tool-proposal',
              name: 'submit_section_change',
              arguments: {}
            }
          ]),
          mutation
        ],
        4_096
      )
    ).toThrow(AgentCurrentTurnTooLargeError)
  })

  it('rejects an oversized current CJK request instead of recursively truncating strings', () => {
    expect(() => boundAgentContextByTokens([user('界'.repeat(20_000), 1)], 4_096)).toThrow(
      AgentCurrentTurnTooLargeError
    )
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
    expect(agentMessageBudget(2_000, { ...limits })).toBe(12_000)
    expect(() =>
      agentMessageBudget(8_192, { ...limits, contextWindowTokens: 20_000, inputLimitTokens: null })
    ).toThrow(AgentModelCapacityError)
  })
})
