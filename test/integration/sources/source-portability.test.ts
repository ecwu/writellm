import { expect, test } from 'bun:test';
import fs from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';
import { normalizeMinerUArtifact } from '../../../src/main/sources/artifact-normalizer';
import { IndexRepository } from '../../../src/main/sources/index-repository';
import { SourceRepository } from '../../../src/main/sources/source-repository';
import { orderedMinerUEntries } from '../../fixtures/sources/mineru-fixtures';

test('canonical source content and vectors survive a project move while runtime and secrets stay untracked', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'source-portability-'));
  const root = path.join(parent, 'original.writellm');
  await mkdir(root);
  await writeFile(path.join(root, 'project.json'), '{}');
  const session = { projectId: 'portable-project', projectRoot: root, sessionId: 'session-one' };
  let nextId = 0;
  const sources = new SourceRepository({
    id: () => `portable-${++nextId}`,
    now: () => '2026-01-01T00:00:00.000Z',
  });
  const created = await sources.createSource(session, {
    expectedCatalogRevision: 0,
    displayName: 'portable.pdf',
    sizeBytes: 8,
    sha256: 'a'.repeat(64),
    originalBytes: Uint8Array.of(37, 80, 68, 70, 45, 49, 46, 55),
  });
  if (created.status !== 'created') throw new Error('source creation failed');
  const artifact = normalizeMinerUArtifact(created.sourceVersionId, orderedMinerUEntries());
  await sources.publishParse(session, created.source.sourceId, created.sourceVersionId, artifact);
  const block = artifact.blocks.find((value) => value.eligible);
  if (!block) throw new Error('eligible block missing');
  await new IndexRepository().saveVectors(session, {
    sourceId: created.source.sourceId,
    sourceVersionId: created.sourceVersionId,
    revision: 3,
    values: [
      {
        chunkId: block.chunkId,
        contentHash: block.contentHash,
        vector: new Float32Array(1024).fill(1),
      },
    ],
  });
  await mkdir(path.join(root, 'runtime/source-downloads'), { recursive: true });
  await mkdir(path.join(root, 'secrets'), { recursive: true });
  await writeFile(path.join(root, 'runtime/source-downloads/provider.zip'), 'temporary-archive');
  await writeFile(path.join(root, 'secrets/token.secret'), 'credential-sentinel');

  const tracked = await git.listFiles({ fs, dir: root });
  expect(tracked).toContain(`sources/${created.source.sourceId}/original.pdf`);
  expect(tracked).toContain(
    `sources/${created.source.sourceId}/versions/${created.sourceVersionId}/embeddings/siliconflow-bge-m3-v1.f32`,
  );
  expect(
    tracked.every((file) => !file.startsWith('runtime/') && !file.startsWith('secrets/')),
  ).toBe(true);
  const commits = await git.log({ fs, dir: root });
  expect(commits.some(({ commit }) => commit.message.includes('WriteLLM-Event: processing'))).toBe(
    true,
  );
  expect(commits.every(({ commit }) => commit.message.includes('WriteLLM-Actor:'))).toBe(true);

  const moved = path.join(parent, 'moved.writellm');
  await cp(root, moved, { recursive: true });
  const movedSession = { ...session, projectRoot: moved, sessionId: 'session-two' };
  const reopened = await new SourceRepository().get(movedSession, created.source.sourceId);
  const vector = await new IndexRepository().readVector(
    movedSession,
    created.source.sourceId,
    created.sourceVersionId,
    block.chunkId,
    block.contentHash,
  );
  expect(reopened).toMatchObject({ displayName: 'portable.pdf', parseSummary: { blockCount: 3 } });
  expect(vector?.length).toBe(1024);
  expect(await readFile(path.join(moved, '.gitignore'), 'utf8')).toContain('runtime/');
});
