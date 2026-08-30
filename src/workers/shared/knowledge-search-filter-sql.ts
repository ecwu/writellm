import type { KnowledgeSearchFilters } from '../../shared/contracts/search'

export function knowledgeSearchFilterSql(filters: KnowledgeSearchFilters): string {
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

export function knowledgeSearchFilterParams(filters: KnowledgeSearchFilters): unknown[] {
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
