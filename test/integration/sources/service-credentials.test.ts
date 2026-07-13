import { expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceServiceCredentials } from '../../../src/main/sources/service-credentials';

const protector = {
  available: async () => true,
  protect: async (value: string) => Buffer.from(`protected:${value}`).toString('base64'),
  unprotect: async (value: string) =>
    Buffer.from(value, 'base64')
      .toString()
      .replace(/^protected:/, ''),
};

test('keeps independent revisions, applies CAS and never persists plaintext', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'source-services-'));
  let id = 0;
  const repository = new SourceServiceCredentials(dir, protector, () => `r${++id}`);
  await repository.initialize();
  expect((await repository.save('mineru', null, 'mineru-sentinel')).status).toBe('saved');
  expect((await repository.save('siliconflow', null, 'silicon-sentinel')).status).toBe('saved');
  expect(repository.summary('mineru').revision).toBe('r1');
  expect(repository.summary('siliconflow').revision).toBe('r2');
  expect((await repository.save('mineru', null, 'stale')).status).toBe('conflict');
  const disk = await readFile(path.join(dir, 'source-services.json'), 'utf8');
  expect(disk).not.toContain('mineru-sentinel');
  expect(disk).not.toContain('silicon-sentinel');
  expect(await repository.readCredential('mineru', 'r1')).toBe('mineru-sentinel');
});

test('fails closed when operating-system protection is unavailable', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'source-services-'));
  const repository = new SourceServiceCredentials(dir, {
    ...protector,
    available: async () => false,
  });
  await repository.initialize();
  const result = await repository.save('mineru', null, 'secret');
  expect(result.status).toBe('error');
  expect(repository.summary('mineru')).toMatchObject({ configured: false, available: false });
});
