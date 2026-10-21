import { describe, expect, it } from 'vitest'
import {
  isCurrentProjectSessionOperation,
  type ProjectSessionOperation
} from './project-session-generation'

describe('project session operation guard', () => {
  const operation: ProjectSessionOperation = {
    projectSessionId: 'session-a',
    generation: 4
  }

  it('accepts only a mounted operation from the current session generation', () => {
    expect(isCurrentProjectSessionOperation(operation, 'session-a', 4, true)).toBe(true)
    expect(isCurrentProjectSessionOperation(operation, 'session-a', 5, true)).toBe(false)
    expect(isCurrentProjectSessionOperation(operation, 'session-b', 4, true)).toBe(false)
    expect(isCurrentProjectSessionOperation(operation, 'session-a', 4, false)).toBe(false)
  })
})
