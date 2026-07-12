import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectRepository, type DirectoryDialog } from '../../../src/main/project/project-repository';
import { createValidProject } from '../../fixtures/project/project-fixtures';

test('recent records are bounded and removal does not remove project files', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'writellm-recent-ui-data-'));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'writellm-recent-ui-parent-'));
  const projects = [];
  for (let index = 0; index < 6; index += 1) projects.push(await createValidProject(parent, `Recent ${index}`));
  let selected = projects[0].root;
  const dialog: DirectoryDialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [selected] }) };
  const repository = new ProjectRepository({ userDataPath: data, dialog, now: (() => { let index = 0; return () => `2026-07-12T00:00:0${index++}.000Z`; })() });
  await repository.initialize();
  for (const project of projects) { selected = project.root; await repository.openProjectFromDialog(); }
  const listed = await repository.listRecentProjects();
  expect(listed.recentProjects).toHaveLength(5);
  const removeId = listed.recentProjects[0].recentId;
  const removedRoot = projects[5].root;
  expect(await repository.removeRecentProject(removeId)).toMatchObject({ status: 'removed', recentId: removeId });
  expect(await import('node:fs/promises').then(({ stat }) => stat(removedRoot))).toBeTruthy();
});

