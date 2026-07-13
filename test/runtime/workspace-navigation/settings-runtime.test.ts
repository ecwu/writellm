import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
test('Settings runtime contract covers application ownership, redaction, cleanup and focus return', async () => {
  const [area, sourcePanel, provider, shell] = await Promise.all([
    readFile('src/renderer/workspace/components/SettingsArea.tsx', 'utf8'),
    readFile('src/renderer/features/sources/SourceServiceSettingsPanel.tsx', 'utf8'),
    readFile('src/renderer/features/provider-settings/ProviderSettingsPanel.tsx', 'utf8'),
    readFile('src/renderer/workspace/WorkspaceShell.tsx', 'utf8'),
  ]);
  expect(area).toContain('Application-level configuration');
  expect(area).toContain('ProviderSettingsPanel');
  expect(area).toContain('SourceServiceSettingsPanel');
  expect(sourcePanel).toContain('type="password"');
  expect(provider).toContain('type="password"');
  expect(shell).toContain("focusKey: 'settings'");
  expect(shell).toContain('inert');
});
