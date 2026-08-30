import type { BlockNoteDocument, BlockNoteInlineContent } from './contracts/manuscript'
import { blockNoteInlinePlainText as inlinePlainText } from './blocknote-inline-text'

export type ReadableCitationSyntax = 'english' | 'chinese'

export interface ReadableCitationMatch {
  from: number
  to: number
  raw: string
  syntax: ReadableCitationSyntax
  title: string
  pageIndex?: number
}

export interface ManuscriptReferenceOccurrence {
  sectionId: string
  sectionRevisionId: string
  blockId: string
  ordinal: number
  raw: string
  syntax: ReadableCitationSyntax
  title: string
  pageIndex?: number
}

export interface ManuscriptReferenceEntry {
  number: number
  title: string
  count: number
  occurrences: ManuscriptReferenceOccurrence[]
}

export interface ManuscriptReferenceIndex {
  entries: ManuscriptReferenceEntry[]
}

const READABLE_CITATION_PATTERN =
  /\[Source:\s*([^\]\r\n\uFFFC]+)\]|【来源：\s*([^】\r\n\uFFFC]+)】/gu
const ENGLISH_PAGE_SUFFIX = /,\s*p\.\s*(\d+)\s*$/u
const CHINESE_PAGE_SUFFIX = /，\s*第\s*(\d+)\s*页\s*$/u

export function normalizeCitationTitle(title: string): string {
  return title.normalize('NFC').trim()
}

export function findReadableCitations(text: string): ReadableCitationMatch[] {
  const citations: ReadableCitationMatch[] = []
  for (const match of text.matchAll(READABLE_CITATION_PATTERN)) {
    const raw = match[0]
    const from = match.index
    const syntax: ReadableCitationSyntax = match[1] === undefined ? 'chinese' : 'english'
    const body = (match[1] ?? match[2] ?? '').trim()
    const parsed = parseBody(body, syntax)
    if (parsed === null || from === undefined) continue
    citations.push({ from, to: from + raw.length, raw, syntax, ...parsed })
  }
  return citations
}

export function stripReadableCitations(text: string): string {
  const matches = findReadableCitations(text)
  if (matches.length === 0) return text
  let result = ''
  let cursor = 0
  for (const citation of matches) {
    result += text.slice(cursor, citation.from)
    result += ' '
    cursor = citation.to
  }
  return result + text.slice(cursor)
}

export function buildManuscriptReferenceIndex(
  sections: readonly {
    sectionId: string
    sectionRevisionId: string
    content: BlockNoteDocument
  }[]
): ManuscriptReferenceIndex {
  return buildReferenceIndexFromOccurrences(
    sections.flatMap((section) => findDocumentCitationOccurrences(section))
  )
}

export function buildReferenceIndexFromOccurrences(
  occurrences: readonly ManuscriptReferenceOccurrence[]
): ManuscriptReferenceIndex {
  const byTitle = new Map<string, ManuscriptReferenceEntry>()
  for (const occurrence of occurrences) {
    const key = normalizeCitationTitle(occurrence.title)
    let entry = byTitle.get(key)
    if (entry === undefined) {
      entry = { number: byTitle.size + 1, title: occurrence.title, count: 0, occurrences: [] }
      byTitle.set(key, entry)
    }
    entry.occurrences.push(occurrence)
    entry.count += 1
  }
  return { entries: [...byTitle.values()] }
}

export function referenceNumberMap(index: ManuscriptReferenceIndex): Map<string, number> {
  return new Map(index.entries.map((entry) => [normalizeCitationTitle(entry.title), entry.number]))
}

export function replaceReadableCitations(
  text: string,
  numbers: ReadonlyMap<string, number>
): string {
  const matches = findReadableCitations(text)
  if (matches.length === 0) return text
  let result = ''
  let cursor = 0
  for (const citation of matches) {
    result += text.slice(cursor, citation.from)
    const number = numbers.get(normalizeCitationTitle(citation.title))
    result += number === undefined ? citation.raw : `[${number}]`
    cursor = citation.to
  }
  return result + text.slice(cursor)
}

export function findDocumentCitationOccurrences(input: {
  sectionId: string
  sectionRevisionId: string
  content: BlockNoteDocument
}): ManuscriptReferenceOccurrence[] {
  const occurrences: ManuscriptReferenceOccurrence[] = []
  let ordinal = 0
  const visit = (blocks: BlockNoteDocument): void => {
    for (const block of blocks) {
      const segments = blockTextSegments(block)
      for (const text of segments) {
        for (const citation of findReadableCitations(text)) {
          occurrences.push({
            sectionId: input.sectionId,
            sectionRevisionId: input.sectionRevisionId,
            blockId: block.id,
            ordinal: ordinal++,
            raw: citation.raw,
            syntax: citation.syntax,
            title: citation.title,
            ...(citation.pageIndex === undefined ? {} : { pageIndex: citation.pageIndex })
          })
        }
      }
      visit(block.children)
    }
  }
  visit(input.content)
  return occurrences
}

function blockTextSegments(block: BlockNoteDocument[number]): string[] {
  if (block.type === 'mathBlock') return []
  if (block.type === 'diagram') {
    return [typeof block.props.caption === 'string' ? block.props.caption : '']
  }
  if (Array.isArray(block.content)) return [inlinePlainText(block.content)]
  if (block.type === 'table' && block.content !== undefined) {
    return block.content.rows.flatMap((row) =>
      row.cells.map((cell) => {
        const value = Array.isArray(cell) ? cell : cell.content
        return inlinePlainText(value as BlockNoteInlineContent[])
      })
    )
  }
  if (block.type === 'image') {
    return [typeof block.props.caption === 'string' ? block.props.caption : '']
  }
  return []
}

function parseBody(
  body: string,
  syntax: ReadableCitationSyntax
): { title: string; pageIndex?: number } | null {
  const suffixPattern = syntax === 'english' ? ENGLISH_PAGE_SUFFIX : CHINESE_PAGE_SUFFIX
  const suffix = suffixPattern.exec(body)
  if (suffix === null) {
    const looksMalformed = syntax === 'english' ? /,\s*p\./u.test(body) : /，\s*第/u.test(body)
    return looksMalformed ? null : validTitle(body)
  }

  const displayedPage = Number(suffix[1])
  const title = body.slice(0, suffix.index).trim()
  const parsedTitle = validTitle(title)
  if (parsedTitle === null || !Number.isSafeInteger(displayedPage) || displayedPage < 1) {
    return null
  }
  return { ...parsedTitle, pageIndex: displayedPage - 1 }
}

function validTitle(title: string): { title: string } | null {
  const normalized = normalizeCitationTitle(title)
  return normalized.length > 0 && normalized.length <= 512 ? { title: normalized } : null
}
