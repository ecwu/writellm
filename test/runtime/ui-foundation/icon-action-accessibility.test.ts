import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('compiled fixture and source contract cover icon action focus, tooltip and 44px geometry', async () => {
  const fixture = await readFile('test/runtime/ui-foundation/fixture.tsx', 'utf8');
  const button = await readFile('src/renderer/components/ui/button.tsx', 'utf8');
  expect(fixture).toContain('PanelTop');
  expect(button).toContain('min-h-11');
  expect(button).toContain('min-w-11');
  expect(button).toContain('focus-visible:ring-1');
  const tooltip = await readFile('src/renderer/components/ui/tooltip.tsx', 'utf8');
  expect(tooltip).toContain('@base-ui/react/tooltip');
  expect(tooltip).toContain('pointer-events-none');
});
