import { expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RecentProjectIndex } from '../../../src/main/project/recent-index';
import { createValidProject } from '../../fixtures/project/project-fixtures';

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
  const first = await index.upsert(
    projects[0].root,
    { projectId: projects[0].manifest.projectId, displayName: projects[0].manifest.displayName },
    undefined,
    '2026-07-12T00:00:00.000Z',
  );
  const updated = await index.upsert(
    projects[0].root,
    { projectId: projects[0].manifest.projectId, displayName: 'Renamed snapshot' },
    undefined,
    '2026-07-12T00:00:00.000Z',
  );
  expect(updated.recentId).toBe(first.recentId);
  for (let i = 1; i < 6; i += 1)
    await index.upsert(
      projects[i].root,
      { projectId: projects[i].manifest.projectId, displayName: projects[i].manifest.displayName },
      undefined,
      `2026-07-12T00:00:0${i}.000Z`,
    );
  const listed = await index.list();
  expect(listed.recentProjects).toHaveLength(5);
  expect(listed.recentProjects.some((record) => record.recentId === first.recentId)).toBe(false);
  expect(listed.recentProjects[0].projectId).toBe(projects[5].manifest.projectId);
});

test('recent index rejects invalid timestamps, diagnostics, duplicates, and unsorted records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-recent-schema-'));
  const fixture = await createValidProject(root, 'Schema');
  const record = {
    recentId: crypto.randomUUID(),
    projectId: fixture.manifest.projectId,
    mainOnlyPath: fixture.root,
    displayName: 'Schema',
    lastOpenedAt: 'not-a-date',
    availability: 'available',
    diagnosticCode: null,
  };
  const file = path.join(root, 'recent.json');
  for (const records of [
    [record],
    [{ ...record, lastOpenedAt: '2026-07-12T00:00:00.000Z', diagnosticCode: 'RAW_OS_ERROR' }],
    [
      { ...record, lastOpenedAt: '2026-07-12T00:00:00.000Z' },
      { ...record, lastOpenedAt: '2026-07-11T00:00:00.000Z' },
    ],
  ]) {
    await writeFile(
      file,
      JSON.stringify({ kind: 'writellm.recent-index', schemaVersion: 1, records }),
    );
    const index = new RecentProjectIndex(file);
    await index.load();
    expect(await index.list()).toMatchObject({ recentProjects: [], warning: expect.any(String) });
  }
});
