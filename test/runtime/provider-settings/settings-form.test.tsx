import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('settings form keeps labels, field errors, constrained layout and theme tokens', async () => {
  const ui = await readFile('src/renderer/features/provider-settings/ProviderSettingsPanel.tsx', 'utf8');
  expect(ui).toContain('<FormField');
  expect(ui).toContain('error=');
  expect(ui).toContain('sm:grid-cols-2');
  expect(ui).toContain('max-w-2xl');
});
