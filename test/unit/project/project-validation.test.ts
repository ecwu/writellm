import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  validateManifest,
  validateProjectDirectory,
  validateProjectName,
} from '../../../src/main/project/project-validation';
import { createValidProject } from '../../fixtures/project/project-fixtures';

test('validates current-platform leaf names without cross-platform sanitizing', () => {
  expect(validateProjectName('A project')).toEqual({ ok: true });
  expect(validateProjectName('')).toMatchObject({ ok: false, code: 'INVALID_PROJECT_NAME' });
  expect(validateProjectName('a/b')).toMatchObject({ ok: false, code: 'INVALID_PROJECT_NAME' });
});

test('validates a v1 manifest and required workspace directory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-validation-'));
  const fixture = await createValidProject(root);
  expect((await validateProjectDirectory(fixture.root)).ok).toBe(true);
  expect(
    validateManifest(JSON.parse(await readFile(path.join(fixture.root, 'project.json'), 'utf8')))
      .ok,
  ).toBe(true);
});

test('rejects unknown schema and missing required directory without repair', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'writellm-invalid-'));
  const fixture = await createValidProject(root);
  const manifestPath = path.join(fixture.root, 'project.json');
  const original = await readFile(manifestPath, 'utf8');
  await writeFile(manifestPath, JSON.stringify({ ...fixture.manifest, schemaVersion: 2 }));
  expect(await validateProjectDirectory(fixture.root)).toMatchObject({
    ok: false,
    error: { code: 'PROJECT_UNSUPPORTED_VERSION' },
  });
  await writeFile(manifestPath, original);
  await import('node:fs/promises').then(({ rm }) =>
    rm(path.join(fixture.root, 'workspace'), { recursive: true }),
  );
  expect(await validateProjectDirectory(fixture.root)).toMatchObject({
    ok: false,
    error: { code: 'PROJECT_INVALID' },
  });
  expect(await readFile(manifestPath, 'utf8')).toBe(original);
});
