import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { JobRecord } from '../jobs/job-store'
import { registerJobIpc, type JobIpcMain } from './job-ipc'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const job: JobRecord = {
  jobId: 'job-1',
  type: 'mineru.submit',
  payload: { knowledgeItemId: 'private-item', relativePath: 'knowledge/private.pdf' },
  state: 'running',
  priority: 5,
  attempts: 1,
  maxAttempts: 3,
  runAfter: '2026-07-15T00:00:00.000Z',
  leaseOwner: 'private-worker',
  lockedUntil: '2026-07-15T00:01:00.000Z',
  heartbeatAt: '2026-07-15T00:00:10.000Z',
  progress: { completed: 1, total: 2, stage: 'submit' },
  deduplicationKey: 'private-dedupe',
  cancellationRequested: false,
  error: null,
  createdAt: '2026-07-15T00:00:00.000Z',
  updatedAt: '2026-07-15T00:00:10.000Z',
  startedAt: '2026-07-15T00:00:00.000Z',
  completedAt: null,
  resumeSameAttempt: false
}

function harness() {
  const handlers = new Map<string, (...args: never[]) => unknown>()
  const ipc: JobIpcMain = {
    handle: vi.fn((channel, handler) => handlers.set(channel, handler as never)),
    removeHandler: vi.fn()
  }
  let listener: ((value: JobRecord) => void) | undefined
  const unsubscribe = vi.fn()
  const jobs = {
    list: vi.fn(() => [job]),
    require: vi.fn(() => job),
    requestCancellation: vi.fn(() => ({ ...job, cancellationRequested: true })),
    subscribe: vi.fn((value: (record: JobRecord) => void) => {
      listener = value
      return unsubscribe
    })
  }
  const runtime = { scheduler: { cancel: vi.fn() } }
  const manager = {
    snapshot: vi.fn(() => ({
      state: 'open',
      activeProject: {
        projectId: '22222222-2222-4222-8222-222222222222',
        projectSessionId,
        displayName: 'Project',
        indexRebuildRequired: false
      }
    })),
    assertActiveSession: vi.fn((value: string) => {
      if (value !== projectSessionId) throw new Error('stale')
      return { jobs, runtime }
    })
  }
  const registration = registerJobIpc({
    manager: manager as never,
    logger: { error: vi.fn() },
    developmentUrl: 'http://localhost:5173',
    ipc
  })
  const sender = { id: 3, send: vi.fn() }
  const event = {
    sender,
    senderFrame: { url: 'http://localhost:5173/' }
  } as unknown as IpcMainInvokeEvent
  const invoke = (channel: string, input?: unknown) =>
    handlers.get(channel)?.(event as never, input as never)
  return {
    invoke,
    handlers,
    jobs,
    runtime,
    manager,
    registration,
    listener: () => listener,
    sender,
    unsubscribe
  }
}

describe('job IPC', () => {
  it('authorizes requests and returns renderer-safe bounded DTOs', () => {
    const { invoke, handlers } = harness()
    const result = invoke(IPC_CHANNELS.jobsList, { projectSessionId, limit: 50 }) as {
      jobs: Array<Record<string, unknown>>
    }
    expect(result.jobs[0]).not.toHaveProperty('payload')
    expect(result.jobs[0]).not.toHaveProperty('leaseOwner')
    expect(result.jobs[0]).not.toHaveProperty('lockedUntil')
    expect(result.jobs[0]).not.toHaveProperty('deduplicationKey')

    const unauthorized = {
      sender: { id: 4 },
      senderFrame: { url: 'https://attacker.invalid/' }
    } as unknown as IpcMainInvokeEvent
    expect(() =>
      handlers.get(IPC_CHANNELS.jobsList)?.(
        unauthorized as never,
        { projectSessionId, limit: 50 } as never
      )
    ).toThrow('Unauthorized IPC sender')
  })

  it('rejects stale sessions and forwards cancellation to the active scheduler', () => {
    const { invoke, runtime } = harness()
    expect(() =>
      invoke(IPC_CHANNELS.jobsGetStatus, {
        projectSessionId: '33333333-3333-4333-8333-333333333333',
        jobId: job.jobId
      })
    ).toThrow('stale')
    expect(
      invoke(IPC_CHANNELS.jobsRequestCancellation, { projectSessionId, jobId: job.jobId })
    ).toMatchObject({ cancellationRequested: true })
    expect(runtime.scheduler.cancel).toHaveBeenCalledWith(job.jobId)
  })

  it('publishes bounded events and revokes subscriptions by project session', () => {
    const { invoke, registration, listener, sender, unsubscribe } = harness()
    invoke(IPC_CHANNELS.jobsSubscribeStatus, { projectSessionId })
    listener()?.(job)
    expect(sender.send).toHaveBeenCalledWith(
      IPC_CHANNELS.jobsStatusEvent,
      expect.objectContaining({
        projectSessionId,
        job: expect.not.objectContaining({ payload: expect.anything() })
      })
    )
    registration.revokeSession(projectSessionId)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
