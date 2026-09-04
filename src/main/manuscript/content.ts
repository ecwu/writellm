import { createHash } from 'node:crypto'
import {
  blockNoteDocumentSchema,
  type BlockNoteDocument,
  normalizeFigureMetadata,
  normalizePlainBlockContent,
  plainTextContentSchema,
  plainTextContentToString,
  projectLegacyBlockNoteDocument,
  SECTION_CONTENT_SCHEMA_VERSION,
  SECTION_COUNT_ALGORITHM_VERSION
} from '../../shared/contracts/manuscript'
import { stripReadableCitations } from '../../shared/readable-citation'

const unicodeWordCharacter = /[\p{L}\p{N}]/u
const cjkCharacter = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const whitespace = /\s/u

export interface PreparedSectionContent {
  content: BlockNoteDocument
  contentJson: string
  contentHash: string
  contentSchemaVersion: typeof SECTION_CONTENT_SCHEMA_VERSION
  wordCount: number
  characterCount: number
  countAlgorithmVersion: typeof SECTION_COUNT_ALGORITHM_VERSION
}

export function decodeStoredSectionContent(
  contentJson: string,
  contentSchemaVersion: number,
  sectionId: string
): BlockNoteDocument {
  const stored = JSON.parse(contentJson) as unknown
  const projected =
    contentSchemaVersion === SECTION_CONTENT_SCHEMA_VERSION
      ? blockNoteDocumentSchema.parse(stored)
      : projectLegacyBlockNoteDocument(stored)
  return normalizeFigureMetadata(projected, sectionId)
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
  if (record.type === 'math' && typeof record.content === 'string') return '\n'
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
    block.type === 'image' || block.type === 'diagram' || block.type === 'mathBlock'
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
  const extractAgentTableCell = (value: unknown): string => {
    if (Array.isArray(value)) {
      const hasBlocks = value.some(
        (item) => item !== null && typeof item === 'object' && 'children' in item
      )
      return hasBlocks ? value.map(extract).join('\n') : extractAgentInline(value)
    }
    return extractAgentInline(value)
  }
  const extractAgentTableRow = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return ''
    const cells = (value as Record<string, unknown>).cells
    return Array.isArray(cells) ? cells.map(extractAgentTableCell).join('\n') : ''
  }
  const extractAgentInline = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (Array.isArray(value)) return value.map(extractAgentInline).join('')
    if (value === null || typeof value !== 'object') return ''
    const record = value as Record<string, unknown>
    if (record.type === 'math' && typeof record.content === 'string') {
      return `$${record.content.slice(0, 8_192)}$`
    }
    if (typeof record.text === 'string') return record.text
    if (Array.isArray(record.content)) return extractAgentInline(record.content)
    if (Array.isArray(record.rows)) return record.rows.map(extractAgentTableRow).join('\n')
    return ''
  }
  const extract = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return ''
    const block = value as Record<string, unknown>
    const props =
      block.props !== null && typeof block.props === 'object'
        ? (block.props as Record<string, unknown>)
        : undefined
    let body: string
    if (block.type === 'image') {
      body = [props?.altText ?? props?.name, props?.caption]
        .filter((item): item is string => typeof item === 'string' && item.length > 0)
        .join('\n')
    } else if (block.type === 'mathBlock') {
      const source = Array.isArray(block.content)
        ? plainTextContentToString(plainTextContentSchema.parse(block.content)).slice(0, 32_000)
        : ''
      body = `$$${source}$$`
    } else if (block.type === 'diagram') {
      const source = Array.isArray(block.content)
        ? plainTextContentToString(plainTextContentSchema.parse(block.content)).slice(0, 64_000)
        : ''
      const caption = typeof props?.caption === 'string' ? props.caption : ''
      const altText = typeof props?.altText === 'string' ? props.altText : ''
      body = [
        `\`\`\`mermaid\n${source}\n\`\`\``,
        caption.length > 0 ? `Caption: ${caption}` : '',
        altText.length > 0 ? `Alt text: ${altText}` : ''
      ]
        .filter((item) => item.length > 0)
        .join('\n')
    } else {
      body =
        block.content !== undefined
          ? extractAgentInline(block.content)
          : extractBlock({ ...block, children: [] })
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

export function prepareSectionContent(
  content: unknown,
  sectionId?: string
): PreparedSectionContent {
  return prepareValidatedSectionContent(blockNoteDocumentSchema.parse(content), sectionId)
}

export function prepareValidatedSectionContent(
  parsedContent: BlockNoteDocument,
  sectionId?: string
): PreparedSectionContent {
  const preparedContent =
    sectionId === undefined
      ? normalizePlainBlockContent(parsedContent)
      : normalizeFigureMetadata(parsedContent, sectionId)
  const canonical = canonicalize(preparedContent, new Set()) as BlockNoteDocument
  const contentJson = JSON.stringify(canonical)
  const contentHash = createHash('sha256').update(contentJson).digest('hex')
  const counts = countSectionText(stripReadableCitations(extractSectionText(preparedContent)))
  return {
    content: preparedContent,
    contentJson,
    contentHash,
    contentSchemaVersion: SECTION_CONTENT_SCHEMA_VERSION,
    ...counts,
    countAlgorithmVersion: SECTION_COUNT_ALGORITHM_VERSION
  }
}
