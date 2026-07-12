import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

describe('compiled Markdown journey', () => {
  test('compiled main distinguishes export failure and cancellation', async () => {
    const source = await readFile(
      path.resolve('dist-electron/main/project/markdown-export.js'),
      'utf8',
    );
    expect(source).toContain('EXPORT_FAILED');
    expect(source).toContain("status: 'canceled'");
  });
});
