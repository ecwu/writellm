import { randomUUID } from 'node:crypto';
import { EMBEDDING_MAX_BATCH_SIZE } from './embedding-limits.js';
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
  private workerIds = new Set<string>();
  constructor(
    private options: {
      jobs: SourceJobRepository;
      isActiveSession(job: SourceJob): boolean;
      execute(job: SourceJob, signal: AbortSignal): Promise<void>;
      executeBatch?(jobs: SourceJob[], signal: AbortSignal): Promise<void>;
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

  async shutdown(): Promise<void> {
    this.stopped = true;
    this.rerunRequested = false;
    this.clearRetryTimer();
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    const workerIds = [...this.workerIds];
    this.workerIds.clear();
    await this.options.jobs.releaseLeases(workerIds);
  }

  private async worker(type: SourceJob['type']): Promise<void> {
    const workerId = `${type}-${randomUUID()}`;
    this.workerIds.add(workerId);
    while (!this.stopped) {
      const leased =
        type === 'embed' && this.options.executeBatch
          ? await this.options.jobs.leaseBatch(
              workerId,
              60_000,
              EMBEDDING_MAX_BATCH_SIZE,
              (candidate) => candidate.type === type && this.options.isActiveSession(candidate),
              (first, candidate) =>
                candidate.sourceId === first.sourceId &&
                candidate.sourceVersionId === first.sourceVersionId &&
                candidate.indexProfileId === first.indexProfileId,
            )
          : [
              await this.options.jobs.leaseNext(
                workerId,
                60_000,
                (candidate) => candidate.type === type && this.options.isActiveSession(candidate),
              ),
            ].filter((job): job is SourceJob => Boolean(job));
      if (leased.length === 0) break;
      const job = leased[0];
      const controller = new AbortController();
      for (const current of leased) this.controllers.set(current.jobId, controller);
      const heartbeat = setInterval(() => {
        void this.options.jobs
          .renewLeases(
            leased.map((current) => current.jobId),
            workerId,
            60_000,
          )
          .then((renewed) => {
            if (!renewed) controller.abort();
          });
      }, 20_000);
      try {
        if (leased.some((current) => !this.options.isActiveSession(current)))
          throw new SourceJobExecutionError('PROJECT_SESSION_STALE', true);
        if (leased.length > 1 && this.options.executeBatch)
          await this.options.executeBatch(leased, controller.signal);
        else await this.options.execute(job, controller.signal);
        if (
          controller.signal.aborted ||
          leased.some((current) => !this.options.isActiveSession(current))
        )
          throw new SourceJobExecutionError('PROJECT_SESSION_STALE', true);
        for (const current of leased) {
          const completed = await this.options.jobs.complete(current.jobId, workerId);
          if (!completed) throw new SourceJobExecutionError('PROJECT_SESSION_STALE', true);
        }
      } catch (error) {
        const known = error instanceof SourceJobExecutionError ? error : null;
        for (const current of leased) {
          const delay = retryDelay(
            current.attempt,
            known?.retryAfter,
            this.options.random ?? Math.random,
            this.options.now ?? Date.now,
          );
          await this.options.jobs.fail(
            current.jobId,
            {
              retryable: known?.retryable ?? true,
              retryAt: new Date((this.options.now ?? Date.now)() + delay).toISOString(),
              errorCode: known?.code ?? 'SOURCE_INTERNAL',
              referenceCode: known?.referenceCode,
            },
            workerId,
          );
        }
      } finally {
        clearInterval(heartbeat);
        for (const current of leased) this.controllers.delete(current.jobId);
      }
      const settled = this.options.jobs.get(job.jobId);
      if (settled) await this.options.onSettled?.(settled);
    }
    this.workerIds.delete(workerId);
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
