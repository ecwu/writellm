import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('compiled saving boundary', () => {
  test('compiled main registers chapter handlers', async () => {
    const main = await readFile(path.resolve('dist-electron/main/main.js'), 'utf8'),
      repository = await readFile(
        path.resolve('dist-electron/main/project/chapter-repository.js'),
        'utf8',
      );
    expect(main).toContain('registerChapterHandlers');
    expect(repository).toContain('REVISION_CONFLICT');
  });
});
