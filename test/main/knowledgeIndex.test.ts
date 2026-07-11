import { describe, expect, test } from 'bun:test';
import type { KnowledgeRetrievalSettings, RetrievedKnowledgeSource } from '../../src/shared/types.js';
import {
  chunkKnowledgeText,
  formatSourcesForPrompt,
  getKnowledgeChunkingDebugConfig
} from '../../src/main/knowledgeIndex.js';

const outOfRangeSettings: KnowledgeRetrievalSettings = {
  maxRetrievedChunks: 99,
  maxCandidateChunks: 1,
  rerankTopN: 99,
  adjacentChunkRadius: -3,
  maxChunksPerItem: 0,
  chunkTargetChars: 10,
  chunkOverlapChars: 5000,
  embeddingBatchSize: 999
};

const source: RetrievedKnowledgeSource = {
  label: '[S1]',
  publicRef: 'a3f91c8.c1',
  itemId: 'item-1',
  itemPublicRef: 'a3f91c8',
  itemTitle: 'A source title',
  itemDescription: 'A source description',
  chunkId: 'chunk-1',
  chunkIndex: 0,
  snippet: 'Relevant evidence from the source.',
  score: 0.4567
};

describe('knowledge indexing helpers', () => {
  test('clamps unsafe chunking settings to supported ranges', () => {
    expect(getKnowledgeChunkingDebugConfig(outOfRangeSettings)).toEqual({
      targetChars: 200,
      overlapChars: 199,
      embeddingBatchSize: 256
    });
  });

  test('normalizes empty text and keeps a heading attached to its content', async () => {
    expect(await chunkKnowledgeText(' \r\n\r\n ', outOfRangeSettings)).toEqual([]);

    const chunks = await chunkKnowledgeText(
      `# Findings\n\n${'Evidence supports the central claim. '.repeat(24)}`,
      { ...outOfRangeSettings, chunkTargetChars: 200, chunkOverlapChars: 20 }
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toStartWith('# Findings\n\nEvidence supports the central claim.');
    expect(chunks.every((chunk) => chunk.trim().length > 0)).toBeTrue();
  });

  test('formats source evidence with stable citation guidance', () => {
    expect(formatSourcesForPrompt([])).toBe('');

    const prompt = formatSourcesForPrompt([source]);
    expect(prompt).toContain('[a3f91c8.c1] A source title');
    expect(prompt).toContain('Relevance: 0.457');
    expect(prompt).toContain('Use one citation per bracket');
  });
});
