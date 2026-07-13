import fs from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import git from 'isomorphic-git';
import type { GitCommitMetadata } from './project-transaction.js';

const identity = { name: 'WriteLLM', email: 'history@writellm.local' };
const ignore = `# WriteLLM transaction and recovery intermediates\nruntime/pending/\nruntime/cache/\nruntime/logs/\nruntime/crash/\nruntime/embeddings/\nruntime/source-jobs/\nruntime/source-downloads/\n**/.writellm-tmp-*\n\n# Secrets must never be project content or history\nsecrets/\n*.secret\n`;

export class ProjectGitError extends Error {
  constructor(
    readonly phase: 'initialization' | 'commit',
    options?: ErrorOptions,
  ) {
    super(`Project Git ${phase} failed`, options);
  }
}

export class ProjectGitRepository {
  async commitContent(projectRoot: string, relativePath: string, revision: number): Promise<void> {
    return this.commitContents(projectRoot, [relativePath], revision);
  }

  async commitContents(
    projectRoot: string,
    relativePaths: string[],
    revision: number,
    metadata: GitCommitMetadata = {
      actor: 'human',
      event: 'content',
      contentChange: true,
    },
  ): Promise<void> {
    const gitDir = path.join(projectRoot, '.git');
    try {
      if (!fs.existsSync(gitDir)) {
        await writeFile(path.join(projectRoot, '.gitignore'), ignore, {
          encoding: 'utf8',
          flag: 'wx',
        }).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        });
        await writeFile(
          path.join(projectRoot, '.gitattributes'),
          '*.json text eol=lf\n*.jsonl text eol=lf\n*.md text eol=lf\n*.pdf binary\n*.png binary\n*.jpg binary\n*.jpeg binary\n*.webp binary\n*.f32 binary\n',
          { encoding: 'utf8', flag: 'wx' },
        ).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        });
        await mkdir(path.join(projectRoot, 'runtime', 'pending'), { recursive: true });
        await git.init({ fs, dir: projectRoot, defaultBranch: 'main' });
        const matrix = await git.statusMatrix({ fs, dir: projectRoot });
        for (const [filepath] of matrix) await git.add({ fs, dir: projectRoot, filepath });
      } else {
        for (const relativePath of relativePaths)
          await git.add({ fs, dir: projectRoot, filepath: relativePath });
      }
    } catch (cause) {
      throw new ProjectGitError('initialization', { cause });
    }
    try {
      await git.commit({
        fs,
        dir: projectRoot,
        author: identity,
        committer: identity,
        message: commitMessage(revision, metadata),
      });
    } catch (cause) {
      throw new ProjectGitError('commit', { cause });
    }
  }

  async commitRemoval(
    projectRoot: string,
    relativePrefix: string,
    revision: number,
    metadata: GitCommitMetadata,
  ): Promise<void> {
    try {
      const matrix = await git.statusMatrix({ fs, dir: projectRoot });
      for (const [filepath, head, workdir] of matrix) {
        if (
          (filepath === relativePrefix || filepath.startsWith(`${relativePrefix}/`)) &&
          head === 1 &&
          workdir === 0
        )
          await git.remove({ fs, dir: projectRoot, filepath });
      }
      await git.commit({
        fs,
        dir: projectRoot,
        author: identity,
        committer: identity,
        message: commitMessage(revision, metadata),
      });
    } catch (cause) {
      throw new ProjectGitError('commit', { cause });
    }
  }
}

function commitMessage(revision: number, metadata: GitCommitMetadata): string {
  const trailers = [
    `WriteLLM-Actor: ${metadata.actor}`,
    `WriteLLM-Event: ${metadata.event}`,
    `WriteLLM-Content-Change: ${metadata.contentChange}`,
    `WriteLLM-Project-Revision: ${revision}`,
  ];
  if (metadata.taskId) trailers.push(`WriteLLM-Task-ID: ${metadata.taskId}`);
  if (metadata.proposalId) trailers.push(`WriteLLM-Proposal-ID: ${metadata.proposalId}`);
  return `Save project ${metadata.event}\n\n${trailers.join('\n')}`;
}
