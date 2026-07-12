import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createValidProject } from '../../fixtures/project/project-fixtures';
import { RecentProjectIndex } from '../../../src/main/project/recent-index';

test('missing and corrupt recent indexes become an empty safe list', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-recent-'));
  const index = new RecentProjectIndex(path.join(root, 'recent.json'));
  await index.load();
  expect((await index.list()).recentProjects).toEqual([]);
  await writeFile(path.join(root, 'recent.json'), '{bad');
  const corrupt = new RecentProjectIndex(path.join(root, 'recent.json'));
  await corrupt.load();
  expect(await corrupt.list()).toMatchObject({ recentProjects: [], warning: expect.any(String) });
});

test('recent index upserts by project ID, preserves recent ID, sorts, and evicts at five', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-recent-limit-'));
  const index = new RecentProjectIndex(path.join(root, 'recent.json'));
  await index.load();
  const projects = [];
  for (let i = 0; i < 6; i += 1) projects.push(await createValidProject(root, `Project ${i}`));
  const first = await index.upsert(projects[0].root, { projectId: projects[0].manifest.projectId, displayName: projects[0].manifest.displayName }, undefined, '2026-07-12T00:00:00.000Z');
  const updated = await index.upsert(projects[0].root, { projectId: projects[0].manifest.projectId, displayName: 'Renamed snapshot' }, undefined, '2026-07-12T00:00:00.000Z');
  expect(updated.recentId).toBe(first.recentId);
  for (let i = 1; i < 6; i += 1) await index.upsert(projects[i].root, { projectId: projects[i].manifest.projectId, displayName: projects[i].manifest.displayName }, undefined, `2026-07-12T00:00:0${i}.000Z`);
  const listed = await index.list();
  expect(listed.recentProjects).toHaveLength(5);
  expect(listed.recentProjects.some((record) => record.recentId === first.recentId)).toBe(false);
  expect(listed.recentProjects[0].projectId).toBe(projects[5].manifest.projectId);
});
