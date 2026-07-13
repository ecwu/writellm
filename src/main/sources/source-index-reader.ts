import {
  SILICONFLOW_INDEX_PROFILE_ID,
  SILICONFLOW_MODEL,
  SILICONFLOW_VECTOR_DIMENSIONS,
} from '../../shared/sources.js';
import type { ProjectSession } from '../project/project-transaction.js';
import { IndexRepository } from './index-repository.js';
import type { SourceRepository } from './source-repository.js';

export type SearchableBlock = {
  projectId: string;
  sourceId: string;
  sourceVersionId: string;
  chunkId: string;
  ordinal: number;
  plainText: string;
  contentHash: string;
  mediaIds: string[];
  mineruMetadata: Record<string, unknown>;
  indexProfileId: string;
  vector: Float32Array;
};

export class SourceIndexReader {
  constructor(
    private sources: SourceRepository,
    private indexes = new IndexRepository(),
  ) {}
  async getIndexProfile(_session: ProjectSession) {
    return {
      indexProfileId: SILICONFLOW_INDEX_PROFILE_ID,
      model: SILICONFLOW_MODEL,
      dimensions: SILICONFLOW_VECTOR_DIMENSIONS,
    };
  }
  async *listSearchableBlocks(session: ProjectSession): AsyncIterable<SearchableBlock> {
    let cursor: string | undefined;
    do {
      const page = await this.sources.list(session, { limit: 100, ...(cursor ? { cursor } : {}) });
      for (const source of page.sources) {
        if (source.eligibility.indexed < 1) continue;
        const blocks = await this.sources.getAllBlocks(session, source.sourceId);
        const version = await this.sources.getCurrentVersion(session, source.sourceId);
        if (!version) continue;
        for (const block of blocks) {
          if (!block.eligible) continue;
          const vector = await this.indexes.readVector(
            session,
            source.sourceId,
            version,
            block.chunkId,
            block.contentHash,
          );
          if (vector)
            yield {
              projectId: session.projectId,
              sourceId: source.sourceId,
              sourceVersionId: version,
              chunkId: block.chunkId,
              ordinal: block.ordinal,
              plainText: block.plainText,
              contentHash: block.contentHash,
              mediaIds: block.mediaIds,
              mineruMetadata: block.mineruMetadata,
              indexProfileId: SILICONFLOW_INDEX_PROFILE_ID,
              vector,
            };
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  async getBlock(
    session: ProjectSession,
    sourceId: string,
    chunkId: string,
  ): Promise<SearchableBlock | null> {
    for await (const block of this.listSearchableBlocks(session))
      if (block.sourceId === sourceId && block.chunkId === chunkId) return block;
    return null;
  }
}
