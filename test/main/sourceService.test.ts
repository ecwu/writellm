import { describe, expect, test } from 'bun:test';
import type { KnowledgeChunkRecord, ModelEndpointSettings } from '../../src/shared/types.js';
import { searchIndexedSources, SourceToolError, type SourceSearchDatabase } from '../../src/main/agent/sourceService.js';

const embedding: ModelEndpointSettings = {
  provider: 'openai-compatible',
  baseURL: 'https://embeddings.example.test/v1',
  model: 'embedding-model',
  apiKey: 'test-key'
};

function chunk(id: string, publicRef: string, content: string): KnowledgeChunkRecord {
  return {
    id,
    publicRef,
    itemId: `item-${id}`,
    itemPublicRef: `src-${id}`,
    itemTitle: `Source ${id}`,
    itemDescription: '',
    chunkIndex: 0,
    content,
    embedding: [0.1, 0.2],
    embeddingDimensions: 2,
    embeddingModel: 'embedding-model',
    vectorRowid: 1,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    score: 0.5,
    retrievalMethod: 'vector'
  };
}

describe('clean-slate source RAG service', () => {
  test('performs one bounded hybrid search and returns only provenance-safe evidence', async () => {
    const database: SourceSearchDatabase = {
      searchKnowledgeChunks: () => [chunk('1', 'a.c1', 'Vector evidence'), chunk('2', 'b.c1', 'Vector only')],
      searchKnowledgeChunksByText: () => [chunk('1', 'a.c1', 'Vector evidence'), chunk('3', 'c.c1', 'Text only')]
    };
    const stages: string[] = [];

    const result = await searchIndexedSources(database, {
      query: '  evidence  claim  ',
      embedding,
      outboundDataPolicy: { externalProcessingEnabled: true },
      maxResults: 2,
      onStage: (stage) => stages.push(stage)
    }, {
      embedQuery: async () => [0.1, 0.2]
    });

    expect(stages).toEqual(['embedding', 'local_search']);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ chunkId: '1', publicRef: 'a.c1', retrievalMethod: 'hybrid' });
    expect(result[0]?.retrievalReason).toContain('vector + full-text');
    expect(result[0]).not.toHaveProperty('embedding');
    expect(result[0]).not.toHaveProperty('content');
  });

  test('classifies an embedding deadline rather than returning empty evidence', async () => {
    const database: SourceSearchDatabase = {
      searchKnowledgeChunks: () => [],
      searchKnowledgeChunksByText: () => []
    };

    const pending = searchIndexedSources(database, {
      query: 'timeout fixture',
      embedding,
      outboundDataPolicy: { externalProcessingEnabled: true }
    }, {
      embeddingTimeoutMs: 1,
      embedQuery: async (_settings, _query, signal) => new Promise<number[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
    });

    await expect(pending).rejects.toMatchObject({ category: 'embedding_timeout', retryable: true } satisfies Partial<SourceToolError>);
  });

  test('rejects a source search before outbound embedding data is sent without consent', async () => {
    const database: SourceSearchDatabase = {
      searchKnowledgeChunks: () => [],
      searchKnowledgeChunksByText: () => []
    };

    await expect(searchIndexedSources(database, {
      query: 'blocked',
      embedding,
      outboundDataPolicy: { externalProcessingEnabled: false }
    })).rejects.toMatchObject({ category: 'tool_policy_denied', retryable: false } satisfies Partial<SourceToolError>);
  });

  test('propagates run cancellation as a classified failure', async () => {
    const database: SourceSearchDatabase = {
      searchKnowledgeChunks: () => [],
      searchKnowledgeChunksByText: () => []
    };
    const controller = new AbortController();
    const pending = searchIndexedSources(database, {
      query: 'cancel fixture',
      embedding,
      outboundDataPolicy: { externalProcessingEnabled: true },
      abortSignal: controller.signal
    }, {
      embedQuery: async (_settings, _query, signal) => new Promise<number[]>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      })
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ category: 'canceled', retryable: false } satisfies Partial<SourceToolError>);
  });
});
