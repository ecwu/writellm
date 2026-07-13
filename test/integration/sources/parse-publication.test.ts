import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeMinerUArtifact } from '../../../src/main/sources/artifact-normalizer';
import { SourceRepository } from '../../../src/main/sources/source-repository';
import { orderedMinerUEntries } from '../../fixtures/sources/mineru-fixtures';

test('atomically publishes deterministic blocks, media and manifest with version fencing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'parse-publication-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  let id = 0;
  const repository = new SourceRepository({ id: () => `id-${++id}` });
  const created = await repository.createSource(session, {
    expectedCatalogRevision: 0,
    displayName: 'one.pdf',
    sizeBytes: 10,
    sha256: 'a'.repeat(64),
  });
  if (created.status !== 'created') throw new Error('not created');
  const artifact = normalizeMinerUArtifact(created.sourceVersionId, orderedMinerUEntries());
  const summary = await repository.publishParse(
    session,
    created.source.sourceId,
    created.sourceVersionId,
    artifact,
  );
  expect(summary).toMatchObject({ state: 'indexing', eligibility: { eligible: 3 } });
  const page = await repository.getBlocks(session, created.source.sourceId, undefined, 2);
  expect(page.blocks.map((block) => block.ordinal)).toEqual([0, 1]);
  expect(page.nextCursor).toBe('2');
  const manifest = await readFile(
    path.join(
      root,
      `sources/${created.source.sourceId}/versions/${created.sourceVersionId}/manifest.json`,
    ),
    'utf8',
  );
  expect(manifest).toContain('"parseState":"complete"');
  expect(
    await repository.resolveMedia(session, created.source.sourceId, artifact.media[0].mediaId),
  ).toMatchObject({ mimeType: 'image/png', sha256: artifact.media[0].sha256 });
  await expect(
    repository.publishParse(session, created.source.sourceId, 'stale-version', artifact),
  ).rejects.toThrow('SOURCE_CONFLICT');
});
