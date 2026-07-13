import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
test('category icons retain names, failure-safe labels, 44px geometry and compact visible labels', async () => {
  const [rail, sidebar, tokens] = await Promise.all([
    readFile('src/renderer/workspace/components/WorkspaceCategoryRail.tsx', 'utf8'),
    readFile('src/renderer/components/ui/sidebar.tsx', 'utf8'),
    readFile('src/renderer/theme/tokens.css', 'utf8'),
  ]);
  for (const value of [
    'ListTree',
    'LibraryBig',
    'Settings',
    'aria-label={label}',
    'aria-hidden="true"',
    'focusable="false"',
    'max-[719px]:inline',
  ])
    expect(rail).toContain(value);
  expect(sidebar).toContain('min-w-11');
  expect(sidebar).toContain('min-h-11');
  expect(tokens).toContain('forced-colors');
  expect(sidebar).toContain('truncate');
});
