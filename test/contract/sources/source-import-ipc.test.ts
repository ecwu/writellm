import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { registerSourceHandlers } from '../../../src/main/sources/handlers';
import { SourceImportService } from '../../../src/main/sources/import-service';
import { SourceEvents } from '../../../src/main/sources/source-events';
import { SourceRepository } from '../../../src/main/sources/source-repository';
import { sourceChannels } from '../../../src/shared/sources';

test('registers six strict source handlers with sender and redaction boundaries', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-ipc-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  const repository = new SourceRepository();
  const events = new SourceEvents();
  const imports = new SourceImportService({
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    repository,
    events,
    getActiveSession: () => session,
  });
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerSourceHandlers({
    ipcMain: { handle: (channel, handler) => void handlers.set(channel, handler as never) },
    getActiveSession: () => session,
    repository,
    imports,
    events,
    isExpectedSender: (event) => (event as { allowed?: boolean }).allowed === true,
    retrySource: async () => ({
      status: 'error',
      error: { code: 'SOURCE_NOT_FOUND', messageKey: 'x', retryable: false },
    }),
    removeSource: async () => ({
      status: 'error',
      error: { code: 'SOURCE_NOT_FOUND', messageKey: 'x', retryable: false },
    }),
  });
  expect([...handlers.keys()].sort()).toEqual(Object.values(sourceChannels).sort());
  const sender = { allowed: true, sender: { isDestroyed: () => false, send: () => undefined } };
  expect(
    await handlers.get(sourceChannels.list)?.(sender, { limit: 10, path: '/private' }),
  ).toMatchObject({ status: 'error', error: { code: 'SOURCE_INVALID_INPUT' } });
  expect(
    await handlers.get(sourceChannels.list)?.({ ...sender, allowed: false }, { limit: 10 }),
  ).toMatchObject({ status: 'error', error: { code: 'SOURCE_UNAUTHORIZED_SENDER' } });
  const listed = await handlers.get(sourceChannels.list)?.(sender, { limit: 10 });
  expect(JSON.stringify(listed)).not.toContain(root);
  expect(JSON.stringify(listed)).not.toContain('%PDF');
  expect(
    await handlers.get(sourceChannels.importDialog)?.(sender, { expectedCatalogRevision: 99 }),
  ).toMatchObject({ status: 'conflict', catalogRevision: 0 });
});
