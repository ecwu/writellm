import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceRepository } from '../../../src/main/sources/source-repository';

test('creates a schema-v1 catalog, enforces hash uniqueness and revision CAS', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-repository-'));
  const session = { projectId: 'project-1', projectRoot: root, sessionId: 'session-1' };
  const repository = new SourceRepository();
  expect((await repository.list(session, { limit: 100 })).catalogRevision).toBe(0);
  const first = await repository.createSource(session, {
    expectedCatalogRevision: 0,
    displayName: 'one.pdf',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
  });
  expect(first.status).toBe('created');
  if (first.status === 'created') {
    expect(await repository.get(session, first.source.sourceId)).toMatchObject({
      sourceId: first.source.sourceId,
      parseSummary: { markdownAvailable: false, mediaCount: 0, blockCount: 0 },
    });
  }
  expect(
    await repository.createSource(session, {
      expectedCatalogRevision: 1,
      displayName: 'duplicate.pdf',
      sizeBytes: 10,
      sha256: 'a'.repeat(64),
    }),
  ).toMatchObject({ status: 'duplicate' });
  expect(
    await repository.createSource(session, {
      expectedCatalogRevision: 0,
      displayName: 'stale.pdf',
      sizeBytes: 10,
      sha256: 'b'.repeat(64),
    }),
  ).toMatchObject({ status: 'conflict' });
});

test('fails closed on corrupt and unknown-version catalogs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-repository-'));
  await mkdir(path.join(root, 'sources'), { recursive: true });
  await writeFile(path.join(root, 'sources/catalog.json'), '{"schemaVersion":99}');
  const repository = new SourceRepository();
  await expect(
    repository.list({ projectId: 'p', projectRoot: root, sessionId: 's' }, { limit: 10 }),
  ).rejects.toThrow('SOURCE_RECOVERY_REQUIRED');
});
