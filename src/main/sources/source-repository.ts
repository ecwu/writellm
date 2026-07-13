import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ListSourcesRequest, SourceDetail, SourceSummary } from '../../shared/sources.js';
import { ProjectGitRepository } from '../project/git-repository.js';
import { type ProjectSession, ProjectTransaction } from '../project/project-transaction.js';
import type { NormalizedArtifact, NormalizedBlock } from './artifact-normalizer.js';
import { IndexRepository } from './index-repository.js';

type CatalogEntry = SourceSummary & {
  sha256: string;
  currentVersionId: string;
  updatedAt: string;
};
type Catalog = {
  kind: 'writellm.source-catalog';
  schemaVersion: 1;
  projectId: string;
  revision: number;
  sources: CatalogEntry[];
};
type SourceDocument = {
  kind: 'writellm.source';
  schemaVersion: 1;
  projectId: string;
  sourceId: string;
  revision: number;
  displayName: string;
  sizeBytes: number;
  sha256: string;
  importedAt: string;
  currentVersionId: string;
};

export class SourceRepository {
  private transaction: ProjectTransaction;
  private git = new ProjectGitRepository();
  private queues = new Map<string, Promise<unknown>>();
  constructor(
    private options: {
      now?: () => string;
      id?: () => string;
      isCurrentSession?: (session: ProjectSession) => boolean;
    } = {},
  ) {
    this.transaction = new ProjectTransaction({
      git: {
        commit: (root, files, revision, metadata) =>
          this.git.commitContents(root, files, revision, metadata),
      },
    });
  }

  async list(session: ProjectSession, request: ListSourcesRequest) {
    const catalog = await this.readCatalog(session);
    const offset = request.cursor ? Number.parseInt(request.cursor, 10) : 0;
    const sources = catalog.sources.slice(offset, offset + request.limit).map(publicSummary);
    const next = offset + sources.length;
    return {
      sources,
      catalogRevision: catalog.revision,
      ...(next < catalog.sources.length ? { nextCursor: String(next) } : {}),
    };
  }

  async get(session: ProjectSession, sourceId: string): Promise<SourceDetail | null> {
    const catalog = await this.readCatalog(session);
    const entry = catalog.sources.find((source) => source.sourceId === sourceId);
    if (!entry) return null;
    const document = await this.readSourceDocument(session, sourceId);
    const manifest = await this.readVersionManifest(session, sourceId, document.currentVersionId);
    return {
      ...publicSummary(entry),
      parseSummary: {
        markdownAvailable: manifest.parseState === 'complete',
        mediaCount: Number.isSafeInteger(manifest.mediaCount) ? (manifest.mediaCount as number) : 0,
        blockCount: Number.isSafeInteger(manifest.blockCount) ? (manifest.blockCount as number) : 0,
      },
    };
  }

  async findPossibleDuplicate(session: ProjectSession, displayName: string, sizeBytes: number) {
    const catalog = await this.readCatalog(session);
    return catalog.sources.some(
      (source) => source.displayName === displayName && source.sizeBytes === sizeBytes,
    );
  }

  async publishParse(
    session: ProjectSession,
    sourceId: string,
    sourceVersionId: string,
    artifact: NormalizedArtifact,
  ): Promise<SourceSummary> {
    const catalog = await this.readCatalog(session);
    const index = catalog.sources.findIndex((source) => source.sourceId === sourceId);
    if (index < 0) throw new Error('SOURCE_NOT_FOUND');
    const document = await this.readSourceDocument(session, sourceId);
    if (document.currentVersionId !== sourceVersionId) throw new Error('SOURCE_CONFLICT');
    const eligible = artifact.blocks.filter((block) => block.eligible).length;
    const nextEntry: CatalogEntry = {
      ...catalog.sources[index],
      revision: catalog.sources[index].revision + 1,
      state: eligible > 0 ? 'indexing' : 'partial',
      progress: { completed: 0, total: eligible, stage: 'indexing' },
      eligibility: { indexed: 0, eligible, failed: 0 },
      retryable: artifact.rejectedBlockCount > 0,
      retrying: false,
      updatedAt: (this.options.now ?? (() => new Date().toISOString()))(),
    };
    const nextCatalog: Catalog = {
      ...catalog,
      revision: catalog.revision + 1,
      sources: catalog.sources.map((source, position) => (position === index ? nextEntry : source)),
    };
    const mediaRecords = artifact.media.map(({ data: _data, ...media }) => media);
    const manifest = {
      kind: 'writellm.source-version',
      schemaVersion: 1,
      projectId: session.projectId,
      sourceId,
      sourceVersionId,
      originalSha256: document.sha256,
      parseState: 'complete',
      blockCount: artifact.blocks.length,
      mediaCount: artifact.media.length,
      eligibleBlockCount: eligible,
      rejectedBlockCount: artifact.rejectedBlockCount,
      media: mediaRecords,
    };
    await this.transaction.publish({
      session,
      revision: nextCatalog.revision,
      files: [
        { relativePath: 'sources/catalog.json', content: `${JSON.stringify(nextCatalog)}\n` },
        {
          relativePath: `sources/${sourceId}/source.json`,
          content: `${JSON.stringify({ ...document, revision: document.revision + 1 })}\n`,
        },
        {
          relativePath: `sources/${sourceId}/versions/${sourceVersionId}/manifest.json`,
          content: `${JSON.stringify(manifest)}\n`,
        },
        {
          relativePath: `sources/${sourceId}/versions/${sourceVersionId}/full.md`,
          content: artifact.fullMarkdown,
        },
        {
          relativePath: `sources/${sourceId}/versions/${sourceVersionId}/blocks.jsonl`,
          content: `${artifact.blocks.map((block) => JSON.stringify({ kind: 'writellm.source-block', schemaVersion: 1, sourceId, sourceVersionId, ...block })).join('\n')}\n`,
        },
        ...artifact.media.map((media) => ({
          relativePath: `sources/${sourceId}/versions/${sourceVersionId}/media/${media.mediaId}.${media.extension}`,
          content: media.data,
        })),
      ],
      metadata: { actor: 'system', event: 'processing', contentChange: false },
      isCurrentSession: () => this.options.isCurrentSession?.(session) ?? true,
    });
    return publicSummary(nextEntry);
  }

  async getBlocks(
    session: ProjectSession,
    sourceId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<{ blocks: NormalizedBlock[]; nextCursor?: string }> {
    const document = await this.readSourceDocument(session, sourceId);
    const file = path.join(
      session.projectRoot,
      'sources',
      sourceId,
      'versions',
      document.currentVersionId,
      'blocks.jsonl',
    );
    let lines: string[];
    try {
      lines = (await readFile(file, 'utf8')).split('\n').filter(Boolean);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { blocks: [] };
      throw new Error('SOURCE_RECOVERY_REQUIRED');
    }
    const offset = cursor ? Number.parseInt(cursor, 10) : 0;
    const indexManifest = await new IndexRepository()
      .readManifest(session, sourceId, document.currentVersionId)
      .catch(() => null);
    const indexed = new Set(
      indexManifest?.records.map((record) => `${record.chunkId}:${record.contentHash}`) ?? [],
    );
    const blocks = lines.slice(offset, offset + limit).map((line) => {
      const value = JSON.parse(line) as NormalizedBlock & {
        kind: string;
        schemaVersion: number;
        sourceId: string;
        sourceVersionId: string;
      };
      if (
        value.kind !== 'writellm.source-block' ||
        value.schemaVersion !== 1 ||
        value.sourceId !== sourceId ||
        value.sourceVersionId !== document.currentVersionId
      )
        throw new Error('SOURCE_RECOVERY_REQUIRED');
      const {
        kind: _kind,
        schemaVersion: _schema,
        sourceId: _source,
        sourceVersionId: _version,
        ...block
      } = value;
      return {
        ...block,
        searchable: block.eligible && indexed.has(`${block.chunkId}:${block.contentHash}`),
      };
    });
    const next = offset + blocks.length;
    return { blocks, ...(next < lines.length ? { nextCursor: String(next) } : {}) };
  }

  async resolveMedia(session: ProjectSession, sourceId: string, mediaId: string) {
    const document = await this.readSourceDocument(session, sourceId);
    const manifest = await this.readVersionManifest(session, sourceId, document.currentVersionId);
    const media = Array.isArray(manifest.media)
      ? (manifest.media as Array<Record<string, unknown>>).find(
          (value) => value.mediaId === mediaId,
        )
      : undefined;
    if (
      !media ||
      typeof media.extension !== 'string' ||
      !['png', 'jpg', 'jpeg', 'webp'].includes(media.extension) ||
      typeof media.mimeType !== 'string' ||
      typeof media.sha256 !== 'string'
    )
      return null;
    return {
      absolutePath: path.join(
        session.projectRoot,
        'sources',
        sourceId,
        'versions',
        document.currentVersionId,
        'media',
        `${mediaId}.${media.extension}`,
      ),
      mimeType: media.mimeType,
      sha256: media.sha256,
    };
  }

  async getCurrentVersion(session: ProjectSession, sourceId: string): Promise<string | null> {
    const document = await this.readSourceDocument(session, sourceId).catch(() => null);
    return document?.currentVersionId ?? null;
  }

  async getAllBlocks(session: ProjectSession, sourceId: string): Promise<NormalizedBlock[]> {
    const result: NormalizedBlock[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.getBlocks(session, sourceId, cursor, 100);
      result.push(...page.blocks);
      cursor = page.nextCursor;
    } while (cursor);
    return result;
  }

  async updateIndexProgress(
    session: ProjectSession,
    sourceId: string,
    sourceVersionId: string,
    indexed: number,
    failedIncrement = 0,
  ): Promise<SourceSummary> {
    return this.serial(`${session.projectId}:${sourceId}`, async () => {
      const catalog = await this.readCatalog(session);
      const index = catalog.sources.findIndex((source) => source.sourceId === sourceId);
      if (index < 0) throw new Error('SOURCE_NOT_FOUND');
      const document = await this.readSourceDocument(session, sourceId);
      if (document.currentVersionId !== sourceVersionId) throw new Error('SOURCE_CONFLICT');
      const current = catalog.sources[index];
      const boundedIndexed = Math.max(
        current.eligibility.indexed,
        Math.min(indexed, current.eligibility.eligible),
      );
      const failed = Math.min(
        current.eligibility.eligible + current.eligibility.failed,
        current.eligibility.failed + failedIncrement,
      );
      const complete = boundedIndexed === current.eligibility.eligible;
      const terminalPartial = boundedIndexed + failed >= current.eligibility.eligible;
      const nextEntry: CatalogEntry = {
        ...current,
        revision: current.revision + 1,
        state: complete ? 'available' : terminalPartial ? 'partial' : 'indexing',
        progress: {
          completed: boundedIndexed + failed,
          total: current.eligibility.eligible,
          stage: 'indexing',
        },
        eligibility: { ...current.eligibility, indexed: boundedIndexed, failed },
        retryable: !complete && failed > 0,
        retrying: complete || terminalPartial ? false : current.retrying,
        updatedAt: new Date().toISOString(),
      };
      const nextCatalog = {
        ...catalog,
        revision: catalog.revision + 1,
        sources: catalog.sources.map((source, position) =>
          position === index ? nextEntry : source,
        ),
      };
      await this.transaction.publish({
        session,
        revision: nextCatalog.revision,
        files: [
          { relativePath: 'sources/catalog.json', content: `${JSON.stringify(nextCatalog)}\n` },
          {
            relativePath: `sources/${sourceId}/source.json`,
            content: `${JSON.stringify({ ...document, revision: document.revision + 1 })}\n`,
          },
        ],
        metadata: { actor: 'system', event: 'processing', contentChange: false },
        isCurrentSession: () => this.options.isCurrentSession?.(session) ?? true,
      });
      return publicSummary(nextEntry);
    });
  }

  async markRetrying(
    session: ProjectSession,
    sourceId: string,
    expectedSourceRevision: number,
  ): Promise<
    | { status: 'accepted'; source: SourceSummary; sourceVersionId: string }
    | { status: 'conflict'; currentSource?: SourceSummary; catalogRevision: number }
  > {
    return this.serial(`${session.projectId}:${sourceId}`, async () => {
      const catalog = await this.readCatalog(session);
      const index = catalog.sources.findIndex((source) => source.sourceId === sourceId);
      if (index < 0) return { status: 'conflict', catalogRevision: catalog.revision };
      const current = catalog.sources[index];
      if (current.revision !== expectedSourceRevision)
        return {
          status: 'conflict',
          currentSource: publicSummary(current),
          catalogRevision: catalog.revision,
        };
      const document = await this.readSourceDocument(session, sourceId);
      const nextEntry: CatalogEntry = {
        ...current,
        revision: current.revision + 1,
        retrying: true,
        retryable: false,
        state: current.eligibility.eligible > 0 ? 'indexing' : 'queued',
        updatedAt: new Date().toISOString(),
      };
      const nextCatalog = {
        ...catalog,
        revision: catalog.revision + 1,
        sources: catalog.sources.map((source, position) =>
          position === index ? nextEntry : source,
        ),
      };
      await this.transaction.publish({
        session,
        revision: nextCatalog.revision,
        files: [
          { relativePath: 'sources/catalog.json', content: `${JSON.stringify(nextCatalog)}\n` },
          {
            relativePath: `sources/${sourceId}/source.json`,
            content: `${JSON.stringify({ ...document, revision: document.revision + 1 })}\n`,
          },
        ],
        metadata: { actor: 'system', event: 'processing', contentChange: false },
        isCurrentSession: () => this.options.isCurrentSession?.(session) ?? true,
      });
      return {
        status: 'accepted',
        source: publicSummary(nextEntry),
        sourceVersionId: document.currentVersionId,
      };
    });
  }

  async removePublishedSource(
    session: ProjectSession,
    sourceId: string,
    expectedSourceRevision: number,
  ): Promise<
    | { status: 'removed'; sourceId: string; catalogRevision: number }
    | { status: 'conflict'; currentSource?: SourceSummary; catalogRevision: number }
  > {
    return this.serial(`${session.projectId}:${sourceId}`, async () => {
      const catalog = await this.readCatalog(session);
      const current = catalog.sources.find((source) => source.sourceId === sourceId);
      if (!current || current.revision !== expectedSourceRevision)
        return {
          status: 'conflict',
          currentSource: current ? publicSummary(current) : undefined,
          catalogRevision: catalog.revision,
        };
      const nextCatalog: Catalog = {
        ...catalog,
        revision: catalog.revision + 1,
        sources: catalog.sources.filter((source) => source.sourceId !== sourceId),
      };
      await this.transaction.publish({
        session,
        revision: nextCatalog.revision,
        files: [
          { relativePath: 'sources/catalog.json', content: `${JSON.stringify(nextCatalog)}\n` },
          {
            relativePath: `sources/.tombstones/${sourceId}.json`,
            content: `${JSON.stringify({ kind: 'writellm.source-tombstone', schemaVersion: 1, projectId: session.projectId, sourceId, sourceRevision: current.revision, removedAt: new Date().toISOString() })}\n`,
          },
        ],
        metadata: { actor: 'system', event: 'processing', contentChange: false },
        isCurrentSession: () => this.options.isCurrentSession?.(session) ?? true,
      });
      await (await import('node:fs/promises')).rm(
        path.join(session.projectRoot, 'sources', sourceId),
        {
          recursive: true,
          force: true,
        },
      );
      await this.git.commitRemoval(
        session.projectRoot,
        `sources/${sourceId}`,
        nextCatalog.revision,
        { actor: 'system', event: 'processing', contentChange: false },
      );
      return { status: 'removed', sourceId, catalogRevision: nextCatalog.revision };
    });
  }

  async createSource(
    session: ProjectSession,
    input: {
      expectedCatalogRevision: number;
      displayName: string;
      sizeBytes: number;
      sha256: string;
      sourceId?: string;
      sourceVersionId?: string;
      originalBytes?: Uint8Array;
    },
  ): Promise<
    | { status: 'created'; source: SourceSummary; sourceVersionId: string; catalogRevision: number }
    | { status: 'duplicate'; source: SourceSummary; catalogRevision: number }
    | { status: 'conflict'; catalogRevision: number }
  > {
    const catalog = await this.readCatalog(session);
    if (catalog.revision !== input.expectedCatalogRevision)
      return { status: 'conflict', catalogRevision: catalog.revision };
    const duplicate = catalog.sources.find((source) => source.sha256 === input.sha256);
    if (duplicate)
      return {
        status: 'duplicate',
        source: publicSummary(duplicate),
        catalogRevision: catalog.revision,
      };
    const now = (this.options.now ?? (() => new Date().toISOString()))();
    const sourceId = input.sourceId ?? (this.options.id ?? randomUUID)();
    const sourceVersionId = input.sourceVersionId ?? (this.options.id ?? randomUUID)();
    const summary: CatalogEntry = {
      sourceId,
      revision: 1,
      displayName: input.displayName,
      sizeBytes: input.sizeBytes,
      importedAt: now,
      state: 'queued',
      progress: { completed: 0, total: 1, stage: 'queued' },
      eligibility: { indexed: 0, eligible: 0, failed: 0 },
      retrying: false,
      retryable: false,
      sha256: input.sha256,
      currentVersionId: sourceVersionId,
      updatedAt: now,
    };
    const next: Catalog = {
      ...catalog,
      revision: catalog.revision + 1,
      sources: [...catalog.sources, summary],
    };
    const source: SourceDocument = {
      kind: 'writellm.source',
      schemaVersion: 1,
      projectId: session.projectId,
      sourceId,
      revision: 1,
      displayName: input.displayName,
      sizeBytes: input.sizeBytes,
      sha256: input.sha256,
      importedAt: now,
      currentVersionId: sourceVersionId,
    };
    await this.transaction.publish({
      session,
      revision: next.revision,
      files: [
        { relativePath: 'sources/catalog.json', content: `${JSON.stringify(next)}\n` },
        { relativePath: `sources/${sourceId}/source.json`, content: `${JSON.stringify(source)}\n` },
        {
          relativePath: `sources/${sourceId}/versions/${sourceVersionId}/manifest.json`,
          content: `${JSON.stringify({ kind: 'writellm.source-version', schemaVersion: 1, projectId: session.projectId, sourceId, sourceVersionId, originalSha256: input.sha256, parseState: 'pending' })}\n`,
        },
        ...(input.originalBytes
          ? [{ relativePath: `sources/${sourceId}/original.pdf`, content: input.originalBytes }]
          : []),
      ],
      metadata: { actor: 'system', event: 'processing', contentChange: false },
      isCurrentSession: () => this.options.isCurrentSession?.(session) ?? true,
    });
    return {
      status: 'created',
      source: publicSummary(summary),
      sourceVersionId,
      catalogRevision: next.revision,
    };
  }

  private async readCatalog(session: ProjectSession): Promise<Catalog> {
    try {
      const value = JSON.parse(
        await readFile(path.join(session.projectRoot, 'sources/catalog.json'), 'utf8'),
      ) as Catalog;
      if (
        value.kind !== 'writellm.source-catalog' ||
        value.schemaVersion !== 1 ||
        value.projectId !== session.projectId ||
        !Number.isSafeInteger(value.revision) ||
        !Array.isArray(value.sources) ||
        new Set(value.sources.map((source) => source.sha256)).size !== value.sources.length
      )
        throw new Error('SOURCE_RECOVERY_REQUIRED');
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return {
          kind: 'writellm.source-catalog',
          schemaVersion: 1,
          projectId: session.projectId,
          revision: 0,
          sources: [],
        };
      if (error instanceof Error && error.message === 'SOURCE_RECOVERY_REQUIRED') throw error;
      throw new Error('SOURCE_RECOVERY_REQUIRED');
    }
  }

  private async readSourceDocument(
    session: ProjectSession,
    sourceId: string,
  ): Promise<SourceDocument> {
    try {
      const value = JSON.parse(
        await readFile(path.join(session.projectRoot, 'sources', sourceId, 'source.json'), 'utf8'),
      ) as SourceDocument;
      if (
        value.kind !== 'writellm.source' ||
        value.schemaVersion !== 1 ||
        value.projectId !== session.projectId ||
        value.sourceId !== sourceId ||
        !Number.isSafeInteger(value.revision) ||
        typeof value.currentVersionId !== 'string'
      )
        throw new Error();
      return value;
    } catch {
      throw new Error('SOURCE_RECOVERY_REQUIRED');
    }
  }

  private async readVersionManifest(
    session: ProjectSession,
    sourceId: string,
    sourceVersionId: string,
  ): Promise<{
    parseState: string;
    mediaCount?: number;
    blockCount?: number;
    [key: string]: unknown;
  }> {
    try {
      const value = JSON.parse(
        await readFile(
          path.join(
            session.projectRoot,
            'sources',
            sourceId,
            'versions',
            sourceVersionId,
            'manifest.json',
          ),
          'utf8',
        ),
      ) as Record<string, unknown>;
      if (
        value.kind !== 'writellm.source-version' ||
        value.schemaVersion !== 1 ||
        value.projectId !== session.projectId ||
        value.sourceId !== sourceId ||
        value.sourceVersionId !== sourceVersionId ||
        typeof value.parseState !== 'string'
      )
        throw new Error();
      return value as {
        parseState: string;
        mediaCount?: number;
        blockCount?: number;
        [key: string]: unknown;
      };
    } catch {
      throw new Error('SOURCE_RECOVERY_REQUIRED');
    }
  }
  private serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    this.queues.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }
}

function publicSummary(entry: CatalogEntry): SourceSummary {
  const { sha256: _sha256, currentVersionId: _version, updatedAt: _updated, ...summary } = entry;
  return summary;
}
