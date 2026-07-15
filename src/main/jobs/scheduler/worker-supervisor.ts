import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'

export interface WorkerMessageEnvelope {
  projectSessionId: string
  jobId: string
  executionId: string
}

export interface WorkerSupervisorOptions {
  projectSessionId: string
  log: Pick<Logger, 'warn' | 'error'>
  terminateWorkers?: () => void | Promise<void>
}

export class WorkerSupervisor {
  readonly #projectSessionId: string
  readonly #log: WorkerSupervisorOptions['log']
  readonly #terminateWorkers: () => void | Promise<void>
  #accepting = true
  #termination: Promise<void> | undefined
  readonly #activeExecutions = new Map<string, string>()

  constructor(options: WorkerSupervisorOptions) {
    this.#projectSessionId = options.projectSessionId
    this.#log = options.log
    this.#terminateWorkers = options.terminateWorkers ?? (() => undefined)
  }

  track(jobId: string): string {
    if (!this.#accepting) throw new Error('Worker supervisor is stopping')
    const executionId = randomUUID()
    this.#activeExecutions.set(jobId, executionId)
    return executionId
  }

  release(jobId: string, executionId: string): void {
    if (this.#activeExecutions.get(jobId) === executionId) {
      this.#activeExecutions.delete(jobId)
    }
  }

  accept<T>(envelope: WorkerMessageEnvelope, commit: () => T): T | undefined {
    if (envelope.projectSessionId !== this.#projectSessionId) {
      this.#log.warn(
        { event: 'worker.message.rejected', jobId: envelope.jobId },
        'Rejected stale or late project worker message'
      )
      return undefined
    }
    return this.commit(envelope.jobId, envelope.executionId, commit)
  }

  commit<T>(jobId: string, executionId: string, operation: () => T): T | undefined {
    if (!this.#accepting || this.#activeExecutions.get(jobId) !== executionId) {
      this.#log.warn(
        { event: 'worker.commit.rejected', jobId },
        'Rejected a project worker commit after authority was revoked'
      )
      return undefined
    }
    return operation()
  }

  stop(): void {
    this.#accepting = false
    this.#activeExecutions.clear()
  }

  terminate(): Promise<void> {
    this.stop()
    this.#termination ??= Promise.resolve()
      .then(() => this.#terminateWorkers())
      .then(() => {
        this.#log.warn(
          { event: 'worker.supervisor.terminated' },
          'Terminated project workers after the close deadline'
        )
      })
      .catch((err) => {
        this.#log.error(
          { event: 'worker.supervisor.termination_failed', err },
          'Failed to terminate project workers after the close deadline'
        )
        throw new Error('Failed to terminate project workers', { cause: err })
      })
    return this.#termination
  }
}
