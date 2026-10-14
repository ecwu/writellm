import { describe, expect, it } from 'vitest'
import { AgentRunCoordinator, type StartingRun } from './session-run-coordinator'

function starting(controller: AbortController): StartingRun {
  return {
    agentSessionId: 'conversation',
    agentRunId: 'run',
    startedAt: '2026-10-14T00:00:00.000Z',
    controller,
    completion: Promise.resolve({ agentRunId: 'run', completion: Promise.resolve() })
  }
}

describe('Agent work ownership', () => {
  it('keeps a replacement work owner when an older completion releases its slot', () => {
    const coordinator = new AgentRunCoordinator()
    const controller = new AbortController()
    coordinator.reserve('conversation', 'old', controller.signal)
    expect(coordinator.release('conversation', 'old')).toBe(true)
    coordinator.reserve('conversation', 'new', controller.signal)
    expect(coordinator.release('conversation', 'old')).toBe(false)
    expect(coordinator.isBusy('conversation')).toBe(true)
    expect(coordinator.activeCount).toBe(1)
    expect(coordinator.release('conversation', 'new')).toBe(true)
    expect(coordinator.activeCount).toBe(0)
  })

  it('rejects overlap and cancellation before registering work', () => {
    const coordinator = new AgentRunCoordinator()
    const controller = new AbortController()
    coordinator.reserve('conversation', 'run', controller.signal)
    expect(() => coordinator.reserve('conversation', 'compaction', controller.signal)).toThrow(
      'Agent work is already active'
    )
    const aborted = new AbortController()
    aborted.abort(new Error('Project is closing'))
    expect(() => coordinator.reserve('another', 'compaction', aborted.signal)).toThrow(
      'Project is closing'
    )
    expect(coordinator.isBusy('another')).toBe(false)
    expect(coordinator.activeCount).toBe(1)
  })

  it('does not let stale preparation cleanup remove a newer registration', () => {
    const coordinator = new AgentRunCoordinator()
    const old = starting(new AbortController())
    const next = starting(new AbortController())
    coordinator.registerStarting(old)
    coordinator.registerStarting(next)
    coordinator.finishStarting(old)
    expect(coordinator.starting.get('run')).toBe(next)
    coordinator.finishStarting(next)
    expect(coordinator.starting.size).toBe(0)
  })
})
