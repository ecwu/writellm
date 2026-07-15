import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeProjectDatabase, openProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { JobOwnershipError, JobStore } from './job-store'

const temporaryDirectories: string[] = []
const silentLog = pino({ level: 'silent' })

function manifest(projectId: string): ProjectManifest {
  return {
    format: 'writellm-project',
    formatVersion: 1,
    projectId,
    createdAt: '2026-07-15T00:00:00.000Z'
  }
}

async function createDatabase(projectId = '019c6a5c-8d34-7a8e-a602-3d37a52dc700') {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-jobs-'))
  temporaryDirectories.push(parent)
  const root = join(parent, 'queue.writellm')
  await mkdir(root)
  const projectManifest = manifest(projectId)
  const database = await initializeProjectDatabase({
    projectRoot: root,
    manifest: projectManifest,
    applicationVersion: '1.0.0-test',
    log: silentLog
  })
  return { root, projectManifest, database }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('JobStore', () => {
  it('stores bounded reference payloads and rejects private or heavyweight values', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })

    expect(
      store.enqueue({
        type: 'mineru.submit',
        payload: { knowledgeItemId: 'item-1', relativePath: 'knowledge/originals/file.pdf' }
      }).job.payload
    ).toEqual({ knowledgeItemId: 'item-1', relativePath: 'knowledge/originals/file.pdf' })
    expect(() =>
      store.enqueue({ type: 'unsafe', payload: { absolutePath: '/private/source.pdf' } })
    ).toThrow('forbidden')
    expect(() => store.enqueue({ type: 'unsafe', payload: { credential: 'secret' } })).toThrow(
      'forbidden'
    )
    expect(() => store.enqueue({ type: 'unsafe', payload: { apiKey: 'secret' } })).toThrow(
      'forbidden'
    )
    expect(() =>
      store.enqueue({ type: 'unsafe', payload: { vector: Array.from({ length: 10 }, () => 0.1) } })
    ).toThrow('forbidden')
    expect(() =>
      store.enqueue({ type: 'oversize', payload: { refs: ['x'.repeat(16_384)] } })
    ).toThrow('exceeds')
    database.close()
  })

  it('deduplicates only unfinished work and permits a new job after completion', async () => {
    const { database, projectManifest } = await createDatabase()
    let sequence = 0
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: silentLog,
      createId: () => `job-${++sequence}`,
      now: () => new Date('2026-07-15T01:00:00.000Z')
    })

    const first = store.enqueue({
      type: 'index.build',
      payload: { generationId: 'generation-1' },
      deduplicationKey: 'generation-1'
    })
    const duplicate = store.enqueue({
      type: 'index.build',
      payload: { generationId: 'generation-1' },
      deduplicationKey: 'generation-1'
    })
    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ created: false, job: { jobId: first.job.jobId } })

    const claimed = store.claimNext({ workerId: 'worker-1', leaseMs: 10_000 })
    store.complete(claimed?.jobId as string, 'worker-1')
    expect(
      store.enqueue({
        type: 'index.build',
        payload: { generationId: 'generation-1' },
        deduplicationKey: 'generation-1'
      })
    ).toMatchObject({ created: true, job: { jobId: 'job-2' } })
    database.close()
  })

  it('atomically prevents two database connections from claiming one job', async () => {
    const { root, database, projectManifest } = await createDatabase()
    const first = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    first.enqueue({ type: 'mineru.poll', payload: { importId: 'import-1' } })
    const secondDatabase = await openProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log: silentLog
    })
    const second = new JobStore({
      database: secondDatabase,
      projectId: projectManifest.projectId,
      log: silentLog
    })

    const claims = [
      first.claimNext({ workerId: 'worker-a', leaseMs: 10_000 }),
      second.claimNext({ workerId: 'worker-b', leaseMs: 10_000 })
    ].filter((job) => job !== null)
    expect(claims).toHaveLength(1)
    expect(claims[0]?.attempts).toBe(1)
    secondDatabase.close()
    database.close()
  })

  it('renews leases and rejects completion by a different worker', async () => {
    const { database, projectManifest } = await createDatabase()
    let now = new Date('2026-07-15T02:00:00.000Z')
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: silentLog,
      now: () => now
    })
    const job = store.enqueue({ type: 'embedding.batch', payload: { batchId: 'batch-1' } }).job
    store.claimNext({ workerId: 'worker-a', leaseMs: 1_000 })
    now = new Date('2026-07-15T02:00:00.500Z')
    expect(
      store.heartbeat(job.jobId, 'worker-a', 2_000, { completed: 1, total: 2, stage: 'embed' })
    ).toMatchObject({
      lockedUntil: '2026-07-15T02:00:02.500Z',
      progress: { completed: 1, total: 2, stage: 'embed' }
    })
    expect(() => store.complete(job.jobId, 'worker-b')).toThrow(JobOwnershipError)
    expect(store.complete(job.jobId, 'worker-a').state).toBe('succeeded')
    database.close()
  })

  it('makes running cancellation win over a racing completion', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    const job = store.enqueue({ type: 'rerank.request', payload: { requestId: 'request-1' } }).job
    store.claimNext({ workerId: 'worker-a', leaseMs: 10_000 })

    expect(store.requestCancellation(job.jobId)).toMatchObject({
      state: 'running',
      cancellationRequested: true
    })
    expect(() => store.complete(job.jobId, 'worker-a')).toThrow(JobOwnershipError)
    expect(store.acknowledgeCancellation(job.jobId, 'worker-a')).toMatchObject({
      state: 'cancelled',
      cancellationRequested: true
    })
    database.close()
  })

  it('makes cancellation win when a worker reports failure after the request', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    const job = store.enqueue({ type: 'embedding.batch', payload: { batchId: 'batch-2' } }).job
    store.claimNext({ workerId: 'worker-a', leaseMs: 10_000 })
    store.requestCancellation(job.jobId)

    expect(store.fail(job.jobId, 'worker-a', new Error('aborted by provider'))).toMatchObject({
      willRetry: false,
      job: { state: 'cancelled', cancellationRequested: true }
    })
    expect(store.claimNext({ workerId: 'worker-b', leaseMs: 10_000 })).toBeNull()
    database.close()
  })

  it('uses deterministic exponential backoff and stops at retry exhaustion', async () => {
    const { database, projectManifest } = await createDatabase()
    let now = new Date('2026-07-15T03:00:00.000Z')
    const errorLog = vi.fn()
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: { info: vi.fn(), warn: vi.fn(), error: errorLog },
      now: () => now,
      random: () => 0,
      retryBaseMs: 1_000
    })
    const job = store.enqueue({
      type: 'mineru.download',
      payload: { parseRevisionId: 'revision-1' },
      maxAttempts: 2
    }).job
    store.claimNext({ workerId: 'worker-a', leaseMs: 10_000 })
    const firstFailure = new Error('temporary provider failure')
    expect(store.fail(job.jobId, 'worker-a', firstFailure)).toMatchObject({
      willRetry: true,
      job: { state: 'queued', runAfter: '2026-07-15T03:00:00.500Z' }
    })
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({ err: firstFailure, event: 'queue.job.execution_failed' }),
      expect.any(String)
    )

    now = new Date('2026-07-15T03:00:00.500Z')
    store.claimNext({ workerId: 'worker-b', leaseMs: 10_000 })
    expect(store.fail(job.jobId, 'worker-b', new Error('still unavailable'))).toMatchObject({
      willRetry: false,
      job: { state: 'failed', attempts: 2, completedAt: now.toISOString() }
    })
    database.close()
  })

  it('does not retry an explicitly non-retryable error', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    const job = store.enqueue({ type: 'import.validate', payload: { fileId: 'file-1' } }).job
    store.claimNext({ workerId: 'worker-a', leaseMs: 10_000 })
    const error = Object.assign(new Error('invalid input'), {
      retryable: false,
      code: 'invalid_input'
    })
    expect(store.fail(job.jobId, 'worker-a', error)).toMatchObject({
      willRetry: false,
      job: { state: 'failed', error: { code: 'invalid_input', retryable: false } }
    })
    database.close()
  })

  it('recovers expired work after process or project closure without double attempts', async () => {
    const { root, database, projectManifest } = await createDatabase()
    let now = new Date('2026-07-15T04:00:00.000Z')
    const beforeClose = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: silentLog,
      now: () => now
    })
    const recoverable = beforeClose.enqueue({
      type: 'index.publish',
      payload: { generationId: 'generation-1' },
      maxAttempts: 2
    }).job
    const cancelled = beforeClose.enqueue({
      type: 'mineru.poll',
      payload: { importId: 'import-1' }
    }).job
    beforeClose.claimNext({ workerId: 'crashed-worker', leaseMs: 1_000 })
    beforeClose.claimNext({ workerId: 'closing-worker', leaseMs: 1_000 })
    beforeClose.requestCancellation(cancelled.jobId)
    database.close()

    now = new Date('2026-07-15T04:00:02.000Z')
    const reopenedDatabase = await openProjectDatabase({
      projectRoot: root,
      manifest: projectManifest,
      applicationVersion: '1.0.0-test',
      log: silentLog
    })
    const reopened = new JobStore({
      database: reopenedDatabase,
      projectId: projectManifest.projectId,
      log: silentLog,
      now: () => now
    })
    expect(reopened.recoverExpiredLeases()).toEqual({ recovered: 1, cancelled: 1, failed: 0 })
    expect(reopened.require(recoverable.jobId)).toMatchObject({ state: 'queued', attempts: 1 })
    expect(reopened.require(cancelled.jobId).state).toBe('cancelled')
    expect(reopened.claimNext({ workerId: 'replacement-worker', leaseMs: 1_000 })).toMatchObject({
      jobId: recoverable.jobId,
      attempts: 2
    })
    reopenedDatabase.close()
  })

  it('supports an explicit pause and resume transition', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    const job = store.enqueue({ type: 'mineru.poll', payload: { importId: 'import-2' } }).job
    store.claimNext({ workerId: 'worker-a', leaseMs: 10_000 })
    expect(store.pause(job.jobId, 'worker-a').state).toBe('paused')
    expect(store.resume(job.jobId).state).toBe('queued')
    database.close()
  })
})
