import { describe, expect, test } from 'bun:test';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

describe('compiled BlockNote editing', () => {
  test('production bundle contains the actual editor mount', async () => {
    const files = await readdir(path.resolve('dist/assets'));
    const js = await Promise.all(
      files
        .filter((file) => file.endsWith('.js'))
        .map((file) => readFile(path.resolve('dist/assets', file), 'utf8')),
    );
    expect(js.some((value) => value.includes('blocknote-editor'))).toBeTrue();
  });
});
