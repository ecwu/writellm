import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('chapter link transaction contract', () => {
  test('repository records one pending receipt before replacing both files', async () => {
    const source = await readFile(path.resolve('src/main/project/chapter-repository.ts'), 'utf8');
    const compact = source.replace(/\s/g, '');
    expect(compact).toContain("runtime','pending','chapter-content.json");
    expect(compact).toContain('commitContents');
    expect(compact).toContain('[chapter,orientationPath]');
  });
});
