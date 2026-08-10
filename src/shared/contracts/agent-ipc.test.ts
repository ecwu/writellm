import { describe, expect, it } from 'vitest'
import {
  agentEventPageInputSchema,
  agentRendererEventSchema,
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
    expect(parsed.skillSelection).toEqual({ mode: 'auto' })
    expect(
      agentStartRunInputSchema.parse({
        ...parsed,
        skillSelection: { mode: 'explicit', skillId: 'nature-writing' }
      }).skillSelection
    ).toEqual({ mode: 'explicit', skillId: 'nature-writing' })
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
})
