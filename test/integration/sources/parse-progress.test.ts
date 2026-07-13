import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceJobRepository } from '../../../src/main/sources/job-repository';
import { type MinerUAdapter, MinerUTransportError } from '../../../src/main/sources/mineru-adapter';
import { SourceServiceCredentials } from '../../../src/main/sources/service-credentials';
import { SourceEvents } from '../../../src/main/sources/source-events';
import { SourcePipeline } from '../../../src/main/sources/source-pipeline';
import { SourceRepository } from '../../../src/main/sources/source-repository';
import { orderedMinerUEntries, storedZipFixture } from '../../fixtures/sources/mineru-fixtures';
import { validPdfFixture } from '../../fixtures/sources/pdf-fixtures';

async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'parse-progress-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  let id = 0;
  const repository = new SourceRepository({ id: () => `id-${++id}` });
  const created = await repository.createSource(session, {
    expectedCatalogRevision: 0,
    displayName: 'progress.pdf',
    sizeBytes: validPdfFixture().byteLength,
    sha256: 'c'.repeat(64),
    originalBytes: validPdfFixture(),
  });
  if (created.status !== 'created') throw new Error('source not created');
  const credentials = new SourceServiceCredentials(
    path.join(root, 'user-data'),
    {
      available: async () => true,
      protect: async (value) => value,
      unprotect: async (value) => value,
    },
    () => 'credential-revision',
  );
  await credentials.initialize();
  await credentials.save('mineru', null, 'secret');
  await credentials.setValidation('mineru', 'credential-revision', { status: 'succeeded' });
  const jobs = new SourceJobRepository(root);
  await jobs.initialize();
  const job = await jobs.enqueue({
    kind: 'writellm.source-job',
    schemaVersion: 1,
    jobId: 'parse-progress-job',
    projectId: session.projectId,
    sourceId: created.source.sourceId,
    sourceVersionId: created.sourceVersionId,
    type: 'parse',
    state: 'queued',
    attempt: 0,
    idempotencyKey: 'parse-progress',
    createdAt: '2026-07-13T10:00:00.000Z',
    updatedAt: '2026-07-13T10:00:00.000Z',
  });
  repository.setJobRepository(jobs);
  return { root, session, repository, credentials, jobs, job };
}

test('persists and publishes MinerU progress so authoritative reads survive event loss', async () => {
  const { session, repository, credentials, jobs, job } = await setup();
  const events = new SourceEvents();
  events.activate(session.sessionId);
  const observations = [
    { state: 'running' as const, progress: 37 },
    { state: 'done' as const, resultUrl: 'https://download.test/result.zip' },
  ];
  const fake = {
    submitLocalPdf: async () => ({ remoteBatchId: 'remote' }),
    poll: async () => observations.shift()!,
    download: async ({ destination }: { destination: string }) =>
      void (await writeFile(destination, storedZipFixture(orderedMinerUEntries()))),
  };
  const seen: number[] = [];
  events.subscribe(
    0,
    (event) => {
      if (event.type === 'source-upserted' && event.source?.state === 'parsing')
        seen.push(event.source.progress.completed);
    },
    session.sessionId,
  );
  const pipeline = new SourcePipeline({
    credentials,
    repository,
    events,
    getActiveSession: () => session,
    mineru: () => fake as unknown as MinerUAdapter,
    pollIntervalMs: 0,
  });
  await pipeline.process(job, new AbortController().signal, jobs);
  expect(seen).toContain(37);
  expect(jobs.get(job.jobId)?.progress).toEqual({ completed: 37, total: 100, stage: 'parsing' });
  const projected = await repository.list(session, { limit: 100 });
  expect(projected.sources[0]?.state).toBe('indexing');
});

test('persists an allocated batch before upload and clears it when signed upload fails', async () => {
  const { session, repository, credentials, jobs, job } = await setup();
  let persistedBeforeUploadFailure = false;
  const fake = {
    submitLocalPdf: async (input: { onBatchAllocated?(remoteBatchId: string): Promise<void> }) => {
      await input.onBatchAllocated?.('allocated-before-upload');
      persistedBeforeUploadFailure =
        jobs.get(job.jobId)?.remoteBatchId === 'allocated-before-upload';
      throw new MinerUTransportError('SOURCE_MINERU_TEMPORARY', true, 'upload');
    },
  };
  const pipeline = new SourcePipeline({
    credentials,
    repository,
    events: new SourceEvents(),
    getActiveSession: () => session,
    mineru: () => fake as unknown as MinerUAdapter,
  });
  await expect(pipeline.process(job, new AbortController().signal, jobs)).rejects.toMatchObject({
    code: 'SOURCE_MINERU_TEMPORARY',
    retryable: true,
  });
  expect(persistedBeforeUploadFailure).toBe(true);
  expect(jobs.get(job.jobId)?.remoteBatchId).toBeUndefined();
});

test('preserves known parse progress when publishing an automatic retry', async () => {
  const { session, repository, credentials, jobs, job } = await setup();
  await jobs.patch(job.jobId, { progress: { completed: 42, total: 100, stage: 'parsing' } });
  const events = new SourceEvents();
  events.activate(session.sessionId);
  const published: number[] = [];
  events.subscribe(
    0,
    (event) => {
      if (event.type === 'source-upserted' && event.source?.retrying)
        published.push(event.source.progress.completed);
    },
    session.sessionId,
  );
  const fake = {
    submitLocalPdf: async () => {
      throw new MinerUTransportError('SOURCE_MINERU_TEMPORARY', true, 'submit');
    },
  };
  const pipeline = new SourcePipeline({
    credentials,
    repository,
    events,
    getActiveSession: () => session,
    mineru: () => fake as unknown as MinerUAdapter,
  });
  await expect(pipeline.process(job, new AbortController().signal, jobs)).rejects.toMatchObject({
    code: 'SOURCE_MINERU_TEMPORARY',
  });
  expect(published).toContain(42);
});

test('abandons a durable batch that remains waiting for a missing upload', async () => {
  const { session, repository, credentials, jobs, job } = await setup();
  await jobs.patch(job.jobId, { remoteBatchId: 'orphaned-batch' });
  const fake = {
    poll: async () => ({
      state: 'pending' as const,
      providerState: 'waiting-file' as const,
      progress: 0,
    }),
  };
  const pipeline = new SourcePipeline({
    credentials,
    repository,
    events: new SourceEvents(),
    getActiveSession: () => session,
    mineru: () => fake as unknown as MinerUAdapter,
    pollIntervalMs: 0,
    waitingFileRetryPolls: 2,
  });
  await expect(pipeline.process(job, new AbortController().signal, jobs)).rejects.toMatchObject({
    code: 'SOURCE_MINERU_TEMPORARY',
    retryable: true,
  });
  expect(jobs.get(job.jobId)?.remoteBatchId).toBeUndefined();
});
