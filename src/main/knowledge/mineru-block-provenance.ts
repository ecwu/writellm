import { posix } from 'node:path'
import type { NormalizedKnowledgeBlock } from '../../shared/contracts/knowledge'
import type { MineruRawManifest } from '../../shared/contracts/mineru'

const MAX_RAW_BLOCKS = 20_000
const ASSET_REF = /^images\/([a-f0-9]{64})\.[A-Za-z0-9]+$/

interface RawContentBlock {
  type?: unknown
  text?: unknown
  table_body?: unknown
  code_body?: unknown
  list_items?: unknown
  image_caption?: unknown
  image_footnote?: unknown
  table_caption?: unknown
  table_footnote?: unknown
  img_path?: unknown
  page_idx?: unknown
  bbox?: unknown
  block_id?: unknown
  id?: unknown
  index?: unknown
}

export interface RecoveredBlockProvenance {
  page: number
  bbox: [number, number, number, number] | null
  providerBlockId: string | null
  regionIdentity: string
}

export function recoverMineruBlockProvenance(input: {
  blocks: readonly NormalizedKnowledgeBlock[]
  contentListPath: string
  contentList: unknown
  manifest: MineruRawManifest
}): Map<string, RecoveredBlockProvenance> {
  if (!Array.isArray(input.contentList) || input.contentList.length > MAX_RAW_BLOCKS) {
    throw new Error('MinerU content list shape or block count is invalid')
  }
  const rawBlocks = input.contentList.map((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('MinerU content block is invalid')
    }
    return value as RawContentBlock
  })
  const evidence = new Map<string, Set<number>>()
  const assets = new Map<string, Set<number>>()
  const files = new Map(input.manifest.files.map((file) => [file.relativePath, file]))
  for (const [rawIndex, raw] of rawBlocks.entries()) {
    for (const value of rawEvidence(raw)) addCandidate(evidence, value, rawIndex)
    const assetSha256 = rawAssetSha256(raw, input.contentListPath, files)
    if (assetSha256 !== null) addCandidate(assets, assetSha256, rawIndex)
  }

  const recovered = new Map<string, RecoveredBlockProvenance>()
  for (const block of input.blocks) {
    const assetCandidates = candidateIndices(
      assets,
      block.assetRefs.flatMap((assetRef) => ASSET_REF.exec(assetRef)?.[1] ?? [])
    )
    const textCandidates = candidateIndices(evidence, normalizedEvidence(block))
    const eligibleTextCandidates =
      block.type === 'caption'
        ? new Set(
            [...textCandidates].filter((rawIndex) => {
              const raw = rawBlocks[rawIndex]
              return raw !== undefined && isDirectCaptionSource(raw, block)
            })
          )
        : textCandidates
    const rawIndex =
      (block.type === 'caption' ? null : uniqueIndex(assetCandidates)) ??
      uniqueIndex(eligibleTextCandidates)
    if (rawIndex === null) continue
    const raw = rawBlocks[rawIndex]
    if (raw === undefined) continue
    const page = pageIndex(raw.page_idx)
    if (page === null) continue
    recovered.set(block.id, {
      page,
      bbox: parseBbox(raw.bbox),
      providerBlockId: providerBlockId(raw),
      regionIdentity: `content-list:${rawIndex}`
    })
  }
  return recovered
}

function isDirectCaptionSource(raw: RawContentBlock, block: NormalizedKnowledgeBlock): boolean {
  const type = typeof raw.type === 'string' ? raw.type.toLowerCase() : ''
  if (type.includes('caption')) return true
  if (type !== 'text') return false
  if (typeof raw.text !== 'string') return false
  const normalized = new Set(normalizedEvidence(block))
  return evidenceForms(raw.text).some((value) => normalized.has(value))
}

function rawEvidence(block: RawContentBlock): string[] {
  const values: unknown[] = [block.text, block.table_body, block.code_body]
  if (Array.isArray(block.list_items)) values.push(block.list_items.join('\n'))
  for (const value of [
    block.image_caption,
    block.image_footnote,
    block.table_caption,
    block.table_footnote
  ]) {
    if (Array.isArray(value)) values.push(...value)
  }
  return values.flatMap((value) => (typeof value === 'string' ? evidenceForms(value) : []))
}

function normalizedEvidence(block: NormalizedKnowledgeBlock): string[] {
  return [block.text, block.markdown].flatMap((value) =>
    typeof value === 'string' ? evidenceForms(value) : []
  )
}

function evidenceForms(value: string): string[] {
  const exact = value.normalize('NFC').replaceAll(/\s+/gu, ' ').trim()
  if (exact.length === 0) return []
  const plain = exact
    .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/[#*_`>$|\\{}[\]()]/g, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim()
  return plain.length === 0 || plain === exact ? [exact] : [exact, plain]
}

function rawAssetSha256(
  block: RawContentBlock,
  contentListPath: string,
  files: Map<string, MineruRawManifest['files'][number]>
): string | null {
  if (
    typeof block.img_path !== 'string' ||
    block.img_path.length === 0 ||
    block.img_path.includes('\\') ||
    block.img_path.startsWith('/')
  ) {
    return null
  }
  const relativePath = posix.normalize(posix.join(posix.dirname(contentListPath), block.img_path))
  if (!relativePath.startsWith('raw/extracted/') || relativePath.includes('/../')) return null
  return files.get(relativePath)?.sha256 ?? null
}

function candidateIndices(index: Map<string, Set<number>>, values: readonly string[]): Set<number> {
  const candidates = new Set<number>()
  for (const value of values) {
    for (const rawIndex of index.get(value) ?? []) candidates.add(rawIndex)
  }
  return candidates
}

function uniqueIndex(candidates: Set<number>): number | null {
  return candidates.size === 1 ? ([...candidates][0] ?? null) : null
}

function addCandidate(index: Map<string, Set<number>>, value: string, rawIndex: number): void {
  const candidates = index.get(value) ?? new Set<number>()
  candidates.add(rawIndex)
  index.set(value, candidates)
}

function pageIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

function parseBbox(value: unknown): [number, number, number, number] | null {
  return Array.isArray(value) &&
    value.length === 4 &&
    value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate))
    ? (value as [number, number, number, number])
    : null
}

function providerBlockId(block: RawContentBlock): string | null {
  const value = block.block_id ?? block.id ?? block.index
  return typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, 256) : null
}
