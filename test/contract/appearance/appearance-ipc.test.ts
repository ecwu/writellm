import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('appearance bridge is exactly two named methods beside unchanged project bridge', async () => {
  const preload = await readFile('src/preload/preload.cts', 'utf8');
  expect((preload.match(/getAppearancePreferences:/g) ?? []).length).toBe(1);
  expect((preload.match(/updateAppearancePreferences:/g) ?? []).length).toBe(1);
  expect(preload).not.toContain('ipcRenderer.send');
  const project = [
    'listRecentProjects',
    'createProject',
    'openProjectFromDialog',
    'openRecentProject',
    'relinkRecentProject',
    'removeRecentProject',
  ];
  for (const method of project) expect(preload).toContain(`${method}:`);
});
