import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('compiled bridge inventory includes application-global provider persistence methods', async () => {
  const s = await readFile('scripts/electron-ui-runtime.mjs', 'utf8');
  for (const m of ['getProviderSummary', 'saveProviderSettings', 'writellmProviderSettings'])
    expect(s).toContain(m);
});
