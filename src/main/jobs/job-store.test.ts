import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initializeProjectDatabase, openProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { JobOwnershipError, JobStore, type JobLease } from './job-store'

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
  it('cancels jobs by a bounded parse reference without scanning renderer-visible jobs', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    const target = store.enqueue({
      type: 'mineru_parse',
      payload: { parseTaskId: 'parse-target' }
    }).job
    const other = store.enqueue({
      type: 'mineru_parse',
      payload: { parseTaskId: 'parse-other' }
    }).job

    expect(
      store.requestCancellationForPayload({
        types: ['mineru_parse'],
        field: 'parseTaskId',
        values: ['parse-target']
      })
    ).toEqual([expect.objectContaining({ jobId: target.jobId, state: 'cancelled' })])
    expect(store.require(other.jobId).state).toBe('queued')
    database.close()
  })

  it('stores bounded reference payloads and rejects private or heavyweight values', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })

    expect(
      store.enqueue({
        type: 'mineru_parse',
        payload: { parseTaskId: 'parse-1' }
      }).job.payload
    ).toEqual({ parseTaskId: 'parse-1' })
    expect(() =>
      store.enqueue({
        type: 'mineru_parse',
        payload: { parseTaskId: 'parse-1', absolutePath: '/private/source.pdf' }
      })
    ).toThrow()
    for (const relativePath of [
      '../source.pdf',
      'knowledge\\source.pdf',
      'C:\\source.pdf',
      '\\\\server\\source.pdf',
      'file:///source.pdf',
      'https://example.test/source.pdf',
      'https://example.test/source.pdf?token=secret'
    ]) {
      expect(() =>
        store.enqueue({
          type: 'mineru_parse',
          payload: { parseTaskId: 'parse-1', relativePath }
        })
      ).toThrow()
    }
    for (const forbidden of ['data', 'text', 'source', 'rawText', 'credential', 'apiKey']) {
      expect(() =>
        store.enqueue({
          type: 'mineru_parse',
          payload: {
            parseTaskId: 'parse-1',
            [forbidden]: 'private'
          }
        })
      ).toThrow()
    }
    expect(() =>
      store.enqueue({ type: 'unknown' as never, payload: { generationId: 'generation-1' } })
    ).toThrow()
    expect(
      store.enqueue({
        type: 'build_embedding_generation',
        payload: {
          generationId: 'embedding-refresh-1',
          refreshScope: 'item',
          knowledgeItemId: 'knowledge-item-1'
        }
      }).job.payload
    ).toEqual({
      generationId: 'embedding-refresh-1',
      refreshScope: 'item',
      knowledgeItemId: 'knowledge-item-1'
    })
    expect(() =>
      store.enqueue({
        type: 'build_embedding_generation',
        payload: { generationId: 'embedding-refresh-2', refreshScope: 'item' }
      })
    ).toThrow()
    expect(() =>
      store.enqueue({
        type: 'build_embedding_generation',
        payload: {
          generationId: 'embedding-refresh-3',
          refreshScope: 'all',
          knowledgeItemId: 'knowledge-item-1'
        }
      })
    ).toThrow()
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
      type: 'build_index_generation',
      payload: { generationId: 'generation-1' },
      deduplicationKey: 'generation-1'
    })
    const duplicate = store.enqueue({
      type: 'build_index_generation',
      payload: { generationId: 'generation-1' },
      deduplicationKey: 'generation-1'
    })
    expect(first.created).toBe(true)
    expect(duplicate).toMatchObject({ created: false, job: { jobId: first.job.jobId } })

    const claimed = store.claimNext({ workerId: 'worker-1', leaseMs: 10_000 })
    store.complete(claimed?.lease as JobLease)
    expect(
      store.enqueue({
        type: 'build_index_generation',
        payload: { generationId: 'generation-1' },
        deduplicationKey: 'generation-1'
      })
    ).toMatchObject({ created: true, job: { jobId: 'job-2' } })
    database.close()
  })

  it('atomically prevents two database connections from claiming one job', async () => {
    const { root, database, projectManifest } = await createDatabase()
    const first = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    first.enqueue({ type: 'mineru_parse', payload: { parseTaskId: 'parse-1' } })
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
    expect(claims[0]?.job.attempts).toBe(1)
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
    store.enqueue({ type: 'build_embedding_generation', payload: { generationId: 'batch-1' } })
    const claimed = store.claimNext({ workerId: 'worker-a', leaseMs: 1_000 })
    now = new Date('2026-07-15T02:00:00.500Z')
    expect(
      store.heartbeat(claimed?.lease as JobLease, 2_000, {
        completed: 1,
        total: 2,
        stage: 'embed'
      })
    ).toMatchObject({
      lockedUntil: '2026-07-15T02:00:02.500Z',
      progress: { completed: 1, total: 2, stage: 'embed' }
    })
    expect(() => store.complete({ ...(claimed?.lease as JobLease), workerId: 'worker-b' })).toThrow(
      JobOwnershipError
    )
    expect(store.complete(claimed?.lease as JobLease).state).toBe('succeeded')
    database.close()
  })

  it('makes running cancellation win over a racing completion', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    const job = store.enqueue({
      type: 'build_embedding_generation',
      payload: { generationId: 'request-1' }
    }).job
    const claimed = store.claimNext({ workerId: 'worker-a', leaseMs: 10_000 })

    expect(store.requestCancellation(job.jobId)).toMatchObject({
      state: 'running',
      cancellationRequested: true
    })
    expect(() => store.complete(claimed?.lease as JobLease)).toThrow(JobOwnershipError)
    expect(store.acknowledgeCancellation(claimed?.lease as JobLease)).toMatchObject({
      state: 'cancelled',
      cancellationRequested: true
    })
    database.close()
  })

  it('makes cancellation win when a worker reports failure after the request', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    const job = store.enqueue({
      type: 'build_embedding_generation',
      payload: { generationId: 'batch-2' }
    }).job
    const claimed = store.claimNext({ workerId: 'worker-a', leaseMs: 10_000 })
    store.requestCancellation(job.jobId)

    expect(store.fail(claimed?.lease as JobLease, new Error('aborted by provider'))).toMatchObject({
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
    store.enqueue({
      type: 'mineru_parse',
      payload: { parseTaskId: 'parse-1' },
      maxAttempts: 2
    })
    const firstClaim = store.claimNext({ workerId: 'worker-a', leaseMs: 10_000 })
    const firstFailure = new Error('temporary provider failure')
    expect(store.fail(firstClaim?.lease as JobLease, firstFailure)).toMatchObject({
      willRetry: true,
      job: { state: 'queued', runAfter: '2026-07-15T03:00:00.500Z' }
    })
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({ err: firstFailure, event: 'queue.job.execution_failed' }),
      expect.any(String)
    )

    now = new Date('2026-07-15T03:00:00.500Z')
    const secondClaim = store.claimNext({ workerId: 'worker-b', leaseMs: 10_000 })
    expect(
      store.fail(secondClaim?.lease as JobLease, new Error('still unavailable'))
    ).toMatchObject({
      willRetry: false,
      job: { state: 'failed', attempts: 2, completedAt: now.toISOString() }
    })
    database.close()
  })

  it('does not retry an explicitly non-retryable error', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    store.enqueue({ type: 'artifact_cleanup', payload: { cleanupId: 'file-1' } })
    const claimed = store.claimNext({ workerId: 'worker-a', leaseMs: 10_000 })
    const error = Object.assign(new Error('invalid input'), {
      retryable: false,
      code: 'invalid_input'
    })
    expect(store.fail(claimed?.lease as JobLease, error)).toMatchObject({
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
      type: 'rebuild_index',
      payload: { generationId: 'generation-1' },
      maxAttempts: 2
    }).job
    const cancelled = beforeClose.enqueue({
      type: 'mineru_parse',
      payload: { parseTaskId: 'parse-1' }
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
      job: { jobId: recoverable.jobId, attempts: 2 }
    })
    reopenedDatabase.close()
  })

  it('treats a lease token and attempt as a claim-scoped capability', async () => {
    const { database, projectManifest } = await createDatabase()
    let now = new Date('2026-07-15T05:00:00.000Z')
    let token = 0
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: silentLog,
      now: () => now,
      createLeaseToken: () => `lease-${++token}`
    })
    const job = store.enqueue({ type: 'rebuild_index', payload: { generationId: 'g-1' } }).job
    const oldClaim = store.claimNext({ workerId: 'same-worker', leaseMs: 1_000 })
    expect(store.require(job.jobId).leaseOwner).toBe('same-worker')

    now = new Date('2026-07-15T05:00:01.000Z')
    for (const operation of [
      () => store.heartbeat(oldClaim?.lease as JobLease, 1_000),
      () => store.complete(oldClaim?.lease as JobLease),
      () => store.fail(oldClaim?.lease as JobLease, null),
      () => store.acknowledgeCancellation(oldClaim?.lease as JobLease)
    ]) {
      expect(operation).toThrow(JobOwnershipError)
    }

    expect(store.recoverExpiredLeases()).toEqual({ recovered: 1, cancelled: 0, failed: 0 })
    const newClaim = store.claimNext({ workerId: 'same-worker', leaseMs: 1_000 })
    expect(newClaim?.lease).toMatchObject({ leaseToken: 'lease-2', attempt: 2 })
    expect(() => store.complete(oldClaim?.lease as JobLease)).toThrow(JobOwnershipError)
    expect(store.complete(newClaim?.lease as JobLease).state).toBe('succeeded')
    database.close()
  })

  it('archives arbitrary failures without persisting untrusted messages', async () => {
    const { database, projectManifest } = await createDatabase()
    const loggedErrors: unknown[] = []
    const log = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((fields: { err?: unknown }) => loggedErrors.push(fields.err))
    }
    let sequence = 0
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('getter secret')
        }
      }
    )
    const failures: unknown[] = [
      new Error(''),
      { code: '', message: '' },
      null,
      42,
      'Authorization: Bearer secret-token /Users/private signed=https://example.test?a=token',
      hostile,
      { message: `${'中文😀'.repeat(4_000)}\ud800` }
    ]
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log,
      createId: () => `failure-${++sequence}`,
      createLeaseToken: () => `failure-lease-${sequence}`,
      classifyFailure: () => ({ code: 'job_execution_failed', retryable: false })
    })

    for (const failure of failures) {
      const job = store.enqueue({
        type: 'build_embedding_generation',
        payload: { generationId: `batch-${sequence + 1}` }
      }).job
      const claim = store.claimNext({ workerId: 'worker', leaseMs: 10_000 })
      const result = store.fail(claim?.lease as JobLease, failure)
      expect(result.job).toMatchObject({
        jobId: job.jobId,
        state: 'failed',
        error: {
          code: 'job_execution_failed',
          message: 'Job execution failed',
          retryable: false
        }
      })
      const persisted = database.immediate(
        (native) =>
          native
            .prepare('SELECT error_json FROM jobs WHERE job_id = ?')
            .pluck()
            .get(job.jobId) as string
      )
      expect(Buffer.byteLength(persisted, 'utf8')).toBeLessThan(8_192)
      expect(persisted).not.toContain('secret-token')
      expect(persisted).not.toContain('/Users/private')
    }
    for (const failure of failures) expect(loggedErrors.includes(failure)).toBe(true)
    database.close()
  })

  it('falls back conservatively when failure classification throws', async () => {
    const { database, projectManifest } = await createDatabase()
    const classifierError = new Error('classifier broke')
    const errorLog = vi.fn()
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: { info: vi.fn(), warn: vi.fn(), error: errorLog },
      classifyFailure: () => {
        throw classifierError
      }
    })
    store.enqueue({ type: 'mineru_parse', payload: { parseTaskId: 'parse-classifier' } })
    const claim = store.claimNext({ workerId: 'worker', leaseMs: 10_000 })

    expect(store.fail(claim?.lease as JobLease, new Error('private failure'))).toMatchObject({
      willRetry: false,
      job: { state: 'failed', error: { code: 'job_execution_failed', retryable: false } }
    })
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'queue.job.failure_classification_failed',
        err: classifierError
      }),
      expect.any(String)
    )
    database.close()
  })

  it('still archives a hostile error when the logger serializer rejects it', async () => {
    const { database, projectManifest } = await createDatabase()
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('hostile logger getter')
        }
      }
    )
    const throwingLog = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((_fields: { err?: unknown }) => {
        if (typeof _fields.err === 'object' && _fields.err !== null) {
          Reflect.get(_fields.err, 'message')
        }
      })
    }
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: throwingLog,
      classifyFailure: () => ({ code: 'job_execution_failed', retryable: false })
    })
    store.enqueue({ type: 'artifact_cleanup', payload: { cleanupId: 'hostile-file' } })
    const claim = store.claimNext({ workerId: 'worker', leaseMs: 10_000 })

    expect(store.fail(claim?.lease as JobLease, hostile).job.state).toBe('failed')
    expect(throwingLog.error).toHaveBeenCalledOnce()
    expect(throwingLog.error.mock.calls[0]?.[0].err === hostile).toBe(true)
    database.close()
  })

  it('validates type-specific payloads when reading portable database rows', async () => {
    const { database, projectManifest } = await createDatabase()
    const store = new JobStore({ database, projectId: projectManifest.projectId, log: silentLog })
    const job = store.enqueue({
      type: 'build_index_generation',
      payload: { generationId: 'g-valid' }
    }).job
    database.immediate((native) => {
      native
        .prepare('UPDATE jobs SET payload_json = ? WHERE job_id = ?')
        .run(JSON.stringify({ generationId: 'g-valid', text: 'private body' }), job.jobId)
    })

    expect(() => store.require(job.jobId)).toThrow()
    database.close()
  })

  it('persists material transitions atomically and keeps retry error history', async () => {
    const { database, projectManifest } = await createDatabase()
    let now = new Date('2026-07-15T06:00:00.000Z')
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: silentLog,
      now: () => now,
      random: () => 0,
      createLeaseToken: () => `lease-${now.getTime()}`
    })
    const job = store.enqueue({
      type: 'build_index_generation',
      payload: { generationId: 'audit-g' }
    }).job
    const first = store.claimNext({ workerId: 'worker', leaseMs: 10_000 })
    store.fail(first?.lease as JobLease, new Error('private retry message'))
    now = new Date('2026-07-15T06:00:00.500Z')
    const second = store.claimNext({ workerId: 'worker', leaseMs: 10_000 })
    store.complete(second?.lease as JobLease)

    expect(store.listTransitions(job.jobId).map(({ event }) => event)).toEqual([
      'enqueued',
      'claimed',
      'retry_scheduled',
      'claimed',
      'completed'
    ])
    expect(store.require(job.jobId).error).toBeNull()
    expect(store.listTransitions(job.jobId)[2]).toMatchObject({
      errorCode: 'job_execution_failed',
      workerId: 'worker'
    })

    const rollbackJob = store.enqueue({
      type: 'rebuild_index',
      payload: { generationId: 'rollback-g' }
    }).job
    const rollbackClaim = store.claimNext({ workerId: 'worker', leaseMs: 10_000 })
    database.immediate((native) => {
      native.exec(`
        CREATE TRIGGER reject_job_transition
        BEFORE INSERT ON job_transitions
        BEGIN
          SELECT RAISE(ABORT, 'transition rejected');
        END;
      `)
    })
    expect(() => store.complete(rollbackClaim?.lease as JobLease)).toThrow('transition rejected')
    expect(store.require(rollbackJob.jobId).state).toBe('running')
    database.close()
  })

  it('audits cancellation and expired lease recovery in order', async () => {
    const { database, projectManifest } = await createDatabase()
    let now = new Date('2026-07-15T07:00:00.000Z')
    let token = 0
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: silentLog,
      now: () => now,
      createLeaseToken: () => `audit-lease-${++token}`
    })
    const job = store.enqueue({ type: 'mineru_parse', payload: { parseTaskId: 'audit-parse' } }).job
    const first = store.claimNext({ workerId: 'worker', leaseMs: 1_000 })
    store.requestCancellation(job.jobId)
    store.acknowledgeCancellation(first?.lease as JobLease)

    const recovery = store.enqueue({
      type: 'rebuild_index',
      payload: { generationId: 'audit-recovery' }
    }).job
    store.claimNext({ workerId: 'worker', leaseMs: 1_000 })
    now = new Date('2026-07-15T07:00:01.000Z')
    store.recoverExpiredLeases()

    expect(store.listTransitions(job.jobId).map(({ event }) => event)).toEqual([
      'enqueued',
      'claimed',
      'cancellation_requested',
      'cancellation_acknowledged'
    ])
    expect(store.listTransitions(recovery.jobId).map(({ event }) => event)).toEqual([
      'enqueued',
      'claimed',
      'lease_expired'
    ])
    database.close()
  })

  it('requeues project-close work without consuming another retry attempt', async () => {
    const { database, projectManifest } = await createDatabase()
    let token = 0
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: silentLog,
      createLeaseToken: () => `close-lease-${++token}`
    })
    const job = store.enqueue({
      type: 'build_embedding_generation',
      payload: { generationId: 'close-batch' },
      maxAttempts: 1
    }).job
    const first = store.claimNext({ workerId: 'worker', leaseMs: 10_000 })

    expect(store.requeueForProjectClose(first?.lease as JobLease)).toMatchObject({
      state: 'queued',
      attempts: 1,
      resumeSameAttempt: true
    })
    const resumed = store.claimNext({ workerId: 'worker', leaseMs: 10_000 })
    expect(resumed).toMatchObject({ job: { attempts: 1, resumeSameAttempt: false } })
    expect(resumed?.lease.leaseToken).not.toBe(first?.lease.leaseToken)
    expect(() => store.complete(first?.lease as JobLease)).toThrow(JobOwnershipError)
    store.complete(resumed?.lease as JobLease)
    expect(store.listTransitions(job.jobId).map(({ event }) => event)).toEqual([
      'enqueued',
      'claimed',
      'project_close_requeued',
      'claimed',
      'completed'
    ])
    database.close()
  })

  it('does not let an ineligible queued row starve later claimable work', async () => {
    const { database, projectManifest } = await createDatabase()
    let sequence = 0
    const store = new JobStore({
      database,
      projectId: projectManifest.projectId,
      log: silentLog,
      createId: () => `starvation-${++sequence}`
    })
    const exhausted = store.enqueue({
      type: 'build_index_generation',
      payload: { generationId: 'exhausted' },
      priority: 100,
      maxAttempts: 1
    }).job
    const eligible = store.enqueue({
      type: 'build_index_generation',
      payload: { generationId: 'eligible' },
      priority: 0
    }).job
    database.immediate((native) => {
      native
        .prepare('UPDATE jobs SET attempts = max_attempts WHERE job_id = ?')
        .run(exhausted.jobId)
    })

    expect(store.claimNext({ workerId: 'worker', leaseMs: 10_000 })?.job.jobId).toBe(eligible.jobId)
    database.close()
  })
})
