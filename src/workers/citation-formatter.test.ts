import { describe, expect, it } from 'vitest'
import type { CitationFormatterRequest } from '../shared/contracts/citation-formatting'
import { assertInTextStyle, formatCitationSnapshot } from './citation-formatter'

describe('citation formatter', () => {
  it.each([
    ['apa', /Smith.*2024/u],
    ['vancouver', /^\(1\)$/u],
    ['ieee', /^\[1\]$/u]
  ] as const)('formats an ordered cluster and bibliography with %s', (styleId, expected) => {
    const result = formatCitationSnapshot(request(styleId))
    expect(result.citations[0]?.formatted).toMatch(expected)
    expect(result.bibliography).toEqual([expect.objectContaining({ citationKey: 'smith2024' })])
  })

  it('passes page ranges to citeproc and rejects note styles', () => {
    const result = formatCitationSnapshot(request('apa'))
    expect(result.citations[0]?.formatted).toContain('pp. 12–14')
    expect(() =>
      assertInTextStyle(
        '<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" class="note" version="1.0"></style>'
      )
    ).toThrow('Only in-text CSL styles are supported')
  })
})

function request(styleId: string): CitationFormatterRequest {
  return {
    operation: 'format_citations',
    requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc101',
    projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc102',
    snapshotHash: 'a'.repeat(64),
    style: { styleId },
    locale: 'en-US',
    items: [
      {
        id: 'smith2024',
        'citation-key': 'smith2024',
        type: 'article-journal',
        title: 'Stable citations',
        author: [{ family: 'Smith' }],
        issued: { 'date-parts': [[2024]] }
      }
    ],
    clusters: [
      {
        clusterId: 'cluster-1',
        items: [
          {
            citationKey: 'smith2024',
            locator: { label: 'page', startPageIndex: 11, endPageIndex: 13 }
          }
        ]
      }
    ]
  }
}
