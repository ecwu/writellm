import { describe, expect, it } from 'vitest'
import type { ReferenceItem } from '../../shared/contracts/references'
import { createBibliographyExport } from './reference-bibliography-export'

describe('Reference bibliography export', () => {
  it('sorts deterministically, fixes CSL IDs to citekeys, and round-trips critical fields', () => {
    const result = createBibliographyExport(
      [reference('zeta2024', 'Zeta'), reference('alpha2023', 'Alpha')],
      'bibtex'
    )
    expect(result.exportedCount).toBe(2)
    expect(result.content.indexOf('alpha2023')).toBeLessThan(result.content.indexOf('zeta2024'))
    expect(result.content).toContain('doi = {10.1000/example}')
    expect(result.losses).toEqual([])
  })

  it('exports bounded CSL JSON with project citekeys as authoritative IDs', () => {
    const result = createBibliographyExport([reference('safe-key', 'Title')], 'csl-json')
    expect(JSON.parse(result.content)).toEqual([
      expect.objectContaining({ id: 'safe-key', 'citation-key': 'safe-key', title: 'Title' })
    ])
  })
})

function reference(citationKey: string, title: string): ReferenceItem {
  return {
    referenceId: crypto.randomUUID(),
    citationKey,
    cslType: 'article-journal',
    title,
    containerTitle: 'Journal',
    issuedYear: 2024,
    doi: '10.1000/example',
    isbn: null,
    url: null,
    csl: {
      id: citationKey,
      'citation-key': citationKey,
      type: 'article-journal',
      title,
      author: [{ family: 'Doe', given: 'Jane' }],
      issued: { 'date-parts': [[2024]] },
      DOI: '10.1000/example',
      'container-title': 'Journal'
    },
    creators: [{ role: 'author', ordinal: 0, given: 'Jane', family: 'Doe', literal: null }],
    metadataCompleteness: 'complete',
    syncStatus: 'synced',
    evidenceAvailable: true,
    knowledgeItemIds: [crypto.randomUUID()],
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z'
  }
}
