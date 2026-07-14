import type { ProjectSession } from '../project/project-transaction.js';
import { type SourceJob, SourceJobRepository } from './job-repository.js';
import { SourceScheduler } from './scheduler.js';

export type SourceJobProcessor = (
  job: SourceJob,
  signal: AbortSignal,
  jobs: SourceJobRepository,
) => Promise<void>;
export type SourceJobBatchProcessor = (
  jobsToProcess: SourceJob[],
  signal: AbortSignal,
  jobs: SourceJobRepository,
) => Promise<void>;

/** Owns one scheduler for the currently active portable project. */
export class SourceRuntime {
  private scheduler: SourceScheduler | null = null;
  private sessionId: string | null = null;
  private processor: SourceJobProcessor | null = null;
  private batchProcessor: SourceJobBatchProcessor | null = null;
  private jobs: SourceJobRepository | null = null;
  private recoveryHandler:
    | ((session: ProjectSession, jobs: SourceJobRepository) => Promise<void>)
    | null = null;

  constructor(private getActiveSession: () => ProjectSession | null) {}

  setProcessor(processor: SourceJobProcessor): void {
    this.processor = processor;
    if (this.scheduler) void this.scheduler.drain();
  }
  setBatchProcessor(processor: SourceJobBatchProcessor): void {
    this.batchProcessor = processor;
    if (this.scheduler) void this.scheduler.drain();
  }
  setRecoveryHandler(
    handler: (session: ProjectSession, jobs: SourceJobRepository) => Promise<void>,
  ): void {
    this.recoveryHandler = handler;
  }
  wake(): void {
    if (this.scheduler && this.processor) void this.scheduler.drain();
  }
  async enqueue(job: SourceJob): Promise<SourceJob> {
    if (!this.jobs) throw new Error('SOURCE_RUNTIME_INACTIVE');
    const created = await this.jobs.enqueue(job);
    this.wake();
    return created;
  }
  activeJobCount(sourceId: string): number {
    return (
      this.jobs
        ?.list()
        .filter(
          (job) =>
            job.sourceId === sourceId && !['completed', 'failed', 'superseded'].includes(job.state),
        ).length ?? 0
    );
  }
  async supersedeSource(sourceId: string): Promise<void> {
    await this.jobs?.supersedeSource(sourceId);
  }
  getJobRepository(): SourceJobRepository | null {
    return this.jobs;
  }

  async activate(): Promise<void> {
    const session = this.getActiveSession();
    if (!session || session.sessionId === this.sessionId) return;
    await this.scheduler?.shutdown();
    const jobs = new SourceJobRepository(session.projectRoot);
    await jobs.initialize();
    const scheduler = new SourceScheduler({
      jobs,
      isActiveSession: (job) => {
        const active = this.getActiveSession();
        return Boolean(
          active && active.projectId === job.projectId && active.sessionId === session.sessionId,
        );
      },
      execute: async (job, signal) => {
        if (!this.processor) throw new Error('SOURCE_PROCESSOR_NOT_READY');
        await this.processor(job, signal, jobs);
      },
      executeBatch: this.batchProcessor
        ? async (batch, signal) => {
            if (!this.batchProcessor) throw new Error('SOURCE_PROCESSOR_NOT_READY');
            await this.batchProcessor(batch, signal, jobs);
          }
        : undefined,
      onSettled: async () => {
        if (this.getActiveSession()?.sessionId === session.sessionId)
          await this.recoveryHandler?.(session, jobs);
      },
    });
    await scheduler.recover();
    await this.recoveryHandler?.(session, jobs);
    this.scheduler = scheduler;
    this.jobs = jobs;
    this.sessionId = session.sessionId;
    if (this.processor) void scheduler.drain();
  }

  async shutdown(): Promise<void> {
    const scheduler = this.scheduler;
    this.scheduler = null;
    this.jobs = null;
    this.sessionId = null;
    await scheduler?.shutdown();
  }
}
