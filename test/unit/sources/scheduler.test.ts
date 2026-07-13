import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceJobRepository } from '../../../src/main/sources/job-repository';
import { retryDelay, SourceScheduler } from '../../../src/main/sources/scheduler';
import { jobFixture } from '../../fixtures/sources/source-fixtures';

test('limits parse to one and embedding to two active requests per project', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scheduler-'));
  const jobs = new SourceJobRepository(root);
  await jobs.initialize();
  await jobs.enqueue(jobFixture({ jobId: 'parse-1', idempotencyKey: 'parse-1' }));
  for (let index = 0; index < 3; index++)
    await jobs.enqueue(
      jobFixture({
        jobId: `embed-${index}`,
        idempotencyKey: `embed-${index}`,
        type: 'embed',
        chunkId: `chunk-${index}`,
      }),
    );
  let parseActive = 0,
    parseMax = 0,
    embedActive = 0,
    embedMax = 0;
  const scheduler = new SourceScheduler({
    jobs,
    isActiveSession: () => true,
    execute: async (job) => {
      if (job.type === 'parse') {
        parseActive++;
        parseMax = Math.max(parseMax, parseActive);
      } else {
        embedActive++;
        embedMax = Math.max(embedMax, embedActive);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (job.type === 'parse') parseActive--;
      else embedActive--;
    },
  });
  await scheduler.drain();
  expect(parseMax).toBe(1);
  expect(embedMax).toBe(2);
  expect(jobs.list().every((job) => job.state === 'completed')).toBe(true);
});

test('honors Retry-After and bounded full-jitter backoff', () => {
  expect(retryDelay(1, '3', () => 0.5)).toBe(3000);
  expect(retryDelay(2, undefined, () => 0.5)).toBe(1000);
  expect(retryDelay(20, undefined, () => 1)).toBeLessThanOrEqual(60_000);
});
