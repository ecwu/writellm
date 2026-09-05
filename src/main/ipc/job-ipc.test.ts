import type { IpcMainInvokeEvent } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../../shared/contracts/channels'
import type { JobRecord } from '../jobs/job-store'
import Database from 'better-sqlite3'
import type { ProjectDatabase } from '../project/project-database'
import { registerJobIpc, toJobStatus, type JobIpcMain } from './job-ipc'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const job: JobRecord = {
  jobId: 'job-1',
  type: 'mineru_parse',
  payload: { parseTaskId: 'private-parse-task' },
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
      return {
        jobs,
        runtime,
        database: {
          immediate: (operation: (db: unknown) => unknown) =>
            operation({ prepare: () => ({ pluck: () => ({ get: () => undefined }) }) })
        }
      }
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

  it('ignores stale unsubscriptions and revokes even after the active project changed', () => {
    const { invoke, registration, unsubscribe, manager } = harness()
    invoke(IPC_CHANNELS.jobsSubscribeStatus, { projectSessionId })
    invoke(IPC_CHANNELS.jobsUnsubscribeStatus, {
      projectSessionId: '33333333-3333-4333-8333-333333333333'
    })
    expect(unsubscribe).not.toHaveBeenCalled()
    manager.snapshot.mockReturnValue({ state: 'closed', activeProject: null } as never)
    registration.revokeSession(projectSessionId)
    expect(unsubscribe).toHaveBeenCalledOnce()
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

describe('job subjects', () => {
  it('resolves parse and normalization ownership without exposing payloads or paths', () => {
    const connection = new Database(':memory:')
    const database = {
      immediate: (operation: (db: Database.Database) => unknown) => operation(connection)
    } as ProjectDatabase
    const knowledgeItemId = '22222222-2222-4222-8222-222222222222'
    try {
      connection.exec(
        'CREATE TABLE parse_tasks (parse_task_id TEXT, knowledge_item_id TEXT); CREATE TABLE parse_revisions (parse_revision_id TEXT, knowledge_item_id TEXT)'
      )
      connection.prepare('INSERT INTO parse_tasks VALUES (?, ?)').run('parse', knowledgeItemId)
      connection
        .prepare('INSERT INTO parse_revisions VALUES (?, ?)')
        .run('revision', knowledgeItemId)
      for (const [type, payload] of [
        ['mineru_parse', { parseTaskId: 'parse' }],
        ['normalize_parse_revision', { parseRevisionId: 'revision' }],
        [
          'build_embedding_generation',
          { generationId: 'generation', refreshScope: 'item', knowledgeItemId }
        ],
        ['remove_index_item', { knowledgeItemId }]
      ] as const) {
        expect(toJobStatus({ ...job, type, payload }, database).subject).toEqual({
          kind: 'file',
          knowledgeItemId
        })
      }
      expect(toJobStatus(job, database).subject).toEqual({ kind: 'unknown' })
      expect(
        toJobStatus(
          { ...job, type: 'build_index_generation', payload: { generationId: 'generation' } },
          database
        ).subject
      ).toEqual({ kind: 'project' })
      expect(
        toJobStatus(
          { ...job, type: 'build_embedding_generation', payload: { generationId: 'generation' } },
          database
        ).subject
      ).toEqual({ kind: 'project' })
      expect(
        toJobStatus(
          { ...job, type: 'artifact_cleanup', payload: { cleanupId: 'cleanup' } },
          database
        ).subject
      ).toEqual({ kind: 'maintenance' })
    } finally {
      connection.close()
    }
  })
})
