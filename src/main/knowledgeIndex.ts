import type {
  KnowledgeChunkRecord,
  KnowledgeChunkingDebugConfig,
  ModelEndpointSettings,
  RetrievedKnowledgeSource
} from '../shared/types.js';
import type { PaperLabDatabase } from './database.js';
import { generateLlmText } from './llmRunner.js';

const CHUNK_TARGET_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 180;
const EMBEDDING_BATCH_SIZE = 64;
const METADATA_SAMPLE_CHARS = 1000;
const METADATA_TITLE_MAX_CHARS = 140;
const METADATA_DESCRIPTION_MAX_CHARS = 320;
const DISPLAY_METADATA_KEY = 'knowledgeDisplayMetadata';

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
  embeddingSettings: ModelEndpointSettings,
  metadataSettings?: ModelEndpointSettings
): Promise<KnowledgeChunkRecord[]> {
  const item = db.getKnowledgeItem(itemId);
  if (!item) {
    throw new Error(`Knowledge item not found: ${itemId}`);
  }

  const chunks = chunkKnowledgeText(item.content);
  if (chunks.length === 0) {
    return db.replaceKnowledgeChunks(itemId, []);
  }

  await extractAndStoreKnowledgeDisplayMetadata(db, item.id, metadataSettings, item.content, {
    replaceExisting: false,
    source: 'indexed-content'
  });

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

export async function extractAndStoreKnowledgeDisplayMetadata(
  db: PaperLabDatabase,
  itemId: string,
  settings: ModelEndpointSettings | undefined,
  content: string,
  options: {
    replaceExisting?: boolean;
    source?: string;
  } = {}
): Promise<void> {
  if (!settings || !settings.apiKey.trim()) {
    return;
  }

  const item = db.getKnowledgeItem(itemId);
  if (!item) {
    return;
  }
  if (!options.replaceExisting && hasKnowledgeDisplayMetadata(item.metadata)) {
    return;
  }

  const sample = content.trim().slice(0, METADATA_SAMPLE_CHARS);
  if (!sample) {
    return;
  }

  try {
    const extracted = await extractKnowledgeMetadata(settings, sample);
    if (!extracted.title && !extracted.description) {
      return;
    }
    const latestItem = db.getKnowledgeItem(itemId);
    if (!latestItem) {
      return;
    }
    const latestMetadata = latestItem.metadata;
    if (!options.replaceExisting && hasKnowledgeDisplayMetadata(latestMetadata)) {
      return;
    }
    const metadata = {
      ...latestMetadata,
      [DISPLAY_METADATA_KEY]: {
        title: extracted.title || latestItem.title,
        description: extracted.description,
        model: settings.model,
        sampleChars: sample.length,
        source: options.source ?? 'content-sample',
        extractedAt: new Date().toISOString()
      }
    };
    db.updateKnowledgeItemMetadata(itemId, metadata);
  } catch {
    // Metadata improves source display, but indexing should still succeed when it fails.
  }
}

function hasKnowledgeDisplayMetadata(metadata: Record<string, unknown>): boolean {
  const value = metadata[DISPLAY_METADATA_KEY];
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.title === 'string' || typeof record.description === 'string';
}

async function extractKnowledgeMetadata(
  settings: ModelEndpointSettings,
  sample: string
): Promise<{ title: string; description: string }> {
  const text = await generateLlmText(settings, {
    systemPrompt: [
      'You extract display metadata for knowledge base articles.',
      'Return only a JSON object with string fields "title" and "description".',
      'Infer the article title from the text. If the title is not explicit, write a concise descriptive title.',
      'Write the description as one short sentence in the same language as the source text when possible.',
      'Do not include markdown, citations, or extra commentary.'
    ].join(' '),
    prompt: [
      'Extract metadata from the first 1000 characters of this source text.',
      'JSON shape: {"title":"...","description":"..."}',
      '',
      sample
    ].join('\n')
  });

  const parsed = parseMetadataJson(text);
  return {
    title: cleanMetadataText(parsed.title, METADATA_TITLE_MAX_CHARS),
    description: cleanMetadataText(parsed.description, METADATA_DESCRIPTION_MAX_CHARS)
  };
}

function parseMetadataJson(text: string): { title?: unknown; description?: unknown } {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  const direct = tryParseMetadataJson(trimmed);
  if (direct) {
    return direct;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const extracted = tryParseMetadataJson(trimmed.slice(start, end + 1));
    if (extracted) {
      return extracted;
    }
  }

  return {};
}

function tryParseMetadataJson(text: string): { title?: unknown; description?: unknown } | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object'
      ? parsed as { title?: unknown; description?: unknown }
      : null;
  } catch {
    return null;
  }
}

function cleanMetadataText(value: unknown, maxChars: number): string {
  if (typeof value !== 'string') {
    return '';
  }
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 3).trimEnd()}...` : normalized;
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
    .map((chunk) => toRetrievedSource(chunk));
}

export function formatSourcesForPrompt(sources: RetrievedKnowledgeSource[]): string {
  if (sources.length === 0) {
    return '';
  }

  return [
    'Retrieved knowledge sources:',
    ...sources.map((source) =>
      [
        `[${source.publicRef}] ${source.itemTitle}`,
        `Relevance: ${source.score.toFixed(3)}`,
        source.snippet
      ].join('\n')
    ),
    '',
    'Use these sources when they are relevant. Cite source-backed claims inline with the source reference, for example [a3f91c8.c1]. Do not invent citations and do not cite sources you did not use.'
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

function toRetrievedSource(chunk: KnowledgeChunkRecord): RetrievedKnowledgeSource {
  return {
    label: `[${chunk.publicRef}]`,
    publicRef: chunk.publicRef,
    itemId: chunk.itemId,
    itemPublicRef: chunk.itemPublicRef,
    itemTitle: chunk.itemTitle,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex,
    snippet: chunk.content,
    score: chunk.score ?? 0
  };
}
