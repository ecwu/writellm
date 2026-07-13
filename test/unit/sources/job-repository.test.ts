import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceJobRepository } from '../../../src/main/sources/job-repository';
import { jobFixture } from '../../fixtures/sources/source-fixtures';

test('recovers JSONL jobs, enforces idempotency and expires leases', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-jobs-'));
  const now = { value: Date.parse('2026-07-13T10:00:00.000Z') };
  const repository = new SourceJobRepository(root, () => new Date(now.value).toISOString());
  await repository.initialize();
  const created = await repository.enqueue(jobFixture());
  const duplicate = await repository.enqueue({ ...jobFixture(), jobId: 'other-job' });
  expect(duplicate.jobId).toBe(created.jobId);
  const leased = await repository.leaseNext('worker', 1_000);
  expect(leased?.state).toBe('running');
  now.value += 2_000;
  await repository.recoverExpiredLeases();
  expect(repository.get(created.jobId)?.state).toBe('queued');
  const reopened = new SourceJobRepository(root, () => new Date(now.value).toISOString());
  await reopened.initialize();
  expect(reopened.get(created.jobId)?.state).toBe('queued');
});

test('durably bounds progress and clears stale failure metadata on success', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-jobs-'));
  const repository = new SourceJobRepository(root);
  await repository.initialize();
  const job = await repository.enqueue(jobFixture());
  await repository.patch(job.jobId, {
    progress: { completed: 150, total: 100, stage: 'parsing' },
  });
  await repository.fail(job.jobId, {
    retryable: true,
    retryAt: new Date(Date.now() + 1000).toISOString(),
    errorCode: 'SOURCE_MINERU_TEMPORARY',
    errorMessage: 'temporary\nprovider detail',
  });
  expect(repository.get(job.jobId)).toMatchObject({
    progress: { completed: 100, total: 100, stage: 'parsing' },
    errorCode: 'SOURCE_MINERU_TEMPORARY',
    errorMessage: 'temporary provider detail',
  });
  await repository.complete(job.jobId);
  expect(repository.get(job.jobId)).toMatchObject({ state: 'completed' });
  expect(repository.get(job.jobId)?.errorCode).toBeUndefined();
  expect(repository.get(job.jobId)?.errorMessage).toBeUndefined();
  const reopened = new SourceJobRepository(root);
  await reopened.initialize();
  expect(reopened.get(job.jobId)?.progress.completed).toBe(100);
  expect(reopened.get(job.jobId)?.errorCode).toBeUndefined();
});

test('persists bounded backoff, attempt caps and supersession', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-jobs-'));
  const repository = new SourceJobRepository(root);
  await repository.initialize();
  const job = await repository.enqueue(jobFixture());
  for (let attempt = 1; attempt <= 6; attempt++)
    await repository.fail(job.jobId, {
      retryable: true,
      retryAt: new Date(Date.now() + 1000).toISOString(),
    });
  expect(repository.get(job.jobId)?.state).toBe('failed');
  const second = await repository.enqueue({
    ...jobFixture(),
    jobId: 'job-2',
    idempotencyKey: 'second',
  });
  await repository.supersedeSource(second.sourceId);
  expect(repository.get(second.jobId)?.state).toBe('superseded');
});
