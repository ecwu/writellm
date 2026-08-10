import { describe, expect, it } from 'vitest'
import type { AgentEventRecord, AgentRunRecord } from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import {
  aggregateAgentUsage,
  agentReviewState,
  agentTerminalLabel,
  agentTimelineScrollAnchorIndex,
  applyAgentTerminalEvent,
  citationDisplaysForToolResult,
  formatAgentDuration,
  findLatestPrompt,
  findToolResult,
  isSectionProposalOutdated,
  mergeAgentEvents,
  protectTerminalAgentRuns,
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

  it('never lets a stale running snapshot overwrite durable terminal truth', () => {
    const running = runRecord('running')
    const terminalEvent = recordAt(
      2,
      'run_interrupted',
      { status: 'interrupted', code: 'user_stopped' },
      '2026-07-21T00:00:05.000Z'
    )
    const interrupted = applyAgentTerminalEvent([running], terminalEvent)

    expect(interrupted[0]).toMatchObject({
      status: 'interrupted',
      errorCode: 'user_stopped',
      completedAt: terminalEvent.createdAt
    })
    expect(protectTerminalAgentRuns(interrupted, [running], new Set([base.agentRunId]))[0]).toEqual(
      interrupted[0]
    )
    expect(protectTerminalAgentRuns([], [running], new Set([base.agentRunId]))).toEqual([])
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
      toolCallRecord(3, 'proposal', 'submit_section_change'),
      toolResultRecord(4, 'proposal', 'submit_section_change'),
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

  it('projects only the latest leaf of a refreshed proposal chain', () => {
    const events = [
      toolCallRecord(1, 'proposal-chain', 'submit_section_change'),
      toolResultRecord(2, 'proposal-chain', 'submit_section_change')
    ]
    const original = proposalRecord('019c6a5c-8d34-7a8e-a602-3d37a52dc430', null, 'superseded')
    const refreshed = proposalRecord(
      '019c6a5c-8d34-7a8e-a602-3d37a52dc431',
      original.proposalId,
      'pending'
    )

    expect(projectAgentTimeline(events, [original, refreshed])).toMatchObject([
      { type: 'proposal', proposal: { proposalId: refreshed.proposalId } }
    ])
    if (refreshed.payload.kind !== 'section_patch') throw new Error('Expected section proposal')
    expect(
      isSectionProposalOutdated(refreshed, {
        [refreshed.payload.mutation.sectionId]: '019c6a5c-8d34-7a8e-a602-3d37a52dc499'
      })
    ).toBe(true)
    expect(
      isSectionProposalOutdated(refreshed, {
        [refreshed.payload.mutation.sectionId]: refreshed.payload.mutation.baseRevisionId
      })
    ).toBe(false)
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
      providerPresetId: null,
      providerLabel: 'openai-compatible',
      modelLabel: 'writer',
      api: 'openai-completions',
      approvalMode: 'manual',
      thinkingLevel: 'off',
      modelLimits: {
        contextWindowTokens: 131_072,
        inputLimitTokens: null,
        outputLimitTokens: null,
        source: 'legacy_fallback',
        catalogModelKey: null,
        resolvedAt: null
      },
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
      skillSnapshot: legacySkillSnapshot(),
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

  it('renders current and historical manual-review pauses without hiding genuine failures', () => {
    const current = projectAgentTimeline([
      record(1, 'run_completed', {
        status: 'completed',
        outcome: 'awaiting_review',
        proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc430'
      })
    ])
    expect(current[0]).toMatchObject({
      type: 'run_completed',
      terminal: { status: 'completed', outcome: 'awaiting_review', code: 'awaiting_review' }
    })

    const historical = projectAgentTimeline([
      toolResultRecord(1, 'proposal', 'submit_brief_change', {
        result: {
          proposal: {
            proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc430',
            kind: 'brief_update',
            status: 'pending'
          },
          application: { status: 'not_applied' },
          continuation: 'pause_for_review',
          warnings: []
        }
      }),
      record(2, 'run_interrupted', { status: 'failed', code: 'agent_run_failed' })
    ])
    expect(historical.at(-1)).toMatchObject({
      type: 'run_interrupted',
      terminal: { status: 'completed', outcome: 'awaiting_review', code: 'awaiting_review' }
    })

    const failed = projectAgentTimeline([
      record(1, 'run_interrupted', { status: 'failed', code: 'provider_timeout' })
    ])
    expect(failed[0]).toMatchObject({
      type: 'run_interrupted',
      terminal: { status: 'failed', outcome: 'finished', code: 'provider_timeout' }
    })

    const retriesExhausted = projectAgentTimeline([
      record(1, 'run_interrupted', { status: 'failed', code: 'provider_retries_exhausted' })
    ])
    expect(retriesExhausted[0]).toMatchObject({
      type: 'run_interrupted',
      terminal: {
        status: 'failed',
        outcome: 'finished',
        code: 'provider_retries_exhausted'
      }
    })
  })

  it('anchors the pending proposal and resolves its historical review state after a decision', () => {
    const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc435'
    const pending = proposalRecord(proposalId, null, 'pending')
    const events = [
      toolCallRecord(1, 'proposal-chain', 'submit_section_change'),
      toolResultRecord(2, 'proposal-chain', 'submit_section_change'),
      record(3, 'run_completed', {
        status: 'completed',
        outcome: 'awaiting_review',
        proposalId
      })
    ]
    const timeline = projectAgentTimeline(events, [pending])

    expect(timeline[agentTimelineScrollAnchorIndex(timeline)]).toMatchObject({
      type: 'proposal',
      proposal: { proposalId, status: 'pending' }
    })
    expect(agentReviewState(base.agentRunId, [pending])).toBe('waiting')
    expect(agentReviewState(base.agentRunId, [{ ...pending, status: 'applied' }])).toBe('approved')
    expect(agentReviewState(base.agentRunId, [{ ...pending, status: 'rejected' }])).toBe('rejected')
  })

  it('labels every Main-emitted terminal code instead of falling back to interrupted', () => {
    expect(agentTerminalLabel('provider_timeout')).toBe('Provider request timed out')
    expect(agentTerminalLabel('provider_retries_exhausted')).toBe(
      'Provider request failed after 5 attempts'
    )
    expect(agentTerminalLabel('user_stopped')).toBe('Stopped by user')
    expect(agentTerminalLabel('project_closed')).toBe('Interrupted because project closed')
    expect(agentTerminalLabel('process_restarted')).toBe('Interrupted because the app restarted')
    expect(agentTerminalLabel('skill_route_failed')).toBe('Writing skill routing failed')
    expect(agentTerminalLabel('skill_prompt_budget_exceeded')).toBe(
      'Writing skill exceeds the prompt budget'
    )
    expect(agentTerminalLabel('compaction_failed')).toBe('Session compaction failed')
    expect(agentTerminalLabel('model_request_start_failed')).toBe(
      'Model request could not be started'
    )
    expect(agentTerminalLabel('agent_context_failed')).toBe('Agent context could not be built')
    expect(agentTerminalLabel('run_failed')).toBe('Run failed')
    expect(agentTerminalLabel('run_interrupted')).toBe('Run interrupted')
    expect(agentTerminalLabel('unknown_code')).toBe('Run interrupted')
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

function proposalRecord(
  proposalId: string,
  replacesProposalId: string | null,
  status: MutationProposalRecord['status']
): MutationProposalRecord {
  const terminal = status !== 'pending'
  return {
    proposalId,
    agentSessionId: base.agentSessionId,
    agentRunId: base.agentRunId,
    agentToolCallId: 'proposal-chain',
    kind: 'section_patch',
    payload: {
      schemaVersion: 1,
      kind: 'section_patch',
      mutation: {
        schemaVersion: 1,
        sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc432',
        baseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc433',
        operations: [
          {
            type: 'updateBlock',
            blockId: 'target',
            update: { content: [{ type: 'text', text: 'After', styles: {} }] }
          }
        ],
        citationIds: []
      },
      preview: {
        summary: 'Update target',
        affectedSectionIds: ['019c6a5c-8d34-7a8e-a602-3d37a52dc432'],
        beforeText: 'Before',
        afterText: 'After',
        beforeTextTruncated: false,
        afterTextTruncated: false,
        citedSources: []
      },
      provenance: {
        modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc434',
        citedSources: []
      }
    },
    status,
    decisionAt: terminal ? base.createdAt : null,
    appliedRevisionId: null,
    appliedBriefVersion: null,
    appliedOutlineVersion: null,
    undoRevisionId: null,
    replacesProposalId,
    rejectedReason: terminal ? 'Replaced by refreshed proposal' : null,
    createdAt: base.createdAt,
    updatedAt: base.createdAt
  }
}

function runRecord(status: AgentRunRecord['status']): AgentRunRecord {
  return {
    agentRunId: base.agentRunId,
    agentSessionId: base.agentSessionId,
    status,
    providerId: 'openai-compatible',
    modelId: 'writer',
    providerPresetId: null,
    providerLabel: 'openai-compatible',
    modelLabel: 'writer',
    api: 'openai-completions',
    approvalMode: 'manual',
    thinkingLevel: 'off',
    modelLimits: {
      contextWindowTokens: 131_072,
      inputLimitTokens: null,
      outputLimitTokens: null,
      source: 'legacy_fallback',
      catalogModelKey: null,
      resolvedAt: null
    },
    editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] },
    skillSnapshot: legacySkillSnapshot(),
    errorCode: null,
    startedAt: base.createdAt,
    completedAt: null,
    updatedAt: base.createdAt
  }
}

function legacySkillSnapshot(): AgentRunRecord['skillSnapshot'] {
  return {
    mode: 'none',
    routingStatus: 'legacy',
    primary: null,
    dependencies: [],
    resources: [],
    safeError: null
  }
}
