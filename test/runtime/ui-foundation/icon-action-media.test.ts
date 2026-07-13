import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('icon controls retain boundaries and motion/layout behavior across media modes', async () => {
  const css = (await readFile('src/renderer/styles.css', 'utf8')).replace(/\s/g, '');
  for (const rule of [
    'forced-colors:active',
    'prefers-reduced-motion:reduce',
    'max-width:860px',
    'min-resolution:1.75dppx',
    'flex-wrap:wrap',
  ])
    expect(css).toContain(rule);
});
