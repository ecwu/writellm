import { describe, expect, it, vi } from 'vitest'
import type { AgentProjectActivitySnapshot } from '../../../../shared/contracts/agent-ipc'
import type { JobStatus } from '../../../../shared/contracts/jobs'
import { indexLabel, taskLabel, workbenchTasks } from './status-model'
import { watchAgentActivity } from './use-workbench-status'

const empty: AgentProjectActivitySnapshot = { activeCount: 0, runs: [], compactions: [] }
const activity: AgentProjectActivitySnapshot = {
  activeCount: 1,
  compactions: [],
  runs: [
    {
      agentSessionId: 'session',
      agentRunId: 'run',
      phase: 'awaiting_input',
      partialText: '',
      pendingMessages: [],
      pendingQuestion: null,
      startedAt: '2026-09-19T00:00:00Z'
    }
  ]
}
describe('workbench status', () => {
  it('distinguishes index loading, readiness and failed observation', () => {
    expect(indexLabel(undefined, [], false)).toBe('Loading')
    expect(indexLabel({ readiness: 'preparing', indexed: false }, [], false)).toBe('Preparing')
    expect(indexLabel({ readiness: 'available', indexed: false }, [], false)).toBe('Not indexed')
    expect(indexLabel({ readiness: 'available', indexed: true }, [], false)).toBe('Ready')
    expect(indexLabel({ readiness: 'unavailable', indexed: true }, [], false)).toBe('Unavailable')
    expect(indexLabel({ readiness: 'available', indexed: true }, [], true)).toBe('Unavailable')
  })
  it('only reports processing for actual active index jobs', () => {
    const index = { readiness: 'available' as const, indexed: true }
    const job = { type: 'build_index_generation', state: 'running' } as JobStatus
    expect(indexLabel(index, [job], false)).toBe('Processing')
    expect(indexLabel(index, [{ ...job, state: 'succeeded' }], false)).toBe('Ready')
    expect(indexLabel(index, [{ ...job, type: 'mineru_parse' }], false)).toBe('Ready')
  })
  it('aggregates background Notebooks and prioritizes input over generation', () => {
    const tabs = [
      { kind: 'notebook' as const, notebookId: 'one', number: 1 },
      { kind: 'notebook' as const, notebookId: 'two', number: 2 }
    ]
    const tasks = workbenchTasks(activity, tabs, {
      one: 'generating',
      two: 'retrieving',
      closed: 'generating'
    })
    expect(tasks).toHaveLength(3)
    expect(taskLabel(tasks, 'ready')).toBe('1 need attention')
    expect(
      taskLabel(
        tasks.map((task) => ({ ...task, attention: false })),
        'ready'
      )
    ).toBe('3 running')
    expect(taskLabel(tasks, 'unavailable')).toBe('Status unavailable')
    expect(taskLabel([], 'loading')).toBe('Loading')
    expect(taskLabel(workbenchTasks(empty, tabs, { one: 'idle', two: 'idle' }), 'ready')).toBe(
      'Idle'
    )
  })
  it('keeps compaction and Notebook failures visible without counting loading as running', () => {
    const tasks = workbenchTasks(
      {
        ...empty,
        activeCount: 1,
        compactions: [
          {
            compactionId: 'c',
            agentSessionId: 's',
            trigger: 'manual',
            phase: 'summarizing',
            startedAt: '2026-09-19T00:00:00Z'
          }
        ]
      },
      [{ kind: 'notebook', notebookId: 'n', number: 1 }],
      { n: 'error' }
    )
    expect(tasks.map((task) => task.status)).toEqual(['Compacting', 'Failed'])
    expect(taskLabel(tasks, 'ready')).toBe('1 need attention')
    expect(
      workbenchTasks(empty, [{ kind: 'notebook', notebookId: 'n', number: 1 }], {})[0].active
    ).toBe(false)
  })
})

describe('project activity lifecycle', () => {
  const fixture = () => {
    const pending =
      Promise.withResolvers<Awaited<ReturnType<typeof window.desktop.agent.subscribeActivity>>>()
    const api = { subscribeActivity: vi.fn(() => pending.promise) }
    const snapshots = vi.fn()
    const states = vi.fn()
    const report = vi.fn()
    const stop = watchAgentActivity(
      'project',
      snapshots,
      states,
      api as unknown as typeof window.desktop.agent,
      report
    )
    const subscription = {
      snapshot: activity,
      activate: vi.fn(async () => {}),
      unsubscribe: vi.fn()
    }
    return { pending, api, snapshots, states, report, stop, subscription }
  }
  it('releases a subscription that resolves after project teardown without activating it', async () => {
    const f = fixture()
    f.stop()
    f.pending.resolve(f.subscription)
    await vi.waitFor(() => expect(f.subscription.unsubscribe).toHaveBeenCalledOnce())
    expect(f.subscription.activate).not.toHaveBeenCalled()
    expect(f.snapshots.mock.calls).toEqual([[null]])
  })
  it('activates the snapshot, ignores deltas and ignores late old-project activity', async () => {
    const f = fixture()
    f.pending.resolve(f.subscription)
    await vi.waitFor(() => expect(f.states).toHaveBeenLastCalledWith('ready'))
    const listener = (
      f.api.subscribeActivity.mock.calls as unknown as Array<[unknown, (event: unknown) => void]>
    )[0][1]
    listener({ kind: 'delta' })
    expect(f.snapshots).toHaveBeenLastCalledWith(activity)
    listener({ kind: 'activity', snapshot: empty })
    expect(f.snapshots).toHaveBeenLastCalledWith(empty)
    f.stop()
    listener({ kind: 'activity', snapshot: activity })
    expect(f.snapshots).toHaveBeenLastCalledWith(empty)
  })
  it('reports the original activation error and marks observation unavailable', async () => {
    const f = fixture()
    const error = new Error('activation failed')
    f.subscription.activate.mockRejectedValue(error)
    f.pending.resolve(f.subscription)
    await vi.waitFor(() => expect(f.states).toHaveBeenLastCalledWith('unavailable'))
    expect(f.report).toHaveBeenCalledWith(error, 'workbench.status.agent.subscribe')
    expect(f.subscription.unsubscribe).toHaveBeenCalledOnce()
    expect(f.snapshots).toHaveBeenLastCalledWith(null)
    f.stop()
  })
})
