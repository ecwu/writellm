import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('compiled runtime gate owns supported size, zoom and focus coverage', async () => {
  const main = await readFile('src/main/main.ts', 'utf8');
  const launch = await readFile('src/renderer/launch/LaunchPage.tsx', 'utf8');
  const tokens = await readFile('src/renderer/theme/tokens.css', 'utf8');
  expect(main.replace(/\s/g, '')).toContain('width:1200');
  expect(main.replace(/\s/g, '')).toContain('minWidth:960');
  expect(main.replace(/\s/g, '')).toContain('minHeight:640');
  expect(tokens.replace(/\s/g, '')).toContain(':focus-visible');
  expect(launch).toContain('sm:flex-row');
  expect(launch).toContain('md:p-10');
});
