import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('compiled main packages Pi validation with two-turn and 30-second bounds', async () => {
  const [pkg, v] = await Promise.all([
    readFile('package.json', 'utf8'),
    readFile('src/main/provider-settings/validator.ts', 'utf8'),
  ]);
  expect(pkg).toContain('@earendil-works/pi-agent-core');
  expect(pkg).toContain('@earendil-works/pi-ai');
  expect(v).toContain('30_000');
  expect(v.replace(/\s/g, '')).toContain('turns>=2');
});
