import type { BlockNoteDocument, ManuscriptReferenceIndex } from '../../shared/contracts/manuscript'
import type { ReferenceItem } from '../../shared/contracts/references'
import { findReadableCitations, normalizeCitationTitle } from '../../shared/readable-citation'

export function planLegacyCitationConversion(
  index: ManuscriptReferenceIndex,
  references: readonly ReferenceItem[]
): {
  replacements: Array<{ title: string; citationKey: string; occurrenceCount: number }>
  ambiguousTitles: string[]
  unmatchedTitles: string[]
} {
  const referencesByTitle = new Map<string, ReferenceItem[]>()
  for (const reference of references) {
    const title = normalizeCitationTitle(reference.title)
    referencesByTitle.set(title, [...(referencesByTitle.get(title) ?? []), reference])
  }
  const replacements: Array<{ title: string; citationKey: string; occurrenceCount: number }> = []
  const ambiguousTitles: string[] = []
  const unmatchedTitles: string[] = []
  for (const entry of index.entries) {
    if (entry.citationKey !== undefined) continue
    const matches = referencesByTitle.get(normalizeCitationTitle(entry.title)) ?? []
    if (matches.length === 1) {
      replacements.push({
        title: entry.title,
        citationKey: matches[0]?.citationKey as string,
        occurrenceCount: entry.count
      })
    } else if (matches.length > 1) ambiguousTitles.push(entry.title)
    else unmatchedTitles.push(entry.title)
  }
  return { replacements, ambiguousTitles, unmatchedTitles }
}

export function convertLegacyCitations(
  document: BlockNoteDocument,
  citationKeyByTitle: ReadonlyMap<string, string>
): BlockNoteDocument {
  const clone = structuredClone(document) as unknown
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value === null || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.type === 'text' && typeof record.text === 'string') {
      record.text = replaceText(record.text, citationKeyByTitle)
    }
    for (const child of Object.values(record)) visit(child)
  }
  visit(clone)
  return clone as BlockNoteDocument
}

function replaceText(text: string, citationKeyByTitle: ReadonlyMap<string, string>): string {
  const matches = findReadableCitations(text)
  if (matches.length === 0) return text
  let output = ''
  let cursor = 0
  for (const citation of matches) {
    output += text.slice(cursor, citation.from)
    const key = citationKeyByTitle.get(normalizeCitationTitle(citation.title))
    if (key === undefined) output += citation.raw
    else if (citation.syntax === 'chinese') {
      output +=
        citation.pageIndex === undefined
          ? `【@${key}】`
          : `【@${key}，第 ${citation.pageIndex + 1} 页】`
    } else {
      output +=
        citation.pageIndex === undefined ? `[@${key}]` : `[@${key}, p. ${citation.pageIndex + 1}]`
    }
    cursor = citation.to
  }
  return output + text.slice(cursor)
}
