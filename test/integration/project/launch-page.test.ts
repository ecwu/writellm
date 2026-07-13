import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { loadLaunchState } from '../../../src/renderer/launch/launchState';
import type { WriteLLMIpc } from '../../../src/shared/ipc';

test('launch state renders a safe empty state after first launch', async () => {
  const api = { listRecentProjects: async () => ({ recentProjects: [] }) } as WriteLLMIpc;
  expect(await loadLaunchState(api)).toEqual({ status: 'ready', recentProjects: [] });
});

test('launch actions use the canonical Lucide mappings, stable labels and busy feedback', async () => {
  const source = await readFile('src/renderer/launch/LaunchPage.tsx', 'utf8');
  for (const value of [
    'FolderPlus',
    'FolderOpen',
    'Trash2',
    'Create project',
    'Open existing project',
    'Opening project…',
    'busy={busy}',
  ])
    expect(source).toContain(value);
});

test('launch state turns bridge failure into a retryable safe error', async () => {
  const api = {
    listRecentProjects: async () => {
      throw new Error('/private/path should not escape');
    },
  } as WriteLLMIpc;
  expect(await loadLaunchState(api)).toEqual({
    status: 'error',
    recentProjects: [],
    message: 'Recent projects are unavailable. You can try again.',
  });
});
