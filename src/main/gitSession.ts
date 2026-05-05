import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type GitStatusRecord = {
  branch: string | null;
  dirty: boolean;
  entries: Array<{
    path: string;
    status: string;
  }>;
};

export type GitHistoryRecord = {
  hash: string;
  shortHash: string;
  subject: string;
  authorDate: string;
};

const TRACKED_PATHS = ['sections', 'metadata', '.writellm-manifest.json'];
const DEFAULT_GITIGNORE = [
  'project.sqlite',
  'project.sqlite-*',
  'cache/',
  'logs/',
  'exports/',
  'snapshots/',
  'assets/knowledge/',
  ''
].join('\n');

export function ensureGitSession(workspacePath: string): void {
  if (!existsSync(path.join(workspacePath, '.git'))) {
    runGit(workspacePath, ['init']);
  }
  ensureGitignore(workspacePath);
  mkdirSync(path.join(workspacePath, 'metadata'), { recursive: true });
  ensureSessionBranch(workspacePath);
  ensureInitialCheckpoint(workspacePath);
}

export function getGitStatus(workspacePath: string): GitStatusRecord {
  ensureGitSession(workspacePath);
  const branch = runGit(workspacePath, ['branch', '--show-current'], { allowFailure: true }).trim() || null;
  const porcelain = runGit(workspacePath, ['status', '--short', '--', ...TRACKED_PATHS], { allowFailure: true });
  const entries = porcelain
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || line.slice(0, 2),
      path: line.slice(3).trim()
    }));
  return {
    branch,
    dirty: entries.length > 0,
    entries
  };
}

export function createGitCheckpoint(workspacePath: string, message?: string): GitHistoryRecord | null {
  ensureGitSession(workspacePath);
  return createGitCheckpointWithoutEnsure(workspacePath, message);
}

export function getGitHead(workspacePath: string): string | null {
  ensureGitSession(workspacePath);
  const head = runGit(workspacePath, ['rev-parse', 'HEAD'], { allowFailure: true }).trim();
  return head || null;
}

function createGitCheckpointWithoutEnsure(workspacePath: string, message?: string): GitHistoryRecord | null {
  runGit(workspacePath, ['add', ...TRACKED_PATHS]);
  const staged = runGit(workspacePath, ['diff', '--cached', '--quiet'], { allowFailure: true, returnStatus: true });
  if (staged === 0) {
    return null;
  }
  runGit(workspacePath, [
    '-c',
    'user.name=writellm',
    '-c',
    'user.email=writellm@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    message?.trim() || `Checkpoint: ${new Date().toISOString()}`
  ]);
  return listGitHistory(workspacePath, undefined, 1)[0] ?? null;
}

export function listGitHistory(
  workspacePath: string,
  sectionId?: string,
  limit = 50
): GitHistoryRecord[] {
  ensureGitSession(workspacePath);
  const args = [
    'log',
    `--max-count=${Math.max(1, Math.min(limit, 200))}`,
    '--format=%H%x1f%h%x1f%ad%x1f%s',
    '--date=iso-strict'
  ];
  const targetPath = sectionId ? `sections/${sectionId}.md` : undefined;
  if (targetPath) {
    args.push('--', targetPath);
  }
  const output = runGit(workspacePath, args, { allowFailure: true });
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, shortHash, authorDate, subject] = line.split('\x1f');
      return { hash, shortHash, authorDate, subject };
    })
    .filter((entry) => Boolean(entry.hash));
}

export function getGitDiff(
  workspacePath: string,
  options: {
    sectionId?: string;
    base?: string;
    head?: string;
  } = {}
): string {
  ensureGitSession(workspacePath);
  const args = ['diff'];
  if (options.base && options.head) {
    args.push(options.base, options.head);
  } else if (options.base) {
    args.push(options.base);
  }
  if (options.sectionId) {
    args.push('--', `sections/${options.sectionId}.md`);
  } else {
    args.push('--', ...TRACKED_PATHS);
  }
  return runGit(workspacePath, args, { allowFailure: true });
}

export function getSectionVersion(workspacePath: string, sectionId: string, commitHash: string): string {
  ensureGitSession(workspacePath);
  assertSectionId(sectionId);
  assertCommitHash(commitHash);
  return runGit(workspacePath, ['show', `${commitHash}:sections/${sectionId}.md`]);
}

function ensureGitignore(workspacePath: string): void {
  const ignorePath = path.join(workspacePath, '.gitignore');
  if (!existsSync(ignorePath)) {
    writeFileSync(ignorePath, DEFAULT_GITIGNORE, 'utf8');
  }
}

function ensureSessionBranch(workspacePath: string): void {
  const current = runGit(workspacePath, ['branch', '--show-current'], { allowFailure: true }).trim();
  if (current.startsWith('session/')) {
    return;
  }
  const branch = `session/${sessionTimestamp()}`;
  const hasHead = runGit(workspacePath, ['rev-parse', '--verify', 'HEAD'], {
    allowFailure: true,
    returnStatus: true
  }) === 0;
  if (hasHead) {
    runGit(workspacePath, ['switch', '-c', branch]);
    return;
  }
  runGit(workspacePath, ['checkout', '-b', branch]);
}

function ensureInitialCheckpoint(workspacePath: string): void {
  const hasHead = runGit(workspacePath, ['rev-parse', '--verify', 'HEAD'], {
    allowFailure: true,
    returnStatus: true
  }) === 0;
  if (hasHead) {
    return;
  }
  const status = runGit(workspacePath, ['status', '--short', '--', ...TRACKED_PATHS], {
    allowFailure: true
  });
  if (!status.trim()) {
    return;
  }
  createGitCheckpointWithoutEnsure(workspacePath, 'Initial workspace');
}

function assertCommitHash(commitHash: string): void {
  if (!/^[0-9a-f]{4,40}$/i.test(commitHash)) {
    throw new Error('Git commit hash is invalid.');
  }
}

function assertSectionId(sectionId: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(sectionId)) {
    throw new Error('Section id is invalid.');
  }
}

function sessionTimestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z').replace('T', '-');
}

function runGit(
  cwd: string,
  args: string[],
  options?: { allowFailure?: boolean; returnStatus?: false }
): string;
function runGit(
  cwd: string,
  args: string[],
  options: { allowFailure?: boolean; returnStatus: true }
): number;
function runGit(
  cwd: string,
  args: string[],
  options: { allowFailure?: boolean; returnStatus?: boolean } = {}
): string | number {
  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: options.returnStatus ? 'ignore' : ['ignore', 'pipe', 'pipe']
    });
    return options.returnStatus ? 0 : output;
  } catch (caught) {
    if (options.returnStatus) {
      const status = typeof caught === 'object' && caught && 'status' in caught
        ? Number((caught as { status?: number }).status)
        : 1;
      return Number.isFinite(status) ? status : 1;
    }
    if (options.allowFailure) {
      return '';
    }
    const stderr = typeof caught === 'object' && caught && 'stderr' in caught
      ? String((caught as { stderr?: Buffer | string }).stderr ?? '').trim()
      : '';
    throw new Error(stderr || `git ${args.join(' ')} failed.`);
  }
}
