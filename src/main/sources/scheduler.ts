import { randomUUID } from 'node:crypto';
import type { SourceJob, SourceJobRepository } from './job-repository.js';

export class SourceJobExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfter?: string,
  ) {
    super(code);
  }
}

export class SourceScheduler {
  private controllers = new Map<string, AbortController>();
  private stopped = false;
  constructor(
    private options: {
      jobs: SourceJobRepository;
      isActiveSession(job: SourceJob): boolean;
      execute(job: SourceJob, signal: AbortSignal): Promise<void>;
      random?: () => number;
      now?: () => number;
    },
  ) {}

  async recover(): Promise<void> {
    await this.options.jobs.recoverExpiredLeases();
  }

  async drain(): Promise<void> {
    this.stopped = false;
    await Promise.all([this.worker('parse'), this.worker('embed'), this.worker('embed')]);
  }

  shutdown(): void {
    this.stopped = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }

  private async worker(type: SourceJob['type']): Promise<void> {
    const workerId = `${type}-${randomUUID()}`;
    while (!this.stopped) {
      const job = await this.options.jobs.leaseNext(
        workerId,
        60_000,
        (candidate) => candidate.type === type && this.options.isActiveSession(candidate),
      );
      if (!job) return;
      const controller = new AbortController();
      this.controllers.set(job.jobId, controller);
      try {
        if (!this.options.isActiveSession(job))
          throw new SourceJobExecutionError('PROJECT_SESSION_STALE', true);
        await this.options.execute(job, controller.signal);
        if (controller.signal.aborted || !this.options.isActiveSession(job))
          throw new SourceJobExecutionError('PROJECT_SESSION_STALE', true);
        await this.options.jobs.complete(job.jobId);
      } catch (error) {
        const known = error instanceof SourceJobExecutionError ? error : null;
        const delay = retryDelay(
          job.attempt,
          known?.retryAfter,
          this.options.random ?? Math.random,
        );
        await this.options.jobs.fail(job.jobId, {
          retryable: known?.retryable ?? true,
          retryAt: new Date((this.options.now ?? Date.now)() + delay).toISOString(),
          errorCode: known?.code ?? 'SOURCE_INTERNAL',
        });
      } finally {
        this.controllers.delete(job.jobId);
      }
    }
  }
}

export function retryDelay(
  attempt: number,
  retryAfter: string | undefined,
  random: () => number,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, Math.min(at - Date.now(), 60_000));
  }
  const ceiling = Math.min(60_000, 500 * 2 ** Math.max(0, attempt));
  return Math.max(0, Math.floor(ceiling * Math.min(1, Math.max(0, random()))));
}
