import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Logger } from 'pino'
import {
  knowledgeMappingPageSchema,
  type KnowledgeMappingPage
} from '../../shared/contracts/knowledge-mapping'
import type { NormalizedKnowledgeBlock } from '../../shared/contracts/knowledge'
import { searchableKnowledgeBlockText } from '../../shared/knowledge-text'
import { mineruRawManifestSchema } from '../../shared/contracts/mineru'
import { chooseMineruContentListPath } from '../../shared/mineru-content-list'
import type { ProjectIndexService } from '../search/index-service'
import type { ProjectDatabase } from '../project/project-database'
import { ProjectFilesystem } from '../project/project-filesystem'
import type { KnowledgeNormalizationService } from './knowledge-normalization-service'
import {
  recoverMineruBlockProvenance,
  type RecoveredBlockProvenance
} from './mineru-block-provenance'

const MAX_GEOMETRY_BYTES = 100 * 1024 * 1024
const MAX_DEPTH = 24
const MAX_GEOMETRY_NODES = 200_000
const MAX_GEOMETRY_PAGES = 10_000
const MAX_PAGE_DIMENSION = 10_000_000
const VLM_CONTENT_COORDINATE_SIZE = 1_000

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
        recoveredProvenance = await this.blockProvenance(
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
    let geometry = new Map<number, { width: number; height: number; origin: 'top-left' }>()
    try {
      geometry = await this.pageGeometry(knowledgeItemId, parseRevisionId)
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

    const ranges = indexed.chunks.map((chunk) => ({
      start: chunk.sourceBlockStart,
      end: chunk.sourceBlockEnd
    }))
    const sourceBlockIds = new Set(
      indexed.chunks.flatMap((chunk) => chunk.sources.map((source) => source.blockId))
    )
    const relevantRead = await this.options.normalization.readBlocksForMapping(
      knowledgeItemId,
      parseRevisionId,
      (block) =>
        sourceBlockIds.has(block.id) ||
        ranges.some((range) => block.ordinal >= range.start && block.ordinal <= range.end),
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
        const inheritedCaptionBbox =
          block.type === 'caption' && isInheritedCaptionBbox(block, candidateBbox, activeBlocks)
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

  async pageGeometry(
    knowledgeItemId: string,
    parseRevisionId: string
  ): Promise<Map<number, { width: number; height: number; origin: 'top-left' }>> {
    const row = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT relative_path, manifest_sha256
               FROM parse_revisions
              WHERE knowledge_item_id = ? AND parse_revision_id = ?`
          )
          .get(knowledgeItemId, parseRevisionId) as
          | { relative_path: string; manifest_sha256: string }
          | undefined
    )
    if (row === undefined) return new Map()
    const manifestBytes = await readBounded(
      await this.filesystem.assertExistingRegularFile(`${row.relative_path}/manifest.json`),
      10 * 1024 * 1024
    )
    if (sha256(manifestBytes) !== row.manifest_sha256)
      throw new Error('Raw parse manifest hash mismatch')
    const manifest = mineruRawManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
    if (manifest.modelVersion === 'vlm') {
      const contentListPath = chooseMineruContentListPath(
        manifest.files.map((file) => file.relativePath)
      )
      const contentListFile = manifest.files.find((file) => file.relativePath === contentListPath)
      if (contentListFile !== undefined) {
        const bytes = await readBounded(
          await this.filesystem.assertExistingRegularFile(
            `${row.relative_path}/${contentListFile.relativePath}`
          ),
          MAX_GEOMETRY_BYTES
        )
        if (
          bytes.byteLength !== contentListFile.byteSize ||
          sha256(bytes) !== contentListFile.sha256
        ) {
          throw new Error('Raw VLM content-list hash or size mismatch')
        }
        const geometry = collectVlmContentListGeometry(JSON.parse(bytes.toString('utf8')))
        if (geometry.size > 0) return geometry
      }
    }
    const candidates = manifest.files
      .filter((file) => /(?:middle|layout|model|content_list)\.json$/i.test(file.relativePath))
      .sort((a, b) => geometryPriority(a.relativePath) - geometryPriority(b.relativePath))
    for (const file of candidates) {
      const bytes = await readBounded(
        await this.filesystem.assertExistingRegularFile(
          `${row.relative_path}/${file.relativePath}`
        ),
        MAX_GEOMETRY_BYTES
      )
      if (sha256(bytes) !== file.sha256) throw new Error('Raw geometry file hash mismatch')
      const geometry = collectGeometry(JSON.parse(bytes.toString('utf8')))
      if (geometry.size > 0) return geometry
    }
    return new Map()
  }

  async blockProvenance(
    knowledgeItemId: string,
    parseRevisionId: string,
    blocks: readonly NormalizedKnowledgeBlock[]
  ): Promise<Map<string, RecoveredBlockProvenance>> {
    const row = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT relative_path, manifest_sha256
               FROM parse_revisions
              WHERE knowledge_item_id = ? AND parse_revision_id = ?`
          )
          .get(knowledgeItemId, parseRevisionId) as
          | { relative_path: string; manifest_sha256: string }
          | undefined
    )
    if (row === undefined) return new Map()
    const manifestBytes = await readBounded(
      await this.filesystem.assertExistingRegularFile(`${row.relative_path}/manifest.json`),
      10 * 1024 * 1024
    )
    if (sha256(manifestBytes) !== row.manifest_sha256) {
      throw new Error('Raw parse manifest hash mismatch')
    }
    const manifest = mineruRawManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8')))
    const contentListPath = chooseMineruContentListPath(
      manifest.files.map((file) => file.relativePath)
    )
    if (contentListPath === undefined) return new Map()
    const file = manifest.files.find((candidate) => candidate.relativePath === contentListPath)
    if (file === undefined) throw new Error('MinerU content list inventory record is missing')
    const contentListBytes = await readBounded(
      await this.filesystem.assertExistingRegularFile(`${row.relative_path}/${contentListPath}`),
      MAX_GEOMETRY_BYTES
    )
    if (contentListBytes.byteLength !== file.byteSize || sha256(contentListBytes) !== file.sha256) {
      throw new Error('MinerU content list hash or size does not match')
    }
    const recovered = recoverMineruBlockProvenance({
      blocks,
      contentListPath,
      contentList: JSON.parse(contentListBytes.toString('utf8')),
      manifest
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
  if (parent?.type !== 'image') return false
  const related =
    block.assetRefs.some((asset) => parent.assetRefs.includes(asset)) ||
    (block.sourceProviderBlockId !== undefined &&
      block.sourceProviderBlockId === parent.sourceProviderBlockId)
  if (!related || parent.bbox === undefined) return false
  return parent.bbox.every((coordinate, index) => coordinate === bbox[index])
}

function validateBbox(
  bbox: [number, number, number, number] | null,
  geometry: { width: number; height: number; origin: 'top-left' } | undefined
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

function blockOffsets(
  blocks: readonly NormalizedKnowledgeBlock[],
  startOrdinal: number,
  endOrdinal: number
): Map<string, { start: number; end: number }> {
  const offsets = new Map<string, { start: number; end: number }>()
  let cursor = 0
  let first = true
  for (const block of blocks) {
    if (block.ordinal < startOrdinal || block.ordinal > endOrdinal) continue
    const text = searchableKnowledgeBlockText(block)
    if (text.length === 0) continue
    if (!first) cursor += 2
    const start = cursor
    cursor += Array.from(text).length
    offsets.set(block.id, { start, end: cursor })
    first = false
  }
  return offsets
}

function collectGeometry(
  value: unknown
): Map<number, { width: number; height: number; origin: 'top-left' }> {
  const result = new Map<number, { width: number; height: number; origin: 'top-left' }>()
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

function collectVlmContentListGeometry(
  value: unknown
): Map<number, { width: number; height: number; origin: 'top-left' }> {
  if (!Array.isArray(value) || value.length > 20_000) {
    throw new Error('MinerU VLM content-list geometry shape is invalid')
  }
  const result = new Map<number, { width: number; height: number; origin: 'top-left' }>()
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

async function readBounded(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      throw new Error('Geometry file size is invalid')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
