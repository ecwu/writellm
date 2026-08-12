import { describe, expect, it } from 'vitest'
import { findReadableCitations } from './readable-citation'

describe('readable citation parser', () => {
  it('parses canonical English and Chinese labels with optional one-based pages', () => {
    expect(
      findReadableCitations(
        'A [Source: Paper, with comma.pdf, p. 3] B 【来源：中文来源.pdf，第 12 页】 C [Source: No page.pdf]'
      )
    ).toEqual([
      expect.objectContaining({
        raw: '[Source: Paper, with comma.pdf, p. 3]',
        syntax: 'english',
        title: 'Paper, with comma.pdf',
        pageIndex: 2
      }),
      expect.objectContaining({
        raw: '【来源：中文来源.pdf，第 12 页】',
        syntax: 'chinese',
        title: '中文来源.pdf',
        pageIndex: 11
      }),
      expect.objectContaining({
        raw: '[Source: No page.pdf]',
        syntax: 'english',
        title: 'No page.pdf'
      })
    ])
  })

  it('returns UTF-16 offsets suitable for ProseMirror positions', () => {
    const text = '😀 claim [Source: Evidence.pdf, p. 1].'
    const [citation] = findReadableCitations(text)
    expect(text.slice(citation?.from, citation?.to)).toBe('[Source: Evidence.pdf, p. 1]')
  })

  it.each([
    '[Source: ]',
    '[Source: Evidence.pdf, p. 0]',
    '[Source: Evidence.pdf, p. nope]',
    '【来源：Evidence.pdf，第 0 页】',
    '【来源：Evidence.pdf，第 x 页】',
    '[12]',
    '(Smith, 2024)',
    '[source: Evidence.pdf, p. 1]'
  ])('does not recognize malformed or non-canonical text: %s', (text) => {
    expect(findReadableCitations(text)).toEqual([])
  })
})
