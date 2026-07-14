import { randomUUID } from 'node:crypto';
import type { SourceJob, SourceJobRepository } from './job-repository.js';

export class SourceJobExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfter?: string,
    readonly referenceCode?: string,
  ) {
    super(code);
  }
}

export class SourceScheduler {
  private controllers = new Map<string, AbortController>();
  private stopped = false;
  private draining: Promise<void> | null = null;
  private rerunRequested = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private options: {
      jobs: SourceJobRepository;
      isActiveSession(job: SourceJob): boolean;
      execute(job: SourceJob, signal: AbortSignal): Promise<void>;
      onSettled?(job: SourceJob): Promise<void>;
      random?: () => number;
      now?: () => number;
      setTimer?: typeof setTimeout;
      clearTimer?: typeof clearTimeout;
    },
  ) {}

  async recover(): Promise<void> {
    await this.options.jobs.recoverExpiredLeases();
  }

  drain(): Promise<void> {
    this.stopped = false;
    this.clearRetryTimer();
    if (this.draining) {
      this.rerunRequested = true;
      return this.draining;
    }
    const current = Promise.all([this.worker('parse'), this.worker('embed'), this.worker('embed')])
      .then(() => undefined)
      .finally(() => {
        if (this.draining === current) this.draining = null;
        if (this.stopped) return;
        if (this.rerunRequested) {
          this.rerunRequested = false;
          void this.drain();
        } else this.scheduleEarliestRetry();
      });
    this.draining = current;
    return current;
  }

  shutdown(): void {
    this.stopped = true;
    this.rerunRequested = false;
    this.clearRetryTimer();
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
          this.options.now ?? Date.now,
        );
        await this.options.jobs.fail(job.jobId, {
          retryable: known?.retryable ?? true,
          retryAt: new Date((this.options.now ?? Date.now)() + delay).toISOString(),
          errorCode: known?.code ?? 'SOURCE_INTERNAL',
          referenceCode: known?.referenceCode,
        });
      } finally {
        this.controllers.delete(job.jobId);
      }
      const settled = this.options.jobs.get(job.jobId);
      if (settled) await this.options.onSettled?.(settled);
    }
  }

  private scheduleEarliestRetry(): void {
    const retryAt = this.options.jobs.earliestRetryAt((job) => this.options.isActiveSession(job));
    if (!retryAt) return;
    const delay = Math.max(0, Date.parse(retryAt) - (this.options.now ?? Date.now)());
    this.retryTimer = (this.options.setTimer ?? setTimeout)(() => {
      this.retryTimer = null;
      void this.drain();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (!this.retryTimer) return;
    (this.options.clearTimer ?? clearTimeout)(this.retryTimer);
    this.retryTimer = null;
  }
}

export function retryDelay(
  attempt: number,
  retryAfter: string | undefined,
  random: () => number,
  now: () => number = Date.now,
): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 60_000);
    const at = Date.parse(retryAfter);
    if (Number.isFinite(at)) return Math.max(0, Math.min(at - now(), 60_000));
  }
  const ceiling = Math.min(60_000, 500 * 2 ** Math.max(0, attempt));
  return Math.max(0, Math.floor(ceiling * Math.min(1, Math.max(0, random()))));
}
