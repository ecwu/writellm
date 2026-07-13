import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('workspace utilities cover constrained and zoom-like layouts', async () => {
  const [shell, frame] = await Promise.all([
    readFile('src/renderer/workspace/WorkspaceShell.tsx', 'utf8'),
    readFile('src/renderer/workspace/components/WorkspaceNavigationFrame.tsx', 'utf8'),
  ]);
  expect(shell).toContain('max-[860px]');
  expect(shell).toContain('minmax(0,1fr)');
  expect(frame).toContain('max-[719px]');
  expect(frame).toContain('min-h-0');
});
