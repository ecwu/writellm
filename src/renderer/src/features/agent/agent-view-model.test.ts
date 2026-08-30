import { describe, expect, it } from 'vitest'
import type { AgentEventRecord, AgentRunRecord } from '../../../../shared/contracts/agent-ipc'
import type { MutationProposalRecord } from '../../../../shared/contracts/agent-mutations'
import type { AgentToolActivity } from './agent-view-model'
import {
  aggregateAgentUsage,
  agentReviewState,
  agentThinkingVisualState,
  agentToolActivityLabel,
  agentTerminalDetail,
  agentTerminalLabel,
  agentTimelineScrollAnchorIndex,
  applyAgentTerminalEvent,
  buildWritingTaskChangeSet,
  citationDisplaysForToolResult,
  currentAgentActivitySummary,
  formatAgentDuration,
  findLatestPrompt,
  findToolResult,
  isSectionProposalOutdated,
  latestAgentContextSnapshot,
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
  it('maps typed Agent work to the bounded thinking-orb states', () => {
    const searching = projectAgentTimeline([
      toolCallRecord(1, 'search', 'search_knowledge', { query: 'evidence' })
    ])
    expect(
      agentThinkingVisualState({
        timeline: searching,
        runId: base.agentRunId,
        workflowState: 'running',
        choosingSkill: false,
        hasStreamingRun: false
      })
    ).toBe('searching')
    expect(
      agentThinkingVisualState({
        timeline: searching,
        runId: base.agentRunId,
        workflowState: 'running',
        choosingSkill: false,
        hasStreamingRun: true
      })
    ).toBe('composing')
    expect(
      agentThinkingVisualState({
        timeline: [],
        runId: null,
        workflowState: 'generating',
        choosingSkill: false,
        hasStreamingRun: false
      })
    ).toBe('shaping')
  })

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

  it('keeps a newly started running row when an older listRuns response arrives late', () => {
    const current = {
      ...runRecord('running'),
      agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc425',
      startedAt: '2026-07-21T00:00:10.000Z',
      updatedAt: '2026-07-21T00:00:10.000Z'
    }
    const older = runRecord('running')

    expect(protectTerminalAgentRuns([current], [older], new Set())).toEqual([current])
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

  it('projects new and historical preflight failures with safe fallbacks', () => {
    const timeline = projectAgentTimeline([
      record(1, 'tool_preflight_failed', {
        requestedToolName: 'submit_section_change',
        diagnostic: {
          code: 'invalid_arguments',
          message: 'Expected operations; received a missing field. Fix it and retry once.',
          paths: ['/operations']
        },
        durationMs: 7
      }),
      record(2, 'tool_preflight_failed', {
        requestedToolName: 'submit_outline_change'
      })
    ])

    expect(timeline).toEqual([
      {
        type: 'preflight_failure',
        id: '019c6a5c-8d34-7a8e-a602-000000000001',
        failure: {
          toolName: 'submit_section_change',
          code: 'invalid_arguments',
          message: 'Expected operations; received a missing field. Fix it and retry once.',
          paths: ['/operations'],
          durationMs: 7
        }
      },
      {
        type: 'preflight_failure',
        id: '019c6a5c-8d34-7a8e-a602-000000000002',
        failure: {
          toolName: 'submit_outline_change',
          code: 'preparation_failed',
          message:
            'Tool preparation failed before Main dispatch. Open Details for the historical diagnostic.',
          paths: [],
          durationMs: 0
        }
      }
    ])
  })

  it('hides synthesized approval prompts and presents only original review feedback', () => {
    const events = [
      record(1, 'approval_decision', {
        schemaVersion: 2,
        proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc426',
        decision: 'rejected',
        continueRequested: true,
        actor: 'user',
        timestamp: 1
      }),
      record(2, 'user_message', {
        content: 'The user approved the proposal. Continue from the authoritative manuscript.',
        delivery: 'prompt',
        timestamp: 1,
        presentation: { kind: 'approval_continuation' }
      }),
      record(3, 'user_message', {
        content: 'The user rejected the section update. Address this feedback: quieter opening.',
        delivery: 'prompt',
        timestamp: 2,
        presentation: {
          kind: 'review_feedback',
          displayContent: 'Use a quieter opening.'
        }
      })
    ]
    const timeline = projectAgentTimeline(events)

    expect(timeline).toMatchObject([
      {
        type: 'user',
        payload: {
          content: 'Use a quieter opening.',
          presentation: { kind: 'review_feedback' }
        }
      }
    ])
    expect(findLatestPrompt(events)).toBe('Use a quieter opening.')
  })

  it('keeps a quick action selection visible without exposing its Main-owned prompt', () => {
    const event = record(1, 'user_message', {
      content: '<QUICK_ACTION_SELECTION>internal composed prompt',
      delivery: 'prompt',
      timestamp: 1,
      presentation: {
        kind: 'quick_action',
        action: 'rewrite',
        label: 'Rewrite',
        selectedText: 'The exact selected sentence.',
        displayInstruction: null
      }
    })
    const timeline = projectAgentTimeline([event])

    expect(timeline).toMatchObject([
      {
        type: 'user',
        payload: {
          presentation: {
            kind: 'quick_action',
            label: 'Rewrite',
            selectedText: 'The exact selected sentence.'
          }
        }
      }
    ])
    expect(findLatestPrompt([event])).toBe('The exact selected sentence.')
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
    expect(aggregateAgentUsage(events)).toEqual({
      inputTokens: 12,
      outputTokens: 4,
      retryCount: 2,
      skillRouteRequests: 0
    })
  })

  it('pairs the latest context usage with its originating matching model run', () => {
    const run = {
      ...runRecord('completed'),
      providerPresetId: 'writer-preset',
      modelLimits: {
        ...runRecord('completed').modelLimits,
        contextWindowTokens: 258_000
      }
    }
    const event = assistantRecord(1, 'Done.')
    event.payload = {
      ...event.payload,
      metadata: {
        ...(event.payload.metadata as Record<string, unknown>),
        contextTokensUsed: 115_000,
        contextTokensEstimated: false
      }
    }

    expect(
      latestAgentContextSnapshot([event], [run], {
        presetId: 'writer-preset',
        modelId: 'writer'
      })
    ).toMatchObject({
      agentRunId: base.agentRunId,
      used: 115_000,
      estimated: false,
      contextWindowTokens: 258_000,
      percent: (115_000 / 258_000) * 100
    })
  })

  it('hides missing-run and stale-model context usage instead of reusing another limit', () => {
    const currentRun = { ...runRecord('completed'), providerPresetId: 'current-preset' }
    const event = assistantRecord(1, 'Done.')

    expect(
      latestAgentContextSnapshot([event], [], {
        presetId: 'current-preset',
        modelId: 'writer'
      })
    ).toBeNull()
    expect(
      latestAgentContextSnapshot([event], [currentRun], {
        presetId: 'other-preset',
        modelId: 'writer'
      })
    ).toBeNull()
    expect(
      latestAgentContextSnapshot([event], [currentRun], {
        presetId: 'current-preset',
        modelId: 'other-model'
      })
    ).toBeNull()
  })

  it('uses provider input plus cache reads when explicit context usage is unavailable', () => {
    const run = { ...runRecord('completed'), providerPresetId: 'writer-preset' }
    const event = assistantRecord(1, 'Done.')
    event.payload = {
      ...event.payload,
      metadata: {
        ...(event.payload.metadata as Record<string, unknown>),
        usage: {
          inputTokens: 12_000,
          outputTokens: 4,
          cacheReadTokens: 3_000,
          cacheWriteTokens: 0,
          estimatedCostUsdMicros: null
        }
      }
    }

    expect(
      latestAgentContextSnapshot([event], [run], {
        presetId: 'writer-preset',
        modelId: 'writer'
      })
    ).toMatchObject({ used: 15_000, estimated: false })
  })

  it('includes bounded historical SkillRouter usage without double-counting Agent messages', () => {
    const run = {
      ...runRecord('completed'),
      skillRouteUsage: {
        inputTokens: 7,
        outputTokens: 1,
        cacheReadTokens: 2,
        cacheWriteTokens: 0,
        estimatedCostUsdMicros: 10,
        retryCount: 1
      }
    }

    expect(aggregateAgentUsage([assistantRecord(1, 'Done.')], [run])).toEqual({
      inputTokens: 19,
      outputTokens: 5,
      retryCount: 1,
      skillRouteRequests: 1
    })
  })

  it('projects durable approval decisions into the visible timeline', () => {
    const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc426'
    const timeline = projectAgentTimeline([
      record(1, 'approval_decision', {
        schemaVersion: 2,
        proposalId,
        decision: 'approved',
        continueRequested: false,
        actor: 'user',
        timestamp: 1
      }),
      record(2, 'approval_decision', {
        schemaVersion: 2,
        proposalId,
        decision: 'approved',
        continueRequested: true,
        actor: 'user',
        timestamp: 2
      })
    ])

    expect(timeline).toEqual([
      {
        type: 'approval_decision',
        id: '019c6a5c-8d34-7a8e-a602-000000000002',
        payload: expect.objectContaining({ decision: 'approved', continueRequested: true })
      }
    ])
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
      summary: 'Read 1 section, searching sources',
      failedCount: 0,
      citations: [{ citationId, title: 'Source paper.pdf', page: 2 }]
    })
  })

  it('names the live activity and its individual steps without exposing raw tool names', () => {
    const timeline = projectAgentTimeline([
      toolCallRecord(1, 'read', 'read_section'),
      toolResultRecord(2, 'read', 'read_section'),
      assistantRecord(3, 'The section establishes the baseline. I will now check the sources.'),
      toolCallRecord(4, 'search', 'search_knowledge')
    ])
    const activities = timeline.filter((item) => item.type === 'activity')

    expect(currentAgentActivitySummary(timeline, base.agentRunId)).toBe('Searching sources')
    expect(activities).toHaveLength(2)
    const read = activities[0]?.tools[0]
    const search = activities[1]?.tools[0]
    if (read === undefined || search === undefined) throw new Error('Expected activity steps')
    expect(agentToolActivityLabel(read)).toBe('Read a section')
    expect(agentToolActivityLabel(search)).toBe('Searching sources')
  })

  it('projects ask_user as a dedicated question record and hides its duplicate answer event', () => {
    const timeline = projectAgentTimeline([
      toolCallRecord(1, 'tool-question', 'ask_user', {
        questions: [
          {
            id: 'scope',
            header: 'Scope',
            question: 'Which scope should be used?',
            options: [
              { label: 'Section (Recommended)', description: 'Limit the revision.' },
              { label: 'Document', description: 'Revise the full manuscript.' }
            ]
          }
        ]
      }),
      record(2, 'user_message', {
        content: 'Trusted clarification decision',
        delivery: 'clarification',
        timestamp: 2,
        presentation: { kind: 'clarification_answer', toolCallId: 'tool-question' }
      }),
      toolResultRecord(3, 'tool-question', 'ask_user', {
        result: {
          answers: [{ questionId: 'scope', kind: 'option', value: 'Section (Recommended)' }]
        }
      })
    ])

    expect(timeline).toHaveLength(1)
    expect(timeline[0]).toMatchObject({
      type: 'question',
      tool: {
        call: { toolName: 'ask_user' },
        result: {
          result: {
            answers: [{ questionId: 'scope', kind: 'option', value: 'Section (Recommended)' }]
          }
        }
      }
    })
  })

  it('keeps an unanswered clarification as stopped, non-actionable history after interruption', () => {
    const timeline = projectAgentTimeline([
      toolCallRecord(1, 'tool-question', 'ask_user', {
        questions: [
          {
            id: 'scope',
            header: 'Scope',
            question: 'Which scope should be used?',
            options: [
              { label: 'Section (Recommended)', description: 'Limit the revision.' },
              { label: 'Document', description: 'Revise the full manuscript.' }
            ]
          }
        ]
      }),
      record(2, 'run_interrupted', { status: 'interrupted', code: 'process_restarted' })
    ])

    expect(timeline[0]).toMatchObject({
      type: 'question',
      tool: { result: null, stopped: true }
    })
    expect(timeline.some((item) => item.type === 'user')).toBe(false)
  })

  it('names visible Writing Skill entrypoint and reference activity from safe projections', () => {
    const timeline = projectAgentTimeline([
      toolCallRecord(1, 'skill-entry', 'read_writing_skill', {
        uri: `writellm://skills/nature-writing/${'a'.repeat(40)}/SKILL.md`
      }),
      toolResultRecord(2, 'skill-entry', 'read_writing_skill', {
        result: {
          skillId: 'nature-writing',
          displayName: 'Nature Writing',
          relativePath: 'SKILL.md'
        }
      }),
      toolCallRecord(3, 'skill-ref', 'read_writing_skill', {
        uri: `writellm://skills/nature-writing/${'a'.repeat(40)}/references/method.md`
      }),
      toolResultRecord(4, 'skill-ref', 'read_writing_skill', {
        result: {
          skillId: 'nature-writing',
          displayName: 'Nature Writing',
          relativePath: 'references/method.md'
        }
      })
    ])
    const activity = timeline[0]
    expect(activity).toMatchObject({
      type: 'activity',
      summary: 'Loaded Nature Writing · 1 reference file'
    })
    if (activity?.type !== 'activity') throw new Error('Expected Writing Skill activity')
    expect(activity.tools.map(agentToolActivityLabel)).toEqual([
      'Loaded Nature Writing · SKILL.md',
      'Read Nature Writing · references/method.md'
    ])
  })

  it('shows the safe Writing Skill display name while an Auto entrypoint is loading', () => {
    const timeline = projectAgentTimeline([
      toolCallRecord(1, 'skill-entry', 'read_writing_skill', {
        uri: `writellm://skills/github%3Aopaque/${'a'.repeat(40)}/SKILL.md`,
        displayName: 'Nature Writing'
      })
    ])
    const activity = timeline[0]
    expect(activity).toMatchObject({ type: 'activity', summary: 'Loading Nature Writing' })
    if (activity?.type !== 'activity') throw new Error('Expected Writing Skill activity')
    expect(agentToolActivityLabel(activity.tools[0] as AgentToolActivity)).toBe(
      'Loading Nature Writing'
    )
  })

  it('distinguishes a partial failure from a wholly failed activity group', () => {
    const events = [
      assistantRecord(1, 'I will inspect the draft.'),
      toolCallRecord(2, 'read-one', 'read_section'),
      toolCallRecord(3, 'proposal', 'submit_section_change'),
      toolResultRecord(4, 'proposal', 'submit_section_change'),
      toolCallRecord(5, 'read-two', 'read_section'),
      toolCallRecord(6, 'search', 'search_knowledge'),
      toolResultRecord(7, 'read-two', 'read_section'),
      toolResultRecord(8, 'search', 'search_knowledge', {
        isError: true,
        error: { code: 'search_failed', message: 'Search failed safely.' },
        result: null
      }),
      assistantRecord(9, 'I need another approach.')
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
    expect(timeline[3]).toMatchObject({
      type: 'activity',
      status: 'partial',
      failedCount: 1
    })

    const failed = projectAgentTimeline([
      toolCallRecord(1, 'read-one', 'read_section'),
      toolCallRecord(2, 'read-two', 'read_section'),
      toolResultRecord(3, 'read-one', 'read_section', {
        isError: true,
        error: { code: 'not_found', message: 'Section was not found.' },
        result: null
      }),
      toolResultRecord(4, 'read-two', 'read_section', {
        isError: true,
        error: { code: 'not_found', message: 'Section was not found.' },
        result: null
      })
    ])
    expect(failed[0]).toMatchObject({
      type: 'activity',
      status: 'error',
      failedCount: 2
    })
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

  it('derives an exact task change set across refreshes, plan steps, and concurrent tasks', () => {
    const taskId = '019c6a5c-8d34-7a8e-a602-3d37a52dc440'
    const stepId = '019c6a5c-8d34-7a8e-a602-3d37a52dc441'
    const original = {
      ...proposalRecord('019c6a5c-8d34-7a8e-a602-3d37a52dc442', null, 'superseded'),
      writingTaskId: taskId,
      writingTaskStepId: stepId
    }
    const refreshed = {
      ...proposalRecord('019c6a5c-8d34-7a8e-a602-3d37a52dc443', original.proposalId, 'pending'),
      writingTaskId: taskId,
      writingTaskStepId: stepId,
      createdAt: '2026-07-21T00:00:01.000Z'
    }
    const unrelated = {
      ...proposalRecord('019c6a5c-8d34-7a8e-a602-3d37a52dc444', null, 'applied'),
      writingTaskId: '019c6a5c-8d34-7a8e-a602-3d37a52dc445'
    }
    if (refreshed.payload.kind !== 'section_patch') throw new Error('Expected section proposal')
    const sectionId = refreshed.payload.mutation.sectionId
    const changeSet = buildWritingTaskChangeSet({
      taskId,
      proposals: [unrelated, refreshed, original],
      currentRevisionIds: {
        [sectionId]: '019c6a5c-8d34-7a8e-a602-3d37a52dc499'
      },
      sectionTitles: { [sectionId]: 'Introduction' },
      stepTitles: { [stepId]: 'Revise the introduction' }
    })

    expect(changeSet).toMatchObject({
      proposalCount: 2,
      staleCount: 1,
      statusCounts: { pending: 1, superseded: 1 },
      groups: [
        {
          label: 'Introduction',
          entries: [
            {
              proposal: { proposalId: original.proposalId },
              stale: false,
              reviewProposalId: refreshed.proposalId,
              stepTitle: 'Revise the introduction'
            },
            {
              proposal: { proposalId: refreshed.proposalId },
              stale: true,
              reviewProposalId: refreshed.proposalId,
              stepTitle: 'Revise the introduction'
            }
          ]
        }
      ]
    })
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
      interactionMode: 'write',
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
      skillRouteUsage: null,
      errorCode: 'user_stopped',
      writingTaskId: null,
      writingTaskStepId: null,
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

  it('projects started, checkpoint detail, and failed compaction markers without inventing a run', () => {
    const compactionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc499'
    const timeline = projectAgentTimeline([
      {
        ...record(1, 'compaction_started', {
          schemaVersion: 2,
          compactionId,
          trigger: 'manual',
          phase: 'planning',
          timestamp: 1
        }),
        agentRunId: null,
        modelRequestId: null
      },
      {
        ...record(2, 'compaction_summary', {
          schemaVersion: 3,
          handoffMode: 'bounded_conversation_memory',
          compactionId,
          trigger: 'manual',
          stepIndex: 1,
          finalStep: true,
          previousCheckpointEventId: null,
          coveredFromSequence: 1,
          coveredThroughSequence: 10,
          summary: 'Objective\nPreserve the thesis.',
          proposalOutcomes: [],
          approvalDecisions: [],
          citationIds: [],
          toolOutcomes: [],
          estimatedTokensBefore: 12_000,
          estimatedTokensAfter: 4_000,
          checkpointTokens: 2_000,
          tailTokens: 2_000,
          postCompactionBudgetTokens: 32_000,
          checkpointBudgetTokens: 12_000,
          recentTailBudgetTokens: 20_000,
          timestamp: 2
        }),
        agentRunId: null
      },
      {
        ...record(3, 'compaction_failed', {
          schemaVersion: 2,
          compactionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc500',
          trigger: 'auto_threshold',
          code: 'compaction_failed',
          retryable: true,
          aborted: false,
          timestamp: 3
        }),
        agentRunId: null,
        modelRequestId: null
      }
    ])

    expect(timeline.map((item) => item.type)).toEqual([
      'compaction_started',
      'compaction_summary',
      'compaction_failed'
    ])
    expect(timeline[1]).toMatchObject({
      type: 'compaction_summary',
      payload: {
        trigger: 'manual',
        coveredFromSequence: 1,
        coveredThroughSequence: 10,
        estimatedTokensBefore: 12_000,
        estimatedTokensAfter: 4_000
      }
    })
  })

  it('hides a compaction failure after a later successful checkpoint recovers the conversation', () => {
    const failedCompactionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc500'
    const successfulCompactionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc501'
    const timeline = projectAgentTimeline([
      {
        ...record(1, 'compaction_failed', {
          schemaVersion: 2,
          compactionId: failedCompactionId,
          trigger: 'auto_threshold',
          code: 'compaction_failed',
          retryable: true,
          aborted: false,
          timestamp: 1
        }),
        agentRunId: null,
        modelRequestId: null
      },
      {
        ...record(2, 'compaction_summary', {
          schemaVersion: 3,
          handoffMode: 'bounded_conversation_memory',
          compactionId: successfulCompactionId,
          trigger: 'auto_threshold',
          stepIndex: 1,
          finalStep: true,
          previousCheckpointEventId: null,
          coveredFromSequence: 1,
          coveredThroughSequence: 10,
          summary: 'Recovered checkpoint.',
          proposalOutcomes: [],
          approvalDecisions: [],
          citationIds: [],
          toolOutcomes: [],
          estimatedTokensBefore: 100,
          estimatedTokensAfter: 20,
          checkpointTokens: 10,
          tailTokens: 10,
          postCompactionBudgetTokens: 32_000,
          checkpointBudgetTokens: 12_000,
          recentTailBudgetTokens: 20_000,
          timestamp: 2
        }),
        agentRunId: null,
        modelRequestId: null
      }
    ])

    expect(timeline.map((item) => item.type)).toEqual(['compaction_summary'])
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
    expect(agentTerminalLabel('skill_mention_ambiguous')).toBe('Writing skill name is ambiguous')
    expect(agentTerminalLabel('skill_mention_unavailable')).toBe(
      'Requested writing skill is unavailable'
    )
    expect(agentTerminalLabel('skill_mention_limit')).toBe('Too many writing skills were requested')
    expect(agentTerminalLabel('skill_request_unfulfilled')).toBe(
      'Requested writing skill was not loaded'
    )
    expect(agentTerminalLabel('compaction_failed')).toBe('Session compaction failed')
    expect(agentTerminalLabel('compaction_required')).toBe(
      'Conversation could not be compacted safely'
    )
    expect(agentTerminalLabel('compaction_run_too_large')).toBe(
      'A conversation run is too large to summarize safely'
    )
    expect(agentTerminalLabel('continuation_lost')).toBe(
      'Tool continuation could not be resumed safely'
    )
    expect(agentTerminalLabel('model_request_start_failed')).toBe(
      'Model request could not be started'
    )
    expect(agentTerminalLabel('agent_context_failed')).toBe('Agent context could not be built')
    expect(agentTerminalLabel('current_turn_too_large')).toBe(
      'The request is too large for this model context'
    )
    expect(agentTerminalLabel('context_overflow')).toBe('The model context limit was exceeded')
    expect(agentTerminalLabel('context_overflow_after_activity')).toBe(
      'The model context limit was exceeded after work began'
    )
    expect(agentTerminalLabel('tool_batch_context_exhausted')).toBe(
      'Reading context was too large to continue safely'
    )
    expect(agentTerminalLabel('run_failed')).toBe('Run failed')
    expect(agentTerminalLabel('run_interrupted')).toBe('Run interrupted')
    expect(agentTerminalLabel('unknown_code')).toBe('Run interrupted')
    expect(agentTerminalDetail('tool_batch_context_exhausted')).toBe(
      'WriteLLM retried with a smaller read once. Earlier confirmed changes remain; the remaining content was not force-edited. Continue with one section or a smaller range.'
    )
    expect(agentTerminalDetail('compaction_required')).toBe(
      'WriteLLM stopped before dropping an earlier user requirement. Retry Compact, choose a larger-context model, or continue in a new conversation with the requirements you still need.'
    )
    expect(agentTerminalDetail('compaction_run_too_large')).toBe(
      'One complete run exceeds the safe summary limit. Original history was preserved; start a new conversation and carry forward the requirements you still need.'
    )
    expect(agentTerminalDetail('continuation_lost')).toBe(
      'WriteLLM stopped instead of marking an authorized but unconsumed model request complete.'
    )
    expect(agentTerminalDetail('context_overflow')).toBeNull()
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

function toolCallRecord(
  sequence: number,
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown> = {}
): AgentEventRecord {
  return record(sequence, 'tool_call', { toolCallId, toolName, args, timestamp: sequence })
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
    writingTaskId: null,
    writingTaskStepId: null,
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
    interactionMode: 'write',
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
    skillRouteUsage: null,
    errorCode: null,
    writingTaskId: null,
    writingTaskStepId: null,
    startedAt: base.createdAt,
    completedAt: null,
    updatedAt: base.createdAt
  }
}

function legacySkillSnapshot(): AgentRunRecord['skillSnapshot'] {
  return {
    schemaVersion: 3,
    mode: 'none',
    routingStatus: 'legacy',
    requestedSkills: [],
    skills: [],
    dependencies: [],
    resources: [],
    safeError: null
  }
}
