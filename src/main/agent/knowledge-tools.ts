import { createHash } from 'node:crypto'
import {
  readCitationsArgsSchema,
  readCitationsResultSchema,
  searchKnowledgeArgsSchema,
  searchKnowledgeResultSchema,
  type ReadCitationsResult,
  type SearchKnowledgeResult
} from '../../shared/contracts/agent-tools'
import type { RetrievalService } from '../search/retrieval-service'

export async function executeKnowledgeSearch(input: {
  retrieval: Pick<RetrievalService, 'search'>
  projectSessionId: string
  args: unknown
  signal: AbortSignal
  forcedKnowledgeItemIds?: string[]
}): Promise<SearchKnowledgeResult> {
  const args = searchKnowledgeArgsSchema.parse(input.args)
  const result = await input.retrieval.search(
    {
      projectSessionId: input.projectSessionId,
      query: args.query,
      filters: {
        knowledgeItemIds: input.forcedKnowledgeItemIds ?? args.knowledgeItemIds,
        fileExtensions: args.fileExtensions,
        parseRevisionIds: args.parseRevisionIds,
        ...(args.pageFrom === undefined ? {} : { pageFrom: args.pageFrom }),
        ...(args.pageTo === undefined ? {} : { pageTo: args.pageTo }),
        ...(args.heading === undefined ? {} : { heading: args.heading })
      },
      limits: { fts: 100, vector: 100, fused: 50, results: args.limit },
      rerank: args.rerank
    },
    input.signal
  )
  return searchKnowledgeResultSchema.parse({
    mode: result.mode,
    rerankStatus: result.rerankStatus,
    hits: result.hits.map((hit) => ({
      citationId: hit.citationId,
      knowledgeItemId: hit.knowledgeItemId,
      parseRevisionId: hit.parseRevisionId,
      chunkId: hit.chunkId,
      title: hit.title,
      snippet: hit.snippet,
      ...(hit.page === undefined ? {} : { page: hit.page }),
      headingPath: hit.headingPath,
      sourceBlockIds: hit.sourceBlockIds
    }))
  })
}

export async function executeCitationRead(input: {
  retrieval: Pick<RetrievalService, 'expand'>
  args: unknown
  signal: AbortSignal
}): Promise<ReadCitationsResult> {
  const args = readCitationsArgsSchema.parse(input.args)
  const requests = [
    ...args.citationIds.map((citationId) => ({ citationId, offset: 0, maxChars: 65_536 })),
    ...args.requests
  ]
  const requestedIds = [...new Set(requests.map((request) => request.citationId))]
  const expanded = await input.retrieval.expand(requestedIds, input.signal)
  const found = new Set(expanded.map((citation) => citation.citationId))
  const byId = new Map(expanded.map((citation) => [citation.citationId, citation]))
  let remainingBudget = 131_072
  let truncated = false
  return readCitationsResultSchema.parse({
    citations: requests.flatMap((request) => {
      const citation = byId.get(request.citationId)
      if (citation === undefined || remainingBudget <= 0) {
        if (citation !== undefined) truncated = true
        return []
      }
      const available = Math.min(request.maxChars, remainingBudget)
      const text = citation.text.slice(request.offset, request.offset + available)
      remainingBudget -= text.length
      const nextOffset =
        request.offset + text.length < citation.text.length ? request.offset + text.length : null
      if (nextOffset !== null) truncated = true
      return [
        {
          citationId: citation.citationId,
          knowledgeItemId: citation.knowledgeItemId,
          parseRevisionId: citation.parseRevisionId,
          chunkId: citation.chunkId,
          title: citation.title,
          text,
          contentHash: createHash('sha256').update(citation.text).digest('hex'),
          offset: request.offset,
          totalChars: citation.text.length,
          nextOffset,
          ...(citation.page === undefined ? {} : { page: citation.page }),
          headingPath: citation.headingPath,
          sourceBlockIds: citation.sourceBlockIds
        }
      ]
    }),
    missingCitationIds: requestedIds.filter((citationId) => !found.has(citationId)),
    truncated
  })
}
