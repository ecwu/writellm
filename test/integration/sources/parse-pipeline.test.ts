import { expect, test } from 'bun:test';
import { access, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { EmbeddingAdapter } from '../../../src/main/sources/embedding-adapter';
import { SourceJobRepository } from '../../../src/main/sources/job-repository';
import type { MinerUAdapter } from '../../../src/main/sources/mineru-adapter';
import { SourceServiceCredentials } from '../../../src/main/sources/service-credentials';
import { SourceEvents } from '../../../src/main/sources/source-events';
import { SourcePipeline } from '../../../src/main/sources/source-pipeline';
import { SourceRepository } from '../../../src/main/sources/source-repository';
import { orderedMinerUEntries, storedZipFixture } from '../../fixtures/sources/mineru-fixtures';
import { validPdfFixture } from '../../fixtures/sources/pdf-fixtures';

test('reuses durable remote identity and publishes a normalized parse result', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'parse-pipeline-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  let id = 0;
  const repository = new SourceRepository({ id: () => `id-${++id}` });
  const created = await repository.createSource(session, {
    expectedCatalogRevision: 0,
    displayName: 'one.pdf',
    sizeBytes: validPdfFixture().byteLength,
    sha256: 'a'.repeat(64),
    originalBytes: validPdfFixture(),
  });
  if (created.status !== 'created') throw new Error('not created');
  const credentials = new SourceServiceCredentials(
    path.join(root, 'user-data'),
    {
      available: async () => true,
      protect: async (value) => Buffer.from(value).toString('base64'),
      unprotect: async (value) => Buffer.from(value, 'base64').toString(),
    },
    () => 'credential-revision',
  );
  await credentials.initialize();
  await credentials.save('mineru', null, 'secret');
  await credentials.setValidation('mineru', 'credential-revision', { status: 'succeeded' });
  await credentials.save('siliconflow', null, 'secret');
  await credentials.setValidation('siliconflow', 'credential-revision', { status: 'succeeded' });
  const jobs = new SourceJobRepository(root);
  await jobs.initialize();
  const job = await jobs.enqueue({
    kind: 'writellm.source-job',
    schemaVersion: 1,
    jobId: 'job',
    projectId: session.projectId,
    sourceId: created.source.sourceId,
    sourceVersionId: created.sourceVersionId,
    type: 'parse',
    state: 'queued',
    attempt: 0,
    idempotencyKey: 'parse',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const fake = {
    submitLocalPdf: async () => ({ remoteBatchId: 'remote' }),
    poll: async () => ({ state: 'done' as const, resultUrl: 'https://download.test/result.zip' }),
    download: async ({ destination }: { destination: string }) =>
      void (await writeFile(destination, storedZipFixture(orderedMinerUEntries()))),
  };
  const pipeline = new SourcePipeline({
    credentials,
    repository,
    events: new SourceEvents(),
    getActiveSession: () => session,
    mineru: () => fake as unknown as MinerUAdapter,
    embedding: () =>
      ({
        embed: async ({ texts }: { texts: Array<{ chunkId: string; contentHash: string }> }) =>
          texts.map((value) => ({
            ...value,
            vector: Float32Array.from({ length: 1024 }, () => 0.5),
          })),
      }) as unknown as EmbeddingAdapter,
    pollIntervalMs: 0,
  });
  await pipeline.process(job, new AbortController().signal, jobs);
  expect(jobs.get(job.jobId)?.remoteBatchId).toBe('remote');
  expect((await repository.get(session, job.sourceId))?.state).toBe('indexing');
  const versionRoot = path.join(root, 'sources', job.sourceId, 'versions', job.sourceVersionId);
  expect(await readFile(path.join(versionRoot, 'full.md'), 'utf8')).toBe(
    '# Title\n\nBody\n\n![Chart](images/chart.png)',
  );
  expect(
    (await readFile(path.join(versionRoot, 'blocks.jsonl'), 'utf8')).trim().split('\n'),
  ).toHaveLength(3);
  expect(JSON.parse(await readFile(path.join(versionRoot, 'manifest.json'), 'utf8'))).toMatchObject(
    {
      parseState: 'complete',
      blockCount: 3,
      mediaCount: 1,
    },
  );
  expect(await readdir(path.join(versionRoot, 'media'))).toHaveLength(1);
  await expect(
    access(path.join(root, 'runtime', 'source-downloads', `${job.jobId}.zip`)),
  ).rejects.toThrow();
  const embed = jobs.list().find((value) => value.type === 'embed');
  if (!embed) throw new Error('embedding job missing');
  await pipeline.process(embed, new AbortController().signal, jobs);
  expect((await repository.get(session, job.sourceId))?.eligibility.indexed).toBe(1);
});

test('publishes parse failures and reconciles durable failures left by an older runtime', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'parse-failure-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  let id = 0;
  const repository = new SourceRepository({ id: () => `id-${++id}` });
  const created = await repository.createSource(session, {
    expectedCatalogRevision: 0,
    displayName: 'failed.pdf',
    sizeBytes: validPdfFixture().byteLength,
    sha256: 'b'.repeat(64),
    originalBytes: validPdfFixture(),
  });
  if (created.status !== 'created') throw new Error('not created');
  const credentials = new SourceServiceCredentials(path.join(root, 'user-data'), {
    available: async () => true,
    protect: async (value) => value,
    unprotect: async (value) => value,
  });
  await credentials.initialize();
  const jobs = new SourceJobRepository(root);
  await jobs.initialize();
  const job = await jobs.enqueue({
    kind: 'writellm.source-job',
    schemaVersion: 1,
    jobId: 'failed-job',
    projectId: session.projectId,
    sourceId: created.source.sourceId,
    sourceVersionId: created.sourceVersionId,
    type: 'parse',
    state: 'queued',
    attempt: 0,
    idempotencyKey: 'failed-parse',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await jobs.fail(job.jobId, { retryable: false, errorCode: 'SOURCE_MINERU_AUTH' });
  const pipeline = new SourcePipeline({
    credentials,
    repository,
    events: new SourceEvents(),
    getActiveSession: () => session,
  });
  await pipeline.reconcile(session, jobs);
  expect(await repository.get(session, job.sourceId)).toMatchObject({
    state: 'failed',
    retryable: true,
    failure: { code: 'SOURCE_MINERU_AUTH', stage: 'parse' },
  });
});
