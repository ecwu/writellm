import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceRuntime } from '../../../src/main/sources/source-runtime';

test('activates per project session and shuts down without processing before adapters register', async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'source-runtime-'));
  let session = { projectId: 'project', projectRoot, sessionId: 'session-1' };
  const runtime = new SourceRuntime(() => session);
  await runtime.activate();
  await runtime.activate();
  session = { ...session, sessionId: 'session-2' };
  await runtime.activate();
  expect(() => runtime.shutdown()).not.toThrow();
});
