import {
  REFERENCE_SEARCH_AUTHOR_MAX_CHARS,
  REFERENCE_SEARCH_MAX_AUTHORS,
  referenceSearchResultSchema,
  type ReferenceSearchCandidate,
  type ReferenceSearchResult
} from '../../shared/contracts/references'

export interface ReferenceSearchRecord {
  referenceId: string
  citationKey: string
  title: string
  authors: readonly string[]
  issuedYear: number | null
}

interface RankedReferenceSearchCandidate {
  candidate: ReferenceSearchCandidate
  citationKey: string
  foldedTitle: string
  rank: number
  sourceIndex: number
}

/**
 * Rank compact Reference metadata for the editor's citation picker.
 *
 * The complete input set is ranked before the result is bounded to three items. Search never
 * parses CSL JSON and only returns the safe, compact candidate projection.
 */
export function searchReferenceCandidates(
  records: readonly ReferenceSearchRecord[],
  rawQuery: string
): ReferenceSearchResult {
  const query = rawQuery.normalize('NFC').trim()
  const foldedQuery = normalizeSearchText(query)
  const tokens = foldedQuery.length === 0 ? [] : foldedQuery.split(' ')

  const ranked: RankedReferenceSearchCandidate[] = records.flatMap((record, sourceIndex) => {
    const candidate = toCandidate(record)
    const foldedCitationKey = normalizeSearchText(record.citationKey)
    const foldedTitle = normalizeSearchText(record.title)
    const foldedAuthors = record.authors.map(normalizeSearchText).filter(Boolean)
    const rank = rankCandidate({
      candidate,
      query,
      foldedQuery,
      tokens,
      foldedCitationKey,
      foldedTitle,
      foldedAuthors
    })
    if (foldedQuery.length > 0 && rank === null) return []
    return [
      {
        candidate,
        citationKey: record.citationKey,
        foldedTitle,
        rank: rank ?? 0,
        sourceIndex
      }
    ]
  })

  ranked.sort(compareRankedCandidates)

  return referenceSearchResultSchema.parse({
    items: ranked.slice(0, 3).map((entry) => entry.candidate),
    hasReferences: records.length > 0
  })
}

function rankCandidate(options: {
  candidate: ReferenceSearchCandidate
  query: string
  foldedQuery: string
  tokens: string[]
  foldedCitationKey: string
  foldedTitle: string
  foldedAuthors: string[]
}): number | null {
  if (options.foldedQuery.length === 0) return 0

  const searchableFields = [
    options.foldedCitationKey,
    options.foldedTitle,
    ...options.foldedAuthors,
    options.candidate.issuedYear === null ? '' : String(options.candidate.issuedYear)
  ]
  if (!options.tokens.every((token) => searchableFields.some((field) => field.includes(token)))) {
    return null
  }

  if (options.candidate.citationKey === options.query) return 0
  if (options.foldedCitationKey === options.foldedQuery) return 1
  if (options.foldedCitationKey.startsWith(options.foldedQuery)) return 2
  if (options.foldedTitle === options.foldedQuery) return 3
  if (options.foldedTitle.includes(options.foldedQuery)) return 4
  return 5
}

function compareRankedCandidates(
  left: RankedReferenceSearchCandidate,
  right: RankedReferenceSearchCandidate
): number {
  if (left.rank !== right.rank) return left.rank - right.rank
  const titleComparison = compareText(left.foldedTitle, right.foldedTitle)
  if (titleComparison !== 0) return titleComparison
  const rawTitleComparison = compareText(left.candidate.title, right.candidate.title)
  if (rawTitleComparison !== 0) return rawTitleComparison
  const keyComparison = compareText(left.citationKey, right.citationKey)
  if (keyComparison !== 0) return keyComparison
  return left.sourceIndex - right.sourceIndex
}

function compareText(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim()
}

function toCandidate(record: ReferenceSearchRecord): ReferenceSearchCandidate {
  return {
    referenceId: record.referenceId,
    citationKey: record.citationKey,
    title: record.title,
    authors: record.authors
      .map((author) => author.normalize('NFC').trim())
      .filter(Boolean)
      .slice(0, REFERENCE_SEARCH_MAX_AUTHORS)
      .map((author) => truncateUnicode(author, REFERENCE_SEARCH_AUTHOR_MAX_CHARS)),
    issuedYear: record.issuedYear
  }
}

function truncateUnicode(value: string, maximumCharacters: number): string {
  return Array.from(value).slice(0, maximumCharacters).join('')
}
