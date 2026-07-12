import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('Markdown export invariants', () => {
  test('preview and export do not call canonical save', async () => {
    const source = await readFile(path.resolve('src/main/project/markdown-export.ts'), 'utf8');
    const compact = source.replace(/\s/g, '');
    expect(compact).not.toContain('ChapterRepository');
    expect(compact).not.toContain('revision+');
    expect(compact).toContain("status:'canceled'");
  });
});
