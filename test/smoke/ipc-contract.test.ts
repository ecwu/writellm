import { expect, test } from 'bun:test';
import { ipcChannels } from '../../src/shared/ipc';

test('the project foundation exposes exactly six named IPC channels', () => {
  expect(Object.keys(ipcChannels).sort()).toEqual([
    'createProject',
    'listRecentProjects',
    'openProjectFromDialog',
    'openRecentProject',
    'relinkRecentProject',
    'removeRecentProject'
  ]);
  expect(Object.values(ipcChannels).every((channel) => channel.startsWith('writellm:project:'))).toBe(true);
});
