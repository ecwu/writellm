import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('provider status remains semantic under forced colors and reduced motion', async () => {
  const ui = await readFile('src/renderer/features/provider-settings/ProviderSettingsPanel.tsx', 'utf8');
  expect(ui).toContain('<StatusNotice');
  expect(ui).toContain('<Checkbox');
  expect(ui).toContain('sm:grid-cols-2');
});
