import { describe, expect, it } from 'vitest'
import { AGENT_PENDING_MESSAGE_LIMIT, AGENT_PENDING_MESSAGE_MAX_BYTES } from './agent'
import {
  AGENT_LIVE_PARTIAL_MAX_BYTES,
  agentAnswerUserQuestionInputSchema,
  agentEventPageInputSchema,
  agentListSessionsInputSchema,
  agentRendererEventSchema,
  agentProjectActivitySnapshotSchema,
  agentSessionRecordSchema,
  agentSetThinkingLevelInputSchema,
  agentStartRunInputSchema
} from './agent-ipc'

const projectSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
const agentSessionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc423'
const agentRunId = '019c6a5c-8d34-7a8e-a602-3d37a52dc424'
const sectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc425'

describe('Agent IPC contracts', () => {
  it('requires editor context to match the selected start scope', () => {
    const parsed = agentStartRunInputSchema.parse({
      projectSessionId,
      agentSessionId,
      prompt: 'Use this selection.',
      scope: 'selection',
      editorContext: {
        activeSectionId: sectionId,
        activeBlockId: 'block-1',
        selectedBlockIds: ['block-1']
      }
    })
    expect(parsed.scope).toBe('selection')
    expect('skillSelection' in parsed).toBe(false)
    expect(() =>
      agentStartRunInputSchema.parse({
        ...parsed,
        skillSelection: { mode: 'explicit', skillId: 'nature-writing' }
      })
    ).toThrow()
    expect(() =>
      agentStartRunInputSchema.parse({
        projectSessionId,
        agentSessionId,
        prompt: 'Use the project.',
        scope: 'project',
        editorContext: {
          activeSectionId: sectionId,
          activeBlockId: null,
          selectedBlockIds: []
        }
      })
    ).toThrow('Project scope')
    expect(() =>
      agentStartRunInputSchema.parse({
        projectSessionId,
        agentSessionId,
        prompt: 'Use this selection.',
        scope: 'selection',
        editorContext: {
          activeSectionId: sectionId,
          activeBlockId: null,
          selectedBlockIds: []
        }
      })
    ).toThrow('selected blocks')
  })

  it('allows exactly one proposal continuation source', () => {
    const base = {
      projectSessionId,
      agentSessionId,
      prompt: 'Continue the task.',
      scope: 'section' as const,
      editorContext: {
        activeSectionId: sectionId,
        activeBlockId: null,
        selectedBlockIds: []
      }
    }
    expect(
      agentStartRunInputSchema.parse({ ...base, rejectedProposalId: agentRunId }).rejectedProposalId
    ).toBe(agentRunId)
    expect(() =>
      agentStartRunInputSchema.parse({
        ...base,
        approvedProposalId: agentRunId,
        rejectedProposalId: agentRunId
      })
    ).toThrow('mutually exclusive')
  })

  it('requires an exact selection and no Renderer prompt for quick actions', () => {
    const input = {
      projectSessionId,
      agentSessionId,
      quickAction: { action: 'rewrite' as const },
      scope: 'selection' as const,
      editorContext: {
        activeSectionId: sectionId,
        activeBlockId: 'block-1',
        selectedBlockIds: ['block-1'],
        selectedText: 'Exact selected text.',
        capturedAt: 1,
        capturedRevisionId: agentRunId
      }
    }
    expect(agentStartRunInputSchema.parse(input).quickAction).toEqual({ action: 'rewrite' })
    expect(() =>
      agentStartRunInputSchema.parse({ ...input, prompt: 'Renderer-authored rewrite prompt' })
    ).toThrow('Exactly one')
    expect(() =>
      agentStartRunInputSchema.parse({
        ...input,
        editorContext: { ...input.editorContext, selectedText: null }
      })
    ).toThrow('exact selected text')
    expect(() => agentStartRunInputSchema.parse({ ...input, scope: 'section' })).toThrow(
      'selection scope'
    )
  })

  it('bounds replay pages and renderer deltas', () => {
    expect(() =>
      agentEventPageInputSchema.parse({
        projectSessionId,
        agentSessionId,
        afterSequence: 0,
        limit: 201
      })
    ).toThrow()
    expect(() =>
      agentRendererEventSchema.parse({
        kind: 'delta',
        projectSessionId,
        agentSessionId,
        agentRunId,
        delta: 'x'.repeat(65_537)
      })
    ).toThrow()
  })

  it('preserves per-session identity and UTF-8 streaming bytes without project slots', () => {
    const run = {
      agentSessionId,
      agentRunId,
      phase: 'running' as const,
      partialText: 'draft',
      startedAt: '2026-08-12T09:00:00.000Z'
    }
    expect(agentProjectActivitySnapshotSchema.parse({ activeCount: 1, runs: [run] })).toMatchObject(
      { activeCount: 1 }
    )
    expect(() =>
      agentProjectActivitySnapshotSchema.parse({
        activeCount: 1,
        runs: [
          {
            ...run,
            partialText: 'é'.repeat(Math.floor(AGENT_LIVE_PARTIAL_MAX_BYTES / 2) + 1)
          }
        ]
      })
    ).toThrow('Live Agent output is too large')
    expect(() =>
      agentProjectActivitySnapshotSchema.parse({
        activeCount: 3,
        runs: [run, run, run, run]
      })
    ).toThrow()
  })

  it('bounds and uniquely identifies pending Follow-ups in live activity', () => {
    const pendingMessage = {
      pendingMessageId: '019c6a5c-8d34-7a8e-a602-3d37a52dc430',
      content: 'Wait for the current turn.',
      queuedAt: '2026-08-13T20:00:00.000Z'
    }
    const run = {
      agentSessionId,
      agentRunId,
      phase: 'running' as const,
      partialText: '',
      startedAt: '2026-08-13T19:00:00.000Z'
    }
    expect(
      agentProjectActivitySnapshotSchema.parse({
        activeCount: 1,
        runs: [{ ...run, pendingMessages: [pendingMessage] }]
      }).runs[0]?.pendingMessages
    ).toEqual([pendingMessage])
    expect(() =>
      agentProjectActivitySnapshotSchema.parse({
        activeCount: 1,
        runs: [
          {
            ...run,
            pendingMessages: Array.from(
              { length: AGENT_PENDING_MESSAGE_LIMIT + 1 },
              () => pendingMessage
            )
          }
        ]
      })
    ).toThrow()
    expect(() =>
      agentProjectActivitySnapshotSchema.parse({
        activeCount: 1,
        runs: [{ ...run, pendingMessages: [pendingMessage, pendingMessage] }]
      })
    ).toThrow('Pending Agent message IDs must be unique')
    expect(() =>
      agentProjectActivitySnapshotSchema.parse({
        activeCount: 1,
        runs: [
          {
            ...run,
            pendingMessages: [
              pendingMessage,
              {
                ...pendingMessage,
                pendingMessageId: '019c6a5c-8d34-7a8e-a602-3d37a52dc431',
                content: '界'.repeat(Math.floor(AGENT_PENDING_MESSAGE_MAX_BYTES / 3) + 1)
              }
            ]
          }
        ]
      })
    ).toThrow('Pending Agent messages exceed 1 MiB')
  })

  it('carries one bounded pending clarification and requires the complete capability to answer', () => {
    const pendingQuestion = {
      toolCallId: 'tool-question-1',
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
      ],
      submitting: false,
      startedAt: '2026-08-24T10:00:00.000Z'
    }
    const snapshot = agentProjectActivitySnapshotSchema.parse({
      activeCount: 1,
      runs: [
        {
          agentSessionId,
          agentRunId,
          phase: 'awaiting_input',
          partialText: '',
          pendingQuestion,
          startedAt: '2026-08-24T09:59:00.000Z'
        }
      ]
    })
    expect(snapshot.runs[0]?.pendingQuestion).toEqual(pendingQuestion)
    expect(() =>
      agentProjectActivitySnapshotSchema.parse({
        activeCount: 1,
        runs: [
          {
            agentSessionId,
            agentRunId,
            phase: 'awaiting_input',
            partialText: '',
            startedAt: '2026-08-24T09:59:00.000Z'
          }
        ]
      })
    ).toThrow('exactly one pending question')
    expect(
      agentAnswerUserQuestionInputSchema.parse({
        projectSessionId,
        agentSessionId,
        agentRunId,
        toolCallId: pendingQuestion.toolCallId,
        answers: [{ questionId: 'scope', kind: 'option', value: 'Section (Recommended)' }]
      })
    ).toMatchObject({ projectSessionId, agentSessionId, agentRunId })
    expect(
      agentAnswerUserQuestionInputSchema.safeParse({
        agentSessionId,
        agentRunId,
        toolCallId: pendingQuestion.toolCallId,
        answers: [{ questionId: 'scope', kind: 'custom', value: '' }]
      }).success
    ).toBe(false)
  })

  it('accepts only the bounded conversation Thinking levels', () => {
    expect(
      agentSetThinkingLevelInputSchema.parse({
        projectSessionId,
        agentSessionId,
        level: 'xhigh'
      }).level
    ).toBe('xhigh')
    expect(() =>
      agentSetThinkingLevelInputSchema.parse({
        projectSessionId,
        agentSessionId,
        level: 'extreme'
      })
    ).toThrow()
  })

  it('defaults session queries to active and projects archived timestamps and title state', () => {
    expect(agentListSessionsInputSchema.parse({ projectSessionId }).status).toBe('active')
    expect(() =>
      agentListSessionsInputSchema.parse({ projectSessionId, status: 'deleted' })
    ).toThrow()
    const session = agentSessionRecordSchema.parse({
      agentSessionId,
      title: 'Archived title',
      status: 'archived',
      compatible: true,
      approvalMode: 'manual',
      workflowState: 'idle',
      modelSelection: null,
      thinkingLevel: 'off',
      createdAt: '2026-08-11T10:00:00.000Z',
      updatedAt: '2026-08-11T11:00:00.000Z',
      archivedAt: '2026-08-11T11:00:00.000Z'
    })
    expect(
      agentRendererEventSchema.parse({
        kind: 'session',
        projectSessionId,
        session,
        titleGenerating: true
      })
    ).toMatchObject({ kind: 'session', session: { archivedAt: session.archivedAt } })
  })
})
