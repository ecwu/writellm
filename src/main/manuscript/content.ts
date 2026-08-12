import { createHash } from 'node:crypto'
import {
  SECTION_CONTENT_SCHEMA_VERSION,
  SECTION_COUNT_ALGORITHM_VERSION
} from '../../shared/contracts/manuscript'
import { stripReadableCitations } from '../../shared/readable-citation'

const unicodeWordCharacter = /[\p{L}\p{N}]/u
const cjkCharacter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const whitespace = /\s/u

export interface PreparedSectionContent {
  content: unknown[]
  contentJson: string
  contentHash: string
  contentSchemaVersion: typeof SECTION_CONTENT_SCHEMA_VERSION
  wordCount: number
  characterCount: number
  countAlgorithmVersion: typeof SECTION_COUNT_ALGORITHM_VERSION
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Section content contains a non-finite number')
    return value
  }
  if (typeof value !== 'object') throw new TypeError('Section content is not JSON serializable')
  if (seen.has(value)) throw new TypeError('Section content contains a cycle')
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((item) => canonicalize(item, seen))
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError('Section content contains a non-JSON object')
    }
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize((value as Record<string, unknown>)[key], seen)])
    )
  } finally {
    seen.delete(value)
  }
}

function extractInline(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(extractInline).join('')
  if (value === null || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (typeof record.content === 'string') return record.content
  if (Array.isArray(record.content)) return extractInline(record.content)
  if (Array.isArray(record.rows)) return record.rows.map(extractTableRow).join('\n')
  return ''
}

function extractTableRow(value: unknown): string {
  if (value === null || typeof value !== 'object') return ''
  const cells = (value as Record<string, unknown>).cells
  return Array.isArray(cells) ? cells.map(extractTableCell).join('\n') : ''
}

function extractTableCell(value: unknown): string {
  if (Array.isArray(value)) {
    const hasBlocks = value.some(
      (item) => item !== null && typeof item === 'object' && 'children' in item
    )
    return hasBlocks ? value.map(extractBlock).join('\n') : extractInline(value)
  }
  return extractInline(value)
}

function extractBlock(value: unknown): string {
  if (value === null || typeof value !== 'object') return ''
  const block = value as Record<string, unknown>
  const props =
    block.props !== null && typeof block.props === 'object'
      ? (block.props as Record<string, unknown>)
      : undefined
  const body =
    block.type === 'image' || block.type === 'mermaid' || block.type === 'math'
      ? typeof props?.caption === 'string'
        ? props.caption
        : ''
      : Array.isArray(block.rows)
        ? block.rows.map(extractTableRow).join('\n')
        : block.content !== undefined
          ? extractInline(block.content)
          : ''
  const children = Array.isArray(block.children) ? block.children.map(extractBlock).join('\n') : ''
  return body && children ? `${body}\n${children}` : body || children
}

export function extractSectionText(content: readonly unknown[]): string {
  return content.map(extractBlock).join('\n')
}

export function extractSectionAgentText(content: readonly unknown[]): string {
  const extract = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return ''
    const block = value as Record<string, unknown>
    const props =
      block.props !== null && typeof block.props === 'object'
        ? (block.props as Record<string, unknown>)
        : undefined
    let body: string
    if (block.type === 'image') {
      body = [props?.name, props?.caption]
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .join('\n')
    } else if (block.type === 'mermaid' || block.type === 'math') {
      body = [props?.caption, typeof props?.source === 'string' ? props.source.slice(0, 8_192) : '']
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .join('\n')
    } else {
      body = extractBlock({ ...block, children: [] })
    }
    const children = Array.isArray(block.children) ? block.children.map(extract).join('\n') : ''
    return body && children ? `${body}\n${children}` : body || children
  }
  return content.map(extract).join('\n')
}

export function countSectionText(text: string): { wordCount: number; characterCount: number } {
  const normalized = text.normalize('NFC')
  let characterCount = 0
  let wordCount = 0
  let inWord = false

  for (const character of normalized) {
    if (!whitespace.test(character)) characterCount += 1
    if (cjkCharacter.test(character)) {
      wordCount += 1
      inWord = false
    } else if (unicodeWordCharacter.test(character)) {
      if (!inWord) wordCount += 1
      inWord = true
    } else {
      inWord = false
    }
  }
  return { wordCount, characterCount }
}

export function prepareSectionContent(content: unknown[]): PreparedSectionContent {
  const canonical = canonicalize(content, new Set()) as unknown[]
  const contentJson = JSON.stringify(canonical)
  const contentHash = createHash('sha256').update(contentJson).digest('hex')
  const counts = countSectionText(stripReadableCitations(extractSectionText(content)))
  return {
    content,
    contentJson,
    contentHash,
    contentSchemaVersion: SECTION_CONTENT_SCHEMA_VERSION,
    ...counts,
    countAlgorithmVersion: SECTION_COUNT_ALGORITHM_VERSION
  }
}
