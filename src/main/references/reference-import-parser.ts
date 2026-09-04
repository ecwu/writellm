import { createHash } from 'node:crypto'
import { Cite } from '@citation-js/core'
import '@citation-js/plugin-bibtex'
import { z } from 'zod'
import {
  BIBLIOGRAPHY_SOURCE_MAX_BYTES,
  BIBLIOGRAPHY_SOURCE_MAX_ITEMS,
  CITATION_KEY_PATTERN,
  REFERENCE_CSL_MAX_BYTES,
  cslItemSchema,
  type CslItem
} from '../../shared/contracts/references'

export interface ParsedReferenceSourceItem {
  readonly item: CslItem
  readonly upstreamKey: string
  readonly fingerprint: string
  readonly attachmentPaths: readonly string[]
}

export interface ReferenceSourceIssue {
  readonly index: number
  readonly upstreamKey: string | null
  readonly code: 'invalid_item' | 'duplicate_upstream_key' | 'item_too_large'
  readonly message: string
  readonly cause?: unknown
}

export interface ParsedReferenceSource {
  readonly items: readonly ParsedReferenceSourceItem[]
  readonly issues: readonly ReferenceSourceIssue[]
  readonly sourceFingerprint: string
}

const cslArraySchema = z.array(z.unknown()).max(BIBLIOGRAPHY_SOURCE_MAX_ITEMS)

export function parseReferenceSource(
  source: string,
  format: 'better-csl-json' | 'bibtex'
): ParsedReferenceSource {
  const sourceBytes = Buffer.byteLength(source)
  if (sourceBytes === 0 || sourceBytes > BIBLIOGRAPHY_SOURCE_MAX_BYTES) {
    throw new Error('Bibliography source size is outside the allowed range')
  }
  const rawItems =
    format === 'better-csl-json'
      ? cslArraySchema.parse(JSON.parse(source) as unknown).map((item) => ({ item, raw: null }))
      : splitBibtexEntries(source).map((raw) => {
          try {
            return { item: new Cite(raw).format('data', { format: 'object' }), raw }
          } catch (err) {
            return { item: null, raw, parseError: err }
          }
        })
  if (rawItems.length > BIBLIOGRAPHY_SOURCE_MAX_ITEMS) {
    throw new Error('Bibliography source contains too many entries')
  }

  const items: ParsedReferenceSourceItem[] = []
  const issues: ReferenceSourceIssue[] = []
  const upstreamKeys = new Set<string>()
  rawItems.forEach((entry, index) => {
    let candidate: unknown = entry.item
    if (entry.raw !== null) {
      const parsed = z.array(z.unknown()).safeParse(candidate)
      candidate = parsed.success && parsed.data.length === 1 ? parsed.data[0] : candidate
    }
    const itemResult = cslItemSchema.safeParse(candidate)
    const approximateKey = approximateUpstreamKey(candidate)
    if (!itemResult.success) {
      issues.push({
        index,
        upstreamKey: approximateKey,
        code: 'invalid_item',
        message: 'Entry is missing required bounded CSL metadata',
        ...(entry.parseError === undefined ? {} : { cause: entry.parseError })
      })
      return
    }
    const canonical = canonicalJson(itemResult.data)
    if (Buffer.byteLength(canonical) > REFERENCE_CSL_MAX_BYTES) {
      issues.push({
        index,
        upstreamKey: itemResult.data['citation-key'] ?? itemResult.data.id,
        code: 'item_too_large',
        message: 'Entry exceeds the per-reference metadata limit'
      })
      return
    }
    const upstreamKey = itemResult.data['citation-key'] ?? itemResult.data.id
    if (upstreamKeys.has(upstreamKey)) {
      issues.push({
        index,
        upstreamKey,
        code: 'duplicate_upstream_key',
        message: 'Entry duplicates an upstream key in this snapshot'
      })
      return
    }
    upstreamKeys.add(upstreamKey)
    items.push({
      item: itemResult.data,
      upstreamKey,
      fingerprint: sha256(canonical),
      attachmentPaths:
        entry.raw === null ? cslAttachmentPaths(itemResult.data) : bibFilePaths(entry.raw)
    })
  })

  return {
    items,
    issues,
    sourceFingerprint: sha256(source)
  }
}

export function createCitationKey(options: {
  item: CslItem
  upstreamKey: string
  fingerprint: string
  reservedKeys?: ReadonlySet<string>
}): string {
  const reserved = options.reservedKeys ?? new Set<string>()
  const declaredKey = (options.item['citation-key'] ?? options.upstreamKey).trim()
  const suffix = options.fingerprint.slice(0, 8)
  if (declaredKey !== undefined && CITATION_KEY_PATTERN.test(declaredKey)) {
    return reserved.has(declaredKey) ? appendSuffix(declaredKey, suffix) : declaredKey
  }
  const slug = declaredKey
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._:+-]+/gu, '-')
    .replace(/^[^A-Za-z0-9]+/u, '')
    .replace(/[-.]+$/u, '')
    .slice(0, 118)
  const base = `${slug || `ref-${issuedYear(options.item) ?? 'nd'}`}-${suffix}`
  return reserved.has(base) ? appendSuffix(base, suffix) : base
}

export function issuedYear(item: CslItem): number | null {
  const value = item.issued?.['date-parts'][0]?.[0]
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^-?\d{1,4}$/u.test(value)) return Number(value)
  return null
}

export function containerTitle(item: CslItem): string | null {
  const value = item['container-title']
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function appendSuffix(value: string, suffix: string): string {
  const prefix = value.slice(0, Math.max(1, 119))
  const candidate = `${prefix}-${suffix}`
  if (!CITATION_KEY_PATTERN.test(candidate))
    throw new Error('Could not generate a safe citation key')
  return candidate
}

function cslAttachmentPaths(item: CslItem): string[] {
  return item.file === undefined ? [] : splitAttachmentField(item.file)
}

function bibFilePaths(source: string): string[] {
  const match = /(?:^|[,\s])file\s*=\s*/iu.exec(source)
  if (match === null) return []
  const start = match.index + match[0].length
  const raw = readBibValue(source, start)
  return raw === null ? [] : splitAttachmentField(raw)
}

function splitAttachmentField(value: string): string[] {
  return value
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const withoutMime = entry.replace(/:application\/pdf$/iu, '')
      if (/^[A-Za-z]:[\\/]/u.test(withoutMime) || withoutMime.startsWith('/')) {
        return withoutMime.replaceAll('\\;', ';').trim()
      }
      const separator = withoutMime.indexOf(':')
      const possiblePath = separator === -1 ? withoutMime : withoutMime.slice(separator + 1)
      return possiblePath.replaceAll('\\;', ';').trim()
    })
    .filter(Boolean)
}

function readBibValue(source: string, offset: number): string | null {
  const opener = source[offset]
  if (opener !== '{' && opener !== '"') return null
  const closer = opener === '{' ? '}' : '"'
  let depth = opener === '{' ? 1 : 0
  let escaped = false
  let output = ''
  for (let index = offset + 1; index < source.length; index += 1) {
    const char = source[index] as string
    if (escaped) {
      output += char
      escaped = false
      continue
    }
    if (char === '\\') {
      output += char
      escaped = true
      continue
    }
    if (opener === '{' && char === '{') depth += 1
    if (char === closer) {
      if (opener === '"' || --depth === 0) return output
    }
    output += char
  }
  return null
}

function splitBibtexEntries(source: string): string[] {
  const entries: string[] = []
  let index = 0
  while (index < source.length) {
    const start = source.indexOf('@', index)
    if (start === -1) break
    const openerIndex = source.slice(start).search(/[({]/u)
    if (openerIndex === -1) break
    const absoluteOpener = start + openerIndex
    const opener = source[absoluteOpener]
    const closer = opener === '{' ? '}' : ')'
    let depth = 1
    let quote = false
    let escaped = false
    let cursor = absoluteOpener + 1
    for (; cursor < source.length; cursor += 1) {
      const char = source[cursor]
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === '"') quote = !quote
      if (quote) continue
      if (char === opener) depth += 1
      if (char === closer && --depth === 0) {
        entries.push(source.slice(start, cursor + 1))
        index = cursor + 1
        break
      }
    }
    if (depth !== 0) {
      entries.push(source.slice(start))
      break
    }
  }
  return entries
}

function approximateUpstreamKey(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const key = record['citation-key'] ?? record['id']
  return typeof key === 'string' ? key.slice(0, 1024) : null
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
    )
    .join(',')}}`
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
