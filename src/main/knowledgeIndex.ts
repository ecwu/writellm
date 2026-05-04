import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { embedMany } from 'ai';
import path from 'node:path';
import { z } from 'zod';
import type {
  KnowledgeChunkRecord,
  KnowledgeChunkingDebugConfig,
  ModelEndpointSettings,
  RerankEndpointSettings,
  RetrievedKnowledgeSource
} from '../shared/types.js';
import type { PaperLabDatabase } from './database.js';
import { extractKnowledgeFileTextSample } from './knowledgeTextExtract.js';
import { generateLlmObject, generateLlmText } from './llmRunner.js';

const CHUNK_TARGET_CHARS = 700;
const CHUNK_OVERLAP_CHARS = 100;
const EMBEDDING_BATCH_SIZE = 64;
const EMBEDDING_BATCH_MAX_CHARS = 64000;
const DEFAULT_MAX_RETRIEVED_CHUNKS = 10;
const DEFAULT_CANDIDATE_CHUNKS = 40;
const RRF_K = 60;
const ADJACENT_CHUNK_RADIUS = 1;
const MAX_INITIAL_CHUNKS_PER_ITEM = 3;
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
  return mergeIsolatedHeadingChunks(await splitter.splitText(normalized))
    .map((chunk) => chunk.trim())
    .filter(Boolean);
}

function mergeIsolatedHeadingChunks(chunks: string[]): string[] {
  const merged: string[] = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index].trim();
    if (!chunk) {
      continue;
    }
    const next = chunks[index + 1]?.trim();
    if (next && isIsolatedHeadingChunk(chunk)) {
      merged.push(`${chunk}\n\n${next}`);
      index += 1;
      continue;
    }
    merged.push(chunk);
  }
  return merged;
}

function isIsolatedHeadingChunk(chunk: string): boolean {
  const lines = chunk.split('\n').map((line) => line.trim()).filter(Boolean);
  return lines.length <= 2 &&
    chunk.length <= 140 &&
    lines.every((line) => /^#{1,6}\s+\S/.test(line) || /^[A-Z0-9][A-Z0-9\s:.,()/+-]{3,}$/.test(line));
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
    maxCandidates?: number;
    queries?: string[];
    rerankSettings?: RerankEndpointSettings;
  } = {}
): Promise<RetrievedKnowledgeSource[]> {
  const queries = uniqueNonEmptyStrings([...(options.queries ?? []), query]);
  if (queries.length === 0) {
    return [];
  }
  const maxChunks = Math.max(1, Math.min(options.maxChunks ?? DEFAULT_MAX_RETRIEVED_CHUNKS, 20));
  const maxCandidates = Math.max(maxChunks, Math.min(options.maxCandidates ?? DEFAULT_CANDIDATE_CHUNKS, 80));
  const candidateMap = new Map<string, RetrievalCandidate>();
  const embeddings = await embedTexts(embeddingSettings, queries);

  queries.forEach((retrievalQuery, queryIndex) => {
    addRankedCandidates(
      candidateMap,
      db.searchKnowledgeChunks({
        embedding: embeddings[queryIndex],
        excludedItemIds: options.excludedItemIds,
        excludedChunkIds: options.excludedChunkIds,
        maxChunks: maxCandidates
      }),
      'vector',
      queryIndex
    );
    addRankedCandidates(
      candidateMap,
      db.searchKnowledgeChunksByText({
        query: retrievalQuery,
        excludedItemIds: options.excludedItemIds,
        excludedChunkIds: options.excludedChunkIds,
        maxChunks: maxCandidates
      }),
      'fts',
      queryIndex
    );
  });

  const fused = sortCandidates(candidateMap).slice(0, maxCandidates);
  addAdjacentCandidates(candidateMap, db, fused.slice(0, Math.min(16, fused.length)), options);
  const expanded = sortCandidates(candidateMap).slice(0, maxCandidates);
  const reranked = await rerankKnowledgeCandidates({
    settings: options.rerankSettings,
    query,
    candidates: expanded,
    maxChunks
  }).catch(() => expanded.slice(0, maxChunks));
  const diversified = diversifyCandidatesByItem(reranked, maxChunks);

  return diversified.map((candidate) => toRetrievedSource(candidate.chunk, {
    score: candidate.rerankScore ?? candidate.fusedScore,
    retrievalMethod: candidate.rerankScore === undefined ? candidate.retrievalMethod : 'reranked',
    rerankScore: candidate.rerankScore,
    retrievalReason: candidate.retrievalReason
  }));
}

type RetrievalMethod = NonNullable<RetrievedKnowledgeSource['retrievalMethod']>;

type RetrievalCandidate = {
  chunk: KnowledgeChunkRecord;
  fusedScore: number;
  bestRawScore: number;
  retrievalMethod: RetrievalMethod;
  vectorHits: number;
  ftsHits: number;
  rerankScore?: number;
  retrievalReason?: string;
};

function uniqueNonEmptyStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

function addRankedCandidates(
  candidateMap: Map<string, RetrievalCandidate>,
  chunks: KnowledgeChunkRecord[],
  method: 'vector' | 'fts',
  queryIndex: number
): void {
  chunks.forEach((chunk, rank) => {
    const contribution = 1 / (RRF_K + rank + 1 + queryIndex);
    const current = candidateMap.get(chunk.id);
    if (!current) {
      candidateMap.set(chunk.id, {
        chunk,
        fusedScore: contribution,
        bestRawScore: chunk.score ?? 0,
        retrievalMethod: method,
        vectorHits: method === 'vector' ? 1 : 0,
        ftsHits: method === 'fts' ? 1 : 0
      });
      return;
    }
    current.fusedScore += contribution;
    current.bestRawScore = Math.max(current.bestRawScore, chunk.score ?? 0);
    current.vectorHits += method === 'vector' ? 1 : 0;
    current.ftsHits += method === 'fts' ? 1 : 0;
    current.retrievalMethod = current.vectorHits > 0 && current.ftsHits > 0 ? 'hybrid' : current.retrievalMethod;
  });
}

function sortCandidates(candidateMap: Map<string, RetrievalCandidate>): RetrievalCandidate[] {
  return [...candidateMap.values()].sort((left, right) =>
    right.fusedScore - left.fusedScore ||
    right.bestRawScore - left.bestRawScore ||
    left.chunk.publicRef.localeCompare(right.chunk.publicRef)
  );
}

function addAdjacentCandidates(
  candidateMap: Map<string, RetrievalCandidate>,
  db: PaperLabDatabase,
  seeds: RetrievalCandidate[],
  options: {
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
  }
): void {
  const adjacentChunks = db.getAdjacentKnowledgeChunks(
    seeds.map((candidate) => ({
      itemId: candidate.chunk.itemId,
      chunkIndex: candidate.chunk.chunkIndex
    })),
    ADJACENT_CHUNK_RADIUS,
    {
      excludedItemIds: options.excludedItemIds,
      excludedChunkIds: options.excludedChunkIds
    }
  );
  const seedScoreByItem = new Map<string, number>();
  seeds.forEach((candidate) => {
    seedScoreByItem.set(candidate.chunk.itemId, Math.max(seedScoreByItem.get(candidate.chunk.itemId) ?? 0, candidate.fusedScore));
  });
  adjacentChunks.forEach((chunk) => {
    if (candidateMap.has(chunk.id)) {
      return;
    }
    candidateMap.set(chunk.id, {
      chunk,
      fusedScore: (seedScoreByItem.get(chunk.itemId) ?? 0) * 0.82,
      bestRawScore: 0,
      retrievalMethod: 'hybrid',
      vectorHits: 0,
      ftsHits: 0,
      retrievalReason: 'Adjacent chunk added for local context.'
    });
  });
}

async function rerankKnowledgeCandidates(options: {
  settings?: RerankEndpointSettings;
  query: string;
  candidates: RetrievalCandidate[];
  maxChunks: number;
}): Promise<RetrievalCandidate[]> {
  const { settings, query, candidates, maxChunks } = options;
  if (!settings?.enabled || !settings.apiKey.trim() || candidates.length === 0 || !query.trim()) {
    return candidates.slice(0, maxChunks);
  }
  const endpoint = `${settings.baseURL.replace(/\/+$/, '')}/rerank`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.model,
      query,
      documents: candidates.map((candidate) => candidate.chunk.content),
      return_documents: false,
      top_n: Math.min(candidates.length, Math.max(maxChunks * 3, maxChunks))
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) {
    throw new Error(`Rerank request failed: ${response.status} ${response.statusText}`);
  }
  const parsed = await response.json() as unknown;
  const results = parseRerankResults(parsed);
  if (results.length === 0) {
    return candidates.slice(0, maxChunks);
  }
  const used = new Set<number>();
  const reranked: RetrievalCandidate[] = [];
  for (const result of results) {
    const candidate = candidates[result.index];
    if (!candidate || used.has(result.index)) {
      continue;
    }
    used.add(result.index);
    reranked.push({
      ...candidate,
      rerankScore: result.score,
      retrievalMethod: 'reranked',
      retrievalReason: 'Selected by SiliconFlow-compatible rerank.'
    });
  }
  return [
    ...reranked,
    ...candidates.filter((_candidate, index) => !used.has(index))
  ];
}

function diversifyCandidatesByItem(candidates: RetrievalCandidate[], maxChunks: number): RetrievalCandidate[] {
  const selected: RetrievalCandidate[] = [];
  const selectedIds = new Set<string>();
  const itemCounts = new Map<string, number>();
  const initialLimit = Math.min(MAX_INITIAL_CHUNKS_PER_ITEM, Math.max(1, Math.ceil(maxChunks / 2)));

  for (const candidate of candidates) {
    if (selected.length >= maxChunks) {
      break;
    }
    const count = itemCounts.get(candidate.chunk.itemId) ?? 0;
    if (count >= initialLimit) {
      continue;
    }
    selected.push(candidate);
    selectedIds.add(candidate.chunk.id);
    itemCounts.set(candidate.chunk.itemId, count + 1);
  }

  for (const candidate of candidates) {
    if (selected.length >= maxChunks) {
      break;
    }
    if (selectedIds.has(candidate.chunk.id)) {
      continue;
    }
    selected.push(candidate);
    selectedIds.add(candidate.chunk.id);
  }

  return selected;
}

function parseRerankResults(parsed: unknown): Array<{ index: number; score: number }> {
  if (!parsed || typeof parsed !== 'object') {
    return [];
  }
  const results = (parsed as Record<string, unknown>).results;
  if (!Array.isArray(results)) {
    return [];
  }
  return results
    .map((item) => {
      if (!item || typeof item !== 'object') {
        return null;
      }
      const record = item as Record<string, unknown>;
      const index = typeof record.index === 'number' ? record.index : -1;
      const score = typeof record.relevance_score === 'number'
        ? record.relevance_score
        : typeof record.relevanceScore === 'number'
          ? record.relevanceScore
          : 0;
      return Number.isInteger(index) && index >= 0 ? { index, score } : null;
    })
    .filter((result): result is { index: number; score: number } => Boolean(result))
    .sort((left, right) => right.score - left.score);
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

function toRetrievedSource(
  chunk: KnowledgeChunkRecord,
  overrides: Partial<Pick<RetrievedKnowledgeSource, 'score' | 'retrievalMethod' | 'rerankScore' | 'retrievalReason'>> = {}
): RetrievedKnowledgeSource {
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
    score: overrides.score ?? chunk.score ?? 0,
    retrievalMethod: overrides.retrievalMethod ?? chunk.retrievalMethod,
    rerankScore: overrides.rerankScore,
    retrievalReason: overrides.retrievalReason
  };
}
