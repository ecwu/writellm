import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ipcChannels } from '../../../src/shared/ipc';

test('preload contains one explicit wrapper for each project method and no generic bridge', async () => {
  const source = await readFile(path.join(process.cwd(), 'src/preload/preload.cts'), 'utf8');
  expect(source).not.toContain('getRuntimeInfo');
  expect(source).not.toContain('ipcRenderer.send');
  expect(source).not.toContain('ipcRenderer.on');
  for (const channel of Object.values(ipcChannels)) expect(source).toContain(channel);
  expect(Object.keys(ipcChannels)).toHaveLength(6);
});

test('renderer-facing project DTOs do not contain a filesystem path', () => {
  const value = { recentId: 'id', projectId: 'id', displayName: 'Example', lastOpenedAt: new Date().toISOString(), availability: 'available', diagnosticCode: null };
  expect(JSON.stringify(value)).not.toContain('Path');
  expect(JSON.stringify(value)).not.toContain('absolute');
});

test('compiled renderer entry has a restrictive content security policy', async () => {
  const source = await readFile(path.join(process.cwd(), 'index.html'), 'utf8');
  expect(source).toContain("default-src 'self'");
  expect(source).not.toContain("script-src 'self' 'unsafe-eval'");
});
