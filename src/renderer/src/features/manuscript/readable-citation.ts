export type ReadableCitationSyntax = 'english' | 'chinese'

export interface ReadableCitationMatch {
  from: number
  to: number
  raw: string
  syntax: ReadableCitationSyntax
  title: string
  pageIndex?: number
}

const READABLE_CITATION_PATTERN = /\[Source:\s*([^\]\r\n]+)\]|【来源：\s*([^】\r\n]+)】/gu
const ENGLISH_PAGE_SUFFIX = /,\s*p\.\s*(\d+)\s*$/u
const CHINESE_PAGE_SUFFIX = /，\s*第\s*(\d+)\s*页\s*$/u

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
  const normalized = title.normalize('NFC').trim()
  return normalized.length > 0 && normalized.length <= 512 ? { title: normalized } : null
}
