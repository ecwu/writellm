import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('workspace itself adds no preload namespace or IPC channel', async () => {
  const preload = await readFile('src/preload/preload.cts', 'utf8');
  expect((preload.match(/exposeInMainWorld/g) ?? []).length).toBe(7);
  expect(preload).toContain("exposeInMainWorld('writellmChapters'");
  expect(preload).toContain("exposeInMainWorld('writellmSources'");
  expect(preload).toContain("exposeInMainWorld('writellmSourceServices'");
  for (const term of ['workspace', 'panel', 'focusReturn'])
    expect(preload.toLowerCase()).not.toContain(term.toLowerCase());
});
