import { describe, expect, it } from 'vitest'
import { createCitationKey, parseReferenceSource } from './reference-import-parser'

describe('Reference source parser', () => {
  it('isolates invalid and duplicate CSL entries while retaining valid metadata', () => {
    const parsed = parseReferenceSource(
      JSON.stringify([
        {
          id: 'zotero-1',
          'citation-key': 'Smith2024',
          type: 'article-journal',
          title: 'Stable citations',
          author: [{ given: 'Ada', family: 'Smith' }],
          issued: { 'date-parts': [[2024]] }
        },
        { id: 'bad', type: 'article-journal' },
        {
          id: 'zotero-2',
          'citation-key': 'Smith2024',
          type: 'article-journal',
          title: 'Duplicate'
        }
      ]),
      'better-csl-json'
    )

    expect(parsed.items).toHaveLength(1)
    expect(parsed.items[0]?.upstreamKey).toBe('Smith2024')
    expect(parsed.issues.map((issue) => issue.code)).toEqual([
      'invalid_item',
      'duplicate_upstream_key'
    ])
  })

  it('parses BibTeX entries independently and preserves file attachment candidates', () => {
    const parsed = parseReferenceSource(
      `@article{smith2024,
        title={Stable citations},
        author={Smith, Ada},
        year={2024},
        journal={Journal},
        file={Paper:attachments/paper.pdf:application/pdf}
      }
      @article{lee2023,title={Second work},year={2023}}`,
      'bibtex'
    )

    expect(parsed.items.map((item) => item.upstreamKey)).toEqual(['smith2024', 'lee2023'])
    expect(parsed.items[0]?.attachmentPaths).toEqual(['attachments/paper.pdf'])
  })

  it('keeps legal upstream keys and deterministically repairs illegal and conflicting keys', () => {
    const [parsed] = parseReferenceSource(
      JSON.stringify([
        {
          id: 'zotero-1',
          'citation-key': 'Smith2024',
          type: 'article-journal',
          title: 'Stable citations',
          issued: { 'date-parts': [[2024]] }
        }
      ]),
      'better-csl-json'
    ).items
    if (parsed === undefined) throw new Error('Fixture did not parse')
    expect(createCitationKey(parsed)).toBe('Smith2024')
    expect(createCitationKey({ ...parsed, reservedKeys: new Set(['Smith2024']) })).toMatch(
      /^Smith2024-[a-f0-9]{8}$/u
    )
    expect(
      createCitationKey({
        ...parsed,
        item: { ...parsed.item, 'citation-key': 'unsafe key / value' }
      })
    ).toMatch(/^unsafe-key-value-[a-f0-9]{8}$/u)
    expect(
      createCitationKey({ ...parsed, item: { ...parsed.item, 'citation-key': undefined } })
    ).toBe('Smith2024')
  })

  it('preserves Windows drive letters and Zotero attachment labels', () => {
    const parsed = parseReferenceSource(
      String.raw`@article{win,
        title = {Windows path},
        file = {C:\Papers\paper.pdf;Label:/tmp/other.pdf:application/pdf}
      }`,
      'bibtex'
    )
    expect(parsed.items[0]?.attachmentPaths).toEqual([
      String.raw`C:\Papers\paper.pdf`,
      '/tmp/other.pdf'
    ])
  })

  it('retains every BibTeX attachment beyond the former 100-item cutoff', () => {
    const entries = Array.from(
      { length: 125 },
      (_, index) => `Paper ${index}:attachments/paper-${index}.pdf:application/pdf`
    ).join(';')
    const parsed = parseReferenceSource(
      `@article{large,title={Large attachment set},file={${entries}}}`,
      'bibtex'
    )
    expect(parsed.items[0]?.attachmentPaths).toHaveLength(125)
    expect(parsed.items[0]?.attachmentPaths.at(-1)).toBe('attachments/paper-124.pdf')
  })
})
