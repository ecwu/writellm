import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceJobRepository } from '../../../src/main/sources/job-repository';
import { SourceJobExecutionError, SourceScheduler } from '../../../src/main/sources/scheduler';
import { jobFixture } from '../../fixtures/sources/source-fixtures';

test('isolates permanent failures, runs two embedding requests and reuses completed jobs after restart', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'indexing-pipeline-'));
  const jobs = new SourceJobRepository(root);
  await jobs.initialize();
  for (let index = 0; index < 500; index++)
    await jobs.enqueue(
      jobFixture({
        jobId: `job-${index}`,
        idempotencyKey: `embed-${index}`,
        type: 'embed',
        chunkId: `chunk-${index}`,
      }),
    );
  let active = 0,
    maximum = 0;
  const scheduler = new SourceScheduler({
    jobs,
    isActiveSession: () => true,
    execute: async (job) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      if (Number(job.chunkId?.split('-')[1]) < 25)
        throw new SourceJobExecutionError('SOURCE_INDEX_FAILED', false);
    },
  });
  await scheduler.drain();
  expect(maximum).toBe(2);
  expect(jobs.list().filter((job) => job.state === 'completed')).toHaveLength(475);
  expect(jobs.list().filter((job) => job.state === 'failed')).toHaveLength(25);
  const reopened = new SourceJobRepository(root);
  await reopened.initialize();
  expect(reopened.list().filter((job) => job.state === 'completed')).toHaveLength(475);
});
