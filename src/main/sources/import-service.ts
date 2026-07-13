import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ImportOutcome, ImportSourcesResult, SourceError } from '../../shared/sources.js';
import type { ProjectSession } from '../project/project-transaction.js';
import { SourceJobRepository } from './job-repository.js';
import type { SourceEvents } from './source-events.js';
import type { SourceRepository } from './source-repository.js';

type FileDialog = {
  showOpenDialog(
    options: Record<string, unknown>,
  ): Promise<{ canceled: boolean; filePaths: string[] }>;
};
type Candidate = { sessionId: string; canceled: boolean; pendingPath?: string };

export class SourceImportService {
  private candidates = new Map<string, Candidate>();
  private pending = new Set<Promise<void>>();
  private publicationQueue: Promise<unknown> = Promise.resolve();
  private jobsByRoot = new Map<string, SourceJobRepository>();

  constructor(
    private options: {
      dialog: FileDialog;
      repository: SourceRepository;
      events: SourceEvents;
      getActiveSession(): ProjectSession | null;
      now?: () => string;
      id?: () => string;
      onJobQueued?: () => void;
      enqueueJob?: (job: Parameters<SourceJobRepository['enqueue']>[0]) => Promise<unknown>;
    },
  ) {}

  async importFromDialog(expectedCatalogRevision: number): Promise<ImportSourcesResult> {
    const session = this.options.getActiveSession();
    if (!session) return { status: 'error', error: error('NO_ACTIVE_PROJECT', false) };
    const current = await this.options.repository.list(session, { limit: 1 });
    if (current.catalogRevision !== expectedCatalogRevision)
      return { status: 'conflict', catalogRevision: current.catalogRevision };
    let selection: { canceled: boolean; filePaths: string[] };
    try {
      selection = await this.options.dialog.showOpenDialog({
        title: 'Import PDF sources',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'PDF documents', extensions: ['pdf'] }],
      });
    } catch {
      return { status: 'error', error: error('SOURCE_STORAGE_UNAVAILABLE', true) };
    }
    if (selection.canceled) return { status: 'canceled' };
    const paths = selection.filePaths.slice(0, 100);
    const overflow = selection.filePaths.length > 100;
    const outcomes = await Promise.all(paths.map((filePath) => this.screen(session, filePath)));
    if (overflow)
      outcomes.push({
        status: 'rejected',
        displayName: 'Additional files',
        error: error('SOURCE_LIMIT_EXCEEDED', false),
      });
    return { status: 'accepted', outcomes, catalogRevision: current.catalogRevision };
  }

  async cancelCandidate(session: ProjectSession, candidateId: string): Promise<boolean> {
    const candidate = this.candidates.get(candidateId);
    if (!candidate || candidate.sessionId !== session.sessionId) return false;
    candidate.canceled = true;
    if (candidate.pendingPath) await rm(candidate.pendingPath, { force: true });
    this.candidates.delete(candidateId);
    const revision = (await this.options.repository.list(session, { limit: 1 })).catalogRevision;
    this.options.events.publish(
      {
        catalogRevision: revision,
        type: 'candidate-updated',
        candidateId,
        candidateStatus: 'canceled',
      },
      session.sessionId,
    );
    return true;
  }

  async settle(): Promise<void> {
    await Promise.all([...this.pending]);
  }

  private async screen(session: ProjectSession, filePath: string): Promise<ImportOutcome> {
    const displayName = path.basename(filePath).slice(0, 255) || 'Unnamed PDF';
    if (path.extname(filePath).toLowerCase() !== '.pdf')
      return { status: 'rejected', displayName, error: error('SOURCE_UNSUPPORTED_PDF', false) };
    try {
      const before = await stat(filePath);
      if (!before.isFile()) throw new Error();
      const handle = await open(filePath, 'r');
      const signature = Buffer.alloc(5);
      try {
        await handle.read(signature, 0, 5, 0);
      } finally {
        await handle.close();
      }
      if (signature.toString() !== '%PDF-')
        return { status: 'rejected', displayName, error: error('SOURCE_UNSUPPORTED_PDF', false) };
      const candidateId = (this.options.id ?? randomUUID)();
      const possible = await this.options.repository.findPossibleDuplicate(
        session,
        displayName,
        before.size,
      );
      this.candidates.set(candidateId, { sessionId: session.sessionId, canceled: false });
      const processing = new Promise<void>((resolve) => setTimeout(resolve, 0))
        .then(() =>
          this.process(session, candidateId, filePath, displayName, before.size, before.mtimeMs),
        )
        .finally(() => this.pending.delete(processing));
      this.pending.add(processing);
      return { status: possible ? 'possible-duplicate' : 'queued', candidateId, displayName };
    } catch {
      return { status: 'rejected', displayName, error: error('SOURCE_IMPORT_UNREADABLE', false) };
    }
  }

  private async process(
    session: ProjectSession,
    candidateId: string,
    filePath: string,
    displayName: string,
    sizeBytes: number,
    originalMtime: number,
  ): Promise<void> {
    const candidate = this.candidates.get(candidateId);
    if (!candidate) return;
    const pendingDir = path.join(session.projectRoot, 'runtime', 'pending', 'source-imports');
    const pendingPath = path.join(pendingDir, `${candidateId}.pdf`);
    candidate.pendingPath = pendingPath;
    try {
      const bytes = await readFile(filePath);
      const after = await stat(filePath);
      if (after.size !== sizeBytes || after.mtimeMs !== originalMtime) throw new Error('changed');
      if (!this.current(session, candidate)) return;
      await mkdir(pendingDir, { recursive: true });
      await writeFile(pendingPath, bytes, { flag: 'wx' });
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      await this.serialPublish(async () => {
        if (!this.current(session, candidate)) return;
        const list = await this.options.repository.list(session, { limit: 1 });
        const result = await this.options.repository.createSource(session, {
          expectedCatalogRevision: list.catalogRevision,
          displayName,
          sizeBytes,
          sha256,
          originalBytes: bytes,
        });
        if (result.status === 'duplicate') {
          this.options.events.publish(
            {
              catalogRevision: result.catalogRevision,
              type: 'candidate-updated',
              candidateId,
              candidateStatus: 'duplicate-confirmed',
            },
            session.sessionId,
          );
          return;
        }
        if (result.status !== 'created') throw new Error('conflict');
        const job = {
          kind: 'writellm.source-job',
          schemaVersion: 1,
          jobId: (this.options.id ?? randomUUID)(),
          projectId: session.projectId,
          sourceId: result.source.sourceId,
          sourceVersionId: result.sourceVersionId,
          type: 'parse',
          state: 'queued',
          attempt: 0,
          idempotencyKey: `${result.source.sourceId}:${result.sourceVersionId}:parse`,
          createdAt: (this.options.now ?? (() => new Date().toISOString()))(),
          updatedAt: (this.options.now ?? (() => new Date().toISOString()))(),
        } as const;
        if (this.options.enqueueJob) await this.options.enqueueJob(job);
        else await (await this.jobs(session.projectRoot)).enqueue(job);
        this.options.onJobQueued?.();
        this.options.events.publish(
          {
            catalogRevision: result.catalogRevision,
            type: 'source-upserted',
            source: result.source,
          },
          session.sessionId,
        );
        this.options.events.publish(
          {
            catalogRevision: result.catalogRevision,
            type: 'candidate-updated',
            candidateId,
            candidateStatus: 'accepted',
          },
          session.sessionId,
        );
      });
    } catch {
      const revision = await this.options.repository
        .list(session, { limit: 1 })
        .then((v) => v.catalogRevision)
        .catch(() => 0);
      this.options.events.publish(
        {
          catalogRevision: revision,
          type: 'candidate-updated',
          candidateId,
          candidateStatus: 'failed',
        },
        session.sessionId,
      );
    } finally {
      await rm(pendingPath, { force: true });
      this.candidates.delete(candidateId);
    }
  }

  private current(session: ProjectSession, candidate: Candidate): boolean {
    const active = this.options.getActiveSession();
    return (
      !candidate.canceled &&
      active?.sessionId === session.sessionId &&
      active.projectId === session.projectId
    );
  }
  private serialPublish<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.publicationQueue.then(operation, operation);
    this.publicationQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
  private async jobs(root: string): Promise<SourceJobRepository> {
    let jobs = this.jobsByRoot.get(root);
    if (!jobs) {
      jobs = new SourceJobRepository(root);
      await jobs.initialize();
      this.jobsByRoot.set(root, jobs);
    }
    return jobs;
  }
}

function error(code: SourceError['code'], retryable: boolean): SourceError {
  return { code, messageKey: `sources.error.${code.toLowerCase()}`, retryable };
}
