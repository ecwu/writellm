import { describe, expect, it } from 'vitest'
import type { AgentEventRecord } from '../../../../shared/contracts/agent-ipc'
import {
  aggregateAgentUsage,
  citationDisplaysForToolResult,
  findLatestPrompt,
  findToolResult,
  mergeAgentEvents
} from './agent-view-model'

const base = {
  agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
  agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc424',
  modelRequestId: null,
  createdAt: '2026-07-21T00:00:00.000Z'
}

describe('Agent renderer view model', () => {
  it('de-duplicates replay/live overlap by durable sequence', () => {
    const event = record(2, 'run_completed', { status: 'completed' })
    expect(mergeAgentEvents([event], event)).toHaveLength(1)
    expect(
      mergeAgentEvents([event], record(1, 'run_completed', {})).map((item) => item.sequence)
    ).toEqual([1, 2])
  })

  it('correlates tool results and keeps retry prompts visible', () => {
    const events = [
      record(1, 'user_message', { content: 'Draft.', delivery: 'prompt', timestamp: 1 }),
      record(2, 'tool_result', {
        toolCallId: 'tool-1',
        toolName: 'get_writing_context',
        isError: false,
        result: {},
        error: null,
        citationIds: [],
        knowledgeItemIds: [],
        parseRevisionIds: [],
        timestamp: 2
      })
    ]
    expect(findLatestPrompt(events)).toBe('Draft.')
    expect(findToolResult(events, 'tool-1')).toMatchObject({ isError: false })
  })

  it('aggregates bounded usage and retries without provider secrets', () => {
    const events = [
      record(1, 'assistant_message', {
        content: 'Done.',
        stopReason: 'stop',
        provider: 'openai-compatible',
        model: 'writer',
        metadata: {
          usage: {
            inputTokens: 12,
            outputTokens: 4,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedCostUsdMicros: null
          },
          responseIds: [],
          retryCount: 2,
          providerModelId: 'writer-resolved'
        },
        timestamp: 1,
        interrupted: false
      })
    ]
    expect(aggregateAgentUsage(events)).toEqual({ inputTokens: 12, outputTokens: 4, retryCount: 2 })
  })

  it('labels search citations with source titles and page indexes', () => {
    const citationId = `citation-${'a'.repeat(40)}`
    const result = findToolResult(
      [
        record(1, 'tool_result', {
          toolCallId: 'tool-search',
          toolName: 'search_knowledge',
          isError: false,
          result: {
            mode: 'hybrid',
            rerankStatus: 'disabled',
            hits: [
              {
                citationId,
                knowledgeItemId: '019c6a5c-8d34-7a8e-a602-3d37a52dc425',
                parseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc426',
                chunkId: `chunk-${'b'.repeat(40)}`,
                title: 'Attention Is All You Need.pdf',
                snippet: 'Transformer evidence',
                page: 0,
                headingPath: ['Introduction'],
                sourceBlockIds: ['block-1']
              }
            ]
          },
          error: null,
          citationIds: [citationId],
          knowledgeItemIds: ['019c6a5c-8d34-7a8e-a602-3d37a52dc425'],
          parseRevisionIds: ['019c6a5c-8d34-7a8e-a602-3d37a52dc426'],
          timestamp: 2
        })
      ],
      'tool-search'
    )

    expect(result).not.toBeNull()
    if (result === null) throw new Error('Expected a correlated tool result')
    expect(citationDisplaysForToolResult(result)).toEqual([
      {
        citationId,
        title: 'Attention Is All You Need.pdf',
        page: 0
      }
    ])
  })
})

function record(
  sequence: number,
  type: AgentEventRecord['type'],
  payload: Record<string, unknown>
): AgentEventRecord {
  return {
    ...base,
    agentEventId: `019c6a5c-8d34-7a8e-a602-${String(sequence).padStart(12, '0')}`,
    sequence,
    type,
    payload
  }
}
