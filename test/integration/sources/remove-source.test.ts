import { expect, test } from 'bun:test';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeMinerUArtifact } from '../../../src/main/sources/artifact-normalizer';
import { SourceJobRepository } from '../../../src/main/sources/job-repository';
import { SourceReferenceReader } from '../../../src/main/sources/reference-reader';
import { SourceRemovalService } from '../../../src/main/sources/removal-service';
import { SourceEvents } from '../../../src/main/sources/source-events';
import { SourceRepository } from '../../../src/main/sources/source-repository';
import { orderedMinerUEntries } from '../../fixtures/sources/mineru-fixtures';

test('fails closed on references/unknown and revision-binds confirmed tombstone removal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'remove-source-'));
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
  const source = await repository.publishParse(
    session,
    created.source.sourceId,
    created.sourceVersionId,
    artifact,
  );
  const chapters = path.join(root, 'workspace/chapters');
  await mkdir(chapters, { recursive: true });
  await writeFile(
    path.join(chapters, 'one.json'),
    JSON.stringify({
      kind: 'writellm.chapter.blocknote',
      schemaVersion: 1,
      projectId: session.projectId,
      citations: [{ sourceId: source.sourceId, chunkId: artifact.blocks[0].chunkId }],
    }),
  );
  const jobs = new SourceJobRepository(root);
  await jobs.initialize();
  let clock = 0;
  const service = new SourceRemovalService({
    repository,
    references: new SourceReferenceReader(),
    events: new SourceEvents(),
    activeJobCount: () => 0,
    supersedeSource: (sourceId) => jobs.supersedeSource(sourceId),
    now: () => clock,
  });
  expect(
    await service.remove(session, {
      sourceId: source.sourceId,
      expectedSourceRevision: source.revision,
    }),
  ).toMatchObject({ status: 'referenced' });
  await writeFile(path.join(chapters, 'one.json'), '{bad');
  expect(
    await service.remove(session, {
      sourceId: source.sourceId,
      expectedSourceRevision: source.revision,
    }),
  ).toMatchObject({ status: 'referenced' });
  await writeFile(
    path.join(chapters, 'one.json'),
    JSON.stringify({
      kind: 'writellm.chapter.blocknote',
      schemaVersion: 1,
      projectId: session.projectId,
      citations: [],
    }),
  );
  const confirmation = await service.remove(session, {
    sourceId: source.sourceId,
    expectedSourceRevision: source.revision,
  });
  if (confirmation.status !== 'confirmation-required') throw new Error('confirmation missing');
  expect(
    await service.remove(session, {
      sourceId: source.sourceId,
      expectedSourceRevision: source.revision,
      confirmationToken: `${confirmation.confirmationToken}x`,
    }),
  ).toMatchObject({ status: 'conflict' });
  clock = 61_000;
  expect(
    await service.remove(session, {
      sourceId: source.sourceId,
      expectedSourceRevision: source.revision,
      confirmationToken: confirmation.confirmationToken,
    }),
  ).toMatchObject({ status: 'conflict' });
  const renewed = await service.remove(session, {
    sourceId: source.sourceId,
    expectedSourceRevision: source.revision,
  });
  if (renewed.status !== 'confirmation-required') throw new Error('renewal missing');
  expect(
    await service.remove(session, {
      sourceId: source.sourceId,
      expectedSourceRevision: source.revision,
      confirmationToken: renewed.confirmationToken,
    }),
  ).toMatchObject({ status: 'removed' });
  await expect(access(path.join(root, 'sources', source.sourceId))).rejects.toThrow();
  await expect(
    repository.publishParse(session, source.sourceId, created.sourceVersionId, artifact),
  ).rejects.toThrow('SOURCE_NOT_FOUND');
});
