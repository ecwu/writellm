import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';

export type ProjectSession = { projectId: string; projectRoot: string; sessionId: string };
export type GitCommitMetadata = {
  actor: 'human' | 'model' | 'system';
  event: 'content' | 'task' | 'processing' | 'metadata';
  contentChange: boolean;
  taskId?: string;
  proposalId?: string;
};
export type ProjectTransactionFile = { relativePath: string; content: string | Uint8Array };
export type ProjectTransactionInput = {
  session: ProjectSession;
  transactionId?: string;
  files: ProjectTransactionFile[];
  revision: number;
  metadata: GitCommitMetadata;
  isCurrentSession(): boolean;
};
type PendingManifest = {
  kind: 'writellm.pending-transaction';
  schemaVersion: 1;
  projectId: string;
  sessionId: string;
  transactionId: string;
  revision: number;
  files: Array<{ relativePath: string; sha256: string; stagedPath: string }>;
  metadata: GitCommitMetadata;
};

export class ProjectTransaction {
  private queues = new Map<string, Promise<unknown>>();
  constructor(
    private options: {
      git: {
        commit(
          projectRoot: string,
          relativePaths: string[],
          revision: number,
          metadata: GitCommitMetadata,
        ): Promise<void>;
      };
    },
  ) {}

  publish(input: ProjectTransactionInput): Promise<void> {
    return this.serial(input.session.projectId, () => this.publishNow(input));
  }

  async recover(
    session: ProjectSession,
    isCurrentSession: () => boolean,
  ): Promise<'none' | 'committed' | 'recovery-required'> {
    const pendingDir = path.join(session.projectRoot, 'runtime', 'pending');
    let names: string[];
    try {
      names = await readdir(pendingDir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'none';
      return 'recovery-required';
    }
    const manifests = names.filter((name) => name.endsWith('.transaction.json'));
    if (manifests.length === 0) return 'none';
    if (manifests.length !== 1 || !isCurrentSession()) return 'recovery-required';
    try {
      const manifest = JSON.parse(
        await readFile(path.join(pendingDir, manifests[0]), 'utf8'),
      ) as PendingManifest;
      if (
        manifest.kind !== 'writellm.pending-transaction' ||
        manifest.schemaVersion !== 1 ||
        manifest.projectId !== session.projectId
      )
        return 'recovery-required';
      for (const file of manifest.files) {
        const bytes = await readFile(path.join(session.projectRoot, file.relativePath));
        if (createHash('sha256').update(bytes).digest('hex') !== file.sha256)
          return 'recovery-required';
      }
      await this.options.git.commit(
        session.projectRoot,
        manifest.files.map((file) => file.relativePath),
        manifest.revision,
        manifest.metadata,
      );
      await rm(path.join(pendingDir, manifests[0]), { force: true });
      return 'committed';
    } catch {
      return 'recovery-required';
    }
  }

  private async publishNow(input: ProjectTransactionInput): Promise<void> {
    if (input.files.length === 0) throw new Error('PROJECT_TRANSACTION_EMPTY');
    const transactionId = input.transactionId ?? randomUUID();
    const pendingDir = path.join(input.session.projectRoot, 'runtime', 'pending');
    const stagingDir = path.join(pendingDir, transactionId);
    const manifestPath = path.join(pendingDir, `${transactionId}.transaction.json`);
    await mkdir(stagingDir, { recursive: true });
    const manifest: PendingManifest = {
      kind: 'writellm.pending-transaction',
      schemaVersion: 1,
      projectId: input.session.projectId,
      sessionId: input.session.sessionId,
      transactionId,
      revision: input.revision,
      files: [],
      metadata: input.metadata,
    };
    for (const file of input.files) {
      const normalized = file.relativePath.replaceAll('\\', '/');
      if (
        path.isAbsolute(file.relativePath) ||
        normalized.startsWith('../') ||
        normalized.includes('/../') ||
        normalized.includes('\0')
      )
        throw new Error('PROJECT_TRANSACTION_PATH_INVALID');
      const content = typeof file.content === 'string' ? Buffer.from(file.content) : file.content;
      const stagedPath = path.join(stagingDir, `${manifest.files.length}.payload`);
      await writeSyncedFile(stagedPath, content);
      manifest.files.push({
        relativePath: normalized,
        sha256: createHash('sha256').update(content).digest('hex'),
        stagedPath: path.relative(input.session.projectRoot, stagedPath).replaceAll('\\', '/'),
      });
    }
    await writeSyncedFile(manifestPath, `${JSON.stringify(manifest)}\n`);
    if (!input.isCurrentSession()) throw new Error('PROJECT_SESSION_STALE');
    for (const file of manifest.files) {
      if (!input.isCurrentSession()) throw new Error('PROJECT_SESSION_STALE');
      const target = path.join(input.session.projectRoot, file.relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await rename(path.join(input.session.projectRoot, file.stagedPath), target);
    }
    await this.options.git.commit(
      input.session.projectRoot,
      manifest.files.map((file) => file.relativePath),
      input.revision,
      input.metadata,
    );
    await rm(manifestPath, { force: true });
    await rm(stagingDir, { recursive: true, force: true });
  }

  private serial<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(projectId) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.queues.set(
      projectId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}

export async function writeSyncedFile(target: string, content: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const handle = await open(target, 'wx');
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}
