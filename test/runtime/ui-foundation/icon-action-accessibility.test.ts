import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('compiled fixture and source contract cover icon action focus, tooltip and 44px geometry', async () => {
  const fixture = await readFile('test/runtime/ui-foundation/fixture.tsx', 'utf8');
  const css = (await readFile('src/renderer/styles.css', 'utf8')).replace(/\s/g, '');
  expect(fixture).toContain('PanelTop');
  expect(css).toContain('min-height:2.75rem');
  expect(css).toContain('min-width:2.75rem');
  expect(css).toContain('.ui-button:focus-visible');
  const tooltip = await readFile('src/renderer/components/ui/tooltip.tsx', 'utf8');
  expect(tooltip).toContain("e.key === 'Escape'");
});
