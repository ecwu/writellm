import { describe, expect, it } from 'vitest'
import type { AgentEventRecord, AgentRunRecord } from '../../../../shared/contracts/agent-ipc'
import {
  aggregateAgentUsage,
  citationDisplaysForToolResult,
  formatAgentDuration,
  findLatestPrompt,
  findToolResult,
  mergeAgentEvents,
  projectAgentTimeline
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

  it('groups reverse-completing tools between visible assistant narratives', () => {
    const citationId = `citation-${'c'.repeat(40)}`
    const events = [
      assistantRecord(1, 'I will read the section and search the knowledge base.'),
      toolCallRecord(2, 'read-section', 'read_section'),
      assistantRecord(3, '', 'toolUse'),
      toolCallRecord(4, 'search', 'search_knowledge'),
      toolResultRecord(5, 'search', 'search_knowledge', {
        citationIds: [citationId],
        result: {
          mode: 'hybrid',
          rerankStatus: 'disabled',
          hits: [
            {
              citationId,
              knowledgeItemId: '019c6a5c-8d34-7a8e-a602-3d37a52dc425',
              parseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc426',
              chunkId: `chunk-${'d'.repeat(40)}`,
              title: 'Source paper.pdf',
              snippet: 'Evidence',
              page: 2,
              headingPath: [],
              sourceBlockIds: ['source-block']
            }
          ]
        }
      }),
      toolResultRecord(6, 'read-section', 'read_section', { citationIds: [citationId] }),
      assistantRecord(7, 'Here is the grounded answer.')
    ]

    const timeline = projectAgentTimeline(events)
    expect(timeline.map((item) => item.type)).toEqual(['assistant', 'activity', 'assistant'])
    expect(timeline[1]).toMatchObject({
      type: 'activity',
      status: 'complete',
      summary: 'Read 1 section, searched knowledge',
      citations: [{ citationId, title: 'Source paper.pdf', page: 2 }]
    })
  })

  it('prioritizes errors over incomplete work and keeps proposals standalone', () => {
    const events = [
      assistantRecord(1, 'I will inspect the draft.'),
      toolCallRecord(2, 'read-one', 'read_section'),
      toolCallRecord(3, 'proposal', 'propose_section_patch'),
      toolResultRecord(4, 'proposal', 'propose_section_patch'),
      toolCallRecord(5, 'read-two', 'read_section'),
      toolCallRecord(6, 'search', 'search_knowledge'),
      toolResultRecord(7, 'search', 'search_knowledge', {
        isError: true,
        error: { code: 'search_failed', message: 'Search failed safely.' },
        result: null
      }),
      assistantRecord(8, 'I need another approach.')
    ]

    const timeline = projectAgentTimeline(events)
    expect(timeline.map((item) => item.type)).toEqual([
      'assistant',
      'activity',
      'proposal',
      'activity',
      'assistant'
    ])
    expect(timeline[1]).toMatchObject({ type: 'activity', status: 'running' })
    expect(timeline[2]).toMatchObject({ type: 'proposal', proposal: null })
    expect(timeline[3]).toMatchObject({ type: 'activity', status: 'error' })
  })

  it('reconstructs frozen run and tool durations and marks unresolved tools stopped', () => {
    const runId = base.agentRunId
    const startTimestamp = Date.parse('2026-07-21T00:00:00.000Z')
    const events = [
      recordAt(
        1,
        'user_message',
        {
          content: 'Stop after the read.',
          delivery: 'prompt',
          timestamp: startTimestamp
        },
        '2026-07-21T00:00:00.000Z'
      ),
      recordAt(
        2,
        'tool_call',
        {
          toolCallId: 'tool-complete',
          toolName: 'read_section',
          args: {},
          timestamp: startTimestamp + 2_000
        },
        '2026-07-21T00:00:01.000Z'
      ),
      recordAt(
        3,
        'tool_result',
        {
          toolCallId: 'tool-complete',
          toolName: 'read_section',
          isError: false,
          result: {},
          error: null,
          citationIds: [],
          knowledgeItemIds: [],
          parseRevisionIds: [],
          timestamp: startTimestamp + 3_500
        },
        '2026-07-21T00:00:02.500Z'
      ),
      recordAt(
        4,
        'tool_call',
        {
          toolCallId: 'tool-stopped',
          toolName: 'search_knowledge',
          args: {},
          timestamp: startTimestamp + 4_000
        },
        '2026-07-21T00:00:03.000Z'
      ),
      recordAt(
        5,
        'run_interrupted',
        { status: 'interrupted', code: 'user_stopped' },
        '2026-07-21T00:00:05.000Z'
      )
    ]
    const run = {
      agentRunId: runId,
      agentSessionId: base.agentSessionId,
      status: 'interrupted',
      providerId: 'openai-compatible',
      modelId: 'writer',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
      errorCode: 'user_stopped',
      startedAt: '2026-07-21T00:00:00.000Z',
      completedAt: '2026-07-21T00:00:05.000Z',
      updatedAt: '2026-07-21T00:00:05.000Z'
    } satisfies AgentRunRecord

    const timeline = projectAgentTimeline(events, [], [run], Date.parse('2026-07-21T00:00:09.000Z'))
    const activity = timeline.find((item) => item.type === 'activity')
    expect(activity).toMatchObject({ type: 'activity', status: 'stopped' })
    if (activity?.type !== 'activity') throw new Error('Expected an activity')
    expect(activity.tools.map((tool) => tool.durationMs)).toEqual([1_500, 1_000])
    const terminal = timeline.find((item) => item.type === 'run_interrupted')
    expect(terminal).toMatchObject({
      type: 'run_interrupted',
      terminal: { code: 'user_stopped', durationMs: 5_000 }
    })
    expect(formatAgentDuration(68_000)).toBe('1m 08s')
  })
})

function assistantRecord(
  sequence: number,
  content: string,
  stopReason: 'stop' | 'toolUse' = 'stop'
): AgentEventRecord {
  return record(sequence, 'assistant_message', {
    content,
    stopReason,
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
      retryCount: 0,
      providerModelId: 'writer-resolved'
    },
    timestamp: sequence,
    interrupted: false
  })
}

function toolCallRecord(sequence: number, toolCallId: string, toolName: string): AgentEventRecord {
  return record(sequence, 'tool_call', { toolCallId, toolName, args: {}, timestamp: sequence })
}

function toolResultRecord(
  sequence: number,
  toolCallId: string,
  toolName: string,
  overrides: Record<string, unknown> = {}
): AgentEventRecord {
  return record(sequence, 'tool_result', {
    toolCallId,
    toolName,
    isError: false,
    result: {},
    error: null,
    citationIds: [],
    knowledgeItemIds: [],
    parseRevisionIds: [],
    timestamp: sequence,
    ...overrides
  })
}

function record(
  sequence: number,
  type: AgentEventRecord['type'],
  payload: Record<string, unknown>
): AgentEventRecord {
  return recordAt(sequence, type, payload, base.createdAt)
}

function recordAt(
  sequence: number,
  type: AgentEventRecord['type'],
  payload: Record<string, unknown>,
  createdAt: string
): AgentEventRecord {
  return {
    ...base,
    agentEventId: `019c6a5c-8d34-7a8e-a602-${String(sequence).padStart(12, '0')}`,
    sequence,
    type,
    payload,
    createdAt
  }
}
