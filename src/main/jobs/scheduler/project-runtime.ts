import type { Logger } from 'pino'
import type { JobStore } from '../job-store'
import { JobHandlerRegistry } from './job-handler-registry'
import { JobScheduler } from './job-scheduler'
import { WorkerSupervisor } from './worker-supervisor'

export interface ProjectRuntimeOptions {
  projectId: string
  projectSessionId: string
  jobs: JobStore
  registry: JobHandlerRegistry
  log: Pick<Logger, 'info' | 'warn' | 'error'>
  pollIntervalMs?: number
  closeTimeoutMs?: number
  leaseRecoveryIntervalMs?: number
  terminateWorkers?: () => void | Promise<void>
}

export class ProjectRuntime {
  readonly scheduler: JobScheduler
  readonly supervisor: WorkerSupervisor

  constructor(options: ProjectRuntimeOptions) {
    this.supervisor = new WorkerSupervisor({
      projectSessionId: options.projectSessionId,
      log: options.log,
      terminateWorkers: options.terminateWorkers
    })
    this.scheduler = new JobScheduler({
      jobs: options.jobs,
      registry: options.registry,
      supervisor: this.supervisor,
      projectId: options.projectId,
      log: options.log,
      pollIntervalMs: options.pollIntervalMs,
      closeTimeoutMs: options.closeTimeoutMs,
      leaseRecoveryIntervalMs: options.leaseRecoveryIntervalMs
    })
  }

  start(): void {
    this.scheduler.start()
  }

  stopClaims(): void {
    this.scheduler.stopClaims()
  }

  park(): Promise<void> {
    return this.scheduler.park()
  }

  stop(): Promise<void> {
    return this.scheduler.stop()
  }
}

export function createProjectHandlerRegistry(): JobHandlerRegistry {
  // Domain checkpoints register concrete handlers; unknown work remains durable and unclaimed.
  return new JobHandlerRegistry()
}
