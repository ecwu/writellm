import { mkdir, open, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type SourceJobState =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'completed'
  | 'failed'
  | 'superseded';
export type SourceJob = {
  kind: 'writellm.source-job';
  schemaVersion: 1;
  jobId: string;
  projectId: string;
  sourceId: string;
  sourceVersionId: string;
  chunkId?: string;
  indexProfileId?: string;
  type: 'parse' | 'embed';
  state: SourceJobState;
  attempt: number;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
  retryAt?: string;
  lease?: { workerId: string; expiresAt: string };
  errorCode?: string;
  errorMessage?: string;
  errorRetryable?: boolean;
  failedAt?: string;
  progress?: { completed: number; total: number; stage: 'queued' | 'parsing' | 'indexing' };
  remoteBatchId?: string;
  resultArchive?: string;
};
type LedgerRecord = { kind: 'writellm.source-job-ledger'; schemaVersion: 1; job: SourceJob };
type Snapshot = { kind: 'writellm.source-job-snapshot'; schemaVersion: 1; jobs: SourceJob[] };

export class SourceJobRepository {
  private jobs = new Map<string, SourceJob>();
  private idempotency = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private projectRoot: string,
    private now = () => new Date().toISOString(),
  ) {}

  async initialize(): Promise<void> {
    await mkdir(this.directory(), { recursive: true });
    try {
      const snapshot = JSON.parse(await readFile(this.snapshotPath(), 'utf8')) as Snapshot;
      if (snapshot.kind === 'writellm.source-job-snapshot' && snapshot.schemaVersion === 1)
        for (const job of snapshot.jobs) this.restore(job);
    } catch {}
    try {
      const lines = (await readFile(this.ledgerPath(), 'utf8')).split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const record = JSON.parse(line) as LedgerRecord;
          if (record.kind === 'writellm.source-job-ledger' && record.schemaVersion === 1)
            this.restore(record.job);
        } catch {}
      }
    } catch {}
  }

  get(jobId: string): SourceJob | undefined {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  }
  list(): SourceJob[] {
    return [...this.jobs.values()].map((job) => structuredClone(job));
  }

  enqueue(input: SourceJob): Promise<SourceJob> {
    return this.serial(async () => {
      const duplicateId = this.idempotency.get(input.idempotencyKey);
      if (duplicateId) {
        const duplicate = this.jobs.get(duplicateId);
        if (duplicate) return structuredClone(duplicate);
      }
      const job = normalizeJob(input, this.now());
      await this.persist(job);
      this.restore(job);
      return structuredClone(job);
    });
  }

  leaseNext(
    workerId: string,
    durationMs: number,
    predicate?: (job: SourceJob) => boolean,
  ): Promise<SourceJob | null> {
    return this.serial(async () => {
      const nowMs = Date.parse(this.now());
      const job = [...this.jobs.values()].find(
        (candidate) =>
          (candidate.state === 'queued' ||
            (candidate.state === 'retrying' && Date.parse(candidate.retryAt ?? '0') <= nowMs)) &&
          (!predicate || predicate(candidate)),
      );
      if (!job) return null;
      const next: SourceJob = {
        ...job,
        state: 'running',
        attempt: job.attempt + 1,
        updatedAt: this.now(),
        lease: { workerId, expiresAt: new Date(nowMs + durationMs).toISOString() },
      };
      await this.persist(next);
      this.restore(next);
      return structuredClone(next);
    });
  }

  complete(jobId: string): Promise<void> {
    return this.update(jobId, (job) => ({
      ...job,
      state: 'completed',
      lease: undefined,
      retryAt: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      errorRetryable: undefined,
      failedAt: undefined,
      progress:
        job.progress && job.progress.total > 0
          ? { ...job.progress, completed: job.progress.total }
          : job.progress,
    }));
  }
  patch(
    jobId: string,
    fields: Partial<Pick<SourceJob, 'remoteBatchId' | 'resultArchive' | 'progress'>>,
  ): Promise<void> {
    return this.update(jobId, (job) => ({
      ...job,
      ...fields,
      ...(fields.progress ? { progress: normalizeProgress(fields.progress) } : {}),
    }));
  }
  fail(
    jobId: string,
    input: { retryable: boolean; retryAt?: string; errorCode?: string; errorMessage?: string },
  ): Promise<void> {
    return this.update(jobId, (job) => {
      const attempt = job.state === 'running' ? job.attempt : job.attempt + 1;
      const retrying = input.retryable && attempt < 6;
      return {
        ...job,
        state: retrying ? 'retrying' : 'failed',
        retryAt: retrying ? input.retryAt : undefined,
        errorCode: input.errorCode,
        errorMessage: safeErrorMessage(input.errorMessage),
        errorRetryable: retrying,
        failedAt: retrying ? undefined : this.now(),
        lease: undefined,
        attempt,
      };
    });
  }
  earliestRetryAt(predicate?: (job: SourceJob) => boolean): string | undefined {
    let earliest: string | undefined;
    for (const job of this.jobs.values()) {
      if (job.state !== 'retrying' || !job.retryAt || (predicate && !predicate(job))) continue;
      if (!earliest || Date.parse(job.retryAt) < Date.parse(earliest)) earliest = job.retryAt;
    }
    return earliest;
  }
  supersedeSource(sourceId: string): Promise<void> {
    return this.serial(async () => {
      for (const job of [...this.jobs.values()]) {
        if (job.sourceId !== sourceId || ['completed', 'superseded'].includes(job.state)) continue;
        const next: SourceJob = {
          ...job,
          state: 'superseded',
          lease: undefined,
          updatedAt: this.now(),
        };
        await this.persist(next);
        this.restore(next);
      }
    });
  }
  recoverExpiredLeases(): Promise<void> {
    return this.serial(async () => {
      const now = Date.parse(this.now());
      for (const job of [...this.jobs.values()]) {
        if (job.state !== 'running' || Date.parse(job.lease?.expiresAt ?? '0') > now) continue;
        const next: SourceJob = {
          ...job,
          state: 'queued',
          lease: undefined,
          updatedAt: this.now(),
        };
        await this.persist(next);
        this.restore(next);
      }
    });
  }
  async compact(): Promise<void> {
    await this.serial(async () => {
      const snapshot: Snapshot = {
        kind: 'writellm.source-job-snapshot',
        schemaVersion: 1,
        jobs: [...this.jobs.values()],
      };
      const temp = `${this.snapshotPath()}.tmp`;
      await writeFile(temp, `${JSON.stringify(snapshot)}\n`);
      await rename(temp, this.snapshotPath());
      await writeFile(this.ledgerPath(), '');
    });
  }

  private update(jobId: string, change: (job: SourceJob) => SourceJob): Promise<void> {
    return this.serial(async () => {
      const current = this.jobs.get(jobId);
      if (!current) return;
      const next = { ...change(current), updatedAt: this.now() };
      await this.persist(next);
      this.restore(next);
    });
  }
  private async persist(job: SourceJob): Promise<void> {
    const record: LedgerRecord = { kind: 'writellm.source-job-ledger', schemaVersion: 1, job };
    const handle = await open(this.ledgerPath(), 'a');
    try {
      await handle.writeFile(`${JSON.stringify(record)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  private restore(job: SourceJob): void {
    if (!validJob(job)) return;
    this.jobs.set(job.jobId, job);
    this.idempotency.set(job.idempotencyKey, job.jobId);
  }
  private directory() {
    return path.join(this.projectRoot, 'runtime', 'source-jobs');
  }
  private ledgerPath() {
    return path.join(this.directory(), 'jobs.jsonl');
  }
  private snapshotPath() {
    return path.join(this.directory(), 'snapshots.json');
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

function normalizeJob(input: SourceJob, now: string): SourceJob {
  return {
    ...input,
    kind: 'writellm.source-job',
    schemaVersion: 1,
    state: 'queued',
    attempt: 0,
    updatedAt: now,
  };
}
function validJob(value: SourceJob): boolean {
  return (
    value?.kind === 'writellm.source-job' &&
    value.schemaVersion === 1 &&
    typeof value.jobId === 'string' &&
    typeof value.idempotencyKey === 'string'
  );
}

function normalizeProgress(
  progress: NonNullable<SourceJob['progress']>,
): NonNullable<SourceJob['progress']> {
  const total = Number.isFinite(progress.total) ? Math.max(0, Math.floor(progress.total)) : 0;
  const completed = Number.isFinite(progress.completed)
    ? Math.max(0, Math.min(total, Math.floor(progress.completed)))
    : 0;
  return { ...progress, completed, total };
}

function safeErrorMessage(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value.replace(/[\r\n\t]/g, ' ').slice(0, 512);
}
