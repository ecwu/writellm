import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  SILICONFLOW_INDEX_PROFILE_ID,
  SILICONFLOW_MODEL,
  SILICONFLOW_VECTOR_DIMENSIONS,
} from '../../shared/sources.js';
import { ProjectGitRepository } from '../project/git-repository.js';
import { type ProjectSession, ProjectTransaction } from '../project/project-transaction.js';

export type EmbeddingRecord = {
  chunkId: string;
  contentHash: string;
  offsetBytes: number;
  dimensions: number;
  vectorHash: string;
};
type IndexManifest = {
  kind: 'writellm.source-index';
  schemaVersion: 1;
  sourceId: string;
  sourceVersionId: string;
  indexProfileId: typeof SILICONFLOW_INDEX_PROFILE_ID;
  model: typeof SILICONFLOW_MODEL;
  dimensions: typeof SILICONFLOW_VECTOR_DIMENSIONS;
  records: EmbeddingRecord[];
};

export class IndexRepository {
  private transaction: ProjectTransaction;
  private queues = new Map<string, Promise<unknown>>();
  constructor(private isCurrentSession: (session: ProjectSession) => boolean = () => true) {
    const git = new ProjectGitRepository();
    this.transaction = new ProjectTransaction({
      git: {
        commit: (root, files, revision, metadata) =>
          git.commitContents(root, files, revision, metadata),
      },
    });
  }
  async saveVectors(
    session: ProjectSession,
    input: {
      sourceId: string;
      sourceVersionId: string;
      revision: number;
      values: Array<{ chunkId: string; contentHash: string; vector: Float32Array }>;
    },
  ): Promise<EmbeddingRecord[]> {
    return this.serial(`${session.projectId}:${input.sourceId}:${input.sourceVersionId}`, () =>
      this.saveVectorsNow(session, input),
    );
  }
  private async saveVectorsNow(
    session: ProjectSession,
    input: {
      sourceId: string;
      sourceVersionId: string;
      revision: number;
      values: Array<{ chunkId: string; contentHash: string; vector: Float32Array }>;
    },
  ): Promise<EmbeddingRecord[]> {
    for (const value of input.values) validateVector(value.vector);
    const existing = await this.readManifest(session, input.sourceId, input.sourceVersionId).catch(
      () => null,
    );
    const vectors = new Map<string, { contentHash: string; vector: Float32Array }>();
    if (existing)
      for (const record of existing.records) {
        const vector = await this.readVector(
          session,
          input.sourceId,
          input.sourceVersionId,
          record.chunkId,
          record.contentHash,
        );
        if (vector) vectors.set(record.chunkId, { contentHash: record.contentHash, vector });
      }
    for (const value of input.values)
      vectors.set(value.chunkId, { contentHash: value.contentHash, vector: value.vector });
    const records: EmbeddingRecord[] = [];
    const binary = Buffer.alloc(vectors.size * SILICONFLOW_VECTOR_DIMENSIONS * 4);
    let offsetBytes = 0;
    for (const [chunkId, value] of vectors) {
      const view = new DataView(
        binary.buffer,
        binary.byteOffset + offsetBytes,
        SILICONFLOW_VECTOR_DIMENSIONS * 4,
      );
      for (let index = 0; index < value.vector.length; index++)
        view.setFloat32(index * 4, value.vector[index], true);
      const slice = binary.subarray(offsetBytes, offsetBytes + SILICONFLOW_VECTOR_DIMENSIONS * 4);
      records.push({
        chunkId,
        contentHash: value.contentHash,
        offsetBytes,
        dimensions: SILICONFLOW_VECTOR_DIMENSIONS,
        vectorHash: hash(slice),
      });
      offsetBytes += SILICONFLOW_VECTOR_DIMENSIONS * 4;
    }
    const manifest: IndexManifest = {
      kind: 'writellm.source-index',
      schemaVersion: 1,
      sourceId: input.sourceId,
      sourceVersionId: input.sourceVersionId,
      indexProfileId: SILICONFLOW_INDEX_PROFILE_ID,
      model: SILICONFLOW_MODEL,
      dimensions: SILICONFLOW_VECTOR_DIMENSIONS,
      records,
    };
    const base = `sources/${input.sourceId}/versions/${input.sourceVersionId}/embeddings`;
    await this.transaction.publish({
      session,
      revision: input.revision,
      files: [
        { relativePath: `${base}/${SILICONFLOW_INDEX_PROFILE_ID}.f32`, content: binary },
        {
          relativePath: `${base}/${SILICONFLOW_INDEX_PROFILE_ID}.json`,
          content: `${JSON.stringify(manifest)}\n`,
        },
      ],
      metadata: { actor: 'system', event: 'processing', contentChange: false },
      isCurrentSession: () => this.isCurrentSession(session),
    });
    return records;
  }

  async readManifest(
    session: ProjectSession,
    sourceId: string,
    sourceVersionId: string,
  ): Promise<IndexManifest> {
    const value = JSON.parse(
      await readFile(this.manifestPath(session, sourceId, sourceVersionId), 'utf8'),
    ) as IndexManifest;
    if (
      value.kind !== 'writellm.source-index' ||
      value.schemaVersion !== 1 ||
      value.sourceId !== sourceId ||
      value.sourceVersionId !== sourceVersionId ||
      value.indexProfileId !== SILICONFLOW_INDEX_PROFILE_ID ||
      value.model !== SILICONFLOW_MODEL ||
      value.dimensions !== SILICONFLOW_VECTOR_DIMENSIONS ||
      !Array.isArray(value.records)
    )
      throw new Error('SOURCE_INDEX_MALFORMED');
    return value;
  }
  async readVector(
    session: ProjectSession,
    sourceId: string,
    sourceVersionId: string,
    chunkId: string,
    contentHash: string,
  ): Promise<Float32Array | null> {
    let manifest: IndexManifest;
    try {
      manifest = await this.readManifest(session, sourceId, sourceVersionId);
    } catch {
      return null;
    }
    const record = manifest.records.find(
      (value) => value.chunkId === chunkId && value.contentHash === contentHash,
    );
    if (!record || record.dimensions !== SILICONFLOW_VECTOR_DIMENSIONS || record.offsetBytes < 0)
      return null;
    try {
      const bytes = await readFile(this.vectorPath(session, sourceId, sourceVersionId));
      const end = record.offsetBytes + record.dimensions * 4;
      if (end > bytes.length) return null;
      const slice = bytes.subarray(record.offsetBytes, end);
      if (hash(slice) !== record.vectorHash) return null;
      const view = new DataView(slice.buffer, slice.byteOffset, slice.byteLength);
      const vector = new Float32Array(record.dimensions);
      for (let index = 0; index < vector.length; index++)
        vector[index] = view.getFloat32(index * 4, true);
      validateVector(vector);
      return vector;
    } catch {
      return null;
    }
  }
  private manifestPath(session: ProjectSession, sourceId: string, versionId: string) {
    return path.join(
      session.projectRoot,
      'sources',
      sourceId,
      'versions',
      versionId,
      'embeddings',
      `${SILICONFLOW_INDEX_PROFILE_ID}.json`,
    );
  }
  private vectorPath(session: ProjectSession, sourceId: string, versionId: string) {
    return path.join(
      session.projectRoot,
      'sources',
      sourceId,
      'versions',
      versionId,
      'embeddings',
      `${SILICONFLOW_INDEX_PROFILE_ID}.f32`,
    );
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

function validateVector(vector: Float32Array): void {
  if (vector.length !== SILICONFLOW_VECTOR_DIMENSIONS || !vector.every(Number.isFinite))
    throw new Error('SOURCE_INDEX_MALFORMED');
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!Number.isFinite(norm) || norm <= 0) throw new Error('SOURCE_INDEX_MALFORMED');
}
function hash(value: Uint8Array) {
  return createHash('sha256').update(value).digest('hex');
}
