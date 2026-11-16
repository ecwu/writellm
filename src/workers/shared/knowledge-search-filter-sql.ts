import type { KnowledgeSearchFilters } from '../../shared/contracts/search'

export function normalizeSearchHeading(value: string): string {
  return value.normalize('NFC').toLocaleLowerCase()
}

export interface SearchFilterSql {
  clause: string
  parameters: Array<string | number>
}

export function compileKnowledgeSearchFilters(filters: KnowledgeSearchFilters): SearchFilterSql {
  const predicates: string[] = []
  const parameters: Array<string | number> = []
  if (filters.knowledgeItemIds.length > 0) {
    predicates.push('chunks.knowledge_item_id IN (SELECT value FROM json_each(?))')
    parameters.push(JSON.stringify(filters.knowledgeItemIds))
  }
  if (filters.fileExtensions.length > 0) {
    predicates.push(`chunks.extension IN (${filters.fileExtensions.map(() => '?').join(',')})`)
    parameters.push(...filters.fileExtensions)
  }
  if (filters.parseRevisionIds.length > 0) {
    predicates.push(
      `chunks.parse_revision_id IN (${filters.parseRevisionIds.map(() => '?').join(',')})`
    )
    parameters.push(...filters.parseRevisionIds)
  }
  if (filters.heading !== undefined) {
    predicates.push('instr(search_heading_text(chunks.heading_path_json), ?) > 0')
    parameters.push(normalizeSearchHeading(filters.heading))
  }
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
    if (filters.pageFrom !== undefined) parameters.push(filters.pageFrom)
    if (filters.pageTo !== undefined) parameters.push(filters.pageTo)
  }
  return { clause: predicates.length === 0 ? '' : `AND ${predicates.join(' AND ')}`, parameters }
}
