import type {
  BlockNoteDocument,
  BlockNoteInlineContent,
  BlockNoteTableContent,
  BlockNoteBlockValue,
  SectionStatus
} from './contracts/manuscript'

export interface Utf16Range {
  from: number
  to: number
}

export interface ProjectionMatch extends Utf16Range {
  searchFrom: number
  searchTo: number
}

interface OffsetMapRun {
  searchFrom: number
  searchTo: number
  sourceFrom: number
  sourceTo: number
  mapping: 'linear' | 'atomic'
}

export interface ProjectionSearchResult {
  matches: ProjectionMatch[]
  slowPath: boolean
}

export interface CooperativeProjectionSearchResult extends ProjectionSearchResult {
  limitReached: boolean
}

export class SearchProjectionSliceLimitError extends Error {
  constructor() {
    super('A manuscript search surface contains a grapheme that exceeds the cooperative slice')
    this.name = 'SearchProjectionSliceLimitError'
  }
}

export interface InlineTextSegment {
  inlineIndex: number
  linkTextIndex?: number
  range: Utf16Range
}

export type ManuscriptSearchTarget =
  | {
      kind: 'section_title' | 'section_objective'
      sectionId: string
      range: Utf16Range
    }
  | {
      kind: 'block_inline'
      sectionId: string
      revisionId: string
      blockId: string
      segments: [InlineTextSegment, ...InlineTextSegment[]]
      flatRange: Utf16Range
    }
  | {
      kind: 'table_cell'
      sectionId: string
      revisionId: string
      blockId: string
      rowIndex: number
      cellIndex: number
      segments: [InlineTextSegment, ...InlineTextSegment[]]
      flatRange: Utf16Range
    }
  | {
      kind: 'block_caption'
      sectionId: string
      revisionId: string
      blockId: string
      property: 'caption'
      range: Utf16Range
    }

interface InlineSourceTarget {
  inlineIndex: number
  linkTextIndex?: number
}

interface SourceRun {
  flatFrom: number
  flatTo: number
  target: InlineSourceTarget
}

interface MetadataSurface {
  kind: 'section_title' | 'section_objective'
  sectionId: string
  text: string
}

interface InlineSurface {
  kind: 'block_inline'
  sectionId: string
  revisionId: string
  blockId: string
  text: string
  sourceRuns: SourceRun[]
}

interface TableCellSurface {
  kind: 'table_cell'
  sectionId: string
  revisionId: string
  blockId: string
  rowIndex: number
  cellIndex: number
  text: string
  sourceRuns: SourceRun[]
}

interface CaptionSurface {
  kind: 'block_caption'
  sectionId: string
  revisionId: string
  blockId: string
  text: string
}

export type ManuscriptSearchSurface =
  | MetadataSurface
  | InlineSurface
  | TableCellSurface
  | CaptionSurface

export interface SearchableSection {
  sectionId: string
  revisionId: string
  title: string
  objective: string | null
  status: SectionStatus
  content: BlockNoteDocument
}

const segmenter = new Intl.Segmenter('und', { granularity: 'grapheme' })
const COOPERATIVE_CHUNK_UTF16 = 16_384

export function projectSearchText(value: string, caseSensitive: boolean): string {
  const normalized = value.normalize('NFC')
  return caseSensitive ? normalized : normalized.toLowerCase()
}

function createOffsetMap(
  source: string,
  caseSensitive: boolean
): { projection: string; runs: OffsetMapRun[]; slowPath: boolean } {
  const normalized = source.normalize('NFC')
  const projection = caseSensitive ? normalized : normalized.toLowerCase()
  if (normalized === source && projection.length === source.length) {
    return {
      projection,
      runs: [
        {
          searchFrom: 0,
          searchTo: projection.length,
          sourceFrom: 0,
          sourceTo: source.length,
          mapping: 'linear'
        }
      ],
      slowPath: false
    }
  }

  const runs: OffsetMapRun[] = []
  const transformedParts: string[] = []
  let searchOffset = 0
  for (const part of segmenter.segment(source)) {
    const transformed = projectSearchText(part.segment, caseSensitive)
    transformedParts.push(transformed)
    const sourceFrom = part.index
    const sourceTo = sourceFrom + part.segment.length
    const mapping =
      transformed.length === part.segment.length && part.segment.normalize('NFC') === part.segment
        ? 'linear'
        : 'atomic'
    runs.push({
      searchFrom: searchOffset,
      searchTo: searchOffset + transformed.length,
      sourceFrom,
      sourceTo,
      mapping
    })
    searchOffset += transformed.length
  }
  if (transformedParts.join('') !== projection) {
    throw new Error('Unicode projection map is not reversible')
  }
  return { projection, runs, slowPath: true }
}

function mapBoundary(
  runs: readonly OffsetMapRun[],
  offset: number,
  edge: 'start' | 'end'
): number | null {
  if (runs.length === 0) return offset === 0 ? 0 : null
  for (const run of runs) {
    if (offset < run.searchFrom || offset > run.searchTo) continue
    if (offset === run.searchFrom) return run.sourceFrom
    if (offset === run.searchTo) return run.sourceTo
    if (run.mapping === 'atomic') return null
    return run.sourceFrom + (offset - run.searchFrom)
  }
  const final = runs.at(-1)
  if (edge === 'end' && final !== undefined && offset === final.searchTo) return final.sourceTo
  return null
}

export function findProjectionMatches(
  source: string,
  query: string,
  caseSensitive: boolean
): ProjectionSearchResult {
  const projectedQuery = projectSearchText(query, caseSensitive)
  if (projectedQuery.length === 0) return { matches: [], slowPath: false }
  const map = createOffsetMap(source, caseSensitive)
  const matches: ProjectionMatch[] = []
  let cursor = 0
  while (cursor <= map.projection.length - projectedQuery.length) {
    const searchFrom = map.projection.indexOf(projectedQuery, cursor)
    if (searchFrom < 0) break
    const searchTo = searchFrom + projectedQuery.length
    const from = mapBoundary(map.runs, searchFrom, 'start')
    const to = mapBoundary(map.runs, searchTo, 'end')
    if (from !== null && to !== null && to > from) {
      matches.push({ from, to, searchFrom, searchTo })
      cursor = searchTo
    } else {
      cursor = searchFrom + 1
    }
  }
  return { matches, slowPath: map.slowPath }
}

async function normalizeCooperatively(
  source: string,
  checkpoint: () => Promise<void>
): Promise<string> {
  if (source.length <= COOPERATIVE_CHUNK_UTF16) return source.normalize('NFC')
  const segments = segmenter.segment(source)
  const chunks: string[] = []
  let start = 0
  while (start < source.length) {
    const candidate = Math.min(source.length, start + COOPERATIVE_CHUNK_UTF16)
    let end = candidate
    if (candidate < source.length) {
      const containing = segments.containing(candidate)
      if (containing === undefined) throw new SearchProjectionSliceLimitError()
      end = containing.index
      if (end <= start) {
        end = containing.index + containing.segment.length
        if (end - start > COOPERATIVE_CHUNK_UTF16) {
          throw new SearchProjectionSliceLimitError()
        }
      }
    }
    chunks.push(source.slice(start, end).normalize('NFC'))
    start = end
    await checkpoint()
  }
  return chunks.join('')
}

export async function findProjectionMatchesCooperatively(
  source: string,
  query: string,
  caseSensitive: boolean,
  options: { checkpoint(): Promise<void>; maxMatches: number }
): Promise<CooperativeProjectionSearchResult> {
  const projectedQuery = projectSearchText(query, caseSensitive)
  if (projectedQuery.length === 0) {
    return { matches: [], slowPath: false, limitReached: false }
  }
  if (source.length <= COOPERATIVE_CHUNK_UTF16) {
    const result = findProjectionMatches(source, query, caseSensitive)
    return {
      ...result,
      matches: result.matches.slice(0, options.maxMatches),
      limitReached: result.matches.length >= options.maxMatches
    }
  }

  const normalized = await normalizeCooperatively(source, options.checkpoint)
  const projection = caseSensitive ? normalized : normalized.toLowerCase()
  let runs: OffsetMapRun[]
  let slowPath = false
  if (normalized === source && projection.length === source.length) {
    runs = [
      {
        searchFrom: 0,
        searchTo: projection.length,
        sourceFrom: 0,
        sourceTo: source.length,
        mapping: 'linear'
      }
    ]
  } else {
    slowPath = true
    runs = []
    const transformedParts: string[] = []
    let searchOffset = 0
    let processed = 0
    for (const part of segmenter.segment(source)) {
      if (part.segment.length > COOPERATIVE_CHUNK_UTF16) {
        throw new SearchProjectionSliceLimitError()
      }
      const transformed = projectSearchText(part.segment, caseSensitive)
      transformedParts.push(transformed)
      const sourceFrom = part.index
      const sourceTo = sourceFrom + part.segment.length
      const mapping =
        transformed.length === part.segment.length && part.segment.normalize('NFC') === part.segment
          ? 'linear'
          : 'atomic'
      runs.push({
        searchFrom: searchOffset,
        searchTo: searchOffset + transformed.length,
        sourceFrom,
        sourceTo,
        mapping
      })
      searchOffset += transformed.length
      processed += 1
      if (processed % 256 === 0) await options.checkpoint()
    }
    if (transformedParts.join('') !== projection) {
      throw new Error('Unicode projection map is not reversible')
    }
  }

  const matches: ProjectionMatch[] = []
  let cursor = 0
  let candidates = 0
  while (cursor <= projection.length - projectedQuery.length) {
    const searchFrom = projection.indexOf(projectedQuery, cursor)
    if (searchFrom < 0) break
    const searchTo = searchFrom + projectedQuery.length
    const from = mapBoundary(runs, searchFrom, 'start')
    const to = mapBoundary(runs, searchTo, 'end')
    if (from !== null && to !== null && to > from) {
      matches.push({ from, to, searchFrom, searchTo })
      if (matches.length >= options.maxMatches) {
        return { matches, slowPath, limitReached: true }
      }
      cursor = searchTo
    } else {
      cursor = searchFrom + 1
    }
    candidates += 1
    if (candidates % 256 === 0) await options.checkpoint()
  }
  return { matches, slowPath, limitReached: false }
}

function flattenInline(content: readonly BlockNoteInlineContent[]): {
  text: string
  sourceRuns: SourceRun[]
} {
  const chunks: string[] = []
  const sourceRuns: SourceRun[] = []
  let offset = 0
  const append = (text: string, target: InlineSourceTarget): void => {
    if (text.length === 0) return
    chunks.push(text)
    sourceRuns.push({ flatFrom: offset, flatTo: offset + text.length, target })
    offset += text.length
  }
  content.forEach((node, inlineIndex) => {
    if (node.type === 'text') {
      append(node.text, { inlineIndex })
      return
    }
    if (node.type === 'math') {
      chunks.push('\uFFFC')
      offset += 1
      return
    }
    node.content.forEach((child, linkTextIndex) => {
      append(child.text, { inlineIndex, linkTextIndex })
    })
  })
  return { text: chunks.join(''), sourceRuns }
}

function tableCellContent(
  cell: BlockNoteTableContent['rows'][number]['cells'][number]
): BlockNoteInlineContent[] {
  return Array.isArray(cell) ? cell : cell.content
}

export function enumerateManuscriptSearchSurfaces(
  sections: readonly SearchableSection[]
): ManuscriptSearchSurface[] {
  const surfaces: ManuscriptSearchSurface[] = []
  for (const section of sections) {
    surfaces.push({ kind: 'section_title', sectionId: section.sectionId, text: section.title })
    if (section.objective !== null && section.objective.length > 0) {
      surfaces.push({
        kind: 'section_objective',
        sectionId: section.sectionId,
        text: section.objective
      })
    }
    const visit = (blocks: readonly BlockNoteBlockValue[]): void => {
      for (const block of blocks) {
        if (Array.isArray(block.content)) {
          const inline = flattenInline(block.content)
          surfaces.push({
            kind: 'block_inline',
            sectionId: section.sectionId,
            revisionId: section.revisionId,
            blockId: block.id,
            ...inline
          })
        } else if (block.content?.type === 'tableContent') {
          block.content.rows.forEach((row, rowIndex) => {
            row.cells.forEach((cell, cellIndex) => {
              const inline = flattenInline(tableCellContent(cell))
              surfaces.push({
                kind: 'table_cell',
                sectionId: section.sectionId,
                revisionId: section.revisionId,
                blockId: block.id,
                rowIndex,
                cellIndex,
                ...inline
              })
            })
          })
        }
        if (
          (block.type === 'image' || block.type === 'mermaid' || block.type === 'math') &&
          typeof block.props.caption === 'string' &&
          block.props.caption.length > 0
        ) {
          surfaces.push({
            kind: 'block_caption',
            sectionId: section.sectionId,
            revisionId: section.revisionId,
            blockId: block.id,
            text: block.props.caption
          })
        }
        visit(block.children)
      }
    }
    visit(section.content)
  }
  return surfaces
}

function semanticSegments(
  sourceRuns: readonly SourceRun[],
  match: Utf16Range
): [InlineTextSegment, ...InlineTextSegment[]] {
  const segments = sourceRuns.flatMap((run) => {
    const from = Math.max(run.flatFrom, match.from)
    const to = Math.min(run.flatTo, match.to)
    if (from >= to) return []
    return [
      {
        ...run.target,
        range: { from: from - run.flatFrom, to: to - run.flatFrom }
      }
    ]
  })
  if (segments.length === 0) throw new Error('Search match has no semantic source segment')
  return segments as [InlineTextSegment, ...InlineTextSegment[]]
}

export function targetForSurfaceMatch(
  surface: ManuscriptSearchSurface,
  match: Utf16Range
): ManuscriptSearchTarget {
  switch (surface.kind) {
    case 'section_title':
    case 'section_objective':
      return {
        kind: surface.kind,
        sectionId: surface.sectionId,
        range: { from: match.from, to: match.to }
      }
    case 'block_caption':
      return {
        kind: 'block_caption',
        sectionId: surface.sectionId,
        revisionId: surface.revisionId,
        blockId: surface.blockId,
        property: 'caption',
        range: { from: match.from, to: match.to }
      }
    case 'block_inline':
      return {
        kind: 'block_inline',
        sectionId: surface.sectionId,
        revisionId: surface.revisionId,
        blockId: surface.blockId,
        segments: semanticSegments(surface.sourceRuns, match),
        flatRange: { from: match.from, to: match.to }
      }
    case 'table_cell':
      return {
        kind: 'table_cell',
        sectionId: surface.sectionId,
        revisionId: surface.revisionId,
        blockId: surface.blockId,
        rowIndex: surface.rowIndex,
        cellIndex: surface.cellIndex,
        segments: semanticSegments(surface.sourceRuns, match),
        flatRange: { from: match.from, to: match.to }
      }
  }
}
