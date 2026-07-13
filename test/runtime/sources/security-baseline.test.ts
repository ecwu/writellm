import { expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceJobRepository, type SourceJob } from '../../../src/main/sources/job-repository';
import { SourceScheduler } from '../../../src/main/sources/scheduler';
import { sourceChannels, sourceServiceChannels } from '../../../src/shared/sources';

test('freezes the exact source/service/event IPC surface and hardened Electron window', async () => {
  expect(Object.keys(sourceChannels)).toEqual([
    'list',
    'importDialog',
    'get',
    'retry',
    'remove',
    'events',
  ]);
  expect(Object.keys(sourceServiceChannels)).toEqual([
    'get',
    'mineruSave',
    'mineruRemove',
    'mineruValidate',
    'siliconflowSave',
    'siliconflowRemove',
    'siliconflowValidate',
  ]);
  expect(new Set(Object.values(sourceChannels)).size).toBe(6);
  expect(new Set(Object.values(sourceServiceChannels)).size).toBe(7);

  const [main, preload] = await Promise.all([
    readFile('src/main/main.ts', 'utf8'),
    readFile('src/preload/preload.cts', 'utf8'),
  ]);
  expect(main).toContain('contextIsolation: true');
  expect(main).toContain('nodeIntegration: false');
  expect(main).toContain('sandbox: true');
  expect(main).toContain("app.on('before-quit', () => sourceRuntime?.shutdown())");
  expect(preload).toContain("ipcRenderer.on('writellm:sources:events'");
  expect(preload).not.toContain('ipcRenderer.send(');
  expect(preload).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer/);
});

test('scheduler shutdown aborts in-flight external work', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-shutdown-'));
  const jobs = new SourceJobRepository(root);
  await jobs.initialize();
  const job: SourceJob = {
    kind: 'writellm.source-job',
    schemaVersion: 1,
    jobId: 'parse-one',
    projectId: 'project',
    sourceId: 'source',
    sourceVersionId: 'version',
    type: 'parse',
    state: 'queued',
    attempt: 0,
    idempotencyKey: 'parse:source:version',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
  await jobs.enqueue(job);
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  let observedAbort = false;
  const scheduler = new SourceScheduler({
    jobs,
    isActiveSession: () => true,
    execute: async (_job, signal) => {
      start();
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
            resolve();
          },
          { once: true },
        ),
      );
    },
    random: () => 0,
    now: () => Date.parse('2026-01-01T00:00:00.000Z'),
  });
  const draining = scheduler.drain();
  await started;
  scheduler.shutdown();
  await draining;
  expect(observedAbort).toBe(true);
  expect(jobs.get(job.jobId)?.state).toBe('retrying');
});
