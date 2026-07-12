import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectGitError } from '../../../src/main/project/git-repository';
import { WritingOrientationRepository } from '../../../src/main/writing-orientation/repository';
import { ORIENTATION_KIND } from '../../../src/shared/writing-orientation';

test('repository saves, reopens, deduplicates and rejects stale revisions', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orientation-'));
  await mkdir(path.join(root, 'workspace'));
  const session = {
      projectId: crypto.randomUUID(),
      projectRoot: root,
      sessionId: crypto.randomUUID(),
    },
    commits: number[] = [];
  const repo = new WritingOrientationRepository(
    {
      commitContent: async (_r: string, _f: string, revision: number) => {
        commits.push(revision);
      },
    } as any,
    () => '2026-07-12T00:00:00.000Z',
  );
  const mutationId = crypto.randomUUID(),
    input = {
      baseRevision: 0,
      mutationId,
      motivation: { problem: 'p', targetReaders: '', desiredOutcome: '' },
      outlineItems: [],
    };
  const first = await repo.save(session, input);
  expect(first.ok).toBeTrue();
  expect(await repo.save(session, input)).toEqual(first);
  expect(commits).toEqual([1]);
  const stale = await repo.save(session, { ...input, mutationId: crypto.randomUUID() });
  expect(stale.ok ? '' : stale.error.code).toBe('REVISION_CONFLICT');
  expect(
    JSON.parse(await readFile(path.join(root, 'workspace', 'writing-orientation.json'), 'utf8'))
      .revision,
  ).toBe(1);
});
test('authoritative linked item refuses deletion with zero write', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orientation-linked-'));
  await mkdir(path.join(root, 'workspace'));
  const session = {
      projectId: crypto.randomUUID(),
      projectRoot: root,
      sessionId: crypto.randomUUID(),
    },
    outlineItemId = crypto.randomUUID();
  const document = {
    kind: ORIENTATION_KIND,
    schemaVersion: 1 as const,
    projectId: session.projectId,
    revision: 4,
    updatedAt: '2026-07-12T00:00:00.000Z',
    motivation: { problem: '', targetReaders: '', desiredOutcome: '' },
    outlineItems: [
      {
        outlineItemId,
        title: 'Linked',
        summary: '',
        status: 'in-progress' as const,
        chapterRef: crypto.randomUUID(),
      },
    ],
  };
  await writeFile(
    path.join(root, 'workspace', 'writing-orientation.json'),
    JSON.stringify(document),
  );
  let writes = 0;
  const repo = new WritingOrientationRepository({
    commitContent: async () => {
      writes++;
    },
  } as any);
  const result = await repo.deleteOutlineItem(session, {
    outlineItemId,
    baseRevision: 4,
    mutationId: crypto.randomUUID(),
  });
  expect(result.ok ? '' : result.error.code).toBe('LINKED_DELETE_NOT_AVAILABLE');
  expect(writes).toBe(0);
  expect(
    JSON.parse(await readFile(path.join(root, 'workspace', 'writing-orientation.json'), 'utf8')),
  ).toEqual(document);
});

test('distinguishes Git initialization failure and recovers the exact retry idempotently', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orientation-recovery-'));
  const session = {
    projectId: crypto.randomUUID(),
    projectRoot: root,
    sessionId: crypto.randomUUID(),
  };
  let attempts = 0;
  const repo = new WritingOrientationRepository(
    {
      commitContent: async () => {
        if (attempts++ === 0) throw new ProjectGitError('initialization');
      },
    } as any,
    () => '2026-07-12T00:00:00.000Z',
  );
  const input = {
    baseRevision: 0,
    mutationId: crypto.randomUUID(),
    motivation: { problem: 'recover me', targetReaders: '', desiredOutcome: '' },
    outlineItems: [],
  };
  const failed = await repo.save(session, input);
  expect(failed.ok ? '' : failed.error.code).toBe('GIT_INITIALIZATION_FAILED');
  const recovered = await repo.save(session, input);
  expect(recovered.ok).toBeTrue();
  expect(recovered.ok && recovered.value.document.revision).toBe(1);
  expect(await repo.save(session, input)).toEqual(recovered);
  expect(attempts).toBe(2);
});

test('maps an existing repository commit failure separately', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orientation-commit-'));
  const session = {
    projectId: crypto.randomUUID(),
    projectRoot: root,
    sessionId: crypto.randomUUID(),
  };
  const repo = new WritingOrientationRepository({
    commitContent: async () => {
      throw new ProjectGitError('commit');
    },
  } as any);
  const result = await repo.save(session, {
    baseRevision: 0,
    mutationId: crypto.randomUUID(),
    motivation: { problem: 'p', targetReaders: '', desiredOutcome: '' },
    outlineItems: [],
  });
  expect(result.ok ? '' : result.error.code).toBe('GIT_COMMIT_FAILED');
});

test('recovers an exact delete retry without deleting twice', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'orientation-delete-recovery-'));
  await mkdir(path.join(root, 'workspace'));
  const session = {
      projectId: crypto.randomUUID(),
      projectRoot: root,
      sessionId: crypto.randomUUID(),
    },
    outlineItemId = crypto.randomUUID();
  await writeFile(
    path.join(root, 'workspace', 'writing-orientation.json'),
    JSON.stringify({
      kind: ORIENTATION_KIND,
      schemaVersion: 1,
      projectId: session.projectId,
      revision: 1,
      updatedAt: '2026-07-12T00:00:00.000Z',
      motivation: { problem: '', targetReaders: '', desiredOutcome: '' },
      outlineItems: [
        { outlineItemId, title: 'Delete me', summary: '', status: 'not-started', chapterRef: null },
      ],
    }),
  );
  let attempts = 0;
  const repo = new WritingOrientationRepository({
    commitContent: async () => {
      if (attempts++ === 0) throw new ProjectGitError('commit');
    },
  } as any);
  const input = { outlineItemId, baseRevision: 1, mutationId: crypto.randomUUID() };
  expect((await repo.deleteOutlineItem(session, input)).ok).toBeFalse();
  const recovered = await repo.deleteOutlineItem(session, input);
  expect(recovered.ok).toBeTrue();
  expect(recovered.ok && recovered.value.document.outlineItems).toHaveLength(0);
  expect(await repo.deleteOutlineItem(session, input)).toEqual(recovered);
});
