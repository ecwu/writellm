import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

test('compiled runtime harness covers startup and dual-process lifecycle', async () => {
  expect(existsSync(path.join(process.cwd(), 'scripts/electron-smoke.mjs'))).toBe(true);
  const harness = await readFile(path.join(process.cwd(), 'scripts/electron-smoke.mjs'), 'utf8');
  expect(harness).toContain('runDualProcess');
  expect(harness).toContain('second-instance');
  expect(harness).toContain('user-data');
});

