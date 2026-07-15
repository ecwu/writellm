import { describe, expect, it, vi } from 'vitest'
import { WorkerSupervisor } from './worker-supervisor'

describe('WorkerSupervisor', () => {
  it('rejects stale sessions, unknown jobs, and all messages after stop', () => {
    const warn = vi.fn()
    const supervisor = new WorkerSupervisor({
      projectSessionId: 'session-current',
      log: { warn, error: vi.fn() }
    })
    const executionId = supervisor.track('job-current')
    const commit = vi.fn(() => 'committed')

    expect(
      supervisor.accept(
        { projectSessionId: 'session-old', jobId: 'job-current', executionId },
        commit
      )
    ).toBe(undefined)
    expect(
      supervisor.accept(
        { projectSessionId: 'session-current', jobId: 'job-old', executionId },
        commit
      )
    ).toBe(undefined)
    expect(
      supervisor.accept(
        { projectSessionId: 'session-current', jobId: 'job-current', executionId },
        commit
      )
    ).toBe('committed')
    supervisor.stop()
    expect(
      supervisor.accept(
        { projectSessionId: 'session-current', jobId: 'job-current', executionId },
        commit
      )
    ).toBe(undefined)
    expect(commit).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledTimes(3)
  })

  it('does not let an old execution release or commit through a newer claim for the same job', () => {
    const supervisor = new WorkerSupervisor({
      projectSessionId: 'session-current',
      log: { warn: vi.fn(), error: vi.fn() }
    })
    const oldExecution = supervisor.track('job-current')
    const newExecution = supervisor.track('job-current')
    const oldCommit = vi.fn()
    const newCommit = vi.fn(() => 'new-result')

    supervisor.release('job-current', oldExecution)
    expect(supervisor.commit('job-current', oldExecution, oldCommit)).toBeUndefined()
    expect(supervisor.commit('job-current', newExecution, newCommit)).toBe('new-result')
    expect(oldCommit).not.toHaveBeenCalled()
    expect(newCommit).toHaveBeenCalledOnce()
  })
})
