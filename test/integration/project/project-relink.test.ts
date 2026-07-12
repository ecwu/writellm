import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectRepository, type DirectoryDialog } from '../../../src/main/project/project-repository';
import { createValidProject } from '../../fixtures/project/project-fixtures';

test('a missing recent record remains visible until explicitly removed', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'writellm-missing-data-'));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'writellm-missing-parent-'));
  const project = await createValidProject(parent, 'Missing');
  const dialog: DirectoryDialog = { showOpenDialog: async () => ({ canceled: false, filePaths: [project.root] }) };
  const repository = new ProjectRepository({ userDataPath: data, dialog });
  await repository.initialize();
  await repository.openProjectFromDialog();
  await import('node:fs/promises').then(({ rm }) => rm(project.root, { recursive: true }));
  const listed = await repository.listRecentProjects();
  expect(listed.recentProjects[0]).toMatchObject({ availability: 'missing', diagnosticCode: 'PROJECT_NOT_FOUND' });
  expect(await repository.openRecentProject(listed.recentProjects[0].recentId)).toMatchObject({ status: 'error', error: { code: 'PROJECT_NOT_FOUND' } });
});

