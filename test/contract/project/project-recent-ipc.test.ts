import { expect, test } from 'bun:test';
import { ipcChannels } from '../../../src/shared/ipc';

test('recent IPC includes pointer management but no project deletion or path method', () => {
  expect(ipcChannels.removeRecentProject).toBe('writellm:project:remove-recent');
  expect(Object.keys(ipcChannels)).not.toContain('deleteProject');
  expect(Object.values(ipcChannels).some((channel) => channel.includes('path'))).toBe(false);
});
