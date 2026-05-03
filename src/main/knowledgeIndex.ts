import type {
  KnowledgeChunkRecord,
  KnowledgeChunkingDebugConfig,
  ModelEndpointSettings,
  RetrievedKnowledgeSource
} from '../shared/types.js';
import type { PaperLabDatabase } from './database.js';

const CHUNK_TARGET_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 180;
const EMBEDDING_BATCH_SIZE = 64;

export function getKnowledgeChunkingDebugConfig(): KnowledgeChunkingDebugConfig {
  return {
    targetChars: CHUNK_TARGET_CHARS,
    overlapChars: CHUNK_OVERLAP_CHARS,
    embeddingBatchSize: EMBEDDING_BATCH_SIZE
  };
}

export function chunkKnowledgeText(content: string): string[] {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < normalized.length) {
    const hardEnd = Math.min(cursor + CHUNK_TARGET_CHARS, normalized.length);
    const window = normalized.slice(cursor, hardEnd);
    const paragraphBreak = window.lastIndexOf('\n\n');
    const sentenceBreak = Math.max(window.lastIndexOf('. '), window.lastIndexOf('? '), window.lastIndexOf('! '));
    const softBreak = paragraphBreak > CHUNK_TARGET_CHARS * 0.45
      ? paragraphBreak + 2
      : sentenceBreak > CHUNK_TARGET_CHARS * 0.55
        ? sentenceBreak + 2
        : window.length;
    const end = Math.min(cursor + softBreak, normalized.length);
    const chunk = normalized.slice(cursor, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }
    if (end >= normalized.length) {
      break;
    }
    cursor = Math.max(end - CHUNK_OVERLAP_CHARS, cursor + 1);
  }

  return chunks;
}

export async function indexKnowledgeItem(
  db: PaperLabDatabase,
  itemId: string,
  embeddingSettings: ModelEndpointSettings
): Promise<KnowledgeChunkRecord[]> {
  const item = db.getKnowledgeItem(itemId);
  if (!item) {
    throw new Error(`Knowledge item not found: ${itemId}`);
  }

  const chunks = chunkKnowledgeText(item.content);
  if (chunks.length === 0) {
    return db.replaceKnowledgeChunks(itemId, []);
  }

  try {
    const embeddings = await embedTexts(embeddingSettings, chunks);
    return db.replaceKnowledgeChunks(
      itemId,
      chunks.map((content, index) => ({
        content,
        embedding: embeddings[index],
        embeddingModel: embeddingSettings.model
      }))
    );
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    db.markKnowledgeItemIndexError(itemId, message);
    throw caught;
  }
}

export async function retrieveKnowledgeSources(
  db: PaperLabDatabase,
  embeddingSettings: ModelEndpointSettings,
  query: string,
  options: {
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
    maxChunks?: number;
  } = {}
): Promise<RetrievedKnowledgeSource[]> {
  if (!query.trim()) {
    return [];
  }
  const [embedding] = await embedTexts(embeddingSettings, [query]);
  return db
    .searchKnowledgeChunks({
      embedding,
      excludedItemIds: options.excludedItemIds,
      excludedChunkIds: options.excludedChunkIds,
      maxChunks: options.maxChunks
    })
    .map((chunk, index) => toRetrievedSource(chunk, index));
}

export function formatSourcesForPrompt(sources: RetrievedKnowledgeSource[]): string {
  if (sources.length === 0) {
    return '';
  }

  return [
    'Retrieved knowledge sources:',
    ...sources.map((source) =>
      [
        `${source.label} ${source.itemTitle}`,
        `Relevance: ${source.score.toFixed(3)}`,
        source.snippet
      ].join('\n')
    ),
    '',
    'Use these sources when they are relevant. Cite source-backed claims inline with the source label, for example [S1]. Do not invent citations and do not cite sources you did not use.'
  ].join('\n\n');
}

async function embedTexts(settings: ModelEndpointSettings, texts: string[]): Promise<number[][]> {
  if (!settings.apiKey.trim()) {
    throw new Error('Embedding API key is required. Add it in Settings first.');
  }
  if (settings.provider !== 'openai-compatible') {
    throw new Error('Knowledge embeddings currently require an OpenAI-compatible embedding endpoint.');
  }

  const embeddings: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    embeddings.push(...await embedTextBatch(settings, batch));
  }

  return embeddings;
}

async function embedTextBatch(settings: ModelEndpointSettings, texts: string[]): Promise<number[][]> {
  const response = await fetch(`${settings.baseURL.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.model,
      input: texts
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Embedding request failed (${response.status}): ${body.slice(0, 240)}`);
  }

  const parsed = await response.json() as {
    data?: Array<{ index?: number; embedding?: unknown }>;
  };
  const embeddings = new Array<number[]>(texts.length);
  parsed.data?.forEach((item, fallbackIndex) => {
    const index = item.index ?? fallbackIndex;
    embeddings[index] = Array.isArray(item.embedding)
      ? item.embedding.filter((value): value is number => typeof value === 'number')
      : [];
  });

  if (embeddings.some((embedding) => !embedding || embedding.length === 0)) {
    throw new Error('Embedding response did not include an embedding for every chunk.');
  }
  return embeddings;
}

function toRetrievedSource(chunk: KnowledgeChunkRecord, index: number): RetrievedKnowledgeSource {
  return {
    label: `[S${index + 1}]`,
    itemId: chunk.itemId,
    itemTitle: chunk.itemTitle,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex,
    snippet: chunk.content,
    score: chunk.score ?? 0
  };
}
