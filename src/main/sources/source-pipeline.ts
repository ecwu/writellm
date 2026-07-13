import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { RetrySourceResult } from '../../shared/sources.js';
import type { ProjectSession } from '../project/project-transaction.js';
import { readZipArchive } from './archive-reader.js';
import { normalizeMinerUArtifact } from './artifact-normalizer.js';
import { EmbeddingAdapter } from './embedding-adapter.js';
import { IndexRepository } from './index-repository.js';
import type { SourceJob, SourceJobRepository } from './job-repository.js';
import { MinerUAdapter } from './mineru-adapter.js';
import { SourceJobExecutionError } from './scheduler.js';
import type { SourceServiceCredentials } from './service-credentials.js';
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
      mineru?: (credential: () => Promise<string>) => MinerUAdapter;
      embedding?: (credential: () => Promise<string>) => EmbeddingAdapter;
    },
  ) {
    this.index = new IndexRepository(
      (current) => this.options.getActiveSession()?.sessionId === current.sessionId,
    );
  }

  async process(job: SourceJob, signal: AbortSignal, jobs: SourceJobRepository): Promise<void> {
    if (job.type === 'embed') return this.processEmbedding(job, signal);
    const session = this.requireSession(job);
    const summary = this.options.credentials.summary('mineru');
    if (!summary.revision || !summary.available)
      throw new SourceJobExecutionError('SOURCE_MINERU_NOT_CONFIGURED', false);
    const revision = summary.revision;
    const credential = () => this.options.credentials.readCredential('mineru', revision);
    const adapter = this.options.mineru?.(credential) ?? new MinerUAdapter(credential);
    const current = jobs.get(job.jobId) ?? job;
    let remoteBatchId = current.remoteBatchId;
    if (!remoteBatchId) {
      const submitted = await adapter.submitLocalPdf({
        jobId: job.jobId,
        dataId: `${job.sourceId}:${job.sourceVersionId}`,
        absolutePath: path.join(session.projectRoot, 'sources', job.sourceId, 'original.pdf'),
        modelVersion: 'vlm',
        ocr: true,
        tables: true,
        formulas: true,
        signal,
      });
      remoteBatchId = submitted.remoteBatchId;
      await jobs.patch(job.jobId, { remoteBatchId });
    }
    let resultUrl: string | undefined;
    while (!resultUrl) {
      const observation = await adapter.poll({ remoteBatchId, signal });
      if (observation.state === 'done') resultUrl = observation.resultUrl;
      else if (observation.state === 'failed')
        throw new SourceJobExecutionError(observation.code, observation.retryable);
      else await waitAbortable(250, signal);
    }
    this.requireSession(job);
    const directory = path.join(session.projectRoot, 'runtime', 'source-downloads');
    await mkdir(directory, { recursive: true });
    const archive = path.join(directory, `${job.jobId}.zip`);
    try {
      await rm(archive, { force: true });
      await adapter.download({ resultUrl, destination: archive, signal });
      const artifact = normalizeMinerUArtifact(job.sourceVersionId, await readZipArchive(archive));
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
      this.options.events.publish({
        catalogRevision: (await this.options.repository.list(session, { limit: 1 }))
          .catalogRevision,
        type: 'source-upserted',
        source,
      });
    } finally {
      await rm(archive, { force: true });
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
      ))
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
    }
    this.options.events.publish({
      catalogRevision: (await this.options.repository.list(session, { limit: 1 })).catalogRevision,
      type: 'source-upserted',
      source: marked.source,
    });
    return { status: 'accepted', source: marked.source };
  }

  private async processEmbedding(job: SourceJob, signal: AbortSignal): Promise<void> {
    const session = this.requireSession(job);
    if (!job.chunkId) throw new SourceJobExecutionError('SOURCE_INDEX_FAILED', false);
    const service = this.options.credentials.summary('siliconflow');
    if (!service.revision || !service.available)
      throw new SourceJobExecutionError('SOURCE_SILICONFLOW_NOT_CONFIGURED', false);
    const revision = service.revision;
    const credential = () => this.options.credentials.readCredential('siliconflow', revision);
    const adapter = this.options.embedding?.(credential) ?? new EmbeddingAdapter(credential);
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
      const updated = await this.options.repository.updateIndexProgress(
        session,
        job.sourceId,
        job.sourceVersionId,
        records.length,
      );
      this.options.events.publish({
        catalogRevision: (await this.options.repository.list(session, { limit: 1 }))
          .catalogRevision,
        type: 'source-upserted',
        source: updated,
      });
    } catch (error) {
      if (error instanceof SourceJobExecutionError && (!error.retryable || job.attempt >= 6)) {
        const manifest = await this.index
          .readManifest(session, job.sourceId, job.sourceVersionId)
          .catch(() => null);
        const updated = await this.options.repository.updateIndexProgress(
          session,
          job.sourceId,
          job.sourceVersionId,
          manifest?.records.length ?? 0,
          1,
        );
        this.options.events.publish({
          catalogRevision: (await this.options.repository.list(session, { limit: 1 }))
            .catalogRevision,
          type: 'source-upserted',
          source: updated,
        });
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
}

function waitAbortable(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new SourceJobExecutionError('SOURCE_MINERU_TEMPORARY', true));
      },
      { once: true },
    );
  });
}
