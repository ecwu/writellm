import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeMinerUArtifact } from '../../../src/main/sources/artifact-normalizer';
import { IndexRepository } from '../../../src/main/sources/index-repository';
import { SourceJobRepository } from '../../../src/main/sources/job-repository';
import { SourceServiceCredentials } from '../../../src/main/sources/service-credentials';
import { SourceEvents } from '../../../src/main/sources/source-events';
import { SourcePipeline } from '../../../src/main/sources/source-pipeline';
import { SourceRepository } from '../../../src/main/sources/source-repository';
import { orderedMinerUEntries } from '../../fixtures/sources/mineru-fixtures';

test('selectively retries missing embeddings, preserves valid vectors and rejects duplicate stale retry', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'retry-source-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  let id = 0;
  const repository = new SourceRepository({ id: () => `id-${++id}` });
  const created = await repository.createSource(session, {
    expectedCatalogRevision: 0,
    displayName: 'one.pdf',
    sizeBytes: 1,
    sha256: 'a'.repeat(64),
  });
  if (created.status !== 'created') throw new Error('not created');
  const artifact = normalizeMinerUArtifact(created.sourceVersionId, orderedMinerUEntries());
  const parsed = await repository.publishParse(
    session,
    created.source.sourceId,
    created.sourceVersionId,
    artifact,
  );
  const indexes = new IndexRepository();
  const vector = Float32Array.from({ length: 1024 }, () => 0.25);
  await indexes.saveVectors(session, {
    sourceId: created.source.sourceId,
    sourceVersionId: created.sourceVersionId,
    revision: 3,
    values: [
      { chunkId: artifact.blocks[0].chunkId, contentHash: artifact.blocks[0].contentHash, vector },
    ],
  });
  await repository.updateIndexProgress(
    session,
    created.source.sourceId,
    created.sourceVersionId,
    1,
  );
  const current = await repository.get(session, created.source.sourceId);
  if (!current) throw new Error('missing');
  const credentials = new SourceServiceCredentials(path.join(root, 'credentials'), {
    available: async () => true,
    protect: async (v) => v,
    unprotect: async (v) => v,
  });
  await credentials.initialize();
  const jobs = new SourceJobRepository(root);
  await jobs.initialize();
  const pipeline = new SourcePipeline({
    credentials,
    repository,
    events: new SourceEvents(),
    getActiveSession: () => session,
  });
  const retry = await pipeline.retrySource(session, current.sourceId, current.revision, jobs);
  expect(retry).toMatchObject({ status: 'accepted', source: { retrying: true } });
  expect(jobs.list().filter((job) => job.type === 'embed')).toHaveLength(2);
  expect(
    await indexes.readVector(
      session,
      current.sourceId,
      created.sourceVersionId,
      artifact.blocks[0].chunkId,
      artifact.blocks[0].contentHash,
    ),
  ).toEqual(vector);
  expect(
    await pipeline.retrySource(session, current.sourceId, current.revision, jobs),
  ).toMatchObject({ status: 'conflict' });
  expect(parsed.eligibility.eligible).toBe(3);
});
