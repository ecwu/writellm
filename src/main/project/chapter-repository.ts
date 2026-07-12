import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CHAPTER_KIND,
  CHAPTER_SCHEMA_VERSION,
  type ChapterDocument,
  type ChapterError,
  type ChapterResult,
} from '../../shared/chapters.js';
import type { WritingOrientationDocument } from '../../shared/writing-orientation.js';
import { parseDiskDocument } from '../writing-orientation/parser.js';
import {
  ChapterValidationError,
  parseChapterDocument,
  parseOpenInput,
  parseSaveInput,
} from './chapter-validation.js';
import { ProjectGitError, ProjectGitRepository } from './git-repository.js';

export type ChapterSession = { projectId: string; projectRoot: string; sessionId: string };
type Cached = { fingerprint: string; result: ChapterResult<unknown> };
const failure = <T>(error: ChapterError): ChapterResult<T> => ({ ok: false, error });
const conflict = (): ChapterError => ({
  code: 'REVISION_CONFLICT',
  message: 'The saved chapter changed. Reload it before saving again.',
  retryable: true,
});

export class ChapterRepository {
  private queues = new Map<string, Promise<unknown>>();
  private mutations = new Map<string, Map<string, Cached>>();
  constructor(
    private readonly git = new ProjectGitRepository(),
    private readonly now = () => new Date().toISOString(),
  ) {}

  async load(session: ChapterSession, chapterId: string): Promise<ChapterResult<ChapterDocument>> {
    try {
      return { ok: true, value: await this.read(session, chapterId) };
    } catch (error) {
      return failure(this.mapError(error, 'STORAGE_READ_FAILED'));
    }
  }
  openForOutlineItem(
    session: ChapterSession,
    unknownInput: unknown,
  ): Promise<ChapterResult<{ document: ChapterDocument; created: boolean }>> {
    return this.serial(session.projectId, async () => {
      try {
        const input = parseOpenInput(unknownInput),
          recovered = await this.recover<{ document: ChapterDocument; created: boolean }>(
            session,
            'openForOutlineItem',
            input.mutationId,
            input,
          );
        if (recovered) return recovered;
        const cached = this.cached(session, 'openForOutlineItem', input.mutationId, input);
        if (cached) return cached as ChapterResult<{ document: ChapterDocument; created: boolean }>;
        const orientation = await this.readOrientation(session);
        if (orientation.revision !== input.baseOrientationRevision) return failure(conflict());
        const item = orientation.outlineItems.find(
          (candidate) => candidate.outlineItemId === input.outlineItemId,
        );
        if (!item)
          return failure({
            code: 'OUTLINE_ITEM_NOT_FOUND',
            message: 'That outline item no longer exists.',
            retryable: false,
          });
        if (item.chapterRef) {
          const document = await this.read(session, item.chapterRef);
          if (document.outlineItemId !== item.outlineItemId)
            throw new ChapterValidationError({
              code: 'INVALID_DOCUMENT',
              message: 'The linked chapter identity is invalid.',
              retryable: false,
            });
          const result = { ok: true as const, value: { document, created: false } };
          this.remember(session, 'openForOutlineItem', input.mutationId, input, result);
          return result;
        }
        const chapterId = randomUUID(),
          timestamp = this.now();
        const document: ChapterDocument = {
          kind: CHAPTER_KIND,
          schemaVersion: CHAPTER_SCHEMA_VERSION,
          projectId: session.projectId,
          chapterId,
          outlineItemId: item.outlineItemId,
          revision: 0,
          editorFormat: 'blocknote-json',
          editorSchemaVersion: 1,
          blocks: [{ id: randomUUID(), type: 'paragraph', props: {}, content: [], children: [] }],
          citations: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const linked: WritingOrientationDocument = {
          ...orientation,
          revision: orientation.revision + 1,
          updatedAt: timestamp,
          outlineItems: orientation.outlineItems.map((candidate) =>
            candidate.outlineItemId === item.outlineItemId
              ? { ...candidate, chapterRef: chapterId }
              : candidate,
          ),
        };
        const result = { ok: true as const, value: { document, created: true } };
        await this.writeLinked(session, document, linked, {
          method: 'openForOutlineItem',
          fingerprint: this.fingerprint('openForOutlineItem', input),
          result,
          orientation: linked,
        });
        this.remember(session, 'openForOutlineItem', input.mutationId, input, result);
        return result;
      } catch (error) {
        return failure(this.mapError(error, 'STORAGE_WRITE_FAILED'));
      }
    });
  }
  save(
    session: ChapterSession,
    unknownInput: unknown,
  ): Promise<ChapterResult<{ document: ChapterDocument }>> {
    return this.serial(session.projectId, async () => {
      try {
        const input = parseSaveInput(unknownInput),
          recovered = await this.recover<{ document: ChapterDocument }>(
            session,
            'save',
            input.mutationId,
            input,
          );
        if (recovered) return recovered;
        const cached = this.cached(session, 'save', input.mutationId, input);
        if (cached) return cached as ChapterResult<{ document: ChapterDocument }>;
        const current = await this.read(session, input.chapterId);
        if (current.revision !== input.baseRevision) return failure(conflict());
        const document: ChapterDocument = {
          ...current,
          revision: current.revision + 1,
          updatedAt: this.now(),
          blocks: input.blocks,
          citations: input.citations,
        };
        parseChapterDocument(document, session.projectId, input.chapterId);
        const result = { ok: true as const, value: { document } };
        await this.writeChapter(session, document, {
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
  private async read(session: ChapterSession, chapterId: string) {
    const pending = path.join(session.projectRoot, 'runtime', 'pending', 'chapter-content.json');
    try {
      await readFile(pending);
      throw new ChapterValidationError({
        code: 'STORAGE_RECOVERY_REQUIRED',
        message: 'This project has an unfinished chapter save that requires recovery.',
        retryable: true,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      return parseChapterDocument(
        JSON.parse(await readFile(this.file(session, chapterId), 'utf8')),
        session.projectId,
        chapterId,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ChapterValidationError({
          code: 'CHAPTER_NOT_FOUND',
          message: 'The linked chapter could not be found.',
          retryable: false,
        });
      if (error instanceof SyntaxError)
        throw new ChapterValidationError({
          code: 'INVALID_DOCUMENT',
          message: 'The saved chapter is malformed.',
          retryable: false,
        });
      throw error;
    }
  }
  private async readOrientation(session: ChapterSession) {
    try {
      return parseDiskDocument(
        JSON.parse(
          await readFile(
            path.join(session.projectRoot, 'workspace', 'writing-orientation.json'),
            'utf8',
          ),
        ),
        session.projectId,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new ChapterValidationError({
          code: 'OUTLINE_ITEM_NOT_FOUND',
          message: 'Create an outline item before starting a chapter.',
          retryable: false,
        });
      throw error;
    }
  }
  private async atomic(target: string, value: unknown) {
    await mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.writellm-tmp-${randomUUID()}`;
    const handle = await open(temp, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
  }
  private async writeChapter(
    session: ChapterSession,
    document: ChapterDocument,
    recovery: unknown,
  ) {
    const relative = `workspace/chapters/${document.chapterId}.json`,
      pending = path.join(session.projectRoot, 'runtime', 'pending', 'chapter-content.json');
    await mkdir(path.dirname(pending), { recursive: true });
    await writeFile(
      pending,
      JSON.stringify({ relative, revision: document.revision, recovery }),
      'utf8',
    );
    await this.atomic(path.join(session.projectRoot, relative), document);
    await this.commit(session, [relative], document.revision);
    await rm(pending, { force: true });
  }
  private async writeLinked(
    session: ChapterSession,
    document: ChapterDocument,
    orientation: WritingOrientationDocument,
    recovery: unknown,
  ) {
    const chapter = `workspace/chapters/${document.chapterId}.json`,
      orientationPath = 'workspace/writing-orientation.json',
      pending = path.join(session.projectRoot, 'runtime', 'pending', 'chapter-content.json');
    await mkdir(path.dirname(pending), { recursive: true });
    await writeFile(
      pending,
      JSON.stringify({ chapter, orientationPath, revision: orientation.revision, recovery }),
      'utf8',
    );
    await this.atomic(path.join(session.projectRoot, chapter), document);
    await this.atomic(path.join(session.projectRoot, orientationPath), orientation);
    await this.commit(session, [chapter, orientationPath], orientation.revision);
    await rm(pending, { force: true });
  }
  private async commit(session: ChapterSession, paths: string[], revision: number) {
    try {
      await this.git.commitContents(session.projectRoot, paths, revision);
    } catch (error) {
      throw new ChapterValidationError({
        code: 'STORAGE_WRITE_FAILED',
        message:
          error instanceof ProjectGitError && error.phase === 'initialization'
            ? 'Project history could not be initialized.'
            : 'Chapter content was written but its history commit needs recovery.',
        retryable: true,
      });
    }
  }
  private async recover<T>(
    session: ChapterSession,
    method: string,
    mutationId: string,
    input: unknown,
  ): Promise<ChapterResult<T> | undefined> {
    const pending = path.join(session.projectRoot, 'runtime', 'pending', 'chapter-content.json');
    let receipt: {
      relative?: string;
      chapter?: string;
      orientationPath?: string;
      revision?: number;
      recovery?: {
        method?: string;
        fingerprint?: string;
        result?: ChapterResult<T>;
        orientation?: WritingOrientationDocument;
      };
    };
    try {
      receipt = JSON.parse(await readFile(pending, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ChapterValidationError({
        code: 'STORAGE_RECOVERY_REQUIRED',
        message: 'Chapter recovery information is invalid.',
        retryable: true,
      });
    }
    if (
      receipt.recovery?.method !== method ||
      receipt.recovery.fingerprint !== this.fingerprint(method, input) ||
      !receipt.recovery.result?.ok ||
      typeof receipt.revision !== 'number'
    )
      throw new ChapterValidationError({
        code: 'STORAGE_RECOVERY_REQUIRED',
        message: 'Another unfinished chapter save requires recovery.',
        retryable: true,
      });
    const paths = receipt.relative
      ? [receipt.relative]
      : receipt.chapter && receipt.orientationPath
        ? [receipt.chapter, receipt.orientationPath]
        : [];
    if (!paths.length)
      throw new ChapterValidationError({
        code: 'STORAGE_RECOVERY_REQUIRED',
        message: 'Chapter recovery information is incomplete.',
        retryable: true,
      });
    const value = receipt.recovery.result.value as { document?: ChapterDocument };
    if (!value.document)
      throw new ChapterValidationError({
        code: 'STORAGE_RECOVERY_REQUIRED',
        message: 'Chapter recovery snapshot is incomplete.',
        retryable: true,
      });
    if (receipt.relative)
      await this.atomic(path.join(session.projectRoot, receipt.relative), value.document);
    else {
      if (!receipt.chapter || !receipt.orientationPath || !receipt.recovery.orientation)
        throw new ChapterValidationError({
          code: 'STORAGE_RECOVERY_REQUIRED',
          message: 'Chapter link recovery snapshot is incomplete.',
          retryable: true,
        });
      await this.atomic(path.join(session.projectRoot, receipt.chapter), value.document);
      await this.atomic(
        path.join(session.projectRoot, receipt.orientationPath),
        receipt.recovery.orientation,
      );
    }
    await this.commit(session, paths, receipt.revision);
    await rm(pending, { force: true });
    this.remember(session, method, mutationId, input, receipt.recovery.result);
    return receipt.recovery.result;
  }
  private file(session: ChapterSession, id: string) {
    return path.join(session.projectRoot, 'workspace', 'chapters', `${id}.json`);
  }
  private fingerprint(method: string, input: unknown) {
    return `${method}:${JSON.stringify(input)}`;
  }
  private cached(session: ChapterSession, method: string, id: string, input: unknown) {
    const hit = this.mutations.get(session.sessionId)?.get(id);
    if (!hit) return undefined;
    if (hit.fingerprint !== this.fingerprint(method, input))
      throw new ChapterValidationError({
        code: 'INVALID_INPUT',
        message: 'Mutation ID was already used for a different request.',
        retryable: false,
      });
    return hit.result;
  }
  private remember(
    session: ChapterSession,
    method: string,
    id: string,
    input: unknown,
    result: ChapterResult<unknown>,
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
  private mapError(error: unknown, fallback: ChapterError['code']): ChapterError {
    if (error instanceof ChapterValidationError) return error.detail;
    return {
      code: fallback,
      message:
        fallback === 'STORAGE_READ_FAILED'
          ? 'Chapter content could not be loaded.'
          : 'Chapter content could not be saved.',
      retryable: true,
    };
  }
}
