import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RecentProjectIndex } from '../../../src/main/project/recent-index';

test('corrupt recent storage yields a safe warning and no filesystem authority', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-failure-'));
  const file = path.join(root, 'recent.json');
  await writeFile(file, JSON.stringify({ kind: 'unknown', schemaVersion: 99, records: [{ mainOnlyPath: '/sensitive' }] }));
  const index = new RecentProjectIndex(file);
  await index.load();
  const result = await index.list();
  expect(result.recentProjects).toEqual([]);
  expect(result.warning).toContain('safely');
});

