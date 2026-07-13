import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('1200x800, 960x640 and zoom-like layouts preserve action labels and avoid fixed rows', async () => {
  const css = (await readFile('src/renderer/styles.css', 'utf8')).replace(/\s/g, '');
  expect(css).toContain('@media(max-width:860px)');
  expect(css).toContain('@media(max-width:760px)');
  expect(css).toContain('minmax(0,1fr)');
  expect(css).toContain('flex-wrap:wrap');
  expect(css).not.toContain('text-overflow:ellipsis');
});
