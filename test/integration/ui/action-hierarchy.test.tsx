import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('launch and workspace retain one contextual primary and distinct secondary/destructive actions', async () => {
  const launch = await readFile('src/renderer/launch/LaunchPage.tsx', 'utf8');
  const workspace = await readFile('src/renderer/workspace/WorkspaceShell.tsx', 'utf8');
  expect(launch).toContain('Create project');
  expect(launch).toContain('variant="secondary"');
  expect(workspace).toContain('Save and leave');
  expect(workspace).toContain('variant="destructive"');
  expect(workspace).toContain('Discard and leave');
});

test('responsive action groups wrap while preserving labels and semantic order', async () => {
  const css = (await readFile('src/renderer/styles.css', 'utf8')).replace(/\s/g, '');
  for (const selector of ['.card-actions', '.chapter-actions', '.orientation-panelheader'])
    expect(css).toContain(selector);
  expect(css).toContain('flex-wrap:wrap');
});
