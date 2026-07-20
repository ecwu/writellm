import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import {
  normalizedKnowledgeBlockSchema,
  normalizedKnowledgeManifestSchema,
  type NormalizedKnowledgeBlock
} from '../shared/contracts/knowledge'
import type { IndexSource } from '../shared/contracts/indexing'
import { searchableKnowledgeBlockText } from '../shared/knowledge-text'

const MAX_MANIFEST_BYTES = 10 * 1024 * 1024
const MAX_BLOCK_BYTES = 200 * 1024 * 1024
const TARGET_CHARS = 1_600
const MAX_CHARS = 2_000
const OVERLAP_CHARS = 200

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
    const groups = groupBlocks(blocks)
    let sourceChunkOrdinal = 0
    for (const group of groups) {
      for (const chunk of splitGroup(source, group, sourceChunkOrdinal, chunkerVersion)) {
        chunks.push(chunk)
        sourceChunkOrdinal += 1
      }
    }
  }
  return chunks
}

async function readVerifiedBlocks(source: IndexSource): Promise<NormalizedKnowledgeBlock[]> {
  const manifestBytes = await readBounded(
    `${source.normalizationRoot}/manifest.json`,
    MAX_MANIFEST_BYTES
  )
  if (sha256(manifestBytes) !== source.manifestSha256) {
    throw new Error('Index source manifest hash does not match')
  }
  const manifest = normalizedKnowledgeManifestSchema.parse(
    JSON.parse(manifestBytes.toString('utf8'))
  )
  if (
    manifest.parseRevisionId !== source.parseRevisionId ||
    manifest.normalizationRunId !== source.normalizationRunId
  ) {
    throw new Error('Index source provenance does not match')
  }
  const blockBytes = await readBounded(
    `${source.normalizationRoot}/${manifest.blocks.relativePath}`,
    MAX_BLOCK_BYTES
  )
  if (sha256(blockBytes) !== manifest.blocks.sha256) {
    throw new Error('Index source blocks hash does not match')
  }
  const blocks = blockBytes
    .toString('utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => normalizedKnowledgeBlockSchema.parse(JSON.parse(line)))
  if (
    blocks.length !== manifest.blocks.count ||
    blocks.some((block, ordinal) => block.ordinal !== ordinal)
  ) {
    throw new Error('Index source block order does not match its manifest')
  }
  return blocks
}

export function groupBlocks(
  blocks: readonly NormalizedKnowledgeBlock[]
): NormalizedKnowledgeBlock[][] {
  const groups: NormalizedKnowledgeBlock[][] = []
  let current: NormalizedKnowledgeBlock[] = []
  const flush = (): void => {
    if (current.length > 0) groups.push(current)
    current = []
  }
  for (const block of blocks) {
    const value = searchableKnowledgeBlockText(block)
    if (value.length === 0) continue
    const atomic = ['table', 'formula', 'image', 'list'].includes(block.type)
    const currentText = current.map(searchableKnowledgeBlockText).join('\n\n')
    const sameHeading =
      current.length === 0 ||
      JSON.stringify(current.at(-1)?.headingPath) === JSON.stringify(block.headingPath)
    let imageIndex = -1
    for (let index = current.length - 1; index >= 0; index -= 1) {
      if (current[index]?.type === 'image') {
        imageIndex = index
        break
      }
    }
    const image = imageIndex >= 0 ? current[imageIndex] : undefined
    const trailingBlocks = imageIndex >= 0 ? current.slice(imageIndex + 1) : []
    const imageCaptionRun =
      image !== undefined && trailingBlocks.every((candidate) => candidate.type === 'caption')
    const captionForImage =
      block.type === 'caption' && imageCaptionRun && image !== undefined
        ? captionBelongsToImage(block, image)
        : false
    if (
      current.length > 0 &&
      !captionForImage &&
      (imageCaptionRun ||
        atomic ||
        block.type === 'heading' ||
        !sameHeading ||
        currentText.length + value.length > TARGET_CHARS)
    ) {
      flush()
    }
    current.push(block)
    if (atomic && block.type !== 'image') flush()
  }
  flush()
  return groups
}

function captionBelongsToImage(
  caption: NormalizedKnowledgeBlock,
  image: NormalizedKnowledgeBlock
): boolean {
  if (caption.type !== 'caption' || image.type !== 'image') return false
  if (caption.assetRefs.some((asset) => image.assetRefs.includes(asset))) return true
  return (
    caption.sourceProviderBlockId !== undefined &&
    caption.sourceProviderBlockId === image.sourceProviderBlockId
  )
}

function splitGroup(
  source: IndexSource,
  blocks: readonly NormalizedKnowledgeBlock[],
  ordinal: number,
  chunkerVersion: number
): DeterministicChunk[] {
  const text = blocks.map(searchableKnowledgeBlockText).join('\n\n')
  const characters = Array.from(text)
  const segments: Array<{ text: string; start: number; end: number }> = []
  if (characters.length <= MAX_CHARS) {
    segments.push({ text, start: 0, end: characters.length })
  } else {
    for (let start = 0; start < characters.length; start += MAX_CHARS - OVERLAP_CHARS) {
      const end = Math.min(characters.length, start + MAX_CHARS)
      segments.push({ text: characters.slice(start, end).join(''), start, end })
      if (end === characters.length) break
    }
  }
  return segments.map((segment, segmentIndex) => {
    const contentSha256 = sha256(Buffer.from(segment.text))
    const start = blocks[0]?.ordinal ?? 0
    const end = blocks.at(-1)?.ordinal ?? start
    const chunkId = `chunk-${sha256(
      Buffer.from(
        `${source.parseRevisionId}\0${start}\0${end}\0${chunkerVersion}\0${contentSha256}\0${segment.start}\0${segment.end}`
      )
    ).slice(0, 40)}`
    return {
      chunkId,
      knowledgeItemId: source.knowledgeItemId,
      displayName: source.displayName,
      extension: source.extension,
      parseRevisionId: source.parseRevisionId,
      normalizationRunId: source.normalizationRunId,
      ordinal: ordinal + segmentIndex,
      text: segment.text,
      contentSha256,
      headingPathJson: JSON.stringify(blocks.at(-1)?.headingPath ?? []),
      sourceBlockStart: start,
      sourceBlockEnd: end,
      sources: blocks.map((block, sourceOrdinal) => ({
        sourceOrdinal,
        blockId: block.id,
        blockOrdinal: block.ordinal,
        blockType: block.type,
        page: block.page ?? null,
        bboxJson: JSON.stringify(block.bbox ?? null),
        assetRefsJson: JSON.stringify(block.assetRefs),
        providerBlockId: block.sourceProviderBlockId ?? null,
        segmentStart: segment.start,
        segmentEnd: segment.end
      }))
    }
  })
}

async function readBounded(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      throw new Error('Index source file size is invalid')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
