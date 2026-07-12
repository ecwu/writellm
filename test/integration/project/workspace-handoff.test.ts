import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('all successful launch operations hand the exact snapshot to the App owner', async () => {
  const source = await readFile('src/renderer/launch/LaunchPage.tsx', 'utf8');
  expect(source.match(/showWorkspace\(result\.project\)/g)?.length).toBe(4);
  expect(source).toContain('onProjectOpened(project)');
  expect(source).not.toContain("status: 'workspace'");
});
