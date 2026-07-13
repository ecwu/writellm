import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeMinerUArtifact } from '../../../src/main/sources/artifact-normalizer';
import { IndexRepository } from '../../../src/main/sources/index-repository';
import { SourceIndexReader } from '../../../src/main/sources/source-index-reader';
import { SourceRepository } from '../../../src/main/sources/source-repository';
import { orderedMinerUEntries } from '../../fixtures/sources/mineru-fixtures';

test('keeps current-profile vector lookup main-only and fail-closed', async () => {
  const [reader, preload, rendererTypes] = await Promise.all([
    readFile('src/main/sources/source-index-reader.ts', 'utf8'),
    readFile('src/preload/preload.cts', 'utf8'),
    readFile('src/shared/sources.ts', 'utf8'),
  ]);
  expect(reader).toContain('block.eligible');
  expect(reader).toContain('readVector');
  expect(reader).toContain('SILICONFLOW_INDEX_PROFILE_ID');
  expect(preload).not.toContain('SourceIndexReader');
  expect(rendererTypes).not.toContain('Float32Array');
});

test('yields only current eligible blocks with hash-valid vectors and exact identity lookup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-index-reader-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  let id = 0;
  const sources = new SourceRepository({ id: () => `id-${++id}` });
  const created = await sources.createSource(session, {
    expectedCatalogRevision: 0,
    displayName: 'one.pdf',
    sizeBytes: 1,
    sha256: 'a'.repeat(64),
  });
  if (created.status !== 'created') throw new Error('not created');
  const artifact = normalizeMinerUArtifact(created.sourceVersionId, orderedMinerUEntries());
  await sources.publishParse(session, created.source.sourceId, created.sourceVersionId, artifact);
  const indexes = new IndexRepository();
  await indexes.saveVectors(session, {
    sourceId: created.source.sourceId,
    sourceVersionId: created.sourceVersionId,
    revision: 3,
    values: [
      {
        chunkId: artifact.blocks[0].chunkId,
        contentHash: artifact.blocks[0].contentHash,
        vector: Float32Array.from({ length: 1024 }, () => 0.25),
      },
    ],
  });
  await sources.updateIndexProgress(session, created.source.sourceId, created.sourceVersionId, 1);
  const reader = new SourceIndexReader(sources, indexes);
  const found = await reader.getBlock(session, created.source.sourceId, artifact.blocks[0].chunkId);
  expect(found).toMatchObject({
    sourceId: created.source.sourceId,
    chunkId: artifact.blocks[0].chunkId,
    indexProfileId: 'siliconflow-bge-m3-v1',
  });
  expect(found?.vector).toHaveLength(1024);
  expect(await reader.getBlock(session, created.source.sourceId, 'missing')).toBeNull();
});
