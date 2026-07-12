import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('orientation bridge is three named wrappers without broad capability', async () => {
  const source = await readFile('src/preload/preload.cts', 'utf8'),
    section = source.slice(source.indexOf('const writingOrientationApi'));
  for (const name of ['load:', 'save:', 'deleteOutlineItem:']) expect(section).toContain(name);
  expect(section).not.toMatch(/sendSync|fs\.|path\.|git\.|stack/);
});
test('stable errors are redacted', async () => {
  const source = await readFile('src/shared/writing-orientation.ts', 'utf8');
  for (const code of [
    'NO_ACTIVE_PROJECT',
    'INVALID_INPUT',
    'REVISION_CONFLICT',
    'LINKED_DELETE_NOT_AVAILABLE',
    'GIT_COMMIT_FAILED',
    'STORAGE_RECOVERY_REQUIRED',
  ])
    expect(source).toContain(code);
  expect(source).not.toContain('stack:');
});
