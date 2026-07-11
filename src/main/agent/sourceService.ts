import type {
  KnowledgeChunkRecord,
  ModelEndpointSettings,
  RerankEndpointSettings
} from '../../shared/types.js';
import { assertOutboundDataAllowed, type OutboundDataPolicySnapshot } from '../llmSettings.js';

const DEFAULT_MAX_RESULTS = 8;
const DEFAULT_MAX_CANDIDATES = 24;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 15_000;
const DEFAULT_RERANK_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 45_000;
const MAX_QUERY_CHARS = 1_200;
const MAX_SNIPPET_CHARS = 900;
const RRF_K = 60;

export type SourceToolFailureCategory =
  | 'tool_policy_denied'
  | 'embedding_configuration'
  | 'embedding_timeout'
  | 'embedding_transport'
  | 'local_search_failure'
  | 'rerank_timeout'
  | 'rerank_transport'
  | 'retrieval_timeout'
  | 'canceled';

export class SourceToolError extends Error {
  constructor(
    readonly category: SourceToolFailureCategory,
    readonly retryable: boolean,
    message: string
  ) {
    super(message);
    this.name = 'SourceToolError';
  }
}

export type SourceEvidence = {
  itemId: string;
  chunkId: string;
  publicRef: string;
  itemPublicRef: string;
  title: string;
  snippet: string;
  score: number;
  retrievalMethod: 'hybrid' | 'reranked';
  retrievalReason: string;
};

export type SourceSearchDatabase = {
  searchKnowledgeChunks(options: {
    embedding: number[];
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
    maxChunks?: number;
  }): KnowledgeChunkRecord[];
  searchKnowledgeChunksByText(options: {
    query: string;
    excludedItemIds?: string[];
    excludedChunkIds?: string[];
    maxChunks?: number;
  }): KnowledgeChunkRecord[];
};

export type SourceSearchOptions = {
  query: string;
  embedding: ModelEndpointSettings;
  rerank?: RerankEndpointSettings;
  outboundDataPolicy: OutboundDataPolicySnapshot;
  excludedItemIds?: string[];
  excludedChunkIds?: string[];
  maxResults?: number;
  abortSignal?: AbortSignal;
  onStage?: (stage: 'embedding' | 'local_search' | 'rerank') => void;
};

type SourceSearchDependencies = {
  embedQuery?: (settings: ModelEndpointSettings, query: string, signal: AbortSignal) => Promise<number[]>;
  rerank?: (input: {
    settings: RerankEndpointSettings;
    query: string;
    candidates: RankedCandidate[];
    signal: AbortSignal;
  }) => Promise<RankedCandidate[]>;
  embeddingTimeoutMs?: number;
  rerankTimeoutMs?: number;
  totalTimeoutMs?: number;
};

type RankedCandidate = {
  chunk: KnowledgeChunkRecord;
  score: number;
  vectorRank?: number;
  textRank?: number;
};

export async function searchIndexedSources(
  db: SourceSearchDatabase,
  options: SourceSearchOptions,
  dependencies: SourceSearchDependencies = {}
): Promise<SourceEvidence[]> {
  const query = validateQuery(options.query);
  const maxResults = clampInteger(options.maxResults, 1, DEFAULT_MAX_RESULTS, DEFAULT_MAX_RESULTS);
  const totalSignal = combineSignal(options.abortSignal, dependencies.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS);
  try {
    ensureActive(totalSignal);
    options.onStage?.('embedding');
    assertPolicy(options.embedding.baseURL, 'embedding', options.outboundDataPolicy);
    const embedding = await runWithDeadline(
      totalSignal.signal,
      dependencies.embeddingTimeoutMs ?? DEFAULT_EMBEDDING_TIMEOUT_MS,
      'embedding_timeout',
      (signal) => (dependencies.embedQuery ?? embedQuery)(options.embedding, query, signal)
    );

    options.onStage?.('local_search');
    let candidates: RankedCandidate[];
    try {
      throwIfAborted(totalSignal.signal);
      candidates = fuseCandidates(
        db.searchKnowledgeChunks({
          embedding,
          excludedItemIds: options.excludedItemIds,
          excludedChunkIds: options.excludedChunkIds,
          maxChunks: DEFAULT_MAX_CANDIDATES
        }),
        db.searchKnowledgeChunksByText({
          query,
          excludedItemIds: options.excludedItemIds,
          excludedChunkIds: options.excludedChunkIds,
          maxChunks: DEFAULT_MAX_CANDIDATES
        })
      );
    } catch (caught) {
      throw classifyLocalSearchFailure(caught, totalSignal.signal);
    }

    if (options.rerank?.enabled && options.rerank.apiKey.trim() && candidates.length > 1) {
      options.onStage?.('rerank');
      assertPolicy(options.rerank.baseURL, 'rerank', options.outboundDataPolicy);
      candidates = await runWithDeadline(
        totalSignal.signal,
        dependencies.rerankTimeoutMs ?? DEFAULT_RERANK_TIMEOUT_MS,
        'rerank_timeout',
        (signal) => (dependencies.rerank ?? rerankCandidates)({
          settings: options.rerank!,
          query,
          candidates,
          signal
        })
      );
      return candidates.slice(0, maxResults).map((candidate, index) => toEvidence(candidate, index, 'reranked'));
    }

    return candidates.slice(0, maxResults).map((candidate, index) => toEvidence(candidate, index, 'hybrid'));
  } catch (caught) {
    throw classifySourceFailure(caught, totalSignal);
  }
}

async function embedQuery(
  settings: ModelEndpointSettings,
  query: string,
  signal: AbortSignal
): Promise<number[]> {
  if (settings.provider !== 'openai-compatible' && settings.provider !== 'deepseek') {
    throw new SourceToolError(
      'embedding_configuration',
      false,
      'RAG requires an OpenAI-compatible embedding endpoint. Configure one before searching indexed sources.'
    );
  }
  if (!settings.model.trim()) {
    throw new SourceToolError('embedding_configuration', false, 'An embedding model is required before searching indexed sources.');
  }
  if (!settings.apiKey.trim()) {
    throw new SourceToolError('embedding_configuration', false, 'An embedding API key is required before searching indexed sources.');
  }
  const endpoint = `${settings.baseURL.trim().replace(/\/+$/, '')}/embeddings`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model: settings.model, input: query }),
      signal
    });
  } catch (caught) {
    throw classifyNetworkFailure(caught, 'embedding_transport', signal);
  }
  if (!response.ok) {
    throw new SourceToolError('embedding_transport', response.status >= 500 || response.status === 429, `Embedding request failed (${response.status}).`);
  }
  const payload = await response.json() as { data?: Array<{ embedding?: unknown }> };
  const embedding = payload.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0 || embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    throw new SourceToolError('embedding_transport', false, 'Embedding response did not contain a valid query vector.');
  }
  return embedding;
}

async function rerankCandidates(input: {
  settings: RerankEndpointSettings;
  query: string;
  candidates: RankedCandidate[];
  signal: AbortSignal;
}): Promise<RankedCandidate[]> {
  const endpoint = `${input.settings.baseURL.trim().replace(/\/+$/, '')}/rerank`;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.settings.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: input.settings.model,
        query: input.query,
        documents: input.candidates.map((candidate) => candidate.chunk.content),
        return_documents: false,
        top_n: input.candidates.length
      }),
      signal: input.signal
    });
  } catch (caught) {
    throw classifyNetworkFailure(caught, 'rerank_transport', input.signal);
  }
  if (!response.ok) {
    throw new SourceToolError('rerank_transport', response.status >= 500 || response.status === 429, `Rerank request failed (${response.status}).`);
  }
  const payload = await response.json() as { results?: Array<{ index?: unknown; relevance_score?: unknown }> };
  const results = payload.results ?? [];
  const ranked = new Map<number, number>();
  for (const result of results) {
    if (typeof result.index === 'number' && Number.isInteger(result.index) && result.index >= 0 && result.index < input.candidates.length && typeof result.relevance_score === 'number' && Number.isFinite(result.relevance_score)) {
      ranked.set(result.index, result.relevance_score);
    }
  }
  if (ranked.size === 0) {
    return input.candidates;
  }
  return input.candidates
    .map((candidate, index) => ({ candidate, rerankScore: ranked.get(index) ?? Number.NEGATIVE_INFINITY }))
    .sort((left, right) => right.rerankScore - left.rerankScore || right.candidate.score - left.candidate.score)
    .map(({ candidate, rerankScore }) => ({ ...candidate, score: Number.isFinite(rerankScore) ? rerankScore : candidate.score }));
}

function fuseCandidates(vector: KnowledgeChunkRecord[], text: KnowledgeChunkRecord[]): RankedCandidate[] {
  const candidates = new Map<string, RankedCandidate>();
  vector.forEach((chunk, index) => addCandidate(candidates, chunk, 'vectorRank', index));
  text.forEach((chunk, index) => addCandidate(candidates, chunk, 'textRank', index));
  return [...candidates.values()].sort((left, right) => right.score - left.score || left.chunk.publicRef.localeCompare(right.chunk.publicRef));
}

function addCandidate(
  candidates: Map<string, RankedCandidate>,
  chunk: KnowledgeChunkRecord,
  rankField: 'vectorRank' | 'textRank',
  index: number
): void {
  const existing = candidates.get(chunk.id) ?? { chunk, score: 0 };
  existing[rankField] = index + 1;
  existing.score += 1 / (RRF_K + index + 1);
  candidates.set(chunk.id, existing);
}

function toEvidence(candidate: RankedCandidate, index: number, retrievalMethod: SourceEvidence['retrievalMethod']): SourceEvidence {
  const methods = [candidate.vectorRank ? 'vector' : null, candidate.textRank ? 'full-text' : null].filter(Boolean).join(' + ');
  return {
    itemId: candidate.chunk.itemId,
    chunkId: candidate.chunk.id,
    publicRef: candidate.chunk.publicRef,
    itemPublicRef: candidate.chunk.itemPublicRef,
    title: candidate.chunk.itemTitle,
    snippet: boundedSnippet(candidate.chunk.content),
    score: Number(candidate.score.toFixed(6)),
    retrievalMethod,
    retrievalReason: retrievalMethod === 'reranked'
      ? `Rank ${index + 1} after reranking ${methods || 'hybrid'} evidence.`
      : `Rank ${index + 1} from ${methods || 'hybrid'} evidence fusion.`
  };
}

function validateQuery(value: string): string {
  const query = value.replace(/\s+/g, ' ').trim();
  if (!query) {
    throw new SourceToolError('tool_policy_denied', false, 'The source query must not be blank.');
  }
  if (query.length > MAX_QUERY_CHARS) {
    throw new SourceToolError('tool_policy_denied', false, `The source query must be at most ${MAX_QUERY_CHARS} characters.`);
  }
  return query;
}

function boundedSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > MAX_SNIPPET_CHARS ? `${normalized.slice(0, MAX_SNIPPET_CHARS - 1).trimEnd()}…` : normalized;
}

function assertPolicy(
  endpoint: string,
  operation: 'embedding' | 'rerank',
  policy: OutboundDataPolicySnapshot | undefined
): void {
  try {
    assertOutboundDataAllowed(endpoint, operation, policy);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    throw new SourceToolError('tool_policy_denied', false, message);
  }
}

async function runWithDeadline<T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  timeoutCategory: Extract<SourceToolFailureCategory, 'embedding_timeout' | 'rerank_timeout'>,
  action: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = AbortSignal.any([parentSignal, timeoutSignal]);
  try {
    return await action(signal);
  } catch (caught) {
    if (timeoutSignal.aborted && !parentSignal.aborted) {
      throw new SourceToolError(timeoutCategory, true, `${timeoutCategory === 'embedding_timeout' ? 'Embedding' : 'Rerank'} timed out.`);
    }
    throw caught;
  }
}

function combineSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): { signal: AbortSignal; totalTimeout: AbortSignal } {
  const totalTimeout = AbortSignal.timeout(timeoutMs);
  return {
    signal: parentSignal ? AbortSignal.any([parentSignal, totalTimeout]) : totalTimeout,
    totalTimeout
  };
}

function classifySourceFailure(caught: unknown, signals: { signal: AbortSignal; totalTimeout: AbortSignal }): SourceToolError {
  if (signals.totalTimeout.aborted) {
    return new SourceToolError('retrieval_timeout', true, 'Source retrieval exceeded its total time budget.');
  }
  if (caught instanceof SourceToolError) {
    return caught;
  }
  if (signals.signal.aborted) {
    return new SourceToolError('canceled', false, 'Source retrieval was canceled.');
  }
  const message = caught instanceof Error ? caught.message : String(caught);
  return new SourceToolError('local_search_failure', true, `Local source search failed: ${message}`);
}

function ensureActive(signals: { signal: AbortSignal; totalTimeout: AbortSignal }): void {
  if (signals.totalTimeout.aborted) {
    throw new SourceToolError('retrieval_timeout', true, 'Source retrieval exceeded its total time budget.');
  }
  throwIfAborted(signals.signal);
}

function classifyLocalSearchFailure(caught: unknown, signal: AbortSignal): SourceToolError {
  if (signal.aborted) {
    return new SourceToolError('canceled', false, 'Source retrieval was canceled.');
  }
  const message = caught instanceof Error ? caught.message : String(caught);
  return new SourceToolError('local_search_failure', true, `Local source search failed: ${message}`);
}

function classifyNetworkFailure(caught: unknown, category: 'embedding_transport' | 'rerank_transport', signal: AbortSignal): SourceToolError {
  if (signal.aborted) {
    return new SourceToolError('canceled', false, 'Source retrieval was canceled.');
  }
  const message = caught instanceof Error ? caught.message : String(caught);
  return new SourceToolError(category, true, `${category === 'embedding_transport' ? 'Embedding' : 'Rerank'} request failed: ${message}`);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new SourceToolError('canceled', false, 'Source retrieval was canceled.');
  }
}

function clampInteger(value: number | undefined, minimum: number, maximum: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value!)));
}
