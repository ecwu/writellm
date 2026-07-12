import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChapterRepository } from '../../../src/main/project/chapter-repository';
import {
  ORIENTATION_KIND,
  ORIENTATION_SCHEMA_VERSION,
  type WritingOrientationDocument,
} from '../../../src/shared/writing-orientation';
import { emptyBlock, paragraph } from '../../fixtures/editor/chapter-fixtures';

const roots: string[] = [];
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chapter-repository-'));
  roots.push(root);
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  const projectId = randomUUID(),
    outlineItemId = randomUUID();
  const orientation: WritingOrientationDocument = {
    kind: ORIENTATION_KIND,
    schemaVersion: ORIENTATION_SCHEMA_VERSION,
    projectId,
    revision: 1,
    updatedAt: new Date().toISOString(),
    motivation: { problem: '', targetReaders: '', desiredOutcome: '' },
    outlineItems: [
      { outlineItemId, title: 'Opening', summary: '', status: 'not-started', chapterRef: null },
    ],
  };
  await writeFile(path.join(root, 'project.json'), JSON.stringify({ projectId }));
  await writeFile(
    path.join(root, 'workspace', 'writing-orientation.json'),
    JSON.stringify(orientation),
  );
  return {
    root,
    projectId,
    outlineItemId,
    session: { projectId, projectRoot: root, sessionId: randomUUID() },
  };
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
describe('chapter repository', () => {
  test('atomically creates once, links, saves and reopens', async () => {
    const fixture = await setup(),
      repository = new ChapterRepository(),
      mutationId = randomUUID();
    const first = await repository.openForOutlineItem(fixture.session, {
      outlineItemId: fixture.outlineItemId,
      baseOrientationRevision: 1,
      mutationId,
    });
    expect(first.ok).toBeTrue();
    if (!first.ok) return;
    expect(first.value.created).toBeTrue();
    const duplicate = await repository.openForOutlineItem(fixture.session, {
      outlineItemId: fixture.outlineItemId,
      baseOrientationRevision: 1,
      mutationId,
    });
    expect(duplicate).toEqual(first);
    const save = await repository.save(fixture.session, {
      chapterId: first.value.document.chapterId,
      baseRevision: 0,
      mutationId: randomUUID(),
      blocks: [paragraph('saved')],
      citations: [],
    });
    expect(save.ok).toBeTrue();
    const loaded = await repository.load(fixture.session, first.value.document.chapterId);
    expect(loaded.ok && loaded.value.revision).toBe(1);
    const disk = JSON.parse(
      await readFile(path.join(fixture.root, 'workspace', 'writing-orientation.json'), 'utf8'),
    );
    expect(disk.outlineItems[0].chapterRef).toBe(first.value.document.chapterId);
  });
  test('rejects stale saves and mutation misuse', async () => {
    const fixture = await setup(),
      repository = new ChapterRepository();
    const opened = await repository.openForOutlineItem(fixture.session, {
      outlineItemId: fixture.outlineItemId,
      baseOrientationRevision: 1,
      mutationId: randomUUID(),
    });
    if (!opened.ok) throw new Error(opened.error.message);
    const mutationId = randomUUID();
    const saved = await repository.save(fixture.session, {
      chapterId: opened.value.document.chapterId,
      baseRevision: 0,
      mutationId,
      blocks: [emptyBlock()],
      citations: [],
    });
    expect(saved.ok).toBeTrue();
    const stale = await repository.save(fixture.session, {
      chapterId: opened.value.document.chapterId,
      baseRevision: 0,
      mutationId: randomUUID(),
      blocks: [emptyBlock()],
      citations: [],
    });
    expect(!stale.ok && stale.error.code).toBe('REVISION_CONFLICT');
    const misuse = await repository.save(fixture.session, {
      chapterId: opened.value.document.chapterId,
      baseRevision: 1,
      mutationId,
      blocks: [paragraph('different')],
      citations: [],
    });
    expect(!misuse.ok && misuse.error.code).toBe('INVALID_INPUT');
  });
});
