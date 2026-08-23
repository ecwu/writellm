import type Database from 'better-sqlite3'
import type { FtsSearchMode } from '../shared/contracts/indexing'
import type { KnowledgeSearchFilters } from '../shared/contracts/search'

export interface FtsCandidate {
  chunkId: string
  rank: number
  strategy: 'unicode61' | 'trigram' | 'substring'
}

export class FtsIndex {
  constructor(private readonly database: Database.Database) {}

  search(
    generationId: string,
    rawQuery: string,
    limit: number,
    filters: KnowledgeSearchFilters,
    mode: FtsSearchMode = 'phrase'
  ): FtsCandidate[] {
    const query = rawQuery.normalize('NFC').trim()
    if (query.length === 0 || limit < 1 || limit > 1_000) return []
    if (mode === 'terms') return this.searchTerms(generationId, query, limit, filters)
    return this.searchPhrase(generationId, query, limit, filters)
  }

  private searchTerms(
    generationId: string,
    query: string,
    limit: number,
    filters: KnowledgeSearchFilters
  ): FtsCandidate[] {
    const best = new Map<string, FtsCandidate>()
    for (const term of lexicalTerms(query)) {
      for (const candidate of this.searchPhrase(generationId, term, limit, filters)) {
        const prior = best.get(candidate.chunkId)
        if (prior === undefined || candidate.rank < prior.rank)
          best.set(candidate.chunkId, candidate)
      }
    }
    return [...best.values()]
      .sort((left, right) => left.rank - right.rank || left.chunkId.localeCompare(right.chunkId))
      .slice(0, limit)
  }

  private searchPhrase(
    generationId: string,
    query: string,
    limit: number,
    filters: KnowledgeSearchFilters
  ): FtsCandidate[] {
    if (isShortHanQuery(query)) return this.searchSubstring(generationId, query, limit, filters)
    const short = Array.from(query).length < 3
    const strategies = short ? (['unicode61'] as const) : (['unicode61', 'trigram'] as const)
    const best = new Map<string, FtsCandidate>()
    for (const strategy of strategies) {
      const table = strategy === 'unicode61' ? 'chunk_fts_unicode61' : 'chunk_fts_trigram'
      const expression = quoteFts(query, strategy === 'unicode61' && short)
      const rows = this.database
        .prepare(
          `SELECT ${table}.chunk_id AS chunk_id, bm25(${table}) AS rank FROM ${table}
            JOIN chunks ON chunks.generation_id = ${table}.generation_id
                       AND chunks.chunk_id = ${table}.chunk_id
            WHERE ${table} MATCH ? AND ${table}.generation_id = ?
              ${filterSql(filters)}
            ORDER BY rank, ${table}.chunk_id LIMIT ?`
        )
        .all(expression, generationId, ...filterParams(filters), limit) as Array<{
        chunk_id: string
        rank: number
      }>
      for (const row of rows) {
        const candidate = { chunkId: row.chunk_id, rank: row.rank, strategy }
        const prior = best.get(row.chunk_id)
        if (prior === undefined || candidate.rank < prior.rank) best.set(row.chunk_id, candidate)
      }
    }
    return [...best.values()]
      .sort((a, b) => a.rank - b.rank || a.chunkId.localeCompare(b.chunkId))
      .slice(0, limit)
  }

  private searchSubstring(
    generationId: string,
    query: string,
    limit: number,
    filters: KnowledgeSearchFilters
  ): FtsCandidate[] {
    const rows = this.database
      .prepare(
        `SELECT chunks.chunk_id AS chunk_id,
                ROW_NUMBER() OVER (
                  ORDER BY instr(chunks.text, ?), length(chunks.text), chunks.chunk_id
                ) AS rank
           FROM chunks
          WHERE chunks.generation_id = ?
            AND instr(chunks.text, ?) > 0
            ${filterSql(filters)}
          ORDER BY rank, chunks.chunk_id
          LIMIT ?`
      )
      .all(query, generationId, query, ...filterParams(filters), limit) as Array<{
      chunk_id: string
      rank: number
    }>
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      rank: row.rank,
      strategy: 'substring' as const
    }))
  }
}

const QUESTION_STOP_WORDS = new Set([
  'about',
  'appears',
  'are',
  'does',
  'exact',
  'explain',
  'for',
  'from',
  'how',
  'in',
  'into',
  'is',
  'of',
  'on',
  'phrase',
  'say',
  'says',
  'source',
  'the',
  'this',
  'to',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with'
])

function lexicalTerms(query: string): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  for (const match of query.matchAll(/[\p{L}\p{N}]+/gu)) {
    const raw = match[0]
    const characters = Array.from(raw)
    const candidates = characters.every((character) => /\p{Script=Han}/u.test(character))
      ? characters.length <= 3
        ? [raw]
        : characters.slice(0, -2).map((_, index) => characters.slice(index, index + 3).join(''))
      : [raw.toLocaleLowerCase()]
    for (const candidate of candidates) {
      if (
        seen.has(candidate) ||
        QUESTION_STOP_WORDS.has(candidate) ||
        (/^\p{N}+$/u.test(candidate) && candidate.length < 4) ||
        Array.from(candidate).length < 2
      ) {
        continue
      }
      seen.add(candidate)
      terms.push(candidate)
      if (terms.length === 24) return terms
    }
  }
  return terms.length === 0 ? [query] : terms
}

function isShortHanQuery(query: string): boolean {
  const characters = Array.from(query)
  return (
    characters.length >= 1 &&
    characters.length < 3 &&
    characters.every((character) => /\p{Script=Han}/u.test(character))
  )
}

function filterSql(filters: KnowledgeSearchFilters): string {
  const predicates: string[] = []
  if (filters.knowledgeItemIds.length > 0) {
    predicates.push(
      `chunks.knowledge_item_id IN (${filters.knowledgeItemIds.map(() => '?').join(',')})`
    )
  }
  if (filters.fileExtensions.length > 0) {
    predicates.push(`chunks.extension IN (${filters.fileExtensions.map(() => '?').join(',')})`)
  }
  if (filters.parseRevisionIds.length > 0) {
    predicates.push(
      `chunks.parse_revision_id IN (${filters.parseRevisionIds.map(() => '?').join(',')})`
    )
  }
  if (filters.heading !== undefined) predicates.push('lower(chunks.heading_path_json) LIKE ?')
  if (filters.pageFrom !== undefined || filters.pageTo !== undefined) {
    predicates.push(
      `EXISTS (
        SELECT 1 FROM chunk_sources AS filtered_sources
         WHERE filtered_sources.generation_id = chunks.generation_id
           AND filtered_sources.chunk_id = chunks.chunk_id
           AND filtered_sources.page IS NOT NULL
           ${filters.pageFrom === undefined ? '' : 'AND filtered_sources.page >= ?'}
           ${filters.pageTo === undefined ? '' : 'AND filtered_sources.page <= ?'}
      )`
    )
  }
  return predicates.length === 0 ? '' : `AND ${predicates.join(' AND ')}`
}

function filterParams(filters: KnowledgeSearchFilters): unknown[] {
  return [
    ...filters.knowledgeItemIds,
    ...filters.fileExtensions,
    ...filters.parseRevisionIds,
    ...(filters.heading === undefined
      ? []
      : [`%${filters.heading.normalize('NFC').toLocaleLowerCase()}%`]),
    ...(filters.pageFrom === undefined ? [] : [filters.pageFrom]),
    ...(filters.pageTo === undefined ? [] : [filters.pageTo])
  ]
}

function quoteFts(query: string, prefix: boolean): string {
  return `"${query.replaceAll('"', '""')}"${prefix ? '*' : ''}`
}
