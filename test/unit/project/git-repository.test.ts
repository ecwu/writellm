import { expect, test } from 'bun:test';
import fs from 'node:fs';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import git from 'isomorphic-git';
import { ProjectGitRepository } from '../../../src/main/project/git-repository';

test('writes exact processing trailers and source binary attributes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'source-git-'));
  await writeFile(path.join(root, 'project.json'), '{}');
  await writeFile(path.join(root, 'source.pdf'), 'pdf');
  const repository = new ProjectGitRepository();
  await repository.commitContents(root, ['source.pdf'], 3, {
    actor: 'system',
    event: 'processing',
    contentChange: false,
  });
  const [commit] = await git.log({ fs, dir: root, depth: 1 });
  expect(commit.commit.message).toContain('WriteLLM-Actor: system');
  expect(commit.commit.message).toContain('WriteLLM-Event: processing');
  expect(commit.commit.message).toContain('WriteLLM-Content-Change: false');
  expect(await readFile(path.join(root, '.gitattributes'), 'utf8')).toContain('*.f32 binary');
});
