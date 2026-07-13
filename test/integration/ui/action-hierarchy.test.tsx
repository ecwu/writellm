import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('launch and workspace retain one contextual primary and distinct secondary/destructive actions', async () => {
  const launch = await readFile('src/renderer/launch/LaunchPage.tsx', 'utf8');
  const workspace = await readFile('src/renderer/workspace/WorkspaceShell.tsx', 'utf8');
  expect(launch).toContain('Create project');
  expect(launch).toContain('variant="outline"');
  expect(workspace).toContain('Save and leave');
  expect(workspace).toContain('variant="destructive"');
  expect(workspace).toContain('Discard and leave');
});

test('responsive action groups wrap while preserving labels and semantic order', async () => {
  const launch = await readFile('src/renderer/launch/LaunchPage.tsx', 'utf8');
  const orientation = await readFile(
    'src/renderer/features/writing-orientation/WritingOrientationPanel.tsx',
    'utf8',
  );
  expect(launch).toContain('flex-wrap');
  expect(orientation).toContain('grid-cols-[minmax(0,1fr)_auto]');
});

test('workspace forms shrink within the detail pane without oversized global headings', async () => {
  const orientation = await readFile(
    'src/renderer/features/writing-orientation/WritingOrientationPanel.tsx',
    'utf8',
  );
  const launch = await readFile('src/renderer/launch/LaunchPage.tsx', 'utf8');
  expect(orientation).toContain('min-w-0');
  expect(orientation).toContain('cn-font-heading text-base');
  expect(launch).toContain('cn-font-heading mt-1 text-xl');
});
