import { expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ProjectRepository, type DirectoryDialog } from '../../../src/main/project/project-repository';
import { createValidProject, treeHash } from '../../fixtures/project/project-fixtures';

function fakeDialog(paths: Array<string | null>): DirectoryDialog {
  return {
    async showOpenDialog() {
      const next = paths.shift() ?? null;
      return next ? { canceled: false, filePaths: [next] } : { canceled: true, filePaths: [] };
    }
  };
}

test('create is collision safe, publishes manifest last, and supports cancellation', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'writellm-repo-data-'));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'writellm-repo-parent-'));
  const repository = new ProjectRepository({ userDataPath: userData, dialog: fakeDialog([null, parent, parent]), now: () => '2026-07-12T00:00:00.000Z' });
  await repository.initialize();
  expect(await repository.createProject('Canceled')).toEqual({ status: 'canceled' });
  const created = await repository.createProject('Draft');
  expect(created.status).toBe('created');
  expect(await repository.createProject('Draft')).toMatchObject({ status: 'error', error: { code: 'PROJECT_EXISTS' } });
  expect(await readFile(path.join(parent, 'Draft.writellm', 'project.json'), 'utf8')).toContain('writellm.project');
  expect(await repository.listRecentProjects()).toMatchObject({ recentProjects: [{ displayName: 'Draft', availability: 'available' }] });
});

test('open is read-only and returns safe invalid-project diagnostics', async () => {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'writellm-open-data-'));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'writellm-open-parent-'));
  const fixture = await createValidProject(parent, 'Moved');
  await writeFile(path.join(fixture.root, 'workspace', 'unknown.txt'), 'keep me');
  const before = await treeHash(fixture.root);
  const repository = new ProjectRepository({ userDataPath: userData, dialog: fakeDialog([fixture.root]) });
  await repository.initialize();
  expect(await repository.openProjectFromDialog()).toMatchObject({ status: 'opened', project: { projectId: fixture.manifest.projectId } });
  expect(await treeHash(fixture.root)).toBe(before);

  const invalid = path.join(parent, 'Invalid.writellm');
  await import('node:fs/promises').then(({ mkdir }) => mkdir(invalid));
  const invalidRepository = new ProjectRepository({ userDataPath: await mkdtemp(path.join(os.tmpdir(), 'writellm-invalid-data-')), dialog: fakeDialog([invalid]) });
  await invalidRepository.initialize();
  expect(await invalidRepository.openProjectFromDialog()).toMatchObject({ status: 'error', error: { code: 'PROJECT_INVALID' } });
});

