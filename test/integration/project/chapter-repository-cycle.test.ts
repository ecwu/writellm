import { afterEach, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ChapterRepository } from '../../../src/main/project/chapter-repository';
import {
  ORIENTATION_KIND,
  ORIENTATION_SCHEMA_VERSION,
} from '../../../src/shared/writing-orientation';
import { paragraph } from '../../fixtures/editor/chapter-fixtures';

let root = '';
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});
async function fixture(git: { commitContents(...args: unknown[]): Promise<void> }) {
  root = await mkdtemp(path.join(os.tmpdir(), 'chapter-cycle-'));
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  const projectId = randomUUID(),
    outlineItemId = randomUUID(),
    session = { projectId, projectRoot: root, sessionId: randomUUID() };
  await writeFile(
    path.join(root, 'workspace', 'writing-orientation.json'),
    JSON.stringify({
      kind: ORIENTATION_KIND,
      schemaVersion: ORIENTATION_SCHEMA_VERSION,
      projectId,
      revision: 1,
      updatedAt: new Date().toISOString(),
      motivation: { problem: '', targetReaders: '', desiredOutcome: '' },
      outlineItems: [
        { outlineItemId, title: 'Chapter', summary: '', status: 'not-started', chapterRef: null },
      ],
    }),
  );
  return { repository: new ChapterRepository(git as never), session, outlineItemId };
}
describe('chapter persistence cycles', () => {
  test('survives 100 save and reopen cycles', async () => {
    const value = await fixture({ commitContents: async () => {} });
    const opened = await value.repository.openForOutlineItem(value.session, {
      outlineItemId: value.outlineItemId,
      baseOrientationRevision: 1,
      mutationId: randomUUID(),
    });
    if (!opened.ok) throw new Error(opened.error.message);
    let revision = 0;
    for (let index = 0; index < 100; index++) {
      const result = await value.repository.save(value.session, {
        chapterId: opened.value.document.chapterId,
        baseRevision: revision,
        mutationId: randomUUID(),
        blocks: [paragraph(`save ${index}`)],
        citations: [],
      });
      if (!result.ok) throw new Error(result.error.message);
      revision = result.value.document.revision;
      const loaded = await value.repository.load(value.session, opened.value.document.chapterId);
      expect(loaded.ok && loaded.value.revision).toBe(revision);
    }
    expect(revision).toBe(100);
  });
  test('recovers a completed replacement after one commit failure using the identical mutation', async () => {
    let fail = false;
    const value = await fixture({
      commitContents: async () => {
        if (fail) {
          fail = false;
          throw new Error('injected');
        }
      },
    });
    const opened = await value.repository.openForOutlineItem(value.session, {
      outlineItemId: value.outlineItemId,
      baseOrientationRevision: 1,
      mutationId: randomUUID(),
    });
    if (!opened.ok) throw new Error(opened.error.message);
    fail = true;
    const input = {
      chapterId: opened.value.document.chapterId,
      baseRevision: 0,
      mutationId: randomUUID(),
      blocks: [paragraph('recover')],
      citations: [],
    };
    const failed = await value.repository.save(value.session, input);
    expect(failed.ok).toBeFalse();
    const recovered = await value.repository.save(value.session, input);
    expect(recovered.ok && recovered.value.document.revision).toBe(1);
  });
});
