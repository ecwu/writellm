import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  DeleteOutlineItemInput,
  DeleteOutlineItemValue,
  OrientationError,
  OrientationResult,
  SaveOrientationValue,
  WritingOrientationDocument,
} from '../../shared/writing-orientation.js';
import { ProjectGitError, ProjectGitRepository } from '../project/git-repository.js';
import {
  emptyOrientation,
  OrientationValidationError,
  parseDiskDocument,
  parseSaveInput,
} from './parser.js';

type Session = { projectId: string; projectRoot: string; sessionId: string };
type Cached = { fingerprint: string; result: OrientationResult<unknown> };
const errors = {
  conflict: (): OrientationError => ({
    code: 'REVISION_CONFLICT',
    message: 'The saved version changed. Reload before trying again.',
    retryable: true,
  }),
  recovery: (): OrientationError => ({
    code: 'STORAGE_RECOVERY_REQUIRED',
    message: 'This project has an unfinished save that requires recovery.',
    retryable: true,
  }),
};
const failure = <T>(error: OrientationError): OrientationResult<T> => ({ ok: false, error });

export class WritingOrientationRepository {
  private queues = new Map<string, Promise<unknown>>();
  private mutations = new Map<string, Map<string, Cached>>();
  constructor(
    private readonly git = new ProjectGitRepository(),
    private readonly now = () => new Date().toISOString(),
  ) {}

  async load(session: Session): Promise<OrientationResult<WritingOrientationDocument>> {
    try {
      return { ok: true, value: await this.read(session) };
    } catch (error) {
      return failure(this.mapError(error, 'STORAGE_READ_FAILED'));
    }
  }
  save(session: Session, unknownInput: unknown): Promise<OrientationResult<SaveOrientationValue>> {
    return this.serial(session.projectId, async () => {
      try {
        const recovered = await this.recoverPendingSave(session, unknownInput);
        if (recovered) return recovered;
        const current = await this.read(session),
          input = parseSaveInput(unknownInput, current);
        const duplicate = this.cached(session, 'save', input.mutationId, input);
        if (duplicate) return duplicate as OrientationResult<SaveOrientationValue>;
        if (input.baseRevision !== current.revision) return failure(errors.conflict());
        const createdItemIds: SaveOrientationValue['createdItemIds'] = [];
        const byId = new Map(current.outlineItems.map((item) => [item.outlineItemId, item]));
        const outlineItems = input.outlineItems.map((item) => {
          if ('outlineItemId' in item && item.outlineItemId)
            return { ...item, chapterRef: byId.get(item.outlineItemId)!.chapterRef };
          const outlineItemId = randomUUID();
          createdItemIds.push({ clientDraftId: item.clientDraftId!, outlineItemId });
          return {
            outlineItemId,
            title: item.title,
            summary: item.summary,
            status: item.status,
            chapterRef: null,
          };
        });
        const document: WritingOrientationDocument = {
          ...current,
          revision: current.revision + 1,
          updatedAt: this.now(),
          motivation: input.motivation,
          outlineItems,
        };
        const result: OrientationResult<SaveOrientationValue> = {
          ok: true,
          value: { document, createdItemIds },
        };
        await this.writeAndCommit(session, document, {
          method: 'save',
          fingerprint: this.fingerprint('save', input),
          result,
        });
        this.remember(session, 'save', input.mutationId, input, result);
        return result;
      } catch (error) {
        return failure(this.mapError(error, 'STORAGE_WRITE_FAILED'));
      }
    });
  }
  deleteOutlineItem(
    session: Session,
    input: DeleteOutlineItemInput,
  ): Promise<OrientationResult<DeleteOutlineItemValue>> {
    return this.serial(session.projectId, async () => {
      try {
        const recovered = await this.recoverPendingDelete(session, input);
        if (recovered) return recovered;
        const current = await this.read(session);
        const duplicate = this.cached(session, 'delete', input.mutationId, input);
        if (duplicate) return duplicate as OrientationResult<DeleteOutlineItemValue>;
        if (input.baseRevision !== current.revision) return failure(errors.conflict());
        const item = current.outlineItems.find(
          (candidate) => candidate.outlineItemId === input.outlineItemId,
        );
        if (!item)
          return failure({
            code: 'INVALID_INPUT',
            message: 'That outline item no longer exists.',
            retryable: false,
          });
        if (item.chapterRef)
          return failure({
            code: 'LINKED_DELETE_NOT_AVAILABLE',
            message: 'This item has a chapter and cannot be deleted yet.',
            retryable: false,
          });
        const document: WritingOrientationDocument = {
          ...current,
          revision: current.revision + 1,
          updatedAt: this.now(),
          outlineItems: current.outlineItems.filter(
            (candidate) => candidate.outlineItemId !== input.outlineItemId,
          ),
        };
        const result: OrientationResult<DeleteOutlineItemValue> = {
          ok: true,
          value: { kind: 'deleted', outlineItemId: input.outlineItemId, document },
        };
        await this.writeAndCommit(session, document, {
          method: 'delete',
          fingerprint: this.fingerprint('delete', input),
          result,
        });
        this.remember(session, 'delete', input.mutationId, input, result);
        return result;
      } catch (error) {
        return failure(this.mapError(error, 'STORAGE_WRITE_FAILED'));
      }
    });
  }

  private async read(session: Session): Promise<WritingOrientationDocument> {
    const pending = path.join(
      session.projectRoot,
      'runtime',
      'pending',
      'writing-orientation.json',
    );
    try {
      await readFile(pending);
      throw new OrientationValidationError(errors.recovery());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      return parseDiskDocument(
        JSON.parse(await readFile(this.file(session), 'utf8')),
        session.projectId,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return emptyOrientation(session.projectId);
      if (error instanceof SyntaxError)
        throw new OrientationValidationError({
          code: 'STORAGE_READ_FAILED',
          message: 'Saved writing orientation is malformed.',
          retryable: false,
        });
      throw error;
    }
  }
  private async writeAndCommit(
    session: Session,
    document: WritingOrientationDocument,
    recovery?: { method: string; fingerprint: string; result: OrientationResult<unknown> },
  ): Promise<void> {
    const target = this.file(session),
      token = randomUUID(),
      temp = `${target}.writellm-tmp-${token}`,
      pending = path.join(session.projectRoot, 'runtime', 'pending', 'writing-orientation.json');
    await mkdir(path.dirname(target), { recursive: true });
    await mkdir(path.dirname(pending), { recursive: true });
    await writeFile(
      pending,
      JSON.stringify({
        revision: document.revision,
        target: 'workspace/writing-orientation.json',
        recovery,
      }),
      'utf8',
    );
    const handle = await open(temp, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(document)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
    try {
      await this.git.commitContent(
        session.projectRoot,
        'workspace/writing-orientation.json',
        document.revision,
      );
    } catch (error) {
      const initialization = error instanceof ProjectGitError && error.phase === 'initialization';
      throw new OrientationValidationError({
        code: initialization ? 'GIT_INITIALIZATION_FAILED' : 'GIT_COMMIT_FAILED',
        message: initialization
          ? 'Project history could not be initialized. Retry the save to recover.'
          : 'The content was written but its history commit needs recovery.',
        retryable: true,
      });
    }
    await rm(pending, { force: true });
  }
  private async recoverPendingSave(
    session: Session,
    unknownInput: unknown,
  ): Promise<OrientationResult<SaveOrientationValue> | undefined> {
    const pendingPath = path.join(
      session.projectRoot,
      'runtime',
      'pending',
      'writing-orientation.json',
    );
    let pending: {
      revision?: number;
      recovery?: {
        method?: string;
        fingerprint?: string;
        result?: OrientationResult<SaveOrientationValue>;
      };
    };
    try {
      pending = JSON.parse(await readFile(pendingPath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new OrientationValidationError(errors.recovery());
    }
    if (
      pending.recovery?.method !== 'save' ||
      !pending.recovery.fingerprint ||
      !pending.recovery.result
    )
      throw new OrientationValidationError(errors.recovery());
    const result = pending.recovery.result;
    if (!result.ok || pending.recovery.fingerprint !== this.fingerprint('save', unknownInput))
      throw new OrientationValidationError(errors.recovery());
    const document = parseDiskDocument(
      JSON.parse(await readFile(this.file(session), 'utf8')),
      session.projectId,
    );
    if (
      document.revision !== pending.revision ||
      document.revision !== result.value.document.revision
    )
      throw new OrientationValidationError(errors.recovery());
    try {
      await this.git.commitContent(
        session.projectRoot,
        'workspace/writing-orientation.json',
        document.revision,
      );
    } catch (error) {
      const initialization = error instanceof ProjectGitError && error.phase === 'initialization';
      throw new OrientationValidationError({
        code: initialization ? 'GIT_INITIALIZATION_FAILED' : 'GIT_COMMIT_FAILED',
        message: initialization
          ? 'Project history could not be initialized. Retry the save to recover.'
          : 'The content was written but its history commit needs recovery.',
        retryable: true,
      });
    }
    await rm(pendingPath, { force: true });
    const input = unknownInput as { mutationId: string };
    this.remember(session, 'save', input.mutationId, unknownInput, result);
    return result;
  }
  private async recoverPendingDelete(
    session: Session,
    input: DeleteOutlineItemInput,
  ): Promise<OrientationResult<DeleteOutlineItemValue> | undefined> {
    const pendingPath = path.join(
      session.projectRoot,
      'runtime',
      'pending',
      'writing-orientation.json',
    );
    let pending: {
      revision?: number;
      recovery?: {
        method?: string;
        fingerprint?: string;
        result?: OrientationResult<DeleteOutlineItemValue>;
      };
    };
    try {
      pending = JSON.parse(await readFile(pendingPath, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new OrientationValidationError(errors.recovery());
    }
    if (
      pending.recovery?.method !== 'delete' ||
      pending.recovery.fingerprint !== this.fingerprint('delete', input) ||
      !pending.recovery.result?.ok
    )
      throw new OrientationValidationError(errors.recovery());
    const document = parseDiskDocument(
      JSON.parse(await readFile(this.file(session), 'utf8')),
      session.projectId,
    );
    if (
      document.revision !== pending.revision ||
      document.revision !== pending.recovery.result.value.document.revision
    )
      throw new OrientationValidationError(errors.recovery());
    try {
      await this.git.commitContent(
        session.projectRoot,
        'workspace/writing-orientation.json',
        document.revision,
      );
    } catch (error) {
      const initialization = error instanceof ProjectGitError && error.phase === 'initialization';
      throw new OrientationValidationError({
        code: initialization ? 'GIT_INITIALIZATION_FAILED' : 'GIT_COMMIT_FAILED',
        message: initialization
          ? 'Project history could not be initialized. Retry the delete to recover.'
          : 'The content was written but its history commit needs recovery.',
        retryable: true,
      });
    }
    await rm(pendingPath, { force: true });
    this.remember(session, 'delete', input.mutationId, input, pending.recovery.result);
    return pending.recovery.result;
  }
  private file(session: Session) {
    return path.join(session.projectRoot, 'workspace', 'writing-orientation.json');
  }
  private fingerprint(method: string, input: unknown) {
    return `${method}:${JSON.stringify(input)}`;
  }
  private cached(session: Session, method: string, id: string, input: unknown) {
    const hit = this.mutations.get(session.sessionId)?.get(id);
    if (!hit) return undefined;
    if (hit.fingerprint !== this.fingerprint(method, input))
      throw new OrientationValidationError({
        code: 'INVALID_INPUT',
        message: 'Mutation ID was already used for a different request.',
        retryable: false,
      });
    return hit.result;
  }
  private remember(
    session: Session,
    method: string,
    id: string,
    input: unknown,
    result: OrientationResult<unknown>,
  ) {
    let cache = this.mutations.get(session.sessionId);
    if (!cache) {
      cache = new Map();
      this.mutations.set(session.sessionId, cache);
    }
    cache.set(id, { fingerprint: this.fingerprint(method, input), result });
  }
  private serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.queues.get(key) ?? Promise.resolve();
    const next = prior.then(operation, operation);
    this.queues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
  private mapError(error: unknown, fallback: OrientationError['code']): OrientationError {
    if (error instanceof OrientationValidationError) return error.detail;
    return {
      code: fallback,
      message:
        fallback === 'STORAGE_READ_FAILED'
          ? 'Writing orientation could not be loaded.'
          : 'Writing orientation could not be saved.',
      retryable: true,
    };
  }
}
