import { expect, test } from 'bun:test';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SourceImportService } from '../../../src/main/sources/import-service';
import { SourceEvents } from '../../../src/main/sources/source-events';
import { SourceRepository } from '../../../src/main/sources/source-repository';
import { validPdfFixture } from '../../fixtures/sources/pdf-fixtures';

test('screens a mixed batch, publishes originals and suppresses exact duplicates', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-import-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const first = path.join(root, 'first.pdf');
  const unsupported = path.join(root, 'notes.txt');
  await writeFile(first, validPdfFixture());
  await writeFile(unsupported, 'notes');
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  const events: unknown[] = [];
  const sourceEvents = new SourceEvents();
  sourceEvents.subscribe(0, (event) => events.push(event));
  let paths = [first, unsupported];
  let id = 0;
  const repository = new SourceRepository({ id: () => `id-${++id}` });
  const service = new SourceImportService({
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: paths }) },
    repository,
    events: sourceEvents,
    getActiveSession: () => session,
    id: () => `work-${++id}`,
  });
  const result = await service.importFromDialog(0);
  expect(result).toMatchObject({
    status: 'accepted',
    outcomes: [{ status: 'queued' }, { status: 'rejected' }],
  });
  await service.settle();
  const listed = await repository.list(session, { limit: 100 });
  expect(listed.sources).toHaveLength(1);
  expect(
    await readFile(path.join(root, `sources/${listed.sources[0].sourceId}/original.pdf`)),
  ).toEqual(Buffer.from(validPdfFixture()));
  paths = [first];
  const duplicate = await service.importFromDialog(listed.catalogRevision);
  expect(duplicate.status).toBe('accepted');
  await service.settle();
  expect((await repository.list(session, { limit: 100 })).sources).toHaveLength(1);
  expect(JSON.stringify(events)).toContain('duplicate-confirmed');
  expect(await readdir(path.join(root, 'runtime/pending/source-imports'))).toEqual([]);
  const reopened = new SourceRepository();
  expect(
    (await reopened.list({ ...session, sessionId: 'reopened' }, { limit: 100 })).sources,
  ).toHaveLength(1);
});

test('cancels a provisional candidate without publishing a source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-import-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const pdf = path.join(root, 'cancel.pdf');
  await writeFile(pdf, new Uint8Array([...validPdfFixture(), ...new Uint8Array(4 * 1024 * 1024)]));
  const session = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  const repository = new SourceRepository();
  const service = new SourceImportService({
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [pdf] }) },
    repository,
    events: new SourceEvents(),
    getActiveSession: () => session,
  });
  const result = await service.importFromDialog(0);
  if (result.status !== 'accepted' || result.outcomes[0].status === 'rejected')
    throw new Error('candidate was not acknowledged');
  expect(await service.cancelCandidate(session, result.outcomes[0].candidateId)).toBe(true);
  await service.settle();
  expect((await repository.list(session, { limit: 100 })).sources).toHaveLength(0);
});

test('bounds selection to 100 and rejects late work after session changes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-import-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  const pdf = path.join(root, 'one.pdf');
  await writeFile(pdf, validPdfFixture());
  let active = { projectId: 'project', projectRoot: root, sessionId: 'session' };
  const repository = new SourceRepository();
  const service = new SourceImportService({
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: Array(101).fill(pdf) }) },
    repository,
    events: new SourceEvents(),
    getActiveSession: () => active,
  });
  const result = await service.importFromDialog(0);
  expect(result.status === 'accepted' && result.outcomes).toHaveLength(101);
  const originalSession = { ...active };
  const publishedBeforeSessionChange = (await repository.list(originalSession, { limit: 100 }))
    .sources.length;
  active = { ...active, sessionId: 'other' };
  await service.settle();
  expect((await repository.list(originalSession, { limit: 100 })).sources).toHaveLength(
    publishedBeforeSessionChange,
  );
});
