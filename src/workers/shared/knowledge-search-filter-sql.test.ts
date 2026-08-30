import { describe, expect, it } from 'vitest'
import {
  knowledgeSearchFilterParams,
  knowledgeSearchFilterSql
} from './knowledge-search-filter-sql'

describe('knowledge search SQL filters', () => {
  it('keeps shared FTS/vector placeholders and parameters in the same order', () => {
    const filters = {
      knowledgeItemIds: ['knowledge-1'],
      fileExtensions: ['PDF'],
      parseRevisionIds: ['revision-1'],
      heading: ' HéAding ',
      pageFrom: 2,
      pageTo: 4
    }
    const sql = knowledgeSearchFilterSql(filters)
    expect(sql).toContain('chunks.knowledge_item_id IN (?)')
    expect(sql).toContain('chunks.extension IN (?)')
    expect(sql).toContain('chunks.parse_revision_id IN (?)')
    expect(sql).toContain('filtered_sources.page >= ?')
    expect(sql).toContain('filtered_sources.page <= ?')
    expect(knowledgeSearchFilterParams(filters)).toEqual([
      'knowledge-1',
      'PDF',
      'revision-1',
      '% héading %',
      2,
      4
    ])
  })
})
