import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { WritingOrientationRepository } from '../../../src/main/writing-orientation/repository';
import { ORIENTATION_KIND } from '../../../src/shared/writing-orientation';

test('linked delete is an authoritative main-owned refusal', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orientation-linked-boundary-'));
  await mkdir(path.join(root, 'workspace'));
  const session = {
    projectId: crypto.randomUUID(),
    projectRoot: root,
    sessionId: crypto.randomUUID(),
  };
  const outlineItemId = crypto.randomUUID();
  const file = path.join(root, 'workspace', 'writing-orientation.json');
  const document = {
    kind: ORIENTATION_KIND,
    schemaVersion: 1 as const,
    projectId: session.projectId,
    revision: 2,
    updatedAt: '2026-07-12T00:00:00.000Z',
    motivation: { problem: '', targetReaders: '', desiredOutcome: '' },
    outlineItems: [
      {
        outlineItemId,
        title: 'Linked',
        summary: '',
        status: 'not-started' as const,
        chapterRef: crypto.randomUUID(),
      },
    ],
  };
  await writeFile(file, JSON.stringify(document));
  let commits = 0;
  const repository = new WritingOrientationRepository({
    commitContent: async () => {
      commits++;
    },
  } as never);
  const result = await repository.deleteOutlineItem(session, {
    outlineItemId,
    baseRevision: 2,
    mutationId: crypto.randomUUID(),
  });
  expect(result.ok ? '' : result.error.code).toBe('LINKED_DELETE_NOT_AVAILABLE');
  expect(commits).toBe(0);
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(document);
});
