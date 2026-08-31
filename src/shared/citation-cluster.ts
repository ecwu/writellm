import { citationKeySchema } from './contracts/references'

export type CitationClusterSyntax = 'english' | 'chinese'

export interface CitationPageLocator {
  readonly label: 'page'
  readonly startPageIndex: number
  readonly endPageIndex: number
  readonly raw: string
}

export interface CitationClusterItem {
  readonly citationKey: string
  readonly locator?: CitationPageLocator
}

export interface CitationCluster {
  readonly from: number
  readonly to: number
  readonly raw: string
  readonly syntax: CitationClusterSyntax
  readonly items: readonly CitationClusterItem[]
}

const ENGLISH_CLUSTER_PATTERN = /\[(@[^\]\r\n\uFFFC]+)\]/gu
const CHINESE_CLUSTER_PATTERN = /【(@[^】\r\n\uFFFC]+)】/gu
const ENGLISH_LOCATOR = /,\s*(p|pp)\.\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*$/u
const CHINESE_LOCATOR = /，\s*第\s*(\d+)(?:\s*[-–—]\s*(\d+))?\s*页\s*$/u

export function findCitationClusters(text: string): CitationCluster[] {
  const matches = [
    ...findSyntaxClusters(text, ENGLISH_CLUSTER_PATTERN, 'english'),
    ...findSyntaxClusters(text, CHINESE_CLUSTER_PATTERN, 'chinese')
  ]
  return matches.sort((left, right) => left.from - right.from)
}

function findSyntaxClusters(
  text: string,
  pattern: RegExp,
  syntax: CitationClusterSyntax
): CitationCluster[] {
  const clusters: CitationCluster[] = []
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    const raw = match[0]
    const body = match[1] ?? ''
    const items = parseClusterBody(body, syntax)
    if (items === null) continue
    clusters.push({
      from: match.index,
      to: match.index + raw.length,
      raw,
      syntax,
      items
    })
  }
  return clusters
}

function parseClusterBody(
  body: string,
  syntax: CitationClusterSyntax
): readonly CitationClusterItem[] | null {
  const separator = syntax === 'english' ? ';' : '；'
  const parts = body.split(separator)
  if (parts.length === 0 || parts.length > 100) return null
  const items: CitationClusterItem[] = []
  for (const part of parts) {
    const parsed = parseClusterItem(part.trim(), syntax)
    if (parsed === null) return null
    items.push(parsed)
  }
  return items
}

function parseClusterItem(
  value: string,
  syntax: CitationClusterSyntax
): CitationClusterItem | null {
  if (!value.startsWith('@')) return null
  const locatorPattern = syntax === 'english' ? ENGLISH_LOCATOR : CHINESE_LOCATOR
  const locatorMatch = locatorPattern.exec(value)
  const rawKey = value.slice(1, locatorMatch?.index ?? value.length).trim()
  const key = citationKeySchema.safeParse(rawKey)
  if (!key.success) return null
  if (locatorMatch === null) {
    const malformedLocator = syntax === 'english' ? /,\s*p{1,2}\./u : /，\s*第/u
    return malformedLocator.test(value) ? null : { citationKey: key.data }
  }
  const startText = syntax === 'english' ? locatorMatch[2] : locatorMatch[1]
  const endText = syntax === 'english' ? locatorMatch[3] : locatorMatch[2]
  const start = Number(startText)
  const end = endText === undefined ? start : Number(endText)
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    return null
  }
  return {
    citationKey: key.data,
    locator: {
      label: 'page',
      startPageIndex: start - 1,
      endPageIndex: end - 1,
      raw: locatorMatch[0]
    }
  }
}
