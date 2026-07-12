import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('provider status remains semantic under forced colors and reduced motion', async () => {
  const [ui, css] = await Promise.all([
    readFile('src/renderer/features/provider-settings/ProviderSettingsPanel.tsx', 'utf8'),
    readFile('src/renderer/features/provider-settings/provider-settings.css', 'utf8'),
  ]);
  expect(ui).toContain('<StatusNotice');
  expect(css).toContain('forced-colors');
  expect(css).toContain('prefers-reduced-motion');
});
