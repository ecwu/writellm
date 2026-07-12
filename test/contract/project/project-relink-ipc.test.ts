import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  type DirectoryDialog,
  ProjectRepository,
} from '../../../src/main/project/project-repository';
import { createValidProject } from '../../fixtures/project/project-fixtures';

function dialogFor(pathValue: string): DirectoryDialog {
  return { showOpenDialog: async () => ({ canceled: false, filePaths: [pathValue] }) };
}

test('relink mismatch preserves the original recent record', async () => {
  const data = await mkdtemp(path.join(os.tmpdir(), 'writellm-relink-data-'));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'writellm-relink-parent-'));
  const original = await createValidProject(parent, 'Original');
  const other = await createValidProject(parent, 'Other');
  const openRepository = new ProjectRepository({
    userDataPath: data,
    dialog: dialogFor(original.root),
    now: () => '2026-07-12T00:00:00.000Z',
  });
  await openRepository.initialize();
  await openRepository.openProjectFromDialog();
  const before = await openRepository.listRecentProjects();
  const relinkRepository = new ProjectRepository({
    userDataPath: data,
    dialog: dialogFor(other.root),
    now: () => '2026-07-12T00:01:00.000Z',
  });
  await relinkRepository.initialize();
  const recentId = before.recentProjects[0].recentId;
  expect(await relinkRepository.relinkRecentProject(recentId)).toMatchObject({
    status: 'error',
    error: { code: 'PROJECT_ID_MISMATCH' },
  });
  expect(await relinkRepository.listRecentProjects()).toMatchObject({
    recentProjects: [
      { recentId, projectId: original.manifest.projectId, availability: 'available' },
    ],
  });
});
