import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('compiled chapter entry', () => {
  test('compiled preload contains open and load methods', async () => {
    const source = await readFile(path.resolve('dist-electron/preload/preload.cjs'), 'utf8');
    expect(source).toContain('openForOutlineItem');
    expect(source).toContain('writellmChapters');
  });
});
