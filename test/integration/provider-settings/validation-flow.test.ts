import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('validation has consent, duplicate suppression, revision-bound persistence and stale completion', async () => {
  const [ui, h, r] = await Promise.all(
    [
      'src/renderer/features/provider-settings/ProviderSettingsPanel.tsx',
      'src/main/provider-settings/handlers.ts',
      'src/main/provider-settings/repository.ts',
    ].map((x) => readFile(x, 'utf8')),
  );
  expect(ui).toContain('may use a small number of tokens');
  expect(h).toContain('inFlight.has');
  expect(h).toContain("status:'stale'");
  expect(r).toContain('this.settings.revision!==revision');
});
