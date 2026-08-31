import { Cite } from '@citation-js/core'
import '@citation-js/plugin-bibtex'
import type { CslItem, ReferenceItem } from '../../shared/contracts/references'

export interface BibliographyExportResult {
  readonly content: string
  readonly exportedCount: number
  readonly losses: readonly { citationKey: string; fields: readonly string[] }[]
}

export function createBibliographyExport(
  references: readonly ReferenceItem[],
  format: 'bibtex' | 'csl-json'
): BibliographyExportResult {
  const items = references
    .map((reference) => ({
      ...reference.csl,
      id: reference.citationKey,
      'citation-key': reference.citationKey
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  if (format === 'csl-json') {
    return {
      content: `${JSON.stringify(items, null, 2)}\n`,
      exportedCount: items.length,
      losses: []
    }
  }
  const content = `${String(
    (new Cite(items) as unknown as { format(name: string, options: object): unknown }).format(
      'bibtex',
      {}
    )
  ).trim()}\n`
  const roundTrip = new Cite(content).format('data', { format: 'object' }) as CslItem[]
  const roundTripByKey = new Map(roundTrip.map((item) => [item['citation-key'] ?? item.id, item]))
  const losses = items.flatMap((item) => {
    const restored = roundTripByKey.get(item.id)
    const fields = restored === undefined ? ['entry'] : changedCriticalFields(item, restored)
    return fields.length === 0 ? [] : [{ citationKey: item.id, fields }]
  })
  return { content, exportedCount: items.length, losses }
}

function changedCriticalFields(source: CslItem, restored: CslItem): string[] {
  const fields: string[] = []
  const compare = (field: string, left: unknown, right: unknown): void => {
    if (canonicalJson(left ?? null) !== canonicalJson(right ?? null)) fields.push(field)
  }
  compare('title', source.title, restored.title)
  compare('author', source.author, restored.author)
  compare('container-title', source['container-title'], restored['container-title'])
  compare('issued', source.issued, restored.issued)
  compare('DOI', source.DOI, restored.DOI)
  compare('ISBN', source.ISBN, restored.ISBN)
  compare('URL', source.URL, restored.URL)
  return fields
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    )
    .join(',')}}`
}
