import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('icon controls retain boundaries and responsive utility behavior', async () => {
  const [button, rail] = await Promise.all([
    readFile('src/renderer/components/ui/button.tsx', 'utf8'),
    readFile('src/renderer/workspace/components/ToolRail.tsx', 'utf8'),
  ]);
  expect(button).toContain('min-h-11');
  expect(button).toContain('focus-visible:ring-1');
  expect(rail).toContain('max-[860px]:flex-row');
  expect(rail).toContain('overflow-auto');
});
