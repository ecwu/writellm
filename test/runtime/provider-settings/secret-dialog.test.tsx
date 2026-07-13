import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('secret removal uses the shared focus-restoring dialog and controlled password draft', async () => {
  const s = await readFile(
    'src/renderer/features/provider-settings/ProviderSettingsPanel.tsx',
    'utf8',
  );
  const compact = s.replace(/\s/g, '');
  expect(compact).toContain('<Dialogopen={removeOpen}');
  expect(compact).toContain('setRemoveOpen(false)');
  expect(compact).toContain("setDraft((d)=>({...d,secret:''}))");
});
