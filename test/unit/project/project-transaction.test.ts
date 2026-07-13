import { expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectTransaction } from '../../../src/main/project/project-transaction';

test('publishes multiple files atomically and clears its pending manifest after commit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-transaction-'));
  const commits: string[][] = [];
  const transaction = new ProjectTransaction({
    git: { commit: async (_root, paths) => commits.push(paths) },
  });
  await transaction.publish({
    session: { projectId: 'project', projectRoot: root, sessionId: 'session' },
    transactionId: 'tx-1',
    files: [
      { relativePath: 'sources/catalog.json', content: '{"revision":1}\n' },
      { relativePath: 'sources/source/source.json', content: '{"sourceId":"source"}\n' },
    ],
    revision: 1,
    metadata: { actor: 'system', event: 'processing', contentChange: false },
    isCurrentSession: () => true,
  });
  expect(await readFile(path.join(root, 'sources/catalog.json'), 'utf8')).toContain('revision');
  expect(commits).toEqual([['sources/catalog.json', 'sources/source/source.json']]);
  expect(await readdir(path.join(root, 'runtime/pending'))).toEqual([]);
});

test('serializes project mutation and fences stale sessions before replacement', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'project-transaction-'));
  const transaction = new ProjectTransaction({ git: { commit: async () => undefined } });
  await expect(
    transaction.publish({
      session: { projectId: 'project', projectRoot: root, sessionId: 'stale' },
      transactionId: 'tx-stale',
      files: [{ relativePath: 'sources/catalog.json', content: '{}' }],
      revision: 1,
      metadata: { actor: 'system', event: 'processing', contentChange: false },
      isCurrentSession: () => false,
    }),
  ).rejects.toThrow('PROJECT_SESSION_STALE');
});
