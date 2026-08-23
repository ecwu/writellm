import { describe, expect, it, vi } from 'vitest'
import {
  ProjectInteractiveModelCapacityError,
  ProjectInteractiveModelLimiter
} from './project-interactive-model-limiter'

describe('ProjectInteractiveModelLimiter', () => {
  it('shares three project slots across Agent runs, compaction, and Notebook turns', () => {
    const log = { info: vi.fn(), warn: vi.fn() }
    const limiter = new ProjectInteractiveModelLimiter('project-1', log)

    limiter.acquire({ workId: 'agent-1', ownerId: 'conversation-1', kind: 'agent_run' })
    limiter.acquire({ workId: 'agent-2', ownerId: 'conversation-2', kind: 'agent_compaction' })
    limiter.acquire({ workId: 'notebook-1', ownerId: 'notebook', kind: 'notebook_turn' })

    expect(limiter.activeCount()).toBe(3)
    expect(() =>
      limiter.acquire({ workId: 'agent-3', ownerId: 'conversation-3', kind: 'agent_run' })
    ).toThrow(ProjectInteractiveModelCapacityError)

    limiter.release('agent-2')
    limiter.acquire({ workId: 'agent-3', ownerId: 'conversation-3', kind: 'agent_run' })
    expect(limiter.activeCount()).toBe(3)
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ activeCount: 3, concurrencyLimit: 3 }),
      expect.any(String)
    )
  })

  it('does not reserve an already-aborted request', () => {
    const limiter = new ProjectInteractiveModelLimiter('project-1', {
      info: vi.fn(),
      warn: vi.fn()
    })
    const controller = new AbortController()
    controller.abort()

    expect(() =>
      limiter.acquire({
        workId: 'notebook-1',
        ownerId: 'notebook',
        kind: 'notebook_turn',
        signal: controller.signal
      })
    ).toThrow()
    expect(limiter.activeCount()).toBe(0)
  })
})
