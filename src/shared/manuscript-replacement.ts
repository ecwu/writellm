import { createHash } from 'node:crypto'
import type {
  BlockNoteBlockValue,
  BlockNoteDocument,
  BlockNoteInlineContent
} from './contracts/manuscript'
import type { ManuscriptReplacementSkipReason } from './contracts/manuscript-replacement'
import type { ManuscriptSearchTargetContract } from './contracts/manuscript-search'
import { findReadableCitations } from './readable-citation'

type WritableSearchTarget = Exclude<
  ManuscriptSearchTargetContract,
  { kind: 'section_title' | 'section_objective' }
>

export interface ReplacementClassification {
  sourceText: string
  skipReason: ManuscriptReplacementSkipReason | null
}

export interface ReplacementOperation {
  target: ManuscriptSearchTargetContract
  sourceSliceHash: string
}

export class ReplacementPreconditionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplacementPreconditionError'
  }
}

export function classifyReplacementTarget(
  document: BlockNoteDocument,
  target: ManuscriptSearchTargetContract,
  replacement: string
): ReplacementClassification {
  if (target.kind === 'section_title' || target.kind === 'section_objective') {
    return { sourceText: '', skipReason: 'section_metadata' }
  }
  const writableTarget = target as WritableSearchTarget
  const source = resolveTarget(document, writableTarget)
  if (overlapsReadableCitation(source.surfaceText, source.flatFrom, source.flatTo)) {
    return { sourceText: source.sourceText, skipReason: 'readable_citation' }
  }
  if (writableTarget.kind === 'block_inline' || writableTarget.kind === 'table_cell') {
    if (writableTarget.segments.some((segment) => segment.linkTextIndex !== undefined)) {
      return { sourceText: source.sourceText, skipReason: 'link_text' }
    }
    if (source.block.type === 'codeBlock') {
      return { sourceText: source.sourceText, skipReason: 'code_block' }
    }
    if (writableTarget.segments.some((segment) => segmentHasCodeStyle(source.inline, segment))) {
      return { sourceText: source.sourceText, skipReason: 'inline_code' }
    }
    if (!writableTarget.segments.every((segment) => segmentIsPlainText(source.inline, segment))) {
      return { sourceText: source.sourceText, skipReason: 'structured_overlap' }
    }
  }
  if (source.sourceText === replacement) {
    return { sourceText: source.sourceText, skipReason: 'unchanged' }
  }
  return { sourceText: source.sourceText, skipReason: null }
}

export function applyReplacementOperations(
  original: BlockNoteDocument,
  operations: readonly ReplacementOperation[],
  replacement: string
): BlockNoteDocument {
  const document = structuredClone(original)
  const ordered = [...operations].sort((left, right) => {
    const sectionOrder = targetSurfaceKey(right.target).localeCompare(targetSurfaceKey(left.target))
    if (sectionOrder !== 0) return sectionOrder
    return targetFrom(right.target) - targetFrom(left.target)
  })
  for (const operation of ordered) {
    const classification = classifyReplacementTarget(document, operation.target, replacement)
    if (classification.skipReason !== null) {
      throw new ReplacementPreconditionError('Replacement target is no longer eligible')
    }
    if (sha256(classification.sourceText) !== operation.sourceSliceHash) {
      throw new ReplacementPreconditionError('Replacement source text changed')
    }
    applyOne(document, operation.target, replacement)
  }
  return document
}

function applyOne(
  document: BlockNoteDocument,
  target: ManuscriptSearchTargetContract,
  replacement: string
): void {
  if (target.kind === 'section_title' || target.kind === 'section_objective') {
    throw new ReplacementPreconditionError('Section metadata is not writable')
  }
  const writableTarget = target as WritableSearchTarget
  const resolved = resolveTarget(document, writableTarget)
  if (writableTarget.kind === 'block_caption') {
    const caption = resolved.block.props.caption
    if (typeof caption !== 'string') throw new ReplacementPreconditionError('Caption is missing')
    resolved.block.props.caption =
      caption.slice(0, writableTarget.range.from) +
      replacement +
      caption.slice(writableTarget.range.to)
    return
  }

  const segments = writableTarget.segments
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (segment === undefined) continue
    const node = resolved.inline[segment.inlineIndex]
    if (node?.type !== 'text' || segment.linkTextIndex !== undefined) {
      throw new ReplacementPreconditionError('Inline source structure changed')
    }
    const insert = index === 0 ? replacement : ''
    node.text = node.text.slice(0, segment.range.from) + insert + node.text.slice(segment.range.to)
  }
  const consumedIndexes = new Set(
    segments
      .filter((segment) => segment.linkTextIndex === undefined)
      .map((segment) => segment.inlineIndex)
  )
  resolved.replaceInline(
    resolved.inline.filter(
      (node, index) =>
        !(consumedIndexes.has(index) && node.type === 'text' && node.text.length === 0)
    )
  )
}

function resolveTarget(
  document: BlockNoteDocument,
  target: WritableSearchTarget
): {
  block: BlockNoteBlockValue
  inline: BlockNoteInlineContent[]
  replaceInline(value: BlockNoteInlineContent[]): void
  surfaceText: string
  sourceText: string
  flatFrom: number
  flatTo: number
} {
  const block = findBlock(document, target.blockId)
  if (block === undefined) throw new ReplacementPreconditionError('Replacement block changed')
  if (target.kind === 'block_caption') {
    const caption = block.props[target.property]
    if (typeof caption !== 'string' || target.range.to > caption.length) {
      throw new ReplacementPreconditionError('Replacement caption changed')
    }
    return {
      block,
      inline: [],
      replaceInline: () => undefined,
      surfaceText: caption,
      sourceText: caption.slice(target.range.from, target.range.to),
      flatFrom: target.range.from,
      flatTo: target.range.to
    }
  }
  const inline =
    target.kind === 'block_inline'
      ? Array.isArray(block.content)
        ? block.content
        : undefined
      : tableInline(block, target.rowIndex, target.cellIndex)
  if (inline === undefined) throw new ReplacementPreconditionError('Replacement surface changed')
  const flat = flattenInline(inline)
  if (target.flatRange.to > flat.text.length) {
    throw new ReplacementPreconditionError('Replacement range changed')
  }
  const sourceText = target.segments.map((segment) => segmentText(inline, segment)).join('')
  if (sourceText !== flat.text.slice(target.flatRange.from, target.flatRange.to)) {
    throw new ReplacementPreconditionError('Replacement source mapping changed')
  }
  return {
    block,
    inline,
    replaceInline(value) {
      if (target.kind === 'block_inline') block.content = value
      else {
        if (block.content === undefined || Array.isArray(block.content)) {
          throw new ReplacementPreconditionError('Replacement table changed')
        }
        const cell = block.content.rows[target.rowIndex]?.cells[target.cellIndex]
        if (cell === undefined) throw new ReplacementPreconditionError('Replacement cell changed')
        const row = block.content.rows[target.rowIndex]
        if (row === undefined) throw new ReplacementPreconditionError('Replacement row changed')
        if (Array.isArray(cell)) row.cells[target.cellIndex] = value
        else cell.content = value
      }
    },
    surfaceText: flat.text,
    sourceText,
    flatFrom: target.flatRange.from,
    flatTo: target.flatRange.to
  }
}

function findBlock(
  blocks: readonly BlockNoteBlockValue[],
  blockId: string
): BlockNoteBlockValue | undefined {
  for (const block of blocks) {
    if (block.id === blockId) return block
    const child = findBlock(block.children, blockId)
    if (child !== undefined) return child
  }
  return undefined
}

function tableInline(
  block: BlockNoteBlockValue,
  rowIndex: number,
  cellIndex: number
): BlockNoteInlineContent[] | undefined {
  if (block.type !== 'table' || block.content === undefined || Array.isArray(block.content)) {
    return undefined
  }
  const cell = block.content.rows[rowIndex]?.cells[cellIndex]
  if (cell === undefined) return undefined
  return Array.isArray(cell) ? cell : cell.content
}

function flattenInline(inline: readonly BlockNoteInlineContent[]): { text: string } {
  return {
    text: inline
      .map((node) =>
        node.type === 'text'
          ? node.text
          : node.type === 'link'
            ? node.content.map((child) => child.text).join('')
            : '\uFFFC'
      )
      .join('')
  }
}

function segmentText(
  inline: readonly BlockNoteInlineContent[],
  segment: { inlineIndex: number; linkTextIndex?: number; range: { from: number; to: number } }
): string {
  const node = inline[segment.inlineIndex]
  const text =
    segment.linkTextIndex === undefined
      ? node?.type === 'text'
        ? node.text
        : undefined
      : node?.type === 'link'
        ? node.content[segment.linkTextIndex]?.text
        : undefined
  if (text === undefined || segment.range.to > text.length) {
    throw new ReplacementPreconditionError('Replacement segment changed')
  }
  return text.slice(segment.range.from, segment.range.to)
}

function segmentIsPlainText(
  inline: readonly BlockNoteInlineContent[],
  segment: { inlineIndex: number; linkTextIndex?: number; range: { from: number; to: number } }
): boolean {
  const node = inline[segment.inlineIndex]
  return (
    node?.type === 'text' &&
    segment.linkTextIndex === undefined &&
    segment.range.to <= node.text.length
  )
}

function segmentHasCodeStyle(
  inline: readonly BlockNoteInlineContent[],
  segment: { inlineIndex: number; linkTextIndex?: number }
): boolean {
  const node = inline[segment.inlineIndex]
  const textNode =
    segment.linkTextIndex === undefined
      ? node?.type === 'text'
        ? node
        : undefined
      : node?.type === 'link'
        ? node.content[segment.linkTextIndex]
        : undefined
  return textNode?.styles.code === true
}

function overlapsReadableCitation(text: string, from: number, to: number): boolean {
  return findReadableCitations(text).some((citation) => citation.from < to && citation.to > from)
}

function targetSurfaceKey(target: ManuscriptSearchTargetContract): string {
  switch (target.kind) {
    case 'section_title':
    case 'section_objective':
      return `${target.kind}:${target.sectionId}`
    case 'block_inline':
    case 'block_caption':
      return `${target.kind}:${target.blockId}`
    case 'table_cell':
      return `${target.kind}:${target.blockId}:${target.rowIndex}:${target.cellIndex}`
  }
}

function targetFrom(target: ManuscriptSearchTargetContract): number {
  return target.kind === 'block_inline' || target.kind === 'table_cell'
    ? target.flatRange.from
    : target.range.from
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
