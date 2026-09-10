import type { AutocompleteStyle } from '../shared/contracts/autocomplete'

export const autocompleteStyles = {
  word: {
    tokens: 32,
    characters: 24,
    instruction: 'Continue with at most four words, not a sentence.'
  },
  sentence: {
    tokens: 128,
    characters: 160,
    instruction: 'Finish only the current sentence. Do not start another sentence.'
  },
  paragraph: {
    tokens: 384,
    characters: 480,
    instruction:
      'Continue only the current paragraph with at most three short sentences. Do not start another paragraph.'
  }
} satisfies Record<AutocompleteStyle, { tokens: number; characters: number; instruction: string }>

// ICU handles scripts without spaces, decimals and closing punctuation. Suppress familiar
// English abbreviation boundaries that ICU deliberately leaves to application tailoring.
const abbreviation =
  /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e)|\b(?:[A-Za-z]\.)*[A-Za-z])\.["'”’）)\]]*\s*$/u
function sentenceLimit(text: string, prefix: string, locale: string, maximum: number): string {
  const context = prefix.split(/[\r\n\u2028\u2029]/u).at(-1) ?? ''
  const combined = context + text
  let count = 0
  for (const part of new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(combined)) {
    const end = part.index + part.segment.length
    if (
      end <= context.length ||
      !combined.slice(Math.max(part.index, context.length), end).trim() ||
      abbreviation.test(part.segment)
    )
      continue
    if (++count === maximum) return text.slice(0, end - context.length).trimEnd()
  }
  return text
}

export function boundAutocomplete(text: string, style: AutocompleteStyle, prefix: string): string {
  let result = text.split(/[\r\n\u2028\u2029]/u)[0].replace(/\0/gu, '')
  const locale = /\p{Script=Han}/u.test(prefix + result) ? 'zh' : 'en'
  const words = new Intl.Segmenter(locale, { granularity: 'word' })
  if (style === 'word') {
    let count = 0
    for (const part of words.segment(result)) {
      if (part.isWordLike && ++count > 4) {
        result = result.slice(0, part.index).trimEnd()
        break
      }
    }
  } else result = sentenceLimit(result, prefix, locale, style === 'sentence' ? 1 : 3)

  const maximum = autocompleteStyles[style].characters
  let characters = 0
  let end = 0
  for (const part of new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(result)) {
    const size = [...part.segment].length
    if (characters + size > maximum) break
    characters += size
    end = part.index + part.segment.length
  }
  if (end < result.length) {
    const part = words.segment(result).containing(end)
    // Prefer a complete word, but permit a bounded fragment when the first word alone
    // exceeds the cap. The grapheme boundary above remains authoritative in that case.
    if (part?.isWordLike && part.index < end && result.slice(0, part.index).trim().length > 0)
      end = part.index
    result = result.slice(0, end)
  }
  return result.trimEnd()
}
