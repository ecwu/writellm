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
import type { ReferenceLibraryService } from '../references/reference-library-service'

export async function executeKnowledgeSearch(input: {
  retrieval: Pick<RetrievalService, 'search'>
  projectSessionId: string
  args: unknown
  references?: ReferenceLibraryService
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
  const referenceByKnowledgeItem = referenceProjectionMap(
    input.references,
    result.hits.map((hit) => hit.knowledgeItemId)
  )
  return searchKnowledgeResultSchema.parse({
    mode: result.mode,
    rerankStatus: result.rerankStatus,
    hits: result.hits.map((hit) => ({
      ...requiredReference(referenceByKnowledgeItem, hit.knowledgeItemId, hit.title),
      citationId: hit.citationId,
      knowledgeItemId: hit.knowledgeItemId,
      parseRevisionId: hit.parseRevisionId,
      chunkId: hit.chunkId,
      sourceTitle: hit.title,
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
  references?: ReferenceLibraryService
  signal: AbortSignal
}): Promise<ReadCitationsResult> {
  const args = readCitationsArgsSchema.parse(input.args)
  const requests = [
    ...args.citationIds.map((citationId) => ({ citationId, offset: 0, maxChars: 65_536 })),
    ...args.requests
  ]
  const requestedIds = [...new Set(requests.map((request) => request.citationId))]
  const expanded = await input.retrieval.expand(requestedIds, input.signal)
  const referenceByKnowledgeItem = referenceProjectionMap(
    input.references,
    expanded.map((citation) => citation.knowledgeItemId)
  )
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
          ...requiredReference(referenceByKnowledgeItem, citation.knowledgeItemId, citation.title),
          citationId: citation.citationId,
          knowledgeItemId: citation.knowledgeItemId,
          parseRevisionId: citation.parseRevisionId,
          chunkId: citation.chunkId,
          sourceTitle: citation.title,
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

function referenceProjectionMap(
  library: ReferenceLibraryService | undefined,
  knowledgeItemIds: readonly string[]
): Map<string, ReturnType<typeof referenceProjection>> {
  if (library === undefined) return new Map()
  const requested = new Set(knowledgeItemIds)
  const result = new Map<string, ReturnType<typeof referenceProjection>>()
  for (const reference of library.list()) {
    if (!reference.evidenceAvailable) continue
    const projection = referenceProjection(reference)
    for (const knowledgeItemId of reference.knowledgeItemIds) {
      if (requested.has(knowledgeItemId) && !result.has(knowledgeItemId)) {
        result.set(knowledgeItemId, projection)
      }
    }
  }
  return result
}

function referenceProjection(reference: ReturnType<ReferenceLibraryService['list']>[number]) {
  return {
    referenceId: reference.referenceId,
    citationKey: reference.citationKey,
    title: reference.title,
    authors: reference.creators
      .filter((creator) => creator.role === 'author')
      .map(
        (creator) => creator.literal ?? [creator.given, creator.family].filter(Boolean).join(' ')
      )
      .filter(Boolean),
    venue: reference.containerTitle,
    year: reference.issuedYear,
    evidenceAvailable: true as const
  }
}

function requiredReference<T>(
  references: ReadonlyMap<string, T>,
  knowledgeItemId: string,
  sourceTitle: string
): T | ReturnType<typeof compatibilityReference> {
  const reference = references.get(knowledgeItemId)
  return reference ?? compatibilityReference(knowledgeItemId, sourceTitle)
}

function compatibilityReference(knowledgeItemId: string, title: string) {
  return {
    referenceId: knowledgeItemId,
    citationKey: `doc-${knowledgeItemId.replaceAll('-', '')}`,
    title,
    authors: [],
    venue: null,
    year: null,
    evidenceAvailable: true as const
  }
}
