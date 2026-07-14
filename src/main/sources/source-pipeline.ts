import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { RetrySourceResult, SourceErrorCode, SourceSummary } from '../../shared/sources.js';
import type { ProjectSession } from '../project/project-transaction.js';
import { readZipArchive } from './archive-reader.js';
import { normalizeMinerUArtifact } from './artifact-normalizer.js';
import { EmbeddingAdapter } from './embedding-adapter.js';
import { IndexRepository } from './index-repository.js';
import type { SourceJob, SourceJobRepository } from './job-repository.js';
import { MinerUAdapter, MinerUTransportError } from './mineru-adapter.js';
import { SourceJobExecutionError } from './scheduler.js';
import type { SourceServiceCredentials } from './service-credentials.js';
import type { SourceHttpRequest } from './service-validator.js';
import type { SourceEvents } from './source-events.js';
import type { SourceRepository } from './source-repository.js';

export class SourcePipeline {
  private index: IndexRepository;
  constructor(
    private options: {
      credentials: SourceServiceCredentials;
      repository: SourceRepository;
      events: SourceEvents;
      getActiveSession(): ProjectSession | null;
      request?: SourceHttpRequest;
      mineru?: (credential: () => Promise<string>) => MinerUAdapter;
      embedding?: (credential: () => Promise<string>) => EmbeddingAdapter;
      wake?: () => void;
      attemptDeadlineMs?: number;
      pollIntervalMs?: number;
      waitingFileRetryPolls?: number;
    },
  ) {
    this.index = new IndexRepository(
      (current) => this.options.getActiveSession()?.sessionId === current.sessionId,
    );
  }

  async process(job: SourceJob, signal: AbortSignal, jobs: SourceJobRepository): Promise<void> {
    if (job.type === 'embed')
      return withAttemptDeadline(
        signal,
        this.options.attemptDeadlineMs ?? 120_000,
        'SOURCE_SILICONFLOW_TEMPORARY',
        (attemptSignal) => this.processEmbedding(job, attemptSignal, jobs),
      );
    const session = this.requireSession(job);
    await this.publishTransientParseState(session, job, job.attempt > 1);
    try {
      const summary = this.options.credentials.summary('mineru');
      if (!summary.revision || !summary.available)
        throw new SourceJobExecutionError('SOURCE_MINERU_NOT_CONFIGURED', false);
      const revision = summary.revision;
      const credential = () => this.options.credentials.readCredential('mineru', revision);
      const adapter =
        this.options.mineru?.(credential) ?? new MinerUAdapter(credential, this.options.request);
      const current = jobs.get(job.jobId) ?? job;
      let remoteBatchId = current.remoteBatchId;
      if (!remoteBatchId) {
        let lastUploadPercent = -1;
        const submitted = await withAttemptDeadline(
          signal,
          this.options.attemptDeadlineMs ?? 120_000,
          'SOURCE_MINERU_TEMPORARY',
          (attemptSignal) =>
            adapter.submitLocalPdf({
              jobId: job.jobId,
              dataId: `${job.sourceId}:${job.sourceVersionId}`,
              absolutePath: path.join(session.projectRoot, 'sources', job.sourceId, 'original.pdf'),
              modelVersion: 'vlm',
              ocr: true,
              tables: true,
              formulas: true,
              signal: attemptSignal,
              onBatchAllocated: async (allocatedBatchId) => {
                remoteBatchId = allocatedBatchId;
                await jobs.patch(job.jobId, { remoteBatchId: allocatedBatchId });
              },
              onUploadProgress: async (completed, total) => {
                const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
                if (percent === lastUploadPercent) return;
                lastUploadPercent = percent;
                const progress = {
                  completed: Math.max(0, Math.min(100, percent)),
                  total: 100,
                  stage: 'uploading' as const,
                };
                await jobs.patch(job.jobId, { progress });
                await this.publishTransientParseState(
                  session,
                  job,
                  job.attempt > 1,
                  progress.completed,
                  'uploading',
                );
              },
            }),
        );
        remoteBatchId = submitted.remoteBatchId;
        if (jobs.get(job.jobId)?.remoteBatchId !== remoteBatchId)
          await jobs.patch(job.jobId, { remoteBatchId });
        await jobs.patch(job.jobId, {
          progress: { completed: 0, total: 100, stage: 'parsing' },
        });
        await this.publishTransientParseState(session, job, job.attempt > 1);
      }
      if (!remoteBatchId)
        throw new SourceJobExecutionError('SOURCE_MINERU_MALFORMED', false);
      const durableBatchId = remoteBatchId;
      let resultUrl: string | undefined;
      let waitingFilePolls = 0;
      while (!resultUrl) {
        const observation = await withAttemptDeadline(
          signal,
          this.options.attemptDeadlineMs ?? 120_000,
          'SOURCE_MINERU_TEMPORARY',
          (attemptSignal) => adapter.poll({ remoteBatchId: durableBatchId, signal: attemptSignal }),
        );
        if (observation.state === 'done') resultUrl = observation.resultUrl;
        else if (observation.state === 'failed')
          throw new SourceJobExecutionError(
            observation.code,
            observation.retryable,
            undefined,
            observation.referenceCode,
          );
        else {
          if (observation.state === 'pending' && observation.providerState === 'waiting-file') {
            waitingFilePolls += 1;
            if (waitingFilePolls >= (this.options.waitingFileRetryPolls ?? 12)) {
              await jobs.patch(job.jobId, { remoteBatchId: undefined });
              throw new SourceJobExecutionError(
                'SOURCE_MINERU_TEMPORARY',
                true,
                undefined,
                'WAITING_FILE_TIMEOUT',
              );
            }
          } else waitingFilePolls = 0;
          const completed = Math.max(0, Math.min(100, Math.round(observation.progress)));
          await jobs.patch(job.jobId, {
            progress: { completed, total: 100, stage: 'parsing' },
          });
          await this.publishTransientParseState(session, job, job.attempt > 1, completed);
          await waitAbortable(this.options.pollIntervalMs ?? 5_000, signal);
        }
      }
      this.requireSession(job);
      const directory = path.join(session.projectRoot, 'runtime', 'source-downloads');
      await mkdir(directory, { recursive: true });
      const archive = path.join(directory, `${job.jobId}.zip`);
      try {
        await rm(archive, { force: true });
        await withAttemptDeadline(
          signal,
          this.options.attemptDeadlineMs ?? 120_000,
          'SOURCE_MINERU_TEMPORARY',
          (attemptSignal) =>
            adapter.download({ resultUrl, destination: archive, signal: attemptSignal }),
        );
        const artifact = normalizeMinerUArtifact(
          job.sourceVersionId,
          await readZipArchive(archive),
        );
        this.requireSession(job);
        const source = await this.options.repository.publishParse(
          session,
          job.sourceId,
          job.sourceVersionId,
          artifact,
        );
        for (const block of artifact.blocks.filter((value) => value.eligible))
          await jobs.enqueue({
            kind: 'writellm.source-job',
            schemaVersion: 1,
            jobId: randomUUID(),
            projectId: job.projectId,
            sourceId: job.sourceId,
            sourceVersionId: job.sourceVersionId,
            chunkId: block.chunkId,
            indexProfileId: 'siliconflow-bge-m3-v1',
            type: 'embed',
            state: 'queued',
            attempt: 0,
            idempotencyKey: `${job.sourceId}:${job.sourceVersionId}:${block.chunkId}:siliconflow-bge-m3-v1`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        await this.publishSource(session, source);
      } finally {
        await rm(archive, { force: true });
      }
    } catch (cause) {
      if (cause instanceof MinerUTransportError && cause.phase === 'upload')
        await jobs.patch(job.jobId, { remoteBatchId: undefined });
      const error = normalizePipelineError(cause);
      if (error.retryable && job.attempt < 6)
        await this.publishTransientParseState(
          session,
          job,
          true,
          jobs.get(job.jobId)?.progress?.completed ?? 0,
        );
      else {
        const updated = await this.options.repository.markParseFailed(
          session,
          job.sourceId,
          job.sourceVersionId,
          error.code as SourceErrorCode,
          error.referenceCode,
        );
        await this.publishSource(session, updated);
      }
      throw error;
    }
  }

  async reconcile(session: ProjectSession, jobs: SourceJobRepository): Promise<void> {
    this.options.repository.setJobRepository(jobs);
    const bySource = new Map<string, SourceJob[]>();
    for (const job of jobs.list()) {
      const grouped = bySource.get(job.sourceId) ?? [];
      grouped.push(job);
      bySource.set(job.sourceId, grouped);
    }
    for (const [sourceId, sourceJobs] of bySource) {
      const source = await this.options.repository.get(session, sourceId).catch(() => null);
      if (!source) continue;
      const current = sourceJobs.filter((job) => job.sourceVersionId === source.sourceVersionId);
      const parseFailure = current
        .filter((job) => job.type === 'parse' && job.state === 'failed')
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
      if (parseFailure && !source.parseSummary.markdownAvailable) {
        const updated = await this.options.repository.markParseFailed(
          session,
          sourceId,
          source.sourceVersionId,
          sourceErrorCode(parseFailure.errorCode),
          parseFailure.referenceCode,
        );
        await this.publishSource(session, updated);
        continue;
      }
      if (!source.parseSummary.markdownAvailable) continue;
      const [manifest, blocks] = await Promise.all([
        this.index.readManifest(session, sourceId, source.sourceVersionId).catch(() => null),
        this.options.repository.getAllBlocks(session, sourceId),
      ]);
      const eligible = new Set(
        blocks
          .filter((block) => block.eligible)
          .map((block) => `${block.chunkId}:${block.contentHash}`),
      );
      const indexedChunks = new Set(
        (manifest?.records ?? [])
          .filter((record) => eligible.has(`${record.chunkId}:${record.contentHash}`))
          .map((record) => record.chunkId),
      );
      const failures = new Map<string, SourceJob>();
      for (const job of current) {
        if (
          job.type === 'embed' &&
          job.chunkId &&
          job.state === 'failed' &&
          !indexedChunks.has(job.chunkId)
        )
          failures.set(job.chunkId, job);
      }
      const failure = [...failures.values()].sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      )[0];
      const absoluteIndexed = Math.min(source.eligibility.eligible, indexedChunks.size);
      const absoluteFailed = Math.min(source.eligibility.eligible - absoluteIndexed, failures.size);
      if (
        source.eligibility.indexed !== absoluteIndexed ||
        source.eligibility.failed !== absoluteFailed ||
        (absoluteIndexed + absoluteFailed >= source.eligibility.eligible &&
          source.state === 'indexing')
      ) {
        const updated = await this.options.repository.updateIndexProgress(
          session,
          sourceId,
          source.sourceVersionId,
          absoluteIndexed,
          absoluteFailed,
          sourceErrorCode(failure?.errorCode, 'SOURCE_INDEX_FAILED'),
        );
        await this.publishSource(session, updated);
      }
    }
  }

  async retrySource(
    session: ProjectSession,
    sourceId: string,
    expectedSourceRevision: number,
    jobs: SourceJobRepository,
  ): Promise<RetrySourceResult> {
    const marked = await this.options.repository.markRetrying(
      session,
      sourceId,
      expectedSourceRevision,
    );
    if (marked.status === 'conflict') return marked;
    const blocks = await this.options.repository.getAllBlocks(session, sourceId);
    let enqueued = 0;
    if (blocks.length === 0) {
      await jobs.enqueue({
        kind: 'writellm.source-job',
        schemaVersion: 1,
        jobId: randomUUID(),
        projectId: session.projectId,
        sourceId,
        sourceVersionId: marked.sourceVersionId,
        type: 'parse',
        state: 'queued',
        attempt: 0,
        idempotencyKey: `${sourceId}:${marked.sourceVersionId}:parse:retry:${marked.source.revision}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      enqueued += 1;
    } else {
      const indexed = await this.index
        .readManifest(session, sourceId, marked.sourceVersionId)
        .then(
          (manifest) =>
            new Set(manifest.records.map((record) => `${record.chunkId}:${record.contentHash}`)),
        )
        .catch(() => new Set<string>());
      for (const block of blocks.filter(
        (value) => value.eligible && !indexed.has(`${value.chunkId}:${value.contentHash}`),
      )) {
        await jobs.enqueue({
          kind: 'writellm.source-job',
          schemaVersion: 1,
          jobId: randomUUID(),
          projectId: session.projectId,
          sourceId,
          sourceVersionId: marked.sourceVersionId,
          chunkId: block.chunkId,
          indexProfileId: 'siliconflow-bge-m3-v1',
          type: 'embed',
          state: 'queued',
          attempt: 0,
          idempotencyKey: `${sourceId}:${marked.sourceVersionId}:${block.chunkId}:retry:${marked.source.revision}`,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
        enqueued += 1;
      }
    }
    if (enqueued === 0) {
      await jobs.enqueue({
        kind: 'writellm.source-job',
        schemaVersion: 1,
        jobId: randomUUID(),
        projectId: session.projectId,
        sourceId,
        sourceVersionId: marked.sourceVersionId,
        type: 'parse',
        state: 'queued',
        attempt: 0,
        idempotencyKey: `${sourceId}:${marked.sourceVersionId}:parse:retry:${marked.source.revision}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    this.options.events.publish(
      {
        catalogRevision: (await this.options.repository.list(session, { limit: 1 }))
          .catalogRevision,
        type: 'source-upserted',
        source: marked.source,
      },
      session.sessionId,
    );
    this.options.wake?.();
    return { status: 'accepted', source: marked.source };
  }

  private async processEmbedding(
    job: SourceJob,
    signal: AbortSignal,
    jobs: SourceJobRepository,
  ): Promise<void> {
    const session = this.requireSession(job);
    if (!job.chunkId) throw new SourceJobExecutionError('SOURCE_INDEX_FAILED', false);
    const service = this.options.credentials.summary('siliconflow');
    if (!service.revision || !service.available)
      throw new SourceJobExecutionError('SOURCE_SILICONFLOW_NOT_CONFIGURED', false);
    const revision = service.revision;
    const credential = () => this.options.credentials.readCredential('siliconflow', revision);
    const adapter =
      this.options.embedding?.(credential) ??
      new EmbeddingAdapter(credential, this.options.request);
    const block = (await this.options.repository.getAllBlocks(session, job.sourceId)).find(
      (value) => value.chunkId === job.chunkId && value.eligible,
    );
    if (!block) throw new SourceJobExecutionError('SOURCE_INDEX_FAILED', false);
    try {
      const [embedded] = await adapter.embed({
        jobId: job.jobId,
        model: 'BAAI/bge-m3',
        texts: [{ chunkId: block.chunkId, contentHash: block.contentHash, text: block.plainText }],
        signal,
      });
      this.requireSession(job);
      const source = await this.options.repository.get(session, job.sourceId);
      if (!source) throw new SourceJobExecutionError('SOURCE_NOT_FOUND', false);
      const records = await this.index.saveVectors(session, {
        sourceId: job.sourceId,
        sourceVersionId: job.sourceVersionId,
        revision: source.revision + 1,
        values: [embedded],
      });
      const failed = countFailedEmbeddingChunks(job, jobs.list());
      const updated = await this.options.repository.updateIndexProgress(
        session,
        job.sourceId,
        job.sourceVersionId,
        records.length,
        failed,
      );
      await this.publishSource(session, updated);
    } catch (cause) {
      const error = normalizeEmbeddingError(cause);
      if (!error.retryable || job.attempt >= 6) {
        const manifest = await this.index
          .readManifest(session, job.sourceId, job.sourceVersionId)
          .catch(() => null);
        const failedChunks = new Set(
          jobs
            .list()
            .filter(
              (candidate) =>
                candidate.type === 'embed' &&
                candidate.sourceId === job.sourceId &&
                candidate.sourceVersionId === job.sourceVersionId &&
                candidate.chunkId &&
                candidate.state === 'failed',
            )
            .map((candidate) => candidate.chunkId!),
        );
        if (job.chunkId) failedChunks.add(job.chunkId);
        for (const record of manifest?.records ?? []) failedChunks.delete(record.chunkId);
        const updated = await this.options.repository.updateIndexProgress(
          session,
          job.sourceId,
          job.sourceVersionId,
          manifest?.records.length ?? 0,
          failedChunks.size,
          sourceErrorCode(error.code, 'SOURCE_INDEX_FAILED'),
        );
        await this.publishSource(session, updated);
      }
      throw error;
    }
  }

  private requireSession(job: SourceJob): ProjectSession {
    const session = this.options.getActiveSession();
    if (!session || session.projectId !== job.projectId)
      throw new SourceJobExecutionError('PROJECT_SESSION_STALE', true);
    return session;
  }

  private async publishSource(session: ProjectSession, source: SourceSummary): Promise<void> {
    const { catalogRevision } = await this.options.repository.list(session, { limit: 1 });
    this.options.events.publish(
      { catalogRevision, type: 'source-upserted', source },
      session.sessionId,
    );
  }

  private async publishTransientParseState(
    session: ProjectSession,
    job: SourceJob,
    retrying: boolean,
    completed = 0,
    stage: 'uploading' | 'parsing' = 'parsing',
  ): Promise<void> {
    const source = await this.options.repository.get(session, job.sourceId);
    if (!source || source.sourceVersionId !== job.sourceVersionId) return;
    await this.publishSource(session, {
      ...source,
      state: 'parsing',
      progress: { completed: Math.max(0, Math.min(100, completed)), total: 100, stage },
      retrying,
      retryable: false,
    });
  }
}

function normalizePipelineError(cause: unknown): SourceJobExecutionError {
  if (cause instanceof SourceJobExecutionError) return cause;
  if (cause instanceof Error && cause.message === 'SOURCE_MINERU_MALFORMED')
    return new SourceJobExecutionError('SOURCE_MINERU_MALFORMED', false);
  return new SourceJobExecutionError('SOURCE_INTERNAL', false);
}

function normalizeEmbeddingError(cause: unknown): SourceJobExecutionError {
  if (cause instanceof SourceJobExecutionError) return cause;
  return new SourceJobExecutionError('SOURCE_INDEX_FAILED', false);
}

function sourceErrorCode(
  value: string | undefined,
  fallback: SourceErrorCode = 'SOURCE_INTERNAL',
): SourceErrorCode {
  return value?.startsWith('SOURCE_') ? (value as SourceErrorCode) : fallback;
}

function countFailedEmbeddingChunks(job: SourceJob, jobs: SourceJob[]): number {
  return new Set(
    jobs
      .filter(
        (candidate) =>
          candidate.type === 'embed' &&
          candidate.sourceId === job.sourceId &&
          candidate.sourceVersionId === job.sourceVersionId &&
          candidate.chunkId &&
          candidate.state === 'failed',
      )
      .map((candidate) => candidate.chunkId!),
  ).size;
}

async function withAttemptDeadline<T>(
  signal: AbortSignal,
  milliseconds: number,
  code: string,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    Math.max(1, milliseconds),
  );
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_resolve, reject) =>
        controller.signal.addEventListener(
          'abort',
          () =>
            reject(
              new SourceJobExecutionError(
                code,
                true,
                undefined,
                timedOut ? 'TIMEOUT' : 'ABORTED',
              ),
            ),
          { once: true },
        ),
      ),
    ]);
  } catch (error) {
    if (timedOut) throw new SourceJobExecutionError(code, true, undefined, 'TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function waitAbortable(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(
          new SourceJobExecutionError(
            'SOURCE_MINERU_TEMPORARY',
            true,
            undefined,
            'ABORTED',
          ),
        );
      },
      { once: true },
    );
  });
}
