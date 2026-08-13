import { describe, expect, it } from 'vitest'
import {
  createWritingTaskArgsSchema,
  updateWritingTaskArgsSchema,
  writingTaskPlanSchema
} from './writing-task'

const id = (suffix: number): string => `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`

describe('writing task contracts', () => {
  it('accepts one active bounded plan and rejects ambiguous progress', () => {
    expect(
      writingTaskPlanSchema.parse({
        schemaVersion: 1,
        steps: [
          { stepId: id(1), title: 'Draft', status: 'active', statusReason: null },
          { stepId: id(2), title: 'Review', status: 'pending', statusReason: null }
        ]
      }).steps
    ).toHaveLength(2)
    expect(() =>
      writingTaskPlanSchema.parse({
        schemaVersion: 1,
        steps: [
          { stepId: id(1), title: 'Draft', status: 'pending', statusReason: null },
          { stepId: id(2), title: 'Review', status: 'pending', statusReason: null }
        ]
      })
    ).toThrow(/active step/u)
  })

  it('requires explicit client references and bounded typed updates', () => {
    expect(
      createWritingTaskArgsSchema.parse({
        objective: 'Revise the manuscript.',
        steps: [{ clientRef: id(3), title: 'Inspect the outline' }]
      }).objective
    ).toBe('Revise the manuscript.')
    expect(() =>
      updateWritingTaskArgsSchema.parse({
        taskId: id(4),
        expectedPlanVersion: 1,
        objective: 'Revise the manuscript.',
        steps: [{ stepId: id(1), title: 'Blocked', status: 'blocked', statusReason: null }]
      })
    ).not.toThrow()
  })
})
