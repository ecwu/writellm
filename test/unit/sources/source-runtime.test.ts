import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceRuntime } from '../../../src/main/sources/source-runtime';
import { jobFixture } from '../../fixtures/sources/source-fixtures';

test('manual enqueue wakes the active single-flight scheduler', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'source-runtime-wake-'));
  const session = { projectId: 'project', projectRoot, sessionId: 'session' };
  const runtime = new SourceRuntime(() => session);
  let resolveProcessed!: () => void;
  const processed = new Promise<void>((resolve) => {
    resolveProcessed = resolve;
  });
  runtime.setProcessor(async () => resolveProcessed());
  await runtime.activate();
  const queued = await runtime.enqueue(
    jobFixture({ projectId: session.projectId, sourceId: 'source', sourceVersionId: 'version' }),
  );
  await processed;
  for (
    let index = 0;
    index < 20 && runtime.getJobRepository()?.get(queued.jobId)?.state !== 'completed';
    index++
  )
    await new Promise((resolve) => setTimeout(resolve, 1));
  expect(runtime.getJobRepository()?.get(queued.jobId)?.state).toBe('completed');
  runtime.shutdown();
});

test('activates per project session and shuts down without processing before adapters register', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'source-runtime-'));
  let session = { projectId: 'project', projectRoot, sessionId: 'session-1' };
  const runtime = new SourceRuntime(() => session);
  await runtime.activate();
  await runtime.activate();
  session = { ...session, sessionId: 'session-2' };
  await runtime.activate();
  expect(() => runtime.shutdown()).not.toThrow();
});
