import { describe, expect, it } from 'vitest'
import { boundAutocomplete } from './autocomplete-style'

describe('autocomplete style boundaries', () => {
  it('limits English words and preserves insertion spacing', () => {
    expect(boundAutocomplete(' one two three four five six.', 'word', 'Write')).toBe(
      ' one two three four'
    )
    expect(boundAutocomplete('  calm.', 'word', 'Stay')).toBe('  calm.')
    expect(boundAutocomplete('hello\nsecond line', 'paragraph', '')).toBe('hello')
    expect(boundAutocomplete('hello\u2028second line', 'paragraph', '')).toBe('hello')
  })
  it('segments Chinese without requiring spaces', () => {
    const text = boundAutocomplete('清晨的阳光透过树叶，洒在青石板上。', 'word', '这里')
    const words = [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(text)].filter(
      (part) => part.isWordLike
    )
    expect(words.length).toBeLessThanOrEqual(4)
    expect([...text].length).toBeLessThanOrEqual(24)
    expect(text).toBe('清晨的阳光透过')
  })
  it.each([
    ['我说：', '“今天很好。”接着出门。', '“今天很好。”'],
    ['He said ', '“It works.” Next sentence.', '“It works.”'],
    ['Talk to Dr.', ' Smith about 3.14 today. Next sentence.', ' Smith about 3.14 today.'],
    ['', 'Dr. Smith spoke to Mr. Jones. Next sentence.', 'Dr. Smith spoke to Mr. Jones.'],
    ['The value is 3.', '14 units. More.', '14 units.'],
    ['A finished sentence.', ' The next sentence. More.', ' The next sentence.'],
    ['', 'Use e.g. a pen. Next.', 'Use e.g. a pen.']
  ])('finds one sentence with prefix %s', (prefix, text, expected) => {
    expect(boundAutocomplete(text, 'sentence', prefix)).toBe(expected)
  })
  it('limits paragraphs to three sentences', () => {
    expect(boundAutocomplete('一句。二句！三句？四句。', 'paragraph', '开始')).toBe(
      '一句。二句！三句？'
    )
    expect(boundAutocomplete(' One. Two! Three? Four.', 'paragraph', 'Start')).toBe(
      ' One. Two! Three?'
    )
  })
  it('caps code points at word and grapheme boundaries, including combining marks and emoji', () => {
    expect(boundAutocomplete(' short extraordinarilylongword', 'word', '')).toBe(' short')
    const family = '👩‍👩‍👧‍👦'
    expect(boundAutocomplete(family.repeat(10), 'word', '')).toBe(family.repeat(3))
    expect(boundAutocomplete('e\u0301'.repeat(20), 'word', '')).toBe('e\u0301'.repeat(12))
    expect(boundAutocomplete('a'.repeat(200), 'sentence', '')).toHaveLength(160)
    expect(boundAutocomplete('文'.repeat(600), 'paragraph', '')).toHaveLength(480)
  })
  it('does not manufacture a sentence ending for bounded partial results', () => {
    expect(boundAutocomplete(' unfinished thought', 'sentence', 'An')).toBe(' unfinished thought')
    expect(boundAutocomplete('\nnew paragraph', 'paragraph', '')).toBe('')
  })
})
