import { expect, test } from 'bun:test';
import { ipcChannels } from '../../src/shared/ipc';

test('the v2 foundation exposes only the runtime-info IPC channel', () => {
  expect(ipcChannels).toEqual({ getRuntimeInfo: 'writellm:runtime-info' });
});
