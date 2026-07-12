import { expect, test } from 'bun:test';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  type DirectoryDialog,
  ProjectRepository,
} from '../../../src/main/project/project-repository';
import { createValidProject, treeHash } from '../../fixtures/project/project-fixtures';

function dialogFor(pathValue: string): DirectoryDialog {
  return { showOpenDialog: async () => ({ canceled: false, filePaths: [pathValue] }) };
}

test('direct open after a move preserves identity, recent ID, bytes, and unknown files', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'writellm-move-data-'));
  const originalParent = await mkdtemp(path.join(os.tmpdir(), 'writellm-move-original-'));
  const movedParent = await mkdtemp(path.join(os.tmpdir(), 'writellm-move-target-'));
  const fixture = await createValidProject(originalParent, 'Portable');
  await writeFile(path.join(fixture.root, 'workspace', 'future-content.bin'), 'preserve');
  const manifestBefore = await readFile(path.join(fixture.root, 'project.json'));
  const hashBefore = await treeHash(fixture.root);
  const first = new ProjectRepository({
    userDataPath: data,
    dialog: dialogFor(fixture.root),
    now: () => '2026-07-12T00:00:00.000Z',
  });
  await first.initialize();
  await first.openProjectFromDialog();
  const recentId = (await first.listRecentProjects()).recentProjects[0].recentId;
  const movedRoot = path.join(movedParent, 'Renamed.writellm');
  await rename(fixture.root, movedRoot);
  const reopened = new ProjectRepository({
    userDataPath: data,
    dialog: dialogFor(movedRoot),
    now: () => '2026-07-12T00:01:00.000Z',
  });
  await reopened.initialize();
  expect(await reopened.openProjectFromDialog()).toMatchObject({
    status: 'opened',
    project: { projectId: fixture.manifest.projectId },
  });
  const listed = await reopened.listRecentProjects();
  expect(listed.recentProjects[0]).toMatchObject({
    recentId,
    projectId: fixture.manifest.projectId,
    displayName: 'Portable',
  });
  expect(await treeHash(movedRoot)).toBe(hashBefore);
  expect(await readFile(path.join(movedRoot, 'project.json'))).toEqual(manifestBefore);
});

test('twenty move and reopen iterations preserve the stable project identity', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'writellm-move-20-data-'));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'writellm-move-20-parent-'));
  const fixture = await createValidProject(parent, 'Repeated');
  let current = fixture.root;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const targetParent = await mkdtemp(path.join(os.tmpdir(), `writellm-move-20-${iteration}-`));
    const target = path.join(targetParent, `Moved-${iteration}.writellm`);
    await rename(current, target);
    const repository = new ProjectRepository({
      userDataPath: data,
      dialog: dialogFor(target),
      now: () => new Date(2026, 6, 12, 0, 0, iteration).toISOString(),
    });
    await repository.initialize();
    expect(await repository.openProjectFromDialog()).toMatchObject({
      status: 'opened',
      project: { projectId: fixture.manifest.projectId },
    });
    current = target;
  }
  expect((await import('node:fs/promises').then(({ stat }) => stat(current))).isDirectory()).toBe(
    true,
  );
});
