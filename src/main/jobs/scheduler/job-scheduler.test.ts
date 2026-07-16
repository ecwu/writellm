import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it } from 'vitest'
import { initializeProjectDatabase } from '../../project/project-database'
import type { ProjectManifest } from '../../project/project-manifest'
import { JobStore, type JobLease } from '../job-store'
import { JobHandlerRegistry } from './job-handler-registry'
import { JobScheduler } from './job-scheduler'
import { WorkerSupervisor } from './worker-supervisor'

const directories: string[] = []
const log = pino({ level: 'silent' })

async function setup() {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-scheduler-'))
  directories.push(parent)
  const root = join(parent, 'scheduler.writellm')
  await mkdir(root)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc808',
    createdAt: '2026-07-15T00:00:00.000Z'
  }
  const database = await initializeProjectDatabase({
    projectRoot: root,
    manifest,
    applicationVersion: 'test',
    log
  })
  const jobs = new JobStore({ database, projectId: manifest.projectId, log })
  const registry = new JobHandlerRegistry()
  const supervisor = new WorkerSupervisor({
    projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc809',
    log
  })
  return { database, jobs, registry, supervisor, projectId: manifest.projectId }
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('JobScheduler', () => {
  it('claims only idle resource slots and never exceeds resource concurrency', async () => {
    const { database, jobs, registry, supervisor, projectId } = await setup()
    const releases: Array<() => void> = []
    let active = 0
    let maximum = 0
    registry.register('build_embedding_generation', async ({ signal }) => {
      active += 1
      maximum = Math.max(maximum, active)
      await new Promise<void>((resolve, reject) => {
        releases.push(resolve)
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
      active -= 1
    })
    for (let index = 0; index < 4; index += 1) {
      jobs.enqueue({
        type: 'build_embedding_generation',
        payload: { generationId: `batch-${index}` },
        priority: index
      })
    }
    const scheduler = new JobScheduler({
      jobs,
      registry,
      supervisor,
      projectId,
      log,
      pollIntervalMs: 5
    })
    scheduler.start()
    await waitFor(
      () => jobs.list({ limit: 10 }).filter(({ state }) => state === 'running').length === 3
    )
    expect(maximum).toBe(3)
    expect(jobs.list({ limit: 10 }).filter(({ state }) => state === 'queued')).toHaveLength(1)
    expect(jobs.list({ limit: 10 }).find(({ state }) => state === 'queued')?.priority).toBe(0)

    releases.shift()?.()
    await waitFor(() => releases.length === 3)
    expect(maximum).toBe(3)
    for (const release of releases.splice(0)) release()
    await waitFor(() => jobs.list({ limit: 10 }).every(({ state }) => state === 'succeeded'))
    await scheduler.stop()
    database.close()
  })

  it('aborts and requeues close-safe work without spending another attempt', async () => {
    const { database, jobs, registry, supervisor, projectId } = await setup()
    registry.register('artifact_cleanup', async ({ signal }) => {
      await new Promise<void>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const job = jobs.enqueue({ type: 'artifact_cleanup', payload: { cleanupId: 'file-close' } }).job
    const scheduler = new JobScheduler({ jobs, registry, supervisor, projectId, log })
    scheduler.start()
    await waitFor(() => jobs.require(job.jobId).state === 'running')
    await scheduler.park()
    expect(jobs.require(job.jobId)).toMatchObject({
      state: 'queued',
      attempts: 1,
      resumeSameAttempt: true
    })
    await scheduler.stop()
    database.close()
  })

  it('persists throttled progress before a successful index generation finishes', async () => {
    const { database, jobs, registry, supervisor, projectId } = await setup()
    let activeGeneration = 'old-generation'
    let publish: (() => void) | undefined
    registry.register(
      'rebuild_index',
      async ({ reportProgress }) => {
        reportProgress({ completed: 1, total: 2, stage: 'validated' })
        await new Promise<void>((resolve) => {
          publish = () => {
            activeGeneration = 'new-generation'
            resolve()
          }
        })
      },
      { heartbeatMs: 5, leaseMs: 100, timeoutMs: 1_000 }
    )
    const job = jobs.enqueue({
      type: 'rebuild_index',
      payload: { generationId: 'new-generation' }
    }).job
    const scheduler = new JobScheduler({ jobs, registry, supervisor, projectId, log })
    scheduler.start()
    await waitFor(() => jobs.require(job.jobId).progress?.stage === 'validated')
    expect(activeGeneration).toBe('old-generation')
    publish?.()
    await waitFor(() => jobs.require(job.jobId).state === 'succeeded')
    expect(activeGeneration).toBe('new-generation')
    expect(jobs.require(job.jobId)).toMatchObject({
      state: 'succeeded',
      progress: { completed: 1, total: 2, stage: 'validated' }
    })
    await scheduler.park()
    await scheduler.stop()
    database.close()
  })

  it('turns timeout into one retry transition', async () => {
    const { database, jobs, registry, supervisor, projectId } = await setup()
    registry.register(
      'build_embedding_generation',
      async () => new Promise<void>(() => undefined),
      {
        timeoutMs: 10,
        heartbeatMs: 100,
        leaseMs: 1_000
      }
    )
    const job = jobs.enqueue({
      type: 'build_embedding_generation',
      payload: { generationId: 'timeout' }
    }).job
    const scheduler = new JobScheduler({ jobs, registry, supervisor, projectId, log })
    scheduler.start()
    await waitFor(
      () => jobs.require(job.jobId).state === 'queued' && jobs.require(job.jobId).attempts === 1
    )
    expect(jobs.listTransitions(job.jobId).map(({ event }) => event)).toEqual([
      'enqueued',
      'claimed',
      'retry_scheduled'
    ])
    await scheduler.stop()
    database.close()
  })

  it('recovers a lease that expires after scheduler start without reopening the project', async () => {
    const { database, jobs, registry, supervisor, projectId } = await setup()
    let executions = 0
    registry.register(
      'artifact_cleanup',
      async () => {
        executions += 1
      },
      { leaseMs: 100, heartbeatMs: 25 }
    )
    const job = jobs.enqueue({
      type: 'artifact_cleanup',
      payload: { cleanupId: 'crashed-worker' }
    }).job
    const oldClaim = jobs.claimNext({ workerId: 'crashed-worker', leaseMs: 40 })
    const scheduler = new JobScheduler({
      jobs,
      registry,
      supervisor,
      projectId,
      log,
      pollIntervalMs: 5,
      leaseRecoveryIntervalMs: 5
    })

    scheduler.start()
    expect(jobs.require(job.jobId).state).toBe('running')
    await waitFor(() => jobs.require(job.jobId).state === 'succeeded')
    expect(executions).toBe(1)
    expect(jobs.listTransitions(job.jobId).map(({ event }) => event)).toEqual([
      'enqueued',
      'claimed',
      'lease_expired',
      'claimed',
      'completed'
    ])
    expect(() => jobs.complete(oldClaim?.lease as JobLease)).toThrow()
    await scheduler.stop()
    database.close()
  })

  it('makes cancellation win atomically when project close races an abortable handler', async () => {
    const { database, jobs, registry, supervisor, projectId } = await setup()
    registry.register('build_embedding_generation', async ({ signal }) => {
      await new Promise<void>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const job = jobs.enqueue({
      type: 'build_embedding_generation',
      payload: { generationId: 'cancel-close' }
    }).job
    const scheduler = new JobScheduler({ jobs, registry, supervisor, projectId, log })
    scheduler.start()
    await waitFor(() => jobs.require(job.jobId).state === 'running')
    jobs.requestCancellation(job.jobId)
    scheduler.cancel(job.jobId)
    await scheduler.park()

    expect(jobs.require(job.jobId).state).toBe('cancelled')
    expect(jobs.listTransitions(job.jobId).map(({ event }) => event)).toEqual([
      'enqueued',
      'claimed',
      'cancellation_requested',
      'cancellation_acknowledged'
    ])
    await scheduler.stop()
    database.close()
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for scheduler state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
