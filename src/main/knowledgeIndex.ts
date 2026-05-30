import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { embedMany } from 'ai';
import path from 'node:path';
import { z } from 'zod';
import type {
  KnowledgeChunkRecord,
  KnowledgeChunkingDebugConfig,
  KnowledgeRetrievalTraceEvent,
  KnowledgeRetrievalSettings,
  ModelEndpointSettings,
  RerankEndpointSettings,
  RetrievedKnowledgeSource
} from '../shared/types.js';
import type { WriteLLMDatabase } from './database.js';
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
const SOURCE_V2_MAX_ROUNDS = 3;
const SOURCE_V2_MAX_NEXT_QUERIES = 2;
const SOURCE_V2_DUPLICATE_RATIO_STOP = 0.8;
const SOURCE_V2_MAX_ROUND_CANDIDATES = 40;
const SOURCE_V2_EVALUATION_CANDIDATES = 40;
const SOURCE_V2_EVALUATION_SNIPPET_CHARS = 420;
const SOURCE_V2_TRACE_SNIPPET_CHARS = 220;
const SOURCE_V2_EVALUATION_TIMEOUT_MS = 60000;
const SOURCE_V2_EVALUATION_MAX_OUTPUT_TOKENS = 2048;
const METADATA_SAMPLE_CHARS = 1000;
const METADATA_TITLE_MAX_CHARS = 140;
const METADATA_DESCRIPTION_MAX_CHARS = 320;
const DISPLAY_METADATA_KEY = 'knowledgeDisplayMetadata';
const metadataResponseSchema = z.object({
  title: z.string().optional().default(''),
  description: z.string().optional().default('')
});
const sourceV2EvaluationSchema = z.object({
  decision: z.enum(['continue', 'stop']).default('stop'),
  reason: z.string().optional().default(''),
  selectedChunkIds: z.array(z.string()).optional().default([]),
  missingEvidence: z.array(z.string()).optional().default([]),
  nextQueries: z.array(z.string()).optional().default([])
});

const DEFAULT_RETRIEVAL_SETTINGS: KnowledgeRetrievalSettings = {
  maxRetrievedChunks: DEFAULT_MAX_RETRIEVED_CHUNKS,
  maxCandidateChunks: DEFAULT_CANDIDATE_CHUNKS,
  rerankTopN: DEFAULT_MAX_RETRIEVED_CHUNKS * 3,
  adjacentChunkRadius: ADJACENT_CHUNK_RADIUS,
  maxChunksPerItem: MAX_INITIAL_CHUNKS_PER_ITEM,
  chunkTargetChars: CHUNK_TARGET_CHARS,
  chunkOverlapChars: CHUNK_OVERLAP_CHARS,
  embeddingBatchSize: EMBEDDING_BATCH_SIZE
};

export function getKnowledgeChunkingDebugConfig(
  retrievalSettings?: KnowledgeRetrievalSettings
): KnowledgeChunkingDebugConfig {
  const settings = resolveRetrievalSettings(retrievalSettings);
  return {
    targetChars: settings.chunkTargetChars,
    overlapChars: settings.chunkOverlapChars,
    embeddingBatchSize: settings.embeddingBatchSize
  };
}

export async function chunkKnowledgeText(
  content: string,
  retrievalSettings?: KnowledgeRetrievalSettings
): Promise<string[]> {
  const settings = resolveRetrievalSettings(retrievalSettings);
  const normalized = content
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return [];
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: settings.chunkTargetChars,
    chunkOverlap: settings.chunkOverlapChars,
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

function resolveRetrievalSettings(
  settings?: KnowledgeRetrievalSettings
): KnowledgeRetrievalSettings {
  if (!settings) {
    return DEFAULT_RETRIEVAL_SETTINGS;
  }
  const maxRetrievedChunks = clampInteger(settings.maxRetrievedChunks, 1, 20);
  const maxCandidateChunks = Math.max(
    maxRetrievedChunks,
    clampInteger(settings.maxCandidateChunks, 1, 80)
  );
  const chunkTargetChars = clampInteger(settings.chunkTargetChars, 200, 3000);
  return {
    maxRetrievedChunks,
    maxCandidateChunks,
    rerankTopN: clampInteger(settings.rerankTopN, 1, 80),
    adjacentChunkRadius: clampInteger(settings.adjacentChunkRadius, 0, 3),
    maxChunksPerItem: clampInteger(settings.maxChunksPerItem, 1, 20),
    chunkTargetChars,
    chunkOverlapChars: Math.min(
      clampInteger(settings.chunkOverlapChars, 0, 1000),
      chunkTargetChars - 1
    ),
    embeddingBatchSize: clampInteger(settings.embeddingBatchSize, 1, 256)
  };
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.trunc(value), max));
}

export async function indexKnowledgeItem(
  db: WriteLLMDatabase,
  itemId: string,
  embeddingSettings: ModelEndpointSettings,
  metadataSettings?: ModelEndpointSettings,
  retrievalSettings?: KnowledgeRetrievalSettings
): Promise<KnowledgeChunkRecord[]> {
  const item = db.getKnowledgeItem(itemId);
  if (!item) {
    throw new Error(`Knowledge item not found: ${itemId}`);
  }

  const resolvedRetrievalSettings = resolveRetrievalSettings(retrievalSettings);
  const chunks = await chunkKnowledgeText(item.content, resolvedRetrievalSettings);
  if (chunks.length === 0) {
    return db.replaceKnowledgeChunks(itemId, []);
  }

  await extractAndStoreKnowledgeItemDisplayMetadata(db, item.id, metadataSettings, {
    replaceExisting: false
  });

  try {
    const embeddings = await embedTexts(
      embeddingSettings,
      chunks,
      resolvedRetrievalSettings.embeddingBatchSize
    );
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
  db: WriteLLMDatabase,
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
  db: WriteLLMDatabase,
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
  db: WriteLLMDatabase,
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
    throw new Error('Assistant metadata response did not contain a JSON object.');
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
  db: WriteLLMDatabase,
  embeddingSettings: ModelEndpointSettings,
  query: string,
  options: {
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
    maxChunks?: number;
    maxChunkLimit?: number;
    maxCandidates?: number;
    queries?: string[];
    rerankSettings?: RerankEndpointSettings;
    retrievalSettings?: KnowledgeRetrievalSettings;
    abortSignal?: AbortSignal;
  } = {}
): Promise<RetrievedKnowledgeSource[]> {
  throwIfAborted(options.abortSignal);
  const queries = uniqueNonEmptyStrings([...(options.queries ?? []), query]);
  if (queries.length === 0) {
    return [];
  }
  const retrievalSettings = resolveRetrievalSettings(options.retrievalSettings);
  const maxChunkLimit = Math.max(1, Math.min(options.maxChunkLimit ?? 20, 80));
  const maxChunks = Math.max(1, Math.min(options.maxChunks ?? retrievalSettings.maxRetrievedChunks, maxChunkLimit));
  const maxCandidates = Math.max(
    maxChunks,
    Math.min(options.maxCandidates ?? retrievalSettings.maxCandidateChunks, 80)
  );
  const candidateMap = new Map<string, RetrievalCandidate>();
  const embeddings = await embedTexts(embeddingSettings, queries, retrievalSettings.embeddingBatchSize, options.abortSignal);

  queries.forEach((retrievalQuery, queryIndex) => {
    throwIfAborted(options.abortSignal);
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
  addAdjacentCandidates(
    candidateMap,
    db,
    fused.slice(0, Math.min(16, fused.length)),
    options,
    retrievalSettings.adjacentChunkRadius
  );
  const expanded = sortCandidates(candidateMap).slice(0, maxCandidates);
  const reranked = await rerankKnowledgeCandidates({
    settings: options.rerankSettings,
    query,
    candidates: expanded,
    maxChunks,
    topN: retrievalSettings.rerankTopN,
    abortSignal: options.abortSignal
  }).catch(() => expanded.slice(0, maxChunks));
  const diversified = diversifyCandidatesByItem(
    reranked,
    maxChunks,
    retrievalSettings.maxChunksPerItem
  );

  return diversified.map((candidate) => toRetrievedSource(candidate.chunk, {
    score: candidate.rerankScore ?? candidate.fusedScore,
    retrievalMethod: candidate.rerankScore === undefined ? candidate.retrievalMethod : 'reranked',
    rerankScore: candidate.rerankScore,
    retrievalReason: candidate.retrievalReason
  }));
}

export async function retrieveKnowledgeSourcesV2(
  db: WriteLLMDatabase,
  embeddingSettings: ModelEndpointSettings,
  chatSettings: ModelEndpointSettings,
  query: string,
  options: {
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
    maxChunks?: number;
    maxCandidates?: number;
    maxRounds?: number;
    queries?: string[];
    rerankSettings?: RerankEndpointSettings;
    retrievalSettings?: KnowledgeRetrievalSettings;
    runId?: string;
    onTrace?: (event: KnowledgeRetrievalTraceEvent) => void;
    abortSignal?: AbortSignal;
  } = {}
): Promise<RetrievedKnowledgeSource[]> {
  throwIfAborted(options.abortSignal);
  const retrievalSettings = resolveRetrievalSettings(options.retrievalSettings);
  const maxChunks = Math.max(1, Math.min(options.maxChunks ?? retrievalSettings.maxRetrievedChunks, 20));
  const maxCandidates = Math.max(
    maxChunks,
    Math.min(options.maxCandidates ?? retrievalSettings.maxCandidateChunks, 80)
  );
  const maxRoundCandidates = Math.min(
    maxCandidates,
    SOURCE_V2_MAX_ROUND_CANDIDATES,
    Math.max(maxChunks * 2, 12)
  );
  const maxRounds = clampInteger(options.maxRounds ?? SOURCE_V2_MAX_ROUNDS, 1, 5);
  const runId = options.runId ?? `sourcev2-${Date.now()}`;
  const trace = (event: KnowledgeRetrievalTraceEvent): void => {
    options.onTrace?.(event);
  };

  const initialQueries = uniqueNonEmptyStrings([...(options.queries ?? []), query]);
  if (initialQueries.length === 0) {
    return [];
  }

  trace({ type: 'started', runId, query, maxRounds });

  const allSources = new Map<string, RetrievedKnowledgeSource>();
  const selectedChunkIds = new Set<string>();
  const attemptedQueries = new Set<string>();
  let roundQueries = initialQueries;
  let stopReason = 'Reached maximum Source v2 retrieval rounds.';

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      throwIfAborted(options.abortSignal);
      roundQueries.forEach((roundQuery) => attemptedQueries.add(normalizeRetrievalQueryKey(roundQuery)));
      trace({ type: 'round_started', runId, round, queries: roundQueries });

      const roundSources = (await retrieveKnowledgeSources(db, embeddingSettings, query, {
        excludedItemIds: options.excludedItemIds,
        excludedChunkIds: options.excludedChunkIds,
        maxChunks: maxRoundCandidates,
        maxChunkLimit: 80,
        maxCandidates: maxRoundCandidates,
        queries: roundQueries,
        rerankSettings: undefined,
        retrievalSettings,
        abortSignal: options.abortSignal
      })).map((source) => ({
        ...source,
        sourceV2Round: source.sourceV2Round ?? round
      }));

      let newCount = 0;
      roundSources.forEach((source) => {
        if (!allSources.has(source.chunkId)) {
          newCount += 1;
          allSources.set(source.chunkId, source);
        }
      });

      trace({ type: 'round_candidates', runId, round, sources: sourcesForTrace(roundSources) });

      if (round > 1 && roundSources.length > 0) {
        const duplicateRatio = 1 - newCount / roundSources.length;
        if (duplicateRatio >= SOURCE_V2_DUPLICATE_RATIO_STOP) {
          stopReason = 'Stopped because the latest round mostly repeated earlier chunks.';
          break;
        }
      }
      if (round > 1 && newCount === 0) {
        stopReason = 'Stopped because the latest round found no new chunks.';
        break;
      }

      trace({
        type: 'round_evaluating',
        runId,
        round,
        candidateCount: Math.min(allSources.size, SOURCE_V2_EVALUATION_CANDIDATES)
      });
      const evaluation = await evaluateSourceV2Round(chatSettings, {
        query,
        round,
        maxChunks,
        sources: Array.from(allSources.values()),
        abortSignal: options.abortSignal
      });
      const validSelectedIds = evaluation.selectedChunkIds.filter((chunkId) => allSources.has(chunkId));
      validSelectedIds.forEach((chunkId) => selectedChunkIds.add(chunkId));
      const nextQueries = uniqueNonEmptyStrings(evaluation.nextQueries)
        .filter((nextQuery) => !attemptedQueries.has(normalizeRetrievalQueryKey(nextQuery)))
        .slice(0, SOURCE_V2_MAX_NEXT_QUERIES);

      trace({
        type: 'round_evaluation',
        runId,
        round,
        decision: evaluation.decision,
        reason: evaluation.reason,
        selectedChunkIds: validSelectedIds,
        missingEvidence: evaluation.missingEvidence,
        nextQueries
      });

      if (evaluation.decision === 'stop') {
        stopReason = evaluation.reason || 'Stopped after Source v2 evaluator judged the evidence sufficient.';
        break;
      }
      if (round >= maxRounds) {
        stopReason = evaluation.reason || stopReason;
        break;
      }
      if (nextQueries.length === 0) {
        stopReason = evaluation.reason || 'Stopped because Source v2 did not produce a new query.';
        break;
      }

      roundQueries = nextQueries;
    }
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    trace({ type: 'error', runId, message });
    const fallback = await retrieveKnowledgeSources(db, embeddingSettings, query, {
      excludedItemIds: options.excludedItemIds,
      excludedChunkIds: options.excludedChunkIds,
      maxChunks,
      maxCandidates,
      queries: initialQueries,
      rerankSettings: options.rerankSettings,
      retrievalSettings,
      abortSignal: options.abortSignal
    });
    trace({
      type: 'done',
      runId,
      sources: fallback,
      stopReason: `Source v2 failed: ${message}. Returned classic retrieval results.`
    });
    return fallback;
  }

  const finalSources = finalizeSourceV2Sources(
    Array.from(allSources.values()),
    selectedChunkIds,
    maxChunks,
    stopReason
  );
  trace({ type: 'done', runId, sources: finalSources, stopReason });
  return finalSources;
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

function normalizeRetrievalQueryKey(query: string): string {
  return query.replace(/\s+/g, ' ').trim().toLowerCase();
}

async function evaluateSourceV2Round(
  settings: ModelEndpointSettings,
  options: {
    query: string;
    round: number;
    maxChunks: number;
    sources: RetrievedKnowledgeSource[];
    abortSignal?: AbortSignal;
  }
): Promise<{
  decision: 'continue' | 'stop';
  reason: string;
  selectedChunkIds: string[];
  missingEvidence: string[];
  nextQueries: string[];
}> {
  const candidateSources = sortRetrievedSources(options.sources)
    .slice(0, SOURCE_V2_EVALUATION_CANDIDATES);
  const systemPrompt = buildSourceV2EvaluationSystemPrompt(options.maxChunks);
  const prompt = buildSourceV2EvaluationPrompt(options, candidateSources);
  const evaluatorSystemPrompt = [
    systemPrompt,
    'Return only one valid JSON object. Do not wrap it in markdown. Do not include commentary.'
  ].join('\n');
  const evaluatorPrompt = [
    prompt,
    '',
    'JSON shape:',
    '{"decision":"continue|stop","reason":"string","selectedChunkIds":["chunk id"],"missingEvidence":["string"],"nextQueries":["query"]}'
  ].join('\n');

  const text = await generateLlmText(settings, {
    systemPrompt: evaluatorSystemPrompt,
    prompt: evaluatorPrompt,
    maxOutputTokens: SOURCE_V2_EVALUATION_MAX_OUTPUT_TOKENS,
    timeoutMs: SOURCE_V2_EVALUATION_TIMEOUT_MS
  }, options.abortSignal);
  const rawJson = parseJsonObjectFromText(text);
  const parsed = sourceV2EvaluationSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new Error(`Source v2 evaluator did not return valid JSON: ${parsed.error.message}`);
  }
  return normalizeSourceV2EvaluationResult(parsed.data, candidateSources, options.maxChunks);
}

function parseJsonObjectFromText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Source v2 evaluator returned an empty response.');
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim());
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('Source v2 evaluator response did not contain a JSON object.');
  }
}

function buildSourceV2EvaluationSystemPrompt(maxChunks: number): string {
  return [
    'You are a retrieval planning agent.',
    'Assess whether the candidate chunks are sufficient evidence for the user request.',
    'Select only chunk IDs that are directly useful. If evidence is missing, produce precise follow-up search queries.',
    `Return at most ${maxChunks} selectedChunkIds and at most ${SOURCE_V2_MAX_NEXT_QUERIES} nextQueries.`
  ].join('\n');
}

function buildSourceV2EvaluationPrompt(
  options: {
    query: string;
    round: number;
    maxChunks: number;
  },
  candidateSources: RetrievedKnowledgeSource[]
): string {
  return [
    `User request:\n${options.query}`,
    `Retrieval round: ${options.round}`,
    `Final source budget: ${options.maxChunks} chunks`,
    'Candidate chunks:',
    ...candidateSources.map(formatSourceV2Candidate),
    '',
    'Return stop when the selected chunks are enough to answer with citations. Return continue only when concrete missing evidence remains.'
  ].join('\n\n');
}

function normalizeSourceV2EvaluationResult(
  result: z.infer<typeof sourceV2EvaluationSchema>,
  candidateSources: RetrievedKnowledgeSource[],
  maxChunks: number
): {
  decision: 'continue' | 'stop';
  reason: string;
  selectedChunkIds: string[];
  missingEvidence: string[];
  nextQueries: string[];
} {
  const selectedChunkIds = uniqueNonEmptyStrings(result.selectedChunkIds)
    .filter((chunkId) => candidateSources.some((source) => source.chunkId === chunkId))
    .slice(0, maxChunks);
  const nextQueries = uniqueNonEmptyStrings(result.nextQueries).slice(0, SOURCE_V2_MAX_NEXT_QUERIES);
  return {
    decision: result.decision,
    reason: result.reason.trim(),
    selectedChunkIds,
    missingEvidence: uniqueNonEmptyStrings(result.missingEvidence).slice(0, 6),
    nextQueries
  };
}

function formatSourceV2Candidate(source: RetrievedKnowledgeSource): string {
  return [
    `- chunkId: ${source.chunkId}`,
    `  ref: ${source.publicRef}`,
    `  title: ${source.itemTitle}`,
    `  round: ${source.sourceV2Round ?? 1}`,
    `  score: ${source.score.toFixed(3)}`,
    `  text: ${source.snippet.replace(/\s+/g, ' ').slice(0, SOURCE_V2_EVALUATION_SNIPPET_CHARS)}`
  ].join('\n');
}

function sourcesForTrace(sources: RetrievedKnowledgeSource[]): RetrievedKnowledgeSource[] {
  return sources.map((source) => ({
    ...source,
    snippet: source.snippet.replace(/\s+/g, ' ').slice(0, SOURCE_V2_TRACE_SNIPPET_CHARS)
  }));
}

function finalizeSourceV2Sources(
  sources: RetrievedKnowledgeSource[],
  selectedChunkIds: Set<string>,
  maxChunks: number,
  stopReason: string
): RetrievedKnowledgeSource[] {
  const sortedSources = sortRetrievedSources(sources);
  const selected = sortedSources.filter((source) => selectedChunkIds.has(source.chunkId));
  const fallback = sortedSources.filter((source) => !selectedChunkIds.has(source.chunkId));
  return [...selected, ...fallback]
    .slice(0, maxChunks)
    .map((source) => ({
      ...source,
      sourceV2Reason: selectedChunkIds.has(source.chunkId)
        ? stopReason
        : source.sourceV2Reason ?? 'Included by Source v2 fallback ranking.'
    }));
}

function sortRetrievedSources(sources: RetrievedKnowledgeSource[]): RetrievedKnowledgeSource[] {
  return [...sources].sort((left, right) =>
    right.score - left.score ||
    (left.sourceV2Round ?? 0) - (right.sourceV2Round ?? 0) ||
    left.publicRef.localeCompare(right.publicRef)
  );
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
  db: WriteLLMDatabase,
  seeds: RetrievalCandidate[],
  options: {
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
  },
  adjacentChunkRadius: number
): void {
  if (adjacentChunkRadius <= 0) {
    return;
  }
  const adjacentChunks = db.getAdjacentKnowledgeChunks(
    seeds.map((candidate) => ({
      itemId: candidate.chunk.itemId,
      chunkIndex: candidate.chunk.chunkIndex
    })),
    adjacentChunkRadius,
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
  topN: number;
  abortSignal?: AbortSignal;
}): Promise<RetrievalCandidate[]> {
  const { settings, query, candidates, maxChunks, topN } = options;
  if (!settings?.enabled || !settings.apiKey.trim() || candidates.length === 0 || !query.trim()) {
    return candidates.slice(0, maxChunks);
  }
  throwIfAborted(options.abortSignal);
  const endpoint = `${settings.baseURL.replace(/\/+$/, '')}/rerank`;
  const timeoutSignal = AbortSignal.timeout(15000);
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
      top_n: Math.min(candidates.length, Math.max(topN, maxChunks))
    }),
    signal: options.abortSignal ? AbortSignal.any([options.abortSignal, timeoutSignal]) : timeoutSignal
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

function diversifyCandidatesByItem(
  candidates: RetrievalCandidate[],
  maxChunks: number,
  maxChunksPerItem: number
): RetrievalCandidate[] {
  const selected: RetrievalCandidate[] = [];
  const selectedIds = new Set<string>();
  const itemCounts = new Map<string, number>();
  const initialLimit = Math.min(maxChunksPerItem, Math.max(1, Math.ceil(maxChunks / 2)));

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
    'Use these sources when they are relevant. Cite source-backed claims inline with the source reference, for example [a3f91c8.c1]. Use one citation per bracket: write [a3f91c8.c1] [b7e12aa.c2], not [a3f91c8.c1, b7e12aa.c2]. Do not invent citations and do not cite sources you did not use.'
  ].join('\n\n');
}

async function embedTexts(
  settings: ModelEndpointSettings,
  texts: string[],
  batchSize = EMBEDDING_BATCH_SIZE,
  abortSignal?: AbortSignal
): Promise<number[][]> {
  throwIfAborted(abortSignal);
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
        abortSignal,
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

  for (const batch of batchEmbeddingTexts(texts, batchSize)) {
    throwIfAborted(abortSignal);
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

function throwIfAborted(abortSignal?: AbortSignal): void {
  if (abortSignal?.aborted) {
    throw abortSignal.reason instanceof Error ? abortSignal.reason : new Error('Retrieval canceled.');
  }
}

function batchEmbeddingTexts(texts: string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentChars = 0;
  for (const text of texts) {
    const wouldExceedCount = currentBatch.length >= batchSize;
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
