import { describe, expect, it } from 'vitest'
import type { KnowledgeSearchFilters } from '../../shared/contracts/search'
import { compileKnowledgeSearchFilters } from './knowledge-search-filter-sql'

describe('knowledge search SQL filters', () => {
  it('binds a large source set as one parameter and leaves empty filters unscoped', () => {
    const ids = Array.from({ length: 40_000 }, (_, index) => `source-${index}`)
    const filters = { knowledgeItemIds: ids, fileExtensions: [], parseRevisionIds: [] }
    const compiled = compileKnowledgeSearchFilters(filters)
    expect(compiled.clause.match(/\?/g)).toHaveLength(1)
    expect(compiled.parameters).toEqual([JSON.stringify(ids)])
    const empty = { ...filters, knowledgeItemIds: [] }
    expect(compileKnowledgeSearchFilters(empty)).toEqual({ clause: '', parameters: [] })
  })

  it('keeps shared FTS/vector placeholders and parameters in the same order', () => {
    const filters: KnowledgeSearchFilters = {
      knowledgeItemIds: ['knowledge-1'],
      fileExtensions: ['pdf'],
      parseRevisionIds: ['revision-1'],
      heading: ' HéAding ',
      pageFrom: 2,
      pageTo: 4
    }
    const { clause: sql, parameters } = compileKnowledgeSearchFilters(filters)
    expect(sql).toContain('chunks.knowledge_item_id IN (SELECT value FROM json_each(?))')
    expect(sql).toContain('chunks.extension IN (?)')
    expect(sql).toContain('chunks.parse_revision_id IN (?)')
    expect(sql).toContain('instr(search_heading_text(chunks.heading_path_json), ?) > 0')
    expect(sql).toContain('filtered_sources.page >= ?')
    expect(sql).toContain('filtered_sources.page <= ?')
    expect(parameters).toEqual([
      JSON.stringify(['knowledge-1']),
      'pdf',
      'revision-1',
      ' héading ',
      2,
      4
    ])
  })
})
