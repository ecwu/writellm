import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IndexRepository } from '../../../src/main/sources/index-repository';
import { SILICONFLOW_INDEX_PROFILE_ID } from '../../../src/shared/sources';

test('publishes profile-bound float32 layout and validates offset/hash/content identity', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'index-repository-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  const repository = new IndexRepository();
  const vector = Float32Array.from({ length: 1024 }, (_, index) => index / 1024 + 0.1);
  const records = await repository.saveVectors(session, {
    sourceId: 'source',
    sourceVersionId: 'version',
    revision: 1,
    values: [{ chunkId: 'chunk', contentHash: 'hash', vector }],
  });
  expect(records[0]).toMatchObject({ offsetBytes: 0, dimensions: 1024 });
  expect(await repository.readVector(session, 'source', 'version', 'chunk', 'hash')).toEqual(
    vector,
  );
  expect(await repository.readVector(session, 'source', 'version', 'chunk', 'stale')).toBeNull();
  const file = path.join(
    root,
    `sources/source/versions/version/embeddings/${SILICONFLOW_INDEX_PROFILE_ID}.f32`,
  );
  const bytes = await readFile(file);
  bytes[0] ^= 1;
  await writeFile(file, bytes);
  expect(await repository.readVector(session, 'source', 'version', 'chunk', 'hash')).toBeNull();
});
