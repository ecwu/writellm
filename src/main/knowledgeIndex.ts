import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { embedMany } from 'ai';
import path from 'node:path';
import { z } from 'zod';
import type {
  KnowledgeChunkRecord,
  KnowledgeChunkingDebugConfig,
  ModelEndpointSettings,
  RetrievedKnowledgeSource
} from '../shared/types.js';
import type { PaperLabDatabase } from './database.js';
import { extractKnowledgeFileTextSample } from './knowledgeTextExtract.js';
import { generateLlmObject, generateLlmText } from './llmRunner.js';

const CHUNK_TARGET_CHARS = 700;
const CHUNK_OVERLAP_CHARS = 100;
const EMBEDDING_BATCH_SIZE = 64;
const EMBEDDING_BATCH_MAX_CHARS = 64000;
const METADATA_SAMPLE_CHARS = 1000;
const METADATA_TITLE_MAX_CHARS = 140;
const METADATA_DESCRIPTION_MAX_CHARS = 320;
const DISPLAY_METADATA_KEY = 'knowledgeDisplayMetadata';
const metadataResponseSchema = z.object({
  title: z.string().optional().default(''),
  description: z.string().optional().default('')
});

export function getKnowledgeChunkingDebugConfig(): KnowledgeChunkingDebugConfig {
  return {
    targetChars: CHUNK_TARGET_CHARS,
    overlapChars: CHUNK_OVERLAP_CHARS,
    embeddingBatchSize: EMBEDDING_BATCH_SIZE
  };
}

export async function chunkKnowledgeText(content: string): Promise<string[]> {
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return [];
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_TARGET_CHARS,
    chunkOverlap: CHUNK_OVERLAP_CHARS,
    separators: ['\n\n', '\n', '. ', '? ', '! ', ' ', '']
  });
  return (await splitter.splitText(normalized))
    .map((chunk) => chunk.trim())
    .filter(Boolean);
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

  const chunks = await chunkKnowledgeText(item.content);
  if (chunks.length === 0) {
    return db.replaceKnowledgeChunks(itemId, []);
  }

  await extractAndStoreKnowledgeItemDisplayMetadata(db, item.id, metadataSettings, {
    replaceExisting: false
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

export async function extractAndStoreKnowledgeItemDisplayMetadata(
  db: PaperLabDatabase,
  itemId: string,
  settings: ModelEndpointSettings | undefined,
  options: {
    replaceExisting?: boolean;
    source?: string;
  } = {}
): Promise<void> {
  if (!settings?.apiKey.trim()) {
    return;
  }

  try {
    const item = db.getKnowledgeItem(itemId);
    if (!item) {
      return;
    }
    if (!options.replaceExisting && hasCompleteKnowledgeDisplayMetadata(item.metadata)) {
      return;
    }

    const sample = await extractKnowledgeDisplayMetadataSample(item);
    await extractAndStoreKnowledgeDisplayMetadata(db, itemId, settings, sample.text, {
      replaceExisting: options.replaceExisting,
      source: options.source ?? sample.source
    });
  } catch (caught) {
    writeKnowledgeDisplayMetadataError(db, itemId, caught);
  }
}

async function extractKnowledgeDisplayMetadataSample(item: {
  content: string;
  metadata: Record<string, unknown>;
  sourceType: string;
}): Promise<{ text: string; source: string }> {
  const filePath = typeof item.metadata.sourcePath === 'string' ? item.metadata.sourcePath : '';
  const fileExt = typeof item.metadata.fileExt === 'string'
    ? item.metadata.fileExt
    : filePath
      ? path.extname(filePath).toLowerCase()
      : '';
  if (item.sourceType === 'file' && filePath && fileExt) {
    return {
      text: await extractKnowledgeFileTextSample(filePath, fileExt, METADATA_SAMPLE_CHARS),
      source: fileExt === '.pdf' ? 'pdfjs-file-sample' : 'file-sample'
    };
  }
  return {
    text: item.content.slice(0, METADATA_SAMPLE_CHARS),
    source: 'content-sample'
  };
}

async function extractAndStoreKnowledgeDisplayMetadata(
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
  if (!options.replaceExisting && hasCompleteKnowledgeDisplayMetadata(item.metadata)) {
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
    if (!options.replaceExisting && hasCompleteKnowledgeDisplayMetadata(latestMetadata)) {
      return;
    }
    const existingDisplayMetadata = readKnowledgeDisplayMetadata(latestMetadata);
    const metadata = {
      ...latestMetadata,
      [DISPLAY_METADATA_KEY]: {
        title: extracted.title || existingDisplayMetadata.title || latestItem.title,
        description: extracted.description || existingDisplayMetadata.description,
        model: settings.model,
        sampleChars: sample.length,
        source: options.source ?? 'content-sample',
        extractedAt: new Date().toISOString()
      }
    };
    db.updateKnowledgeItemMetadata(itemId, metadata);
  } catch (caught) {
    writeKnowledgeDisplayMetadataError(db, itemId, caught);
    // Metadata improves source display, but indexing should still succeed when it fails.
  }
}

function writeKnowledgeDisplayMetadataError(
  db: PaperLabDatabase,
  itemId: string,
  caught: unknown
): void {
  const latestItem = db.getKnowledgeItem(itemId);
  if (!latestItem) {
    return;
  }
  db.updateKnowledgeItemMetadata(itemId, {
    ...latestItem.metadata,
    knowledgeDisplayMetadataError: caught instanceof Error ? caught.message : String(caught)
  });
}

function hasCompleteKnowledgeDisplayMetadata(metadata: Record<string, unknown>): boolean {
  const displayMetadata = readKnowledgeDisplayMetadata(metadata);
  return Boolean(displayMetadata.title && displayMetadata.description);
}

function readKnowledgeDisplayMetadata(metadata: Record<string, unknown>): { title: string; description: string } {
  const value = metadata[DISPLAY_METADATA_KEY];
  if (!value || typeof value !== 'object') {
    return { title: '', description: '' };
  }
  const record = value as Record<string, unknown>;
  return {
    title: typeof record.title === 'string' ? record.title.trim() : '',
    description: typeof record.description === 'string' ? record.description.trim() : ''
  };
}

async function extractKnowledgeMetadata(
  settings: ModelEndpointSettings,
  sample: string
): Promise<{ title: string; description: string }> {
  const systemPrompt = [
    'You extract display metadata for knowledge base articles.',
    'Infer the article title from the text. If the title is not explicit, write a concise descriptive title.',
    'Write the description as one short sentence in the same language as the source text when possible.',
    'Do not include markdown, citations, or extra commentary.'
  ].join(' ');
  const prompt = [
    'Extract metadata from the first 1000 characters of this source text.',
    'JSON shape: {"title":"...","description":"..."}',
    '',
    sample
  ].join('\n');
  const parsed = await generateLlmObject(settings, {
    schema: metadataResponseSchema,
    systemPrompt,
    prompt
  }).catch(() => extractKnowledgeMetadataFromText(settings, systemPrompt, prompt));

  return {
    title: cleanMetadataText(parsed.title, METADATA_TITLE_MAX_CHARS),
    description: cleanMetadataText(parsed.description, METADATA_DESCRIPTION_MAX_CHARS)
  };
}

async function extractKnowledgeMetadataFromText(
  settings: ModelEndpointSettings,
  systemPrompt: string,
  prompt: string
): Promise<{ title: string; description: string }> {
  const text = await generateLlmText(settings, {
    systemPrompt,
    prompt: `${prompt}\n\nReturn only valid JSON.`
  });
  return metadataResponseSchema.parse(parseJsonObject(text));
}

function parseJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced?.[1]?.trim() || trimmed;
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(raw.slice(start, end + 1));
    }
    throw new Error('LLM metadata response did not contain a JSON object.');
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

  const provider = createOpenAICompatible({
    name: 'knowledgeEmbeddings',
    baseURL: settings.baseURL,
    apiKey: settings.apiKey
  });
  const model = provider.embeddingModel(settings.model);
  const embeddings: number[][] = [];
  const embedBatch = async (batch: string[]): Promise<number[][]> => {
    try {
      const result = await embedMany({
        model,
        values: batch,
        maxRetries: 0
      });
      return result.embeddings.map((embedding) => [...embedding]);
    } catch (caught) {
      if (batch.length > 1 && isRequestEntityTooLargeError(caught)) {
        const midpoint = Math.ceil(batch.length / 2);
        return [
          ...(await embedBatch(batch.slice(0, midpoint))),
          ...(await embedBatch(batch.slice(midpoint)))
        ];
      }
      throw caught;
    }
  };

  for (const batch of batchEmbeddingTexts(texts)) {
    embeddings.push(...await embedBatch(batch));
  }

  if (embeddings.some((embedding) => !embedding || embedding.length === 0)) {
    throw new Error('Embedding response did not include an embedding for every chunk.');
  }
  if (embeddings.length !== texts.length) {
    throw new Error('Embedding response did not include an embedding for every chunk.');
  }
  return embeddings;
}

function batchEmbeddingTexts(texts: string[]): string[][] {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentChars = 0;
  for (const text of texts) {
    const wouldExceedCount = currentBatch.length >= EMBEDDING_BATCH_SIZE;
    const wouldExceedChars = currentBatch.length > 0 && currentChars + text.length > EMBEDDING_BATCH_MAX_CHARS;
    if (wouldExceedCount || wouldExceedChars) {
      batches.push(currentBatch);
      currentBatch = [];
      currentChars = 0;
    }
    currentBatch.push(text);
    currentChars += text.length;
  }
  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }
  return batches;
}

function isRequestEntityTooLargeError(caught: unknown): boolean {
  if (!caught || typeof caught !== 'object') {
    return false;
  }
  const error = caught as Record<string, unknown>;
  return error.statusCode === 413 ||
    error.status === 413 ||
    String(error.message ?? '').toLowerCase().includes('request entity too large');
}

function toRetrievedSource(chunk: KnowledgeChunkRecord): RetrievedKnowledgeSource {
  return {
    label: `[${chunk.publicRef}]`,
    publicRef: chunk.publicRef,
    itemId: chunk.itemId,
    itemPublicRef: chunk.itemPublicRef,
    itemTitle: chunk.itemTitle,
    itemDescription: chunk.itemDescription,
    chunkId: chunk.id,
    chunkIndex: chunk.chunkIndex,
    snippet: chunk.content,
    score: chunk.score ?? 0
  };
}
