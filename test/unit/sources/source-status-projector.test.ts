import { expect, test } from 'bun:test';
import { projectSourceStatus } from '../../../src/main/sources/source-status-projector';
import { jobFixture, sourceFixture } from '../../fixtures/sources/source-fixtures';

const source = () => ({
  ...sourceFixture({
    state: 'indexing',
    progress: { completed: 0, total: 2, stage: 'indexing' },
    eligibility: { indexed: 0, eligible: 2, failed: 0 },
  }),
  currentVersionId: 'version',
  sha256: 'a'.repeat(64),
  updatedAt: '2026-07-13T10:00:00.000Z',
});

const embeddingJob = (
  chunkId: string,
  state: 'queued' | 'running' | 'retrying' | 'completed' | 'failed',
  updatedAt: string,
) =>
  jobFixture({
    jobId: `${chunkId}-${state}-${updatedAt}`,
    sourceVersionId: 'version',
    type: 'embed',
    chunkId,
    state,
    updatedAt,
    errorCode: state === 'failed' ? 'SOURCE_INDEX_MALFORMED' : undefined,
  });

test('projects absolute indexing counts and lets vectors supersede stale failures', () => {
  const projected = projectSourceStatus(
    source(),
    [
      embeddingJob('chunk-a', 'failed', '2026-07-13T10:01:00.000Z'),
      embeddingJob('chunk-b', 'failed', '2026-07-13T10:01:00.000Z'),
    ],
    new Set(['chunk-a']),
  );
  expect(projected.state).toBe('partial');
  expect(projected.progress).toEqual({ completed: 2, total: 2, stage: 'indexing' });
  expect(projected.eligibility).toEqual({ indexed: 1, eligible: 2, failed: 1 });
  expect(projected.failure?.code).toBe('SOURCE_INDEX_MALFORMED');
});

test('a newer retry supersedes an older failed job for the same chunk', () => {
  const projected = projectSourceStatus(
    source(),
    [
      embeddingJob('chunk-a', 'failed', '2026-07-13T10:01:00.000Z'),
      embeddingJob('chunk-a', 'queued', '2026-07-13T10:02:00.000Z'),
      embeddingJob('chunk-b', 'running', '2026-07-13T10:02:00.000Z'),
    ],
    new Set(),
  );
  expect(projected.state).toBe('indexing');
  expect(projected.eligibility.failed).toBe(0);
  expect(projected.progress.completed).toBe(0);
});

test('reports a source as failed when every eligible block terminally fails', () => {
  const projected = projectSourceStatus(
    source(),
    [
      embeddingJob('chunk-a', 'failed', '2026-07-13T10:01:00.000Z'),
      embeddingJob('chunk-b', 'failed', '2026-07-13T10:01:00.000Z'),
    ],
    new Set(),
  );
  expect(projected.state).toBe('failed');
  expect(projected.progress.completed).toBe(2);
  expect(projected.eligibility.failed).toBe(2);
});
