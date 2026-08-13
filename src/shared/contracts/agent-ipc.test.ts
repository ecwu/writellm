import { describe, expect, it } from 'vitest'
import {
  AGENT_LIVE_PARTIAL_MAX_BYTES,
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

  it('bounds project activity snapshots by slots and UTF-8 streaming bytes', () => {
    const run = {
      agentSessionId,
      agentRunId,
      phase: 'running' as const,
      partialText: 'draft',
      startedAt: '2026-08-12T09:00:00.000Z'
    }
    expect(
      agentProjectActivitySnapshotSchema.parse({ limit: 3, activeCount: 1, runs: [run] })
    ).toMatchObject({ limit: 3, activeCount: 1 })
    expect(() =>
      agentProjectActivitySnapshotSchema.parse({
        limit: 3,
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
        limit: 3,
        activeCount: 3,
        runs: [run, run, run, run]
      })
    ).toThrow()
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
      skillSelection: { mode: 'auto' },
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
