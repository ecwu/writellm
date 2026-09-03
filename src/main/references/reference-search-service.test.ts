import { describe, expect, it } from 'vitest'
import { searchReferenceCandidates, type ReferenceSearchRecord } from './reference-search-service'

const records: ReferenceSearchRecord[] = [
  {
    referenceId: '11111111-1111-4111-8111-111111111111',
    citationKey: 'attention-prefix',
    title: 'A later attention study',
    authors: ['Other Author'],
    issuedYear: 2025
  },
  {
    referenceId: '22222222-2222-4222-8222-222222222222',
    citationKey: 'FoldedKey',
    title: 'A paper with a folded key',
    authors: [],
    issuedYear: null
  },
  {
    referenceId: '33333333-3333-4333-8333-333333333333',
    citationKey: 'exact-key',
    title: 'A paper with an exact key',
    authors: ['Exact Author'],
    issuedYear: 2024
  },
  {
    referenceId: '44444444-4444-4444-8444-444444444444',
    citationKey: 'attention-title',
    title: 'Attention',
    authors: [],
    issuedYear: null
  },
  {
    referenceId: '55555555-5555-4555-8555-555555555555',
    citationKey: 'cross-field',
    title: 'Neural translation methods',
    authors: ['Ada Lovelace'],
    issuedYear: 2026
  },
  {
    referenceId: '66666666-6666-4666-8666-666666666666',
    citationKey: 'misc-attention',
    title: 'Attention overview',
    authors: [],
    issuedYear: null
  },
  {
    referenceId: '77777777-7777-4777-8777-777777777777',
    citationKey: 'zh-key',
    title: '注意力模型',
    authors: ['张伟'],
    issuedYear: 2026
  }
]

describe('searchReferenceCandidates', () => {
  it('ranks the complete match set before returning the three strongest candidates', () => {
    const result = searchReferenceCandidates(records, 'attention')

    expect(result.hasReferences).toBe(true)
    expect(result.items.map((item) => item.citationKey)).toEqual([
      'attention-prefix',
      'attention-title',
      'misc-attention'
    ])
  })

  it('prefers exact-case and folded citation keys while preserving key identity', () => {
    expect(searchReferenceCandidates(records, 'exact-key').items[0]?.citationKey).toBe('exact-key')
    expect(searchReferenceCandidates(records, 'FOLDEDKEY').items[0]?.citationKey).toBe('FoldedKey')
  })

  it('matches all whitespace-separated terms across title, author, and year fields', () => {
    expect(searchReferenceCandidates(records, 'lovelace neural 2026').items).toMatchObject([
      {
        citationKey: 'cross-field',
        title: 'Neural translation methods',
        authors: ['Ada Lovelace'],
        issuedYear: 2026
      }
    ])
    expect(searchReferenceCandidates(records, '张伟 注意力').items[0]?.citationKey).toBe('zh-key')
    expect(searchReferenceCandidates(records, 'lovelace missing').items).toEqual([])
  })

  it('normalizes Unicode and returns bounded authors for partial metadata', () => {
    const result = searchReferenceCandidates(
      [
        {
          ...records[6],
          authors: Array.from({ length: 25 }, (_, index) => `作者 ${index}`)
        }
      ],
      '注意力模型'
    )
    expect(result.items[0]?.authors).toHaveLength(20)
    expect(result.items[0]?.issuedYear).toBe(2026)
    expect(searchReferenceCandidates(records, 'folded\u00a0key').items[0]?.citationKey).toBe(
      'FoldedKey'
    )
  })

  it('sorts an empty query by title and key and reports an empty library', () => {
    const result = searchReferenceCandidates(records, '')
    expect(result.items.map((item) => item.title)).toEqual([
      'A later attention study',
      'A paper with a folded key',
      'A paper with an exact key'
    ])
    expect(searchReferenceCandidates([], '').hasReferences).toBe(false)
    expect(searchReferenceCandidates([], '').items).toEqual([])
  })
})
