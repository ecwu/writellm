import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import type { IndexCandidate } from '../../shared/contracts/indexing'
import type { RerankResult } from '../../shared/contracts/model-runtime'
import type { ProviderConfig } from '../../shared/contracts/providers'
import {
  citationExpansionResultSchema,
  citationIdSchema,
  knowledgeSearchInputSchema,
  knowledgeSearchResultSchema,
  type ExpandedCitation,
  type KnowledgeSearchHit,
  type KnowledgeSearchInput,
  type KnowledgeSearchResult
} from '../../shared/contracts/search'
import type { IndexClient } from './index-client'
import { embeddingContractSha256 } from './index-service'

interface RankedCandidate {
  candidate: IndexCandidate
  ftsRank: number | null
  vectorRank: number | null
  rrfScore: number
  rerankScore: number | null
}

export class RetrievalService {
  constructor(
    private readonly options: {
      projectId: string
      client: IndexClient
      getEmbeddingProvider: () => Promise<ProviderConfig>
      embedQuery: (
        query: string,
        expectedContractSha256: string,
        operationId: string,
        signal: AbortSignal,
        projectSessionId?: string
      ) => Promise<number[]>
      getRerankProvider: () => Promise<ProviderConfig>
      rerank: (
        query: string,
        documents: string[],
        topN: number,
        operationId: string,
        signal: AbortSignal,
        projectSessionId?: string
      ) => Promise<RerankResult>
      log: Pick<Logger, 'info' | 'warn' | 'error'>
    }
  ) {}

  async search(
    rawInput: KnowledgeSearchInput,
    signal: AbortSignal,
    options: { ftsMode?: 'phrase' | 'terms' } = {}
  ): Promise<KnowledgeSearchResult> {
    const input = knowledgeSearchInputSchema.parse(rawInput)
    if (signal.aborted) throw abortError()
    const operationId = randomUUID()
    const state = await this.options.client.retrievalState(signal)
    if (state.activeIndexGenerationId === null) {
      return knowledgeSearchResultSchema.parse({ mode: 'none', rerankStatus: 'disabled', hits: [] })
    }

    const ftsRaw = await this.options.client.ftsCandidates(
      input.query,
      input.limits.fts,
      input.filters,
      signal,
      options.ftsMode
    )
    const ftsHydrated = await this.options.client.hydrateCandidates(
      ftsRaw.map((candidate) => candidate.chunkId),
      input.filters,
      signal
    )
    const ftsAllowed = new Set(ftsHydrated.map((candidate) => candidate.chunkId))
    const ftsIds = ftsRaw
      .map((candidate) => candidate.chunkId)
      .filter((chunkId) => ftsAllowed.has(chunkId))

    let vectorHydrated: IndexCandidate[] = []
    let vectorIds: string[] = []
    let vectorAvailable = false
    const embeddingContract = state.activeEmbeddingContract
    if (embeddingContract !== null) {
      try {
        const configured = await this.options.getEmbeddingProvider()
        if (embeddingContractSha256(configured) !== embeddingContract.contractSha256) {
          throw new Error('Configured embedding provider is incompatible with the active index')
        }
        const vector = await this.options.embedQuery(
          input.query,
          embeddingContract.contractSha256,
          operationId,
          signal
        )
        if (vector.length !== embeddingContract.dimension) {
          throw new Error('Query embedding dimension is incompatible with the active index')
        }
        const vectorRaw = await this.options.client.queryVectors(
          embeddingContract.embeddingGenerationId,
          vector,
          input.limits.vector,
          input.filters,
          signal
        )
        vectorHydrated = await this.options.client.hydrateCandidates(
          vectorRaw.map((candidate) => candidate.chunkId),
          input.filters,
          signal
        )
        const vectorAllowed = new Set(vectorHydrated.map((candidate) => candidate.chunkId))
        vectorIds = vectorRaw
          .map((candidate) => candidate.chunkId)
          .filter((chunkId) => vectorAllowed.has(chunkId))
        vectorAvailable = true
      } catch (err) {
        if (signal.aborted || isAbortError(err)) throw err
        this.options.log.warn(
          {
            event: 'retrieval.vector_unavailable',
            err,
            projectId: this.options.projectId,
            operationId
          },
          'Vector retrieval is unavailable; continuing with FTS candidates'
        )
      }
    }

    const byId = new Map(
      [...ftsHydrated, ...vectorHydrated].map((candidate) => [candidate.chunkId, candidate])
    )
    let ranked: RankedCandidate[] = reciprocalRankFusion(
      ftsIds,
      vectorIds,
      input.limits.fused
    ).flatMap((rank) => {
      const candidate = byId.get(rank.chunkId)
      if (candidate === undefined) return []
      return [
        {
          candidate,
          ftsRank: rank.ftsRank,
          vectorRank: rank.vectorRank,
          rrfScore: rank.rrfScore,
          rerankScore: null
        }
      ]
    })

    let rerankStatus: KnowledgeSearchResult['rerankStatus'] = input.rerank
      ? ranked.length === 0
        ? 'skipped-no-candidates'
        : 'not-configured'
      : 'disabled'
    if (input.rerank && ranked.length > 0) {
      try {
        const rerankProvider = await this.options.getRerankProvider()
        if (rerankProvider.role !== 'rerank') throw new Error('Rerank provider role is invalid')
        const result = await this.options.rerank(
          input.query,
          ranked.map((entry) => entry.candidate.text),
          Math.min(input.limits.results, ranked.length),
          operationId,
          signal
        )
        ranked = applyReranking(ranked, result)
        rerankStatus = 'applied'
      } catch (err) {
        if (signal.aborted || isAbortError(err)) throw err
        const notConfigured = err instanceof Error && err.message.includes('not configured')
        rerankStatus = notConfigured ? 'not-configured' : 'unavailable'
        this.options.log.warn(
          {
            event: 'retrieval.rerank_unavailable',
            err,
            projectId: this.options.projectId,
            operationId,
            fallback: 'rrf'
          },
          'Reranking is unavailable; returning deterministic fused ordering'
        )
      }
    }

    const hits = ranked.slice(0, input.limits.results).map(toSearchHit)
    const result = knowledgeSearchResultSchema.parse({
      mode: vectorAvailable ? 'hybrid' : 'fts',
      rerankStatus,
      hits
    })
    this.options.log.info(
      {
        event: 'retrieval.search.completed',
        projectId: this.options.projectId,
        operationId,
        mode: result.mode,
        rerankStatus: result.rerankStatus,
        ftsCandidates: ftsIds.length,
        vectorCandidates: vectorIds.length,
        resultCount: result.hits.length
      },
      'Knowledge retrieval completed'
    )
    return result
  }

  async expand(citationIds: string[], signal: AbortSignal): Promise<ExpandedCitation[]> {
    const parsedIds = citationIdSchema.array().min(1).max(20).parse(citationIds)
    const candidates = await this.options.client.expandCitations(parsedIds, signal)
    const byCitation = new Map(candidates.map((candidate) => [candidate.citationId, candidate]))
    return citationExpansionResultSchema.parse(
      parsedIds.flatMap((citationId) => {
        const candidate = byCitation.get(citationId)
        if (candidate === undefined) return []
        return [
          {
            citationId: candidate.citationId,
            knowledgeItemId: candidate.knowledgeItemId,
            parseRevisionId: candidate.parseRevisionId,
            chunkId: candidate.chunkId,
            title: candidate.title,
            text: candidate.text,
            ...(candidate.page === undefined ? {} : { page: candidate.page }),
            headingPath: candidate.headingPath,
            sourceBlockIds: candidate.sourceBlockIds,
            assetRefs: candidate.assetRefs,
            sources: candidate.sources
          }
        ]
      })
    )
  }
}

export function reciprocalRankFusion(
  ftsIds: string[],
  vectorIds: string[],
  limit: number,
  rankConstant = 60
): Array<{
  chunkId: string
  ftsRank: number | null
  vectorRank: number | null
  rrfScore: number
}> {
  const scores = new Map<
    string,
    { chunkId: string; ftsRank: number | null; vectorRank: number | null; rrfScore: number }
  >()
  const add = (chunkId: string, rank: number, channel: 'fts' | 'vector'): void => {
    const current = scores.get(chunkId) ?? {
      chunkId,
      ftsRank: null,
      vectorRank: null,
      rrfScore: 0
    }
    if (channel === 'fts') {
      if (current.ftsRank !== null) return
      current.ftsRank = rank
    } else {
      if (current.vectorRank !== null) return
      current.vectorRank = rank
    }
    current.rrfScore += 1 / (rankConstant + rank)
    scores.set(chunkId, current)
  }
  ftsIds.forEach((chunkId, index) => {
    add(chunkId, index + 1, 'fts')
  })
  vectorIds.forEach((chunkId, index) => {
    add(chunkId, index + 1, 'vector')
  })
  return [...scores.values()]
    .sort((a, b) => b.rrfScore - a.rrfScore || a.chunkId.localeCompare(b.chunkId))
    .slice(0, limit)
}

function applyReranking(ranked: RankedCandidate[], result: RerankResult): RankedCandidate[] {
  if (result.ranking.length === 0) throw new Error('Reranker returned no ranking')
  const seen = new Set<number>()
  const reranked: RankedCandidate[] = []
  for (const item of result.ranking) {
    if (item.originalIndex >= ranked.length || seen.has(item.originalIndex)) {
      throw new Error('Reranker returned an invalid candidate index')
    }
    seen.add(item.originalIndex)
    const candidate = ranked[item.originalIndex]
    if (candidate === undefined) throw new Error('Reranker candidate correlation failed')
    reranked.push({ ...candidate, rerankScore: item.score })
  }
  for (let index = 0; index < ranked.length; index += 1) {
    if (!seen.has(index)) reranked.push(ranked[index] as RankedCandidate)
  }
  return reranked
}

function toSearchHit(entry: RankedCandidate): KnowledgeSearchHit {
  const candidate = entry.candidate
  return {
    citationId: candidate.citationId,
    knowledgeItemId: candidate.knowledgeItemId,
    parseRevisionId: candidate.parseRevisionId,
    chunkId: candidate.chunkId,
    title: candidate.title,
    snippet: snippet(candidate.text),
    score: entry.rerankScore === null ? entry.rrfScore : Math.max(0, entry.rerankScore),
    ...(candidate.page === undefined ? {} : { page: candidate.page }),
    headingPath: candidate.headingPath,
    sourceBlockIds: candidate.sourceBlockIds,
    assetRefs: candidate.assetRefs,
    debug: {
      ftsRank: entry.ftsRank,
      vectorRank: entry.vectorRank,
      rrfScore: entry.rrfScore,
      rerankScore: entry.rerankScore
    }
  }
}

function snippet(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length <= 1_200 ? normalized : `${normalized.slice(0, 1_199)}…`
}

function abortError(): Error {
  const error = new Error('Retrieval operation aborted')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
