import type Database from 'better-sqlite3'
import type { KnowledgeSearchFilters } from '../shared/contracts/search'

export interface FtsCandidate {
  chunkId: string
  rank: number
  strategy: 'unicode61' | 'trigram'
}

export class FtsIndex {
  constructor(private readonly database: Database.Database) {}

  search(
    generationId: string,
    rawQuery: string,
    limit: number,
    filters: KnowledgeSearchFilters
  ): FtsCandidate[] {
    const query = rawQuery.normalize('NFC').trim()
    if (query.length === 0 || limit < 1 || limit > 1_000) return []
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
