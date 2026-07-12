import { expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { writeAtomicJson } from '../../../src/main/project/atomic-json';

test('atomic JSON replaces a file and leaves valid JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-atomic-'));
  const target = path.join(root, 'index.json');
  await writeAtomicJson(target, { version: 1 });
  await writeAtomicJson(target, { version: 2 });
  expect(JSON.parse(await readFile(target, 'utf8'))).toEqual({ version: 2 });
});

test('atomic JSON failure cleans its temporary file', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-atomic-fail-'));
  const target = path.join(root, 'index.json');
  await expect(
    writeAtomicJson(target, { version: 1 }, { failureStage: 'rename' }),
  ).rejects.toThrow();
  expect(await readdir(root)).toEqual([]);
});
