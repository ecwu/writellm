import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ProjectManifest } from '../../../src/shared/project';

export async function createValidProject(
  parent: string,
  displayName = 'Example',
): Promise<{ root: string; manifest: ProjectManifest }> {
  const root = path.join(parent, `${displayName}.writellm`);
  const createdAt = new Date('2026-07-12T00:00:00.000Z').toISOString();
  const manifest: ProjectManifest = {
    kind: 'writellm.project',
    schemaVersion: 1,
    projectId: randomUUID(),
    displayName,
    requiredDirectories: ['workspace'],
    createdAt,
    updatedAt: createdAt,
  };
  await mkdir(path.join(root, 'workspace'), { recursive: true });
  await writeFile(path.join(root, 'project.json'), `${JSON.stringify(manifest)}\n`);
  return { root, manifest };
}

export async function treeHash(root: string): Promise<string> {
  const hash = createHash('sha256');
  async function visit(current: string, relative = ''): Promise<void> {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const entry of entries) {
      const rel = path.join(relative, entry.name);
      hash.update(`${rel}\0${entry.isDirectory() ? 'd' : 'f'}\0`);
      if (entry.isDirectory()) await visit(path.join(current, entry.name), rel);
      else hash.update(await readFile(path.join(current, entry.name)));
    }
  }
  await visit(root);
  return hash.digest('hex');
}

export async function assertDirectory(root: string): Promise<void> {
  if (!(await stat(root)).isDirectory()) throw new Error(`Expected directory: ${root}`);
}
