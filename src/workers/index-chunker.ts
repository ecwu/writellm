import { sha256 } from '../shared/hash'
import { verifyNormalizedBlocks } from '../main/knowledge/normalized-blocks'
import { readNormalizedManifest } from '../main/knowledge/normalized-manifest'
import type { NormalizedKnowledgeBlock } from '../shared/contracts/knowledge'
import type { IndexSource } from '../shared/contracts/indexing'
import { KNOWLEDGE_CHUNK_ASSET_LIMIT } from '../shared/contracts/search'
import { captionMatchesImage } from '../shared/knowledge-block-provenance'
import { KNOWLEDGE_BLOCK_SEPARATOR, searchableKnowledgeBlockText } from '../shared/knowledge-text'

const TARGET_CHARS = 1_600
const MAX_CHARS = 2_000
const OVERLAP_CHARS = 200
const SEPARATOR_CODE_POINTS = Array.from(KNOWLEDGE_BLOCK_SEPARATOR).length

interface BlockSpan {
  block: NormalizedKnowledgeBlock
  start: number
  end: number
}

interface BlockGroup {
  spans: BlockSpan[]
  text: string
}

export interface DeterministicChunkSource {
  sourceOrdinal: number
  blockId: string
  blockOrdinal: number
  blockType: NormalizedKnowledgeBlock['type']
  page: number | null
  bboxJson: string
  assetRefsJson: string
  providerBlockId: string | null
  segmentStart: number
  segmentEnd: number
}

export interface DeterministicChunk {
  chunkId: string
  knowledgeItemId: string
  displayName: string
  extension: string | null
  parseRevisionId: string
  normalizationRunId: string
  ordinal: number
  text: string
  contentSha256: string
  headingPathJson: string
  sourceBlockStart: number
  sourceBlockEnd: number
  sources: DeterministicChunkSource[]
}

export async function buildDeterministicChunks(
  sources: readonly IndexSource[],
  chunkerVersion: number
): Promise<DeterministicChunk[]> {
  const chunks: DeterministicChunk[] = []
  for (const source of [...sources].sort((a, b) =>
    a.knowledgeItemId.localeCompare(b.knowledgeItemId)
  )) {
    const blocks = await readVerifiedBlocks(source)
    let sourceChunkOrdinal = 0
    for (const group of groupBlocks(blocks)) {
      for (const chunk of splitGroup(source, group, sourceChunkOrdinal, chunkerVersion)) {
        chunks.push(chunk)
        sourceChunkOrdinal += 1
      }
    }
  }
  return chunks
}

async function readVerifiedBlocks(source: IndexSource): Promise<NormalizedKnowledgeBlock[]> {
  const { manifest } = await readNormalizedManifest(
    `${source.normalizationRoot}/manifest.json`,
    source
  )
  const blocks: NormalizedKnowledgeBlock[] = []
  await verifyNormalizedBlocks(
    `${source.normalizationRoot}/${manifest.blocks.relativePath}`,
    manifest.blocks,
    (block) => {
      blocks.push(block)
    }
  )
  return blocks
}

export function* groupBlocks(blocks: readonly NormalizedKnowledgeBlock[]): Generator<BlockGroup> {
  let current: BlockSpan[] = []
  let textParts: string[] = []
  let textCodeUnits = 0
  let image: NormalizedKnowledgeBlock | undefined
  const assetRefs = new Set<string>()
  const finish = (): BlockGroup => {
    const group = { spans: current, text: textParts.join(KNOWLEDGE_BLOCK_SEPARATOR) }
    current = []
    textParts = []
    textCodeUnits = 0
    image = undefined
    assetRefs.clear()
    return group
  }
  for (const block of blocks) {
    const value = searchableKnowledgeBlockText(block)
    if (value.length === 0) continue
    const atomic = ['table', 'formula', 'image', 'list'].includes(block.type)
    const sameHeading =
      current.length === 0 ||
      JSON.stringify(current.at(-1)?.block.headingPath) === JSON.stringify(block.headingPath)
    const captionForImage = image !== undefined && captionMatchesImage(block, image)
    const exceedsAssetLimit =
      assetRefs.size + block.assetRefs.length > KNOWLEDGE_CHUNK_ASSET_LIMIT &&
      assetRefs.size + new Set(block.assetRefs.filter((ref) => !assetRefs.has(ref))).size >
        KNOWLEDGE_CHUNK_ASSET_LIMIT
    if (
      exceedsAssetLimit ||
      (current.length > 0 &&
        !captionForImage &&
        (image !== undefined ||
          atomic ||
          block.type === 'heading' ||
          !sameHeading ||
          textCodeUnits + value.length > TARGET_CHARS))
    ) {
      const continuedImage = captionForImage ? image : undefined
      yield finish()
      image = continuedImage
    }
    if (current.length > 0) textCodeUnits += KNOWLEDGE_BLOCK_SEPARATOR.length
    textCodeUnits += value.length
    const previous = current.at(-1)
    const start = previous === undefined ? 0 : previous.end + SEPARATOR_CODE_POINTS
    let end = start
    for (const _character of value) end += 1
    current.push({ block, start, end })
    textParts.push(value)
    for (const ref of block.assetRefs) assetRefs.add(ref)
    if (block.type === 'image') image = block
    else if (atomic) yield finish()
  }
  if (current.length > 0) yield finish()
}

function* splitGroup(
  source: IndexSource,
  { spans, text }: BlockGroup,
  ordinal: number,
  chunkerVersion: number
): Generator<DeterministicChunk> {
  const characters = Array.from(text)
  const groupStart = spans[0]?.block.ordinal ?? 0
  const groupEnd = spans.at(-1)?.block.ordinal ?? groupStart
  const headingPathJson = JSON.stringify(spans.at(-1)?.block.headingPath ?? [])
  let firstSource = 0
  let pastLastSource = 0
  for (let start = 0; start < characters.length; start += MAX_CHARS - OVERLAP_CHARS) {
    const end = Math.min(characters.length, start + MAX_CHARS)
    while ((spans[firstSource]?.end ?? Infinity) <= start) firstSource += 1
    while ((spans[pastLastSource]?.start ?? Infinity) < end) pastLastSource += 1
    const selected = spans.slice(firstSource, pastLastSource)
    const first = selected[0]
    const last = selected.at(-1)
    if (first === undefined || last === undefined) {
      throw new Error('Index chunk has no source text')
    }
    const segmentText =
      start === 0 && end === characters.length ? text : characters.slice(start, end).join('')
    const contentSha256 = sha256(Buffer.from(segmentText))
    // IDs use group coordinates so rebuilding provenance preserves existing citations.
    const chunkId = `chunk-${sha256(
      Buffer.from(
        `${source.parseRevisionId}\0${groupStart}\0${groupEnd}\0${chunkerVersion}\0${contentSha256}\0${start}\0${end}`
      )
    ).slice(0, 40)}`
    yield {
      chunkId,
      knowledgeItemId: source.knowledgeItemId,
      displayName: source.displayName,
      extension: source.extension,
      parseRevisionId: source.parseRevisionId,
      normalizationRunId: source.normalizationRunId,
      ordinal,
      text: segmentText,
      contentSha256,
      headingPathJson,
      sourceBlockStart: first.block.ordinal,
      sourceBlockEnd: last.block.ordinal,
      sources: selected.map(({ block }, sourceOrdinal) => ({
        sourceOrdinal,
        blockId: block.id,
        blockOrdinal: block.ordinal,
        blockType: block.type,
        page: block.page ?? null,
        bboxJson: JSON.stringify(block.bbox ?? null),
        assetRefsJson: JSON.stringify(block.assetRefs),
        providerBlockId: block.sourceProviderBlockId ?? null,
        segmentStart: Math.max(0, start - first.start),
        segmentEnd: end - first.start
      }))
    }
    if (end === characters.length) break
    ordinal += 1
  }
}
