import { sha256 } from '../../shared/hash'
import { basename } from 'node:path'
import type { Logger } from 'pino'
import {
  knowledgeMappingPageSchema,
  type KnowledgeMappingPage
} from '../../shared/contracts/knowledge-mapping'
import type { NormalizedKnowledgeBlock } from '../../shared/contracts/knowledge'
import { captionMatchesImage } from '../../shared/knowledge-block-provenance'
import {
  KNOWLEDGE_BLOCK_SEPARATOR,
  searchableKnowledgeBlockText
} from '../../shared/knowledge-text'
import type { MineruRawManifest } from '../../shared/contracts/mineru'
import { chooseMineruContentListPath } from '../../shared/mineru-content-list'
import type { ProjectIndexService } from '../search/index-service'
import type { ProjectDatabase } from '../project/project-database'
import { ProjectFilesystem } from '../project/project-filesystem'
import { readBounded } from '../storage/durable-sync'
import type { KnowledgeNormalizationService } from './knowledge-normalization-service'
import { readMineruRawManifest, type RawManifestRevision } from './mineru-raw-manifest'
import {
  recoverMineruBlockProvenance,
  type RecoveredBlockProvenance
} from './mineru-block-provenance'

const MAX_RAW_JSON_BYTES = 100 * 1024 * 1024
const MAX_DEPTH = 24
const MAX_GEOMETRY_NODES = 200_000
const MAX_GEOMETRY_PAGES = 10_000
const MAX_PAGE_DIMENSION = 10_000_000
const VLM_CONTENT_COORDINATE_SIZE = 1_000
const BLOCK_SEPARATOR_CODE_POINTS = Array.from(KNOWLEDGE_BLOCK_SEPARATOR).length

type RawArtifact = MineruRawManifest['files'][number]
type PageGeometry = { width: number; height: number; origin: 'top-left' }

interface RawMappingRevision {
  manifest: MineruRawManifest
  contentList: RawArtifact | undefined
  readJson(file: RawArtifact): Promise<unknown>
}

export class KnowledgeMappingService {
  private readonly filesystem: ProjectFilesystem

  constructor(
    private readonly options: {
      projectRoot: string
      filesystem?: ProjectFilesystem
      database: ProjectDatabase
      normalization: KnowledgeNormalizationService
      index: ProjectIndexService
      log: Pick<Logger, 'info' | 'error'>
    }
  ) {
    this.filesystem = options.filesystem ?? new ProjectFilesystem(options.projectRoot)
  }

  async page(knowledgeItemId: string, pageIndex: number): Promise<KnowledgeMappingPage> {
    const startedAt = Date.now()
    const metadata = await this.options.normalization.metadata(knowledgeItemId)
    if (metadata.active === null) {
      return knowledgeMappingPageSchema.parse({
        state: 'unavailable',
        knowledgeItemId,
        parseRevisionId: null,
        pageIndex,
        geometry: null,
        regions: [],
        chunks: [],
        activeIndexGenerationId: null,
        activeEmbeddingGenerationId: null,
        message: 'No active parsed revision is available'
      })
    }
    const parseRevisionId = metadata.active.parseRevisionId
    let rawRevision: Promise<RawMappingRevision | undefined> | undefined
    const readRawRevision = () => {
      rawRevision ??= this.#readRawRevision(knowledgeItemId, parseRevisionId)
      return rawRevision
    }
    const fallbackRead = await this.options.normalization.readBlocksForMapping(
      knowledgeItemId,
      parseRevisionId,
      (block) => block.page === undefined || block.bbox === undefined,
      { maxBlocks: 5_000, maxBytes: 16 * 1024 * 1024 }
    )
    const fallbackBlocks = fallbackRead.blocks
    let recoveredProvenance = new Map<string, RecoveredBlockProvenance>()
    if (!fallbackRead.tooComplex && fallbackBlocks.length > 0) {
      try {
        recoveredProvenance = await this.#blockProvenance(
          await readRawRevision(),
          knowledgeItemId,
          parseRevisionId,
          fallbackBlocks
        )
      } catch (err) {
        this.options.log.error(
          {
            event: 'knowledge.mapping.provenance_failed',
            err,
            knowledgeItemId,
            parseRevisionId
          },
          'MinerU block provenance could not be recovered'
        )
      }
    }
    const fallbackBlockOrdinals = fallbackBlocks.flatMap((block) =>
      block.page === undefined && recoveredProvenance.get(block.id)?.page === pageIndex
        ? [block.ordinal]
        : []
    )
    const fallbackTooComplex = fallbackRead.tooComplex || fallbackBlockOrdinals.length > 5_000
    const indexed = await this.options.index.inspectKnowledgeMapping(
      knowledgeItemId,
      parseRevisionId,
      pageIndex,
      fallbackTooComplex ? [] : fallbackBlockOrdinals
    )
    let geometry = new Map<number, PageGeometry>()
    try {
      geometry = await this.#pageGeometry(await readRawRevision())
    } catch (err) {
      this.options.log.error(
        {
          event: 'knowledge.mapping.geometry_failed',
          err,
          knowledgeItemId,
          parseRevisionId
        },
        'MinerU page geometry is unavailable'
      )
    }
    if (indexed.state === 'indexing') {
      return knowledgeMappingPageSchema.parse({
        state: 'indexing',
        knowledgeItemId,
        parseRevisionId,
        pageIndex,
        geometry: geometry.get(pageIndex) ?? null,
        regions: [],
        chunks: [],
        activeIndexGenerationId: indexed.activeIndexGenerationId,
        activeEmbeddingGenerationId: indexed.activeEmbeddingGenerationId,
        message: 'The search index is still being prepared'
      })
    }
    if (indexed.state === 'unavailable') {
      return knowledgeMappingPageSchema.parse({
        state: 'unavailable',
        knowledgeItemId,
        parseRevisionId,
        pageIndex,
        geometry: geometry.get(pageIndex) ?? null,
        regions: [],
        chunks: [],
        activeIndexGenerationId: null,
        activeEmbeddingGenerationId: null,
        message: 'The search index is unavailable'
      })
    }
    if (indexed.state === 'too_complex') {
      return knowledgeMappingPageSchema.parse({
        state: 'too_complex',
        knowledgeItemId,
        parseRevisionId,
        pageIndex,
        geometry: geometry.get(pageIndex) ?? null,
        regions: [],
        chunks: [],
        activeIndexGenerationId: indexed.activeIndexGenerationId,
        activeEmbeddingGenerationId: indexed.activeEmbeddingGenerationId,
        message: 'This page contains too many indexed relationships to display safely'
      })
    }
    if (fallbackTooComplex) {
      return knowledgeMappingPageSchema.parse({
        state: 'too_complex',
        knowledgeItemId,
        parseRevisionId,
        pageIndex,
        geometry: geometry.get(pageIndex) ?? null,
        regions: [],
        chunks: [],
        activeIndexGenerationId: indexed.activeIndexGenerationId,
        activeEmbeddingGenerationId: indexed.activeEmbeddingGenerationId,
        message: 'This page contains too many recovered relationships to display safely'
      })
    }

    const ranges = mergeOrdinalRanges(
      indexed.chunks.map((chunk) => ({
        start: chunk.sourceBlockStart,
        end: chunk.sourceBlockEnd
      }))
    )
    const sourceBlockIds = new Set(
      indexed.chunks.flatMap((chunk) => chunk.sources.map((source) => source.blockId))
    )
    const relevantRead = await this.options.normalization.readBlocksForMapping(
      knowledgeItemId,
      parseRevisionId,
      (block) => {
        if (sourceBlockIds.has(block.id)) return true
        const index = lowerBoundByOrdinal(ranges, block.ordinal, (range) => range.end)
        const range = ranges[index]
        return range !== undefined && range.start <= block.ordinal
      },
      { maxBlocks: 10_000, maxBytes: 32 * 1024 * 1024 }
    )
    if (relevantRead.tooComplex) {
      return knowledgeMappingPageSchema.parse({
        state: 'too_complex',
        knowledgeItemId,
        parseRevisionId,
        pageIndex,
        geometry: geometry.get(pageIndex) ?? null,
        regions: [],
        chunks: [],
        activeIndexGenerationId: indexed.activeIndexGenerationId,
        activeEmbeddingGenerationId: indexed.activeEmbeddingGenerationId,
        message: 'This page requires too much normalized content to display safely'
      })
    }
    const activeBlocks = [
      ...new Map(
        [...fallbackBlocks, ...relevantRead.blocks].map((block) => [block.id, block])
      ).values()
    ].sort((left, right) => left.ordinal - right.ordinal)
    const blockById = new Map(activeBlocks.map((block) => [block.id, block]))
    const regions = new Map<string, RegionAccumulator>()
    const chunks = indexed.chunks.map((chunk) => {
      const offsets = blockOffsets(activeBlocks, chunk.sourceBlockStart, chunk.sourceBlockEnd)
      const coverages = new Map<string, CoverageAccumulator>()
      for (const source of chunk.sources) {
        const block = blockById.get(source.blockId)
        if (block === undefined) continue
        const recovered = recoveredProvenance.get(block.id)
        const candidateBbox = source.bbox ?? block.bbox ?? recovered?.bbox ?? null
        const inheritedCaptionBbox = isInheritedCaptionBbox(block, candidateBbox, activeBlocks)
        const effectiveSource = {
          ...source,
          page: source.page ?? block.page ?? recovered?.page ?? null,
          bbox: inheritedCaptionBbox ? null : candidateBbox,
          providerBlockId:
            source.providerBlockId ??
            block.sourceProviderBlockId ??
            recovered?.providerBlockId ??
            null
        }
        if (effectiveSource.page !== pageIndex) continue
        const regionId = regionKey(
          effectiveSource.providerBlockId,
          effectiveSource.page,
          effectiveSource.bbox,
          recovered?.regionIdentity ?? block.id,
          block.type === 'caption'
        )
        const region =
          regions.get(regionId) ?? createRegion(regionId, effectiveSource, block, recovered)
        region.normalizedBlockIds.add(block.id)
        region.blockTypes.add(block.type)
        regions.set(regionId, region)
        const offset = offsets.get(block.id)
        if (offset === undefined) continue
        const totalCharacters = Math.max(0, offset.end - offset.start)
        const start = Math.max(offset.start, source.segmentStart)
        const end = Math.min(offset.end, source.segmentEnd)
        const coveredCharacters = Math.max(0, end - start)
        const coverage = coverages.get(regionId) ?? {
          totalCharacters: 0,
          coveredCharacters: 0,
          segments: []
        }
        coverage.totalCharacters += totalCharacters
        coverage.coveredCharacters += coveredCharacters
        if (totalCharacters > 0 && coveredCharacters > 0) {
          coverage.segments.push({
            startRatio: (start - offset.start) / totalCharacters,
            endRatio: (end - offset.start) / totalCharacters
          })
        }
        coverages.set(regionId, coverage)
      }
      return {
        chunkId: chunk.chunkId,
        ordinal: chunk.ordinal,
        text: chunk.text,
        headingPath: chunk.headingPath,
        coverages: [...coverages.entries()].map(([regionId, coverage]) => {
          const region = regions.get(regionId)
          return {
            regionId,
            normalizedBlockIds: [...(region?.normalizedBlockIds ?? [])],
            totalCharacters: coverage.totalCharacters,
            coveredCharacters: coverage.coveredCharacters,
            coverageRatio:
              coverage.totalCharacters === 0
                ? 1
                : Math.min(1, coverage.coveredCharacters / coverage.totalCharacters),
            segments: coverage.segments.slice(0, 32)
          }
        }),
        embedding: chunk.embedding
      }
    })
    const result = knowledgeMappingPageSchema.parse({
      state: 'ready',
      knowledgeItemId,
      parseRevisionId,
      pageIndex,
      geometry: geometry.get(pageIndex) ?? null,
      regions: [...regions.values()].map((region) => ({
        regionId: region.regionId,
        providerBlockId: region.providerBlockId,
        normalizedBlockIds: [...region.normalizedBlockIds],
        blockTypes: [...region.blockTypes],
        bbox: validateBbox(region.bbox, geometry.get(region.pageIndex)),
        pageIndex: region.pageIndex
      })),
      chunks,
      activeIndexGenerationId: indexed.activeIndexGenerationId,
      activeEmbeddingGenerationId: indexed.activeEmbeddingGenerationId,
      ...(geometry.get(pageIndex) === undefined
        ? { message: 'MinerU page geometry is unavailable for this revision' }
        : {})
    })
    this.options.log.info(
      {
        event: 'knowledge.mapping.loaded',
        knowledgeItemId,
        pageIndex,
        regionCount: result.regions.length,
        chunkCount: result.chunks.length,
        durationMs: Date.now() - startedAt
      },
      'Knowledge mapping page loaded'
    )
    return result
  }

  async #readRawRevision(
    knowledgeItemId: string,
    parseRevisionId: string
  ): Promise<RawMappingRevision | undefined> {
    const row = this.options.database.read(
      (database) =>
        database
          .prepare(
            `SELECT relative_path, parse_revision_id, knowledge_item_id, source_sha256, manifest_sha256
               FROM parse_revisions
              WHERE knowledge_item_id = ? AND parse_revision_id = ?`
          )
          .get(knowledgeItemId, parseRevisionId) as RawManifestRevision | undefined
    )
    if (row === undefined) return undefined
    const { manifest } = await readMineruRawManifest(this.filesystem, row)
    const contentListPath = chooseMineruContentListPath(
      manifest.files.map((file) => file.relativePath)
    )
    const contentList = manifest.files.find((file) => file.relativePath === contentListPath)
    let contentListJson: Promise<unknown> | undefined
    return {
      manifest,
      contentList,
      readJson: (file) => {
        if (file !== contentList) return this.#readRawJson(row.relative_path, file)
        contentListJson ??= this.#readRawJson(row.relative_path, file)
        return contentListJson
      }
    }
  }

  async #readRawJson(relativePath: string, file: RawArtifact): Promise<unknown> {
    const bytes = await readBounded(
      await this.filesystem.assertExistingRegularFile(`${relativePath}/${file.relativePath}`),
      MAX_RAW_JSON_BYTES
    )
    if (bytes.byteLength !== file.byteSize || sha256(bytes) !== file.sha256) {
      throw new Error('Raw mapping artifact hash or size mismatch')
    }
    return JSON.parse(bytes.toString('utf8'))
  }

  async #pageGeometry(
    revision: RawMappingRevision | undefined
  ): Promise<Map<number, PageGeometry>> {
    if (revision === undefined) return new Map()
    const { manifest, contentList, readJson } = revision
    if (manifest.modelVersion === 'vlm' && contentList !== undefined) {
      const geometry = collectVlmContentListGeometry(await readJson(contentList))
      if (geometry.size > 0) return geometry
    }
    const candidates = manifest.files
      .filter((file) => /(?:middle|layout|model|content_list)\.json$/i.test(file.relativePath))
      .sort((a, b) => geometryPriority(a.relativePath) - geometryPriority(b.relativePath))
    for (const file of candidates) {
      const geometry = collectGeometry(await readJson(file))
      if (geometry.size > 0) return geometry
    }
    return new Map()
  }

  async #blockProvenance(
    revision: RawMappingRevision | undefined,
    knowledgeItemId: string,
    parseRevisionId: string,
    blocks: readonly NormalizedKnowledgeBlock[]
  ): Promise<Map<string, RecoveredBlockProvenance>> {
    if (revision?.contentList === undefined) return new Map()
    const recovered = recoverMineruBlockProvenance({
      blocks,
      contentListPath: revision.contentList.relativePath,
      contentList: await revision.readJson(revision.contentList),
      manifest: revision.manifest
    })
    this.options.log.info(
      {
        event: 'knowledge.mapping.provenance_recovered',
        knowledgeItemId,
        parseRevisionId,
        recoveredBlockCount: recovered.size,
        unmatchedBlockCount: Math.max(0, blocks.length - recovered.size)
      },
      'MinerU block provenance recovered from the raw revision'
    )
    return recovered
  }
}

type RegionAccumulator = {
  regionId: string
  providerBlockId: string | null
  normalizedBlockIds: Set<string>
  blockTypes: Set<string>
  bbox: [number, number, number, number] | null
  pageIndex: number
}

type CoverageAccumulator = {
  totalCharacters: number
  coveredCharacters: number
  segments: Array<{ startRatio: number; endRatio: number }>
}

function createRegion(
  regionId: string,
  source: {
    providerBlockId: string | null
    page: number | null
    bbox: [number, number, number, number] | null
  },
  block: NormalizedKnowledgeBlock,
  recovered?: RecoveredBlockProvenance
): RegionAccumulator {
  return {
    regionId,
    providerBlockId: source.providerBlockId,
    normalizedBlockIds: new Set([block.id]),
    blockTypes: new Set([block.type]),
    bbox: source.bbox,
    pageIndex: source.page ?? block.page ?? recovered?.page ?? 0
  }
}

function regionKey(
  providerBlockId: string | null,
  page: number | null,
  bbox: [number, number, number, number] | null,
  fallback: string,
  separateFromProvider = false
): string {
  return providerBlockId === null || separateFromProvider
    ? `block:${fallback}`
    : `provider-${sha256(Buffer.from(`${providerBlockId}\0${page ?? -1}\0${bbox?.join(',') ?? ''}`)).slice(0, 24)}`
}

function isInheritedCaptionBbox(
  block: NormalizedKnowledgeBlock,
  bbox: [number, number, number, number] | null,
  blocks: readonly NormalizedKnowledgeBlock[]
): boolean {
  if (block.type !== 'caption' || bbox === null) return false
  let parent: NormalizedKnowledgeBlock | undefined
  const blockIndex = blocks.findIndex((candidate) => candidate.id === block.id)
  for (let index = blockIndex - 1; index >= 0; index -= 1) {
    const candidate = blocks[index]
    if (candidate?.type === 'caption') continue
    parent = candidate
    break
  }
  if (parent?.bbox === undefined || !captionMatchesImage(block, parent)) return false
  return parent.bbox.every((coordinate, index) => coordinate === bbox[index])
}

function validateBbox(
  bbox: [number, number, number, number] | null,
  geometry: PageGeometry | undefined
): [number, number, number, number] | null {
  if (bbox === null || geometry === undefined) return bbox
  const tolerance = Math.max(1, Math.max(geometry.width, geometry.height) * 0.01)
  const [x0, y0, x1, y1] = bbox
  if (
    Math.min(x0, x1) < -tolerance ||
    Math.min(y0, y1) < -tolerance ||
    Math.max(x0, x1) > geometry.width + tolerance ||
    Math.max(y0, y1) > geometry.height + tolerance
  ) {
    return null
  }
  return bbox
}

function mergeOrdinalRanges(ranges: Array<{ start: number; end: number }>) {
  const merged: typeof ranges = []
  for (const range of ranges.sort((left, right) => left.start - right.start)) {
    if (range.start > range.end) continue
    const last = merged.at(-1)
    if (last !== undefined && range.start <= last.end) {
      last.end = Math.max(last.end, range.end)
    } else {
      merged.push(range)
    }
  }
  return merged
}

function lowerBoundByOrdinal<T>(
  entries: readonly T[],
  ordinal: number,
  getOrdinal: (entry: T) => number
): number {
  let first = 0
  let end = entries.length
  while (first < end) {
    const middle = first + Math.floor((end - first) / 2)
    const entry = entries[middle]
    if (entry !== undefined && getOrdinal(entry) < ordinal) first = middle + 1
    else end = middle
  }
  return first
}

function blockOffsets(
  blocks: readonly NormalizedKnowledgeBlock[],
  startOrdinal: number,
  endOrdinal: number
): Map<string, { start: number; end: number }> {
  const offsets = new Map<string, { start: number; end: number }>()
  let cursor = 0
  let first = true
  const firstBlock = lowerBoundByOrdinal(blocks, startOrdinal, (block) => block.ordinal)
  for (let index = firstBlock; index < blocks.length; index += 1) {
    const block = blocks[index]
    if (block === undefined || block.ordinal > endOrdinal) break
    const text = searchableKnowledgeBlockText(block)
    if (text.length === 0) continue
    if (!first) cursor += BLOCK_SEPARATOR_CODE_POINTS
    const start = cursor
    cursor += Array.from(text).length
    offsets.set(block.id, { start, end: cursor })
    first = false
  }
  return offsets
}

function collectGeometry(value: unknown): Map<number, PageGeometry> {
  const result = new Map<number, PageGeometry>()
  let visited = 0
  const visit = (node: unknown, depth: number, pageHint?: number): void => {
    if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return
    visited += 1
    if (visited > MAX_GEOMETRY_NODES) throw new Error('MinerU geometry is too complex')
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1, pageHint)
      return
    }
    const object = node as Record<string, unknown>
    const pageIndex = pageHint ?? pageIndexOf(object)
    const size = pageSizeOf(object)
    if (pageIndex !== undefined && size !== undefined) {
      result.set(pageIndex, { width: size[0], height: size[1], origin: 'top-left' })
      if (result.size > MAX_GEOMETRY_PAGES) throw new Error('MinerU geometry has too many pages')
    }
    for (const [key, child] of Object.entries(object)) {
      visit(child, depth + 1, key === 'page_idx' && typeof child === 'number' ? child : pageIndex)
    }
  }
  visit(value, 0)
  return result
}

function collectVlmContentListGeometry(value: unknown): Map<number, PageGeometry> {
  if (!Array.isArray(value) || value.length > 20_000) {
    throw new Error('MinerU VLM content-list geometry shape is invalid')
  }
  const result = new Map<number, PageGeometry>()
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('MinerU VLM content-list block is invalid')
    }
    const block = item as Record<string, unknown>
    const pageIndex = pageIndexOf(block)
    if (pageIndex === undefined || block.bbox === undefined) continue
    if (
      !Array.isArray(block.bbox) ||
      block.bbox.length !== 4 ||
      !block.bbox.every(
        (coordinate) =>
          typeof coordinate === 'number' &&
          Number.isFinite(coordinate) &&
          coordinate >= 0 &&
          coordinate <= VLM_CONTENT_COORDINATE_SIZE
      )
    ) {
      throw new Error('MinerU VLM content-list bbox is outside its coordinate space')
    }
    result.set(pageIndex, {
      width: VLM_CONTENT_COORDINATE_SIZE,
      height: VLM_CONTENT_COORDINATE_SIZE,
      origin: 'top-left'
    })
    if (result.size > MAX_GEOMETRY_PAGES) {
      throw new Error('MinerU VLM content-list has too many pages')
    }
  }
  return result
}

function pageIndexOf(value: Record<string, unknown>): number | undefined {
  if (
    typeof value.page_idx === 'number' &&
    Number.isInteger(value.page_idx) &&
    value.page_idx >= 0
  ) {
    return value.page_idx
  }
  if (typeof value.page_no === 'number' && Number.isInteger(value.page_no) && value.page_no >= 0) {
    return value.page_no
  }
  if (typeof value.page_id === 'number' && Number.isInteger(value.page_id) && value.page_id >= 0) {
    return value.page_id
  }
  return undefined
}

function pageSizeOf(value: Record<string, unknown>): [number, number] | undefined {
  const candidate = value.page_size
  if (Array.isArray(candidate) && candidate.length >= 2) {
    const width = candidate[0]
    const height = candidate[1]
    if (
      typeof width === 'number' &&
      typeof height === 'number' &&
      Number.isFinite(width) &&
      Number.isFinite(height) &&
      width > 0 &&
      height > 0 &&
      width <= MAX_PAGE_DIMENSION &&
      height <= MAX_PAGE_DIMENSION
    ) {
      return [width, height]
    }
  }
  const width = value.page_width
  const height = value.page_height
  if (
    typeof width === 'number' &&
    typeof height === 'number' &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0 &&
    width <= MAX_PAGE_DIMENSION &&
    height <= MAX_PAGE_DIMENSION
  ) {
    return [width, height]
  }
  return undefined
}

function geometryPriority(path: string): number {
  const name = basename(path).toLowerCase()
  if (name === 'middle.json' || name === 'layout.json') return 0
  if (name === 'model.json') return 1
  return 2
}
