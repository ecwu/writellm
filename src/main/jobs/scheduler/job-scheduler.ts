import PQueue from 'p-queue'
import type { Logger } from 'pino'
import { JobOwnershipError, type ClaimedJob, type JobStore } from '../job-store'
import type { JobProgress } from '../job-schemas'
import type { JobHandlerDefinition, JobResource, JobHandlerRegistry } from './job-handler-registry'
import type { WorkerSupervisor } from './worker-supervisor'

interface Execution {
  readonly claimed: ClaimedJob
  readonly definition: JobHandlerDefinition
  readonly controller: AbortController
  readonly executionId: string
  progress?: JobProgress
  closeRequested: boolean
}

export interface JobSchedulerOptions {
  jobs: JobStore
  registry: JobHandlerRegistry
  supervisor: WorkerSupervisor
  projectId: string
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  pollIntervalMs?: number
  closeTimeoutMs?: number
  leaseRecoveryIntervalMs?: number
}

export class JobScheduler {
  readonly #jobs: JobStore
  readonly #registry: JobHandlerRegistry
  readonly #supervisor: WorkerSupervisor
  readonly #projectId: string
  readonly #log: JobSchedulerOptions['log']
  readonly #pollIntervalMs: number
  readonly #closeTimeoutMs: number
  readonly #workerId: string
  readonly #leaseRecoveryIntervalMs: number
  readonly #queues = new Map<JobResource, PQueue>()
  readonly #executions = new Map<string, Execution>()
  #claiming = false
  #dispatching = false
  #pollTimer: ReturnType<typeof setInterval> | undefined
  #stopped = false
  #lastLeaseRecoveryAt = 0

  constructor(options: JobSchedulerOptions) {
    this.#jobs = options.jobs
    this.#registry = options.registry
    this.#supervisor = options.supervisor
    this.#projectId = options.projectId
    this.#log = options.log
    this.#pollIntervalMs = options.pollIntervalMs ?? 100
    this.#closeTimeoutMs = options.closeTimeoutMs ?? 10_000
    this.#leaseRecoveryIntervalMs = options.leaseRecoveryIntervalMs ?? 1_000
    this.#workerId = this.#jobs.createWorkerId()
    for (const resource of this.#registry.resources()) {
      const type = this.#registry.typesForResource(resource)[0]
      if (type === undefined) continue
      this.#queues.set(
        resource,
        new PQueue({ concurrency: this.#registry.require(type).concurrency })
      )
    }
  }

  start(): void {
    if (this.#claiming || this.#stopped) return
    this.#claiming = true
    this.#pollTimer = setInterval(() => this.wake(), this.#pollIntervalMs)
    this.#pollTimer.unref?.()
    this.#log.info(
      { event: 'queue.scheduler.started', projectId: this.#projectId },
      'Project job scheduler started'
    )
    this.wake()
  }

  wake(): void {
    if (!this.#claiming || this.#dispatching) return
    this.#dispatching = true
    try {
      const now = Date.now()
      if (now - this.#lastLeaseRecoveryAt >= this.#leaseRecoveryIntervalMs) {
        this.#jobs.recoverExpiredLeases()
        this.#lastLeaseRecoveryAt = now
      }
      let claimedAny: boolean
      do {
        claimedAny = false
        for (const [resource, queue] of this.#queues) {
          if (
            !this.#claiming ||
            queue.isPaused ||
            queue.pending + queue.size >= queue.concurrency
          ) {
            continue
          }
          const types = this.#registry.typesForResource(resource)
          if (types.length === 0) continue
          const leaseMs = Math.max(...types.map((type) => this.#registry.require(type).leaseMs))
          const claimed = this.#jobs.claimNext({ workerId: this.#workerId, leaseMs, types })
          if (claimed === null) continue
          claimedAny = true
          this.#dispatch(queue, claimed)
        }
      } while (claimedAny && this.#claiming)
    } finally {
      this.#dispatching = false
    }
  }

  stopClaims(): void {
    this.#claiming = false
    if (this.#pollTimer !== undefined) clearInterval(this.#pollTimer)
    this.#pollTimer = undefined
    for (const queue of this.#queues.values()) queue.pause()
    this.#log.info(
      { event: 'queue.scheduler.claims_stopped', projectId: this.#projectId },
      'Project job claims stopped'
    )
  }

  cancel(jobId: string): void {
    this.#executions.get(jobId)?.controller.abort(new Error('Job cancellation requested'))
  }

  async park(): Promise<void> {
    this.stopClaims()
    for (const execution of this.#executions.values()) {
      execution.closeRequested = true
      if (execution.definition.closePolicy !== 'finish') {
        execution.controller.abort(new Error('Project is closing'))
      }
    }
    try {
      await withTimeout(
        Promise.all([...this.#queues.values()].map((queue) => queue.onPendingZero())),
        this.#closeTimeoutMs
      )
    } catch (err) {
      this.#log.error(
        { event: 'queue.scheduler.close_drain_failed', err, projectId: this.#projectId },
        'Project job scheduler did not drain before close deadline'
      )
      const termination = this.#supervisor.terminate()
      for (const execution of this.#executions.values()) {
        execution.controller.abort(new Error('Project workers terminated after close timeout'))
      }
      await Promise.all([...this.#queues.values()].map((queue) => queue.onPendingZero()))
      try {
        await withTimeout(termination, this.#closeTimeoutMs)
      } catch (terminationErr) {
        this.#log.error(
          {
            event: 'queue.scheduler.worker_termination_timeout',
            err: terminationErr,
            projectId: this.#projectId
          },
          'Project worker termination did not confirm before the secondary deadline'
        )
      }
      throw new Error('Project job scheduler close timed out', { cause: err })
    }
  }

  async stop(): Promise<void> {
    this.stopClaims()
    this.#stopped = true
    this.#supervisor.stop()
    for (const execution of this.#executions.values()) {
      execution.controller.abort(new Error('Project runtime stopped'))
    }
    this.#log.info(
      { event: 'queue.scheduler.stopped', projectId: this.#projectId },
      'Project job scheduler stopped'
    )
  }

  #dispatch(queue: PQueue, claimed: ClaimedJob): void {
    const definition = this.#registry.require(claimed.job.type)
    const controller = new AbortController()
    const executionId = this.#supervisor.track(claimed.job.jobId)
    const execution: Execution = {
      claimed,
      definition,
      controller,
      executionId,
      closeRequested: false
    }
    this.#executions.set(claimed.job.jobId, execution)
    void queue
      .add(() => this.#execute(execution), {
        id: claimed.job.jobId,
        priority: claimed.job.priority,
        signal: controller.signal
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          this.#log.error(
            { event: 'queue.scheduler.dispatch_failed', err, jobId: claimed.job.jobId },
            'Project job queue dispatch failed'
          )
        }
      })
      .finally(() => {
        if (this.#executions.get(claimed.job.jobId) === execution) {
          this.#executions.delete(claimed.job.jobId)
        }
        this.#supervisor.release(claimed.job.jobId, execution.executionId)
        this.wake()
      })
  }

  async #execute(execution: Execution): Promise<void> {
    const { claimed, definition, controller } = execution
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      heartbeat = setInterval(() => {
        if (this.#stopped) return
        try {
          const current = this.#supervisor.commit(claimed.job.jobId, execution.executionId, () =>
            this.#jobs.heartbeat(claimed.lease, definition.leaseMs, execution.progress)
          )
          if (current === undefined) {
            controller.abort(new Error('Job commit authority was revoked'))
            return
          }
          execution.progress = undefined
          if (current.cancellationRequested)
            controller.abort(new Error('Job cancellation requested'))
        } catch (err) {
          this.#log.error(
            { event: 'queue.scheduler.heartbeat_failed', err, jobId: claimed.job.jobId },
            'Project job heartbeat failed'
          )
          controller.abort(err)
        }
      }, definition.heartbeatMs)
      heartbeat.unref?.()
      timeout = setTimeout(
        () => controller.abort(new Error('Job handler timed out')),
        definition.timeoutMs
      )
      timeout.unref?.()
      const handler = definition.handler({
        job: claimed.job,
        signal: controller.signal,
        reportProgress: (progress) => {
          execution.progress = progress
        }
      })
      await Promise.race([handler, aborted(controller.signal)])
      if (this.#stopped) return
      if (controller.signal.aborted) throw controller.signal.reason
      this.#supervisor.commit(claimed.job.jobId, execution.executionId, () =>
        this.#jobs.complete(claimed.lease, execution.progress)
      )
    } catch (err) {
      if (this.#stopped) return
      if (execution.closeRequested && definition.closePolicy === 'abort-and-requeue') {
        this.#transitionIgnoringLostLease(claimed.job.jobId, execution.executionId, () =>
          this.#jobs.requeueForProjectClose(claimed.lease)
        )
        return
      }
      const current = this.#jobs.get(claimed.job.jobId)
      if (current?.cancellationRequested) {
        this.#transitionIgnoringLostLease(claimed.job.jobId, execution.executionId, () =>
          this.#jobs.acknowledgeCancellation(claimed.lease)
        )
      } else if (execution.closeRequested) {
        return
      } else {
        this.#transitionIgnoringLostLease(claimed.job.jobId, execution.executionId, () =>
          this.#jobs.fail(claimed.lease, err)
        )
      }
    } finally {
      if (heartbeat !== undefined) clearInterval(heartbeat)
      if (timeout !== undefined) clearTimeout(timeout)
    }
  }

  #transitionIgnoringLostLease(jobId: string, executionId: string, operation: () => unknown): void {
    try {
      this.#supervisor.commit(jobId, executionId, operation)
    } catch (err) {
      if (!(err instanceof JobOwnershipError)) throw err
      this.#log.warn(
        { event: 'queue.scheduler.stale_transition_rejected', projectId: this.#projectId },
        'Rejected a scheduler transition after lease ownership changed'
      )
    }
  }
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

async function withTimeout(operation: Promise<unknown>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Scheduler close timed out')), timeoutMs)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
