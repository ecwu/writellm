import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';

test('freezes six named source methods, receive-only events and typed retry/removal unions', async () => {
  const [preload, shared, handlers] = await Promise.all([
    readFile('src/preload/preload.cts', 'utf8'),
    readFile('src/shared/sources.ts', 'utf8'),
    readFile('src/main/sources/handlers.ts', 'utf8'),
  ]);
  for (const method of [
    'listSources',
    'importSourcesFromDialog',
    'getSource',
    'retrySource',
    'removeSource',
    'subscribeSourceEvents',
  ])
    expect(preload).toContain(method);
  expect(preload).toContain("ipcRenderer.on('writellm:sources:events'");
  expect(preload).not.toContain('ipcRenderer.send(');
  expect(shared).toContain("status: 'confirmation-required'");
  expect(shared).toContain("status: 'referenced'");
  expect(shared).toContain("status: 'conflict'");
  expect(handlers).toContain('isExpectedSender');
  for (const forbidden of ['absolutePath', 'remoteBatchId', 'resultUrl', 'Float32Array'])
    expect(handlers).not.toContain(forbidden);
});
