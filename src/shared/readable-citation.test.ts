import { describe, expect, it } from 'vitest'
import {
  buildManuscriptReferenceIndex,
  findReadableCitations,
  normalizeCitationTitle,
  stripReadableCitations
} from './readable-citation'

describe('readable citation utilities', () => {
  it('parses canonical English and Chinese labels and converts displayed pages to zero-based pages', () => {
    expect(findReadableCitations('[Source: Paper, p. 3] 【来源：白皮书，第 2 页】')).toEqual([
      expect.objectContaining({ syntax: 'english', title: 'Paper', pageIndex: 2 }),
      expect.objectContaining({ syntax: 'chinese', title: '白皮书', pageIndex: 1 })
    ])
    expect(findReadableCitations('[Source: Broken, p. zero]')).toEqual([])
  })

  it('groups by NFC plus trim and ignores page while preserving case', () => {
    const index = buildManuscriptReferenceIndex([
      document('section-a', 'revision-a', '[Source: Cafe\u0301, p. 1] [Source: Café, p. 8]'),
      document('section-b', 'revision-b', '【来源： Café ，第 3 页】 [Source: CAFÉ]')
    ])
    expect(index.entries.map(({ number, title, count }) => ({ number, title, count }))).toEqual([
      { number: 1, title: 'Café', count: 3 },
      { number: 2, title: 'CAFÉ', count: 1 }
    ])
    expect(normalizeCitationTitle(' Cafe\u0301 ')).toBe('Café')
  })

  it('renumbers from manuscript order and tracks repeated occurrences', () => {
    const first = document('section-a', 'revision-a', '[Source: Alpha] [Source: Beta]')
    const second = document('section-b', 'revision-b', '[Source: Beta]')
    expect(
      buildManuscriptReferenceIndex([first, second]).entries.map((entry) => entry.title)
    ).toEqual(['Alpha', 'Beta'])
    expect(
      buildManuscriptReferenceIndex([second, first]).entries.map((entry) => entry.title)
    ).toEqual(['Beta', 'Alpha'])
  })

  it('replaces valid citations with boundary whitespace for authoritative counting', () => {
    expect(stripReadableCitations('alpha[Source: Book]beta【来源：书，第 2 页】中文')).toBe(
      'alpha beta 中文'
    )
  })

  it('does not form readable citations across an inline math boundary', () => {
    const index = buildManuscriptReferenceIndex([
      {
        sectionId: 'section',
        sectionRevisionId: 'revision',
        content: [
          {
            id: 'paragraph',
            type: 'paragraph',
            props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
            content: [
              { type: 'text', text: '[Source: Re', styles: {} },
              { type: 'math', content: 'x' },
              { type: 'text', text: 'search]', styles: {} }
            ],
            children: []
          }
        ]
      }
    ])
    expect(index.entries).toEqual([])
  })
})

function document(sectionId: string, sectionRevisionId: string, text: string) {
  return {
    sectionId,
    sectionRevisionId,
    content: [
      {
        id: `${sectionId}-block`,
        type: 'paragraph' as const,
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text' as const, text, styles: {} }],
        children: []
      }
    ]
  }
}
