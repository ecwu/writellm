import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('renderer provider feature imports no Pi, Node, Electron, filesystem or secret protector', async () => {
  const files = [
    'src/renderer/features/provider-settings/ProviderSettingsPanel.tsx',
    'src/renderer/features/provider-settings/provider-settings-state.ts',
  ];
  for (const f of files) {
    const s = await readFile(f, 'utf8');
    expect(s).not.toMatch(/@earendil|node:|electron|secret-protector|safeStorage/);
  }
});
