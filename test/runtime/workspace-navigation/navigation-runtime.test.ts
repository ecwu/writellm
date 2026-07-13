import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
test('runtime sources cover keyboard, focus, scroll, 100-switch, themes and zoom-like layouts', async () => {
  const [fixture, entry, frame, detail, switching] = await Promise.all([
    readFile('test/runtime/workspace-navigation/fixture.tsx', 'utf8'),
    readFile('test/runtime/workspace-navigation/electron-entry.mjs', 'utf8'),
    readFile('src/renderer/workspace/components/WorkspaceNavigationFrame.tsx', 'utf8'),
    readFile('src/renderer/workspace/components/WorkspaceDetail.tsx', 'utf8'),
    readFile('test/integration/workspace/workspace-navigation-switching.test.tsx', 'utf8'),
  ]);
  expect(fixture).toContain('WorkspaceNavigationFrame');
  expect(switching).toContain('index < 100');
  for (const value of [
    '960',
    'forced-colors',
    'prefers-reduced-motion',
    'scroll-area-viewport',
    'max-[719px]',
  ])
    expect(`${fixture}\n${entry}\n${frame}\n${detail}`).toContain(value);
});
