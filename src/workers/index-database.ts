import { createHash } from 'node:crypto'
import { INDEX_GENERATION_PREFIX, generationIdFor, hashSourceSet } from '../shared/index-generation'
import Database from 'better-sqlite3'
import {
  INDEX_SCHEMA_VERSION,
  INDEX_MAPPING_CHUNK_LIMIT,
  type FtsSearchMode,
  type IndexCandidate,
  type IndexSnapshot,
  type IndexSource,
  type VectorRefresh,
  type VectorGenerationContract
} from '../shared/contracts/indexing'
import type { KnowledgeSearchFilters } from '../shared/contracts/search'
import { buildDeterministicChunks } from './index-chunker'
import { FtsIndex, type FtsCandidate } from './fts-index'
import { SqliteVecVectorIndex, type VectorIndex, vectorTableName } from './vector-index'
import {
  compileKnowledgeSearchFilters,
  normalizeSearchHeading,
  type SearchFilterSql
} from './shared/knowledge-search-filter-sql'

const INDEX_DATABASE_APPLICATION_ID = 0x574c4958
const RETAINED_NON_ACTIVE_GENERATIONS = 3
const EMBEDDING_CACHE_LIMIT = 50_000
const MAPPING_SOURCE_ROW_LIMIT = 5_000

interface CandidateSourceRow {
  chunk_id: string
  block_id: string
  page: number | null
  asset_refs_json: string
}

interface SourceLocationRow {
  block_id: string
  page: number | null
  block_type: string
  bbox_json: string
  provider_block_id: string | null
  segment_start: number
  segment_end: number
}

type DetailedCandidateSourceRow = CandidateSourceRow & SourceLocationRow

export interface IndexStartupReport {
  integrityMode: 'new' | 'full' | 'clean-shutdown-fast-path'
  integrityDurationMs: number
  cleanup: {
    indexGenerations: number
    embeddingGenerations: number
    orphanFtsRows: number
    orphanVectorTables: number
    embeddingCacheRows: number
  }
}

export class IndexDatabase {
  readonly #database: Database.Database
  readonly #fts: FtsIndex
  readonly #vectors: VectorIndex
  readonly startupReport: IndexStartupReport

  constructor(path: string, extensionPath?: string) {
    this.#database = new Database(path)
    try {
      this.#database.pragma('journal_mode = WAL')
      this.#database.pragma('synchronous = NORMAL')
      this.#database.pragma('foreign_keys = ON')
      this.#database.pragma('busy_timeout = 5000')
      if (extensionPath !== undefined) this.#database.loadExtension(extensionPath)
      this.#database.function('search_heading_text', { deterministic: true }, (value: string) =>
        normalizeSearchHeading(parseStringArray(value).join('\n'))
      )
      const applicationId = this.#database.pragma('application_id', { simple: true }) as number
      if (applicationId !== 0 && applicationId !== INDEX_DATABASE_APPLICATION_ID) {
        throw new Error('Index database application ID is incompatible')
      }
      const userVersion = this.#database.pragma('user_version', { simple: true }) as number
      const cleanShutdown =
        userVersion >= 5
          ? (this.#database
              .prepare('SELECT clean_shutdown FROM index_runtime_state WHERE singleton = 1')
              .pluck()
              .get() as number | undefined)
          : undefined
      const integrityMode =
        applicationId === 0 && userVersion === 0
          ? 'new'
          : cleanShutdown === 1
            ? 'clean-shutdown-fast-path'
            : 'full'
      const integrityStartedAt = Date.now()
      if (integrityMode === 'full') {
        const quickCheck = this.#database.pragma('quick_check', { simple: true }) as string
        if (quickCheck !== 'ok') throw new Error('Index database integrity check failed')
      }
      this.#database.pragma(`application_id = ${INDEX_DATABASE_APPLICATION_ID}`)
      this.#migrate()
      this.#fts = new FtsIndex(this.#database)
      this.#vectors = new SqliteVecVectorIndex(this.#database)
      this.#verifyLogicalIntegrity()
      const cleanup = this.#cleanupDerivedStorage()
      this.#database
        .prepare(
          'UPDATE index_runtime_state SET clean_shutdown = 0, updated_at = ? WHERE singleton = 1'
        )
        .run(new Date().toISOString())
      this.startupReport = {
        integrityMode,
        integrityDurationMs: Date.now() - integrityStartedAt,
        cleanup
      }
    } catch (err) {
      try {
        this.#database.close()
      } catch (closeError) {
        throw new AggregateError(
          [err, closeError],
          'Index database initialization failed and its handle could not be closed',
          { cause: err }
        )
      }
      throw err
    }
  }

  close(): void {
    if (!this.#database.open) return
    this.#database
      .prepare(
        'UPDATE index_runtime_state SET clean_shutdown = 1, updated_at = ? WHERE singleton = 1'
      )
      .run(new Date().toISOString())
    this.#database.close()
  }

  inspect(): IndexSnapshot {
    const active = this.#activeGeneration()
    const generationCount = this.#database
      .prepare('SELECT count(*) FROM index_generations')
      .pluck()
      .get() as number
    const chunkCount =
      active === undefined
        ? 0
        : (this.#database
            .prepare('SELECT count(*) FROM chunks WHERE generation_id = ?')
            .pluck()
            .get(active.generation_id) as number)
    const sourceCount =
      active === undefined
        ? 0
        : (this.#database
            .prepare('SELECT count(DISTINCT knowledge_item_id) FROM chunks WHERE generation_id = ?')
            .pluck()
            .get(active.generation_id) as number)
    return {
      schemaVersion: INDEX_SCHEMA_VERSION,
      activeGenerationId: active?.generation_id ?? null,
      generationCount,
      chunkCount,
      sourceCount,
      activeSourceSetSha256: active?.source_set_sha256 ?? null
    }
  }

  #activeGeneration(): { generation_id: string; source_set_sha256: string } | undefined {
    return this.#database
      .prepare(
        `SELECT generation_id, source_set_sha256 FROM index_generations
          WHERE state = 'active' AND generation_id GLOB ?`
      )
      .get(`${INDEX_GENERATION_PREFIX}*`) as
      | { generation_id: string; source_set_sha256: string }
      | undefined
  }

  get activeGenerationId(): string | null {
    return this.#activeGeneration()?.generation_id ?? null
  }

  searchFts(
    query: string,
    limit: number,
    filters: KnowledgeSearchFilters = emptyFilters(),
    mode: FtsSearchMode = 'phrase'
  ): FtsCandidate[] {
    const active = this.activeGenerationId
    return active === null ? [] : this.#fts.search(active, query, limit, filters, mode)
  }

  retrievalState(): {
    activeIndexGenerationId: string | null
    activeEmbeddingContract: VectorGenerationContract | null
  } {
    const active = this.#activeGeneration()
    if (active === undefined) {
      return { activeIndexGenerationId: null, activeEmbeddingContract: null }
    }
    const activeIndexGenerationId = active.generation_id
    const row = this.#database
      .prepare(
        `SELECT embedding_generation_id, index_generation_id, provider_id, model_id,
                model_revision, dimension, metric, normalization, chunker_version,
                contract_sha256, content_fingerprint
           FROM embedding_generations
          WHERE state = 'active' AND index_generation_id = ?`
      )
      .get(activeIndexGenerationId) as
      | {
          embedding_generation_id: string
          index_generation_id: string
          provider_id: string
          model_id: string
          model_revision: string
          dimension: number
          metric: 'cosine' | 'l2'
          normalization: 'none' | 'l2'
          chunker_version: number
          contract_sha256: string
          content_fingerprint: string
        }
      | undefined
    if (row !== undefined && row.content_fingerprint !== active.source_set_sha256) {
      throw new Error('Active embedding source fingerprint is incompatible')
    }
    return {
      activeIndexGenerationId,
      activeEmbeddingContract:
        row === undefined
          ? null
          : {
              embeddingGenerationId: row.embedding_generation_id,
              indexGenerationId: row.index_generation_id,
              providerId: row.provider_id,
              modelId: row.model_id,
              modelRevision: row.model_revision,
              dimension: row.dimension,
              metric: row.metric,
              normalization: row.normalization,
              chunkerVersion: row.chunker_version,
              contractSha256: row.contract_sha256,
              contentFingerprint: row.content_fingerprint
            }
    }
  }

  searchCandidates(
    input: {
      indexGenerationId: string
      filters: KnowledgeSearchFilters
      limit: number
    } & (
      | { query: string; mode: FtsSearchMode }
      | { embeddingGenerationId: string; vector: number[] }
    )
  ): IndexCandidate[] | null {
    const active = this.activeGenerationId
    if (active !== input.indexGenerationId) return null
    const { filters, limit } = input
    const matches =
      'query' in input
        ? this.#fts.search(active, input.query, limit, filters, input.mode)
        : this.#vectors.query(input.embeddingGenerationId, input.vector, limit, filters)
    return this.#hydrateCandidates(
      active,
      matches.map((match) => match.chunkId),
      false
    )
  }

  hydrateCandidates(
    chunkIds: string[],
    filters: KnowledgeSearchFilters,
    includeSourceDetails = false
  ): IndexCandidate[] {
    const active = this.activeGenerationId
    return active === null
      ? []
      : this.#hydrateCandidates(
          active,
          chunkIds,
          includeSourceDetails,
          compileKnowledgeSearchFilters(filters)
        )
  }

  #hydrateCandidates(
    active: string,
    chunkIds: string[],
    includeSourceDetails: boolean,
    filter?: SearchFilterSql
  ): IndexCandidate[] {
    if (chunkIds.length === 0) return []
    const placeholders = chunkIds.map(() => '?').join(', ')
    const chunks = this.#database
      .prepare(
        `SELECT chunk_id, knowledge_item_id, display_name, extension, parse_revision_id,
                text, heading_path_json
           FROM chunks
          WHERE generation_id = ? AND chunk_id IN (${placeholders})
            ${filter?.clause ?? ''}`
      )
      .all(active, ...chunkIds, ...(filter?.parameters ?? [])) as Array<{
      chunk_id: string
      knowledge_item_id: string
      display_name: string
      extension: string | null
      parse_revision_id: string
      text: string
      heading_path_json: string
    }>
    if (chunks.length === 0) return []
    const matchedIds = chunks.map((chunk) => chunk.chunk_id)
    const detailColumns = includeSourceDetails
      ? ', block_type, bbox_json, provider_block_id, segment_start, segment_end'
      : ''
    const sources = this.#database
      .prepare(
        `SELECT chunk_id, block_id, page, asset_refs_json${detailColumns}
           FROM chunk_sources
          WHERE generation_id = ? AND chunk_id IN (${matchedIds.map(() => '?').join(', ')})
          ORDER BY chunk_id, source_ordinal`
      )
      .all(active, ...matchedIds) as Array<CandidateSourceRow | DetailedCandidateSourceRow>
    const sourcesByChunk = new Map<string, typeof sources>()
    for (const source of sources) {
      const group = sourcesByChunk.get(source.chunk_id) ?? []
      group.push(source)
      sourcesByChunk.set(source.chunk_id, group)
    }
    const chunkById = new Map(chunks.map((chunk) => [chunk.chunk_id, chunk]))
    const result: IndexCandidate[] = []
    for (const chunkId of chunkIds) {
      const chunk = chunkById.get(chunkId)
      if (chunk === undefined) continue
      const headingPath = parseStringArray(chunk.heading_path_json)
      const sourceBlockIds: string[] = []
      const assetRefs = new Set<string>()
      const sourceDetails: IndexCandidate['sources'] = []
      let page: number | undefined
      for (const source of sourcesByChunk.get(chunkId) ?? []) {
        sourceBlockIds.push(source.block_id)
        if (source.page !== null) page = Math.min(page ?? source.page, source.page)
        const sourceAssetRefs = parseStringArray(source.asset_refs_json)
        for (const ref of sourceAssetRefs) assetRefs.add(ref)
        if ('bbox_json' in source) {
          sourceDetails.push({
            ...readSourceLocation(source),
            assetRefs: sourceAssetRefs
          })
        }
      }
      result.push({
        citationId: citationIdForChunk(chunkId),
        chunkId,
        knowledgeItemId: chunk.knowledge_item_id,
        parseRevisionId: chunk.parse_revision_id,
        title: chunk.display_name,
        extension: chunk.extension,
        text: chunk.text,
        ...(page === undefined ? {} : { page }),
        headingPath,
        sourceBlockIds,
        assetRefs: [...assetRefs],
        sources: sourceDetails
      })
    }
    return result
  }

  inspectKnowledgeMapping(input: {
    knowledgeItemId: string
    parseRevisionId: string
    pageIndex: number
    fallbackBlockOrdinals?: number[]
  }): {
    state: 'ready' | 'indexing' | 'unavailable' | 'too_complex'
    activeIndexGenerationId: string | null
    activeEmbeddingGenerationId: string | null
    chunks: Array<{
      chunkId: string
      ordinal: number
      text: string
      headingPath: string[]
      sourceBlockStart: number
      sourceBlockEnd: number
      sources: Array<{
        blockId: string
        blockOrdinal: number
        blockType: string
        page: number | null
        bbox: [number, number, number, number] | null
        providerBlockId: string | null
        segmentStart: number
        segmentEnd: number
      }>
      embedding: {
        embeddingGenerationId: string
        providerId: string
        modelId: string
        modelRevision: string
        dimension: number
        metric: 'cosine' | 'l2'
        normalization: 'none' | 'l2'
        norm: number
        preview: number[]
      } | null
    }>
  } {
    const active = this.activeGenerationId
    if (active === null) {
      return {
        state: 'unavailable',
        activeIndexGenerationId: null,
        activeEmbeddingGenerationId: null,
        chunks: []
      }
    }
    const indexedRevision = this.#database
      .prepare(
        `SELECT parse_revision_id FROM index_sources
          WHERE generation_id = ? AND knowledge_item_id = ?`
      )
      .get(active, input.knowledgeItemId) as { parse_revision_id: string } | undefined
    if (indexedRevision?.parse_revision_id !== input.parseRevisionId) {
      return {
        state: 'indexing',
        activeIndexGenerationId: active,
        activeEmbeddingGenerationId: null,
        chunks: []
      }
    }

    const fallbackBlockOrdinals = [...new Set(input.fallbackBlockOrdinals ?? [])]
    const fallbackPlaceholders = fallbackBlockOrdinals.map(() => '?').join(', ')
    const fallbackPredicate =
      fallbackBlockOrdinals.length === 0
        ? ''
        : ` OR (chunk_sources.page IS NULL
                  AND chunk_sources.block_ordinal IN (${fallbackPlaceholders}))`
    const chunkIds = this.#database
      .prepare(
        `SELECT chunks.chunk_id
           FROM chunks
          WHERE chunks.generation_id = ?
            AND chunks.knowledge_item_id = ?
            AND chunks.parse_revision_id = ?
            AND EXISTS (
              SELECT 1 FROM chunk_sources
               WHERE chunk_sources.generation_id = chunks.generation_id
                 AND chunk_sources.chunk_id = chunks.chunk_id
                 AND (chunk_sources.page = ?${fallbackPredicate})
            )
          LIMIT ?`
      )
      .pluck()
      .all(
        active,
        input.knowledgeItemId,
        input.parseRevisionId,
        input.pageIndex,
        ...fallbackBlockOrdinals,
        INDEX_MAPPING_CHUNK_LIMIT + 1
      ) as string[]
    if (chunkIds.length === 0 || chunkIds.length > INDEX_MAPPING_CHUNK_LIMIT) {
      return {
        state: chunkIds.length === 0 ? 'ready' : 'too_complex',
        activeIndexGenerationId: active,
        activeEmbeddingGenerationId: this.#activeEmbeddingGenerationId(active),
        chunks: []
      }
    }
    const placeholders = chunkIds.map(() => '?').join(', ')
    const sources = this.#database
      .prepare(
        `SELECT chunk_id, block_id, block_ordinal, block_type, page, bbox_json,
                provider_block_id, segment_start, segment_end
           FROM chunk_sources
          WHERE generation_id = ? AND chunk_id IN (${placeholders})
          ORDER BY chunk_id, source_ordinal
          LIMIT ?`
      )
      .all(active, ...chunkIds, MAPPING_SOURCE_ROW_LIMIT + 1) as Array<
      SourceLocationRow & {
        chunk_id: string
        block_ordinal: number
      }
    >
    if (sources.length > MAPPING_SOURCE_ROW_LIMIT) {
      return {
        state: 'too_complex',
        activeIndexGenerationId: active,
        activeEmbeddingGenerationId: this.#activeEmbeddingGenerationId(active),
        chunks: []
      }
    }
    const sourcesByChunk = new Map<string, typeof sources>()
    for (const source of sources) {
      const current = sourcesByChunk.get(source.chunk_id) ?? []
      current.push(source)
      sourcesByChunk.set(source.chunk_id, current)
    }
    const chunks = this.#database
      .prepare(
        `SELECT chunk_id, ordinal, text, heading_path_json, source_block_start, source_block_end
           FROM chunks
          WHERE generation_id = ? AND chunk_id IN (${placeholders})
          ORDER BY ordinal, chunk_id`
      )
      .all(active, ...chunkIds) as Array<{
      chunk_id: string
      ordinal: number
      text: string
      heading_path_json: string
      source_block_start: number
      source_block_end: number
    }>
    const embedding = this.#database
      .prepare(
        `SELECT embedding_generation_id, provider_id, model_id, model_revision,
                dimension, metric, normalization
           FROM embedding_generations
          WHERE index_generation_id = ? AND state = 'active'`
      )
      .get(active) as
      | {
          embedding_generation_id: string
          provider_id: string
          model_id: string
          model_revision: string
          dimension: number
          metric: 'cosine' | 'l2'
          normalization: 'none' | 'l2'
        }
      | undefined
    const previews =
      embedding === undefined
        ? new Map<string, { norm: number; preview: number[] }>()
        : new Map(
            this.#vectors
              .preview(embedding.embedding_generation_id, chunkIds, 16)
              .map((value) => [value.chunkId, { norm: value.norm, preview: value.preview }])
          )
    return {
      state: 'ready',
      activeIndexGenerationId: active,
      activeEmbeddingGenerationId: embedding?.embedding_generation_id ?? null,
      chunks: chunks.map((chunk) => ({
        chunkId: chunk.chunk_id,
        ordinal: chunk.ordinal,
        text: chunk.text,
        headingPath: parseStringArray(chunk.heading_path_json),
        sourceBlockStart: chunk.source_block_start,
        sourceBlockEnd: chunk.source_block_end,
        sources: (sourcesByChunk.get(chunk.chunk_id) ?? []).map((source) => ({
          ...readSourceLocation(source),
          blockOrdinal: source.block_ordinal
        })),
        embedding:
          embedding === undefined
            ? null
            : {
                embeddingGenerationId: embedding.embedding_generation_id,
                providerId: embedding.provider_id,
                modelId: embedding.model_id,
                modelRevision: embedding.model_revision,
                dimension: embedding.dimension,
                metric: embedding.metric,
                normalization: embedding.normalization,
                norm: previews.get(chunk.chunk_id)?.norm ?? 0,
                preview: previews.get(chunk.chunk_id)?.preview ?? []
              }
      }))
    }
  }

  #activeEmbeddingGenerationId(indexGenerationId: string): string | null {
    return (
      (this.#database
        .prepare(
          "SELECT embedding_generation_id FROM embedding_generations WHERE index_generation_id = ? AND state = 'active'"
        )
        .pluck()
        .get(indexGenerationId) as string | undefined) ?? null
    )
  }

  expandCitations(citationIds: string[]): IndexCandidate[] {
    return this.hydrateCandidates(
      citationIds.map((citationId) => `chunk-${citationId.slice('citation-'.length)}`),
      emptyFilters(),
      true
    )
  }

  embeddingInputs(
    indexGenerationId: string,
    offset = 0,
    limit = 256,
    contractSha256?: string,
    dimension?: number
  ): {
    values: Array<{
      chunkId: string
      text: string
      contentSha256: string
      cachedVector?: number[]
    }>
    total: number
  } {
    const total = this.#database
      .prepare('SELECT count(*) FROM chunks WHERE generation_id = ?')
      .pluck()
      .get(indexGenerationId) as number
    const rows = this.#database
      .prepare(
        `SELECT chunks.chunk_id AS chunkId, chunks.text,
                chunks.content_sha256 AS contentSha256, cache.vector_blob AS vectorBlob
           FROM chunks
           LEFT JOIN embedding_vector_cache AS cache
             ON cache.contract_sha256 = ?
            AND cache.content_sha256 = chunks.content_sha256
            AND cache.dimension = ?
          WHERE chunks.generation_id = ?
          ORDER BY chunks.knowledge_item_id, chunks.ordinal, chunks.chunk_id
          LIMIT ? OFFSET ?`
      )
      .all(contractSha256 ?? '', dimension ?? -1, indexGenerationId, limit, offset) as Array<{
      chunkId: string
      text: string
      contentSha256: string
      vectorBlob: Buffer | null
    }>
    const values = rows.map(({ vectorBlob, ...row }) => ({
      ...row,
      ...(vectorBlob === null ? {} : { cachedVector: decodeVector(vectorBlob) })
    }))
    return { values, total }
  }

  beginEmbedding(
    contract: VectorGenerationContract,
    refresh?: VectorRefresh
  ): { alreadyActive: boolean; clearedCount: number | null } {
    return this.#database.transaction(() => {
      const alreadyActive = this.#vectors.begin(contract)
      if (alreadyActive || refresh === undefined) return { alreadyActive, clearedCount: null }

      // Older builds can stop after creating the generation but before clearing the cache.
      // A saved vector proves that the refresh passed that boundary.
      const hasProgress =
        this.#database
          .prepare('SELECT 1 FROM chunk_vectors WHERE embedding_generation_id = ? LIMIT 1')
          .pluck()
          .get(contract.embeddingGenerationId) === 1
      const clearedCount = hasProgress
        ? null
        : this.#clearEmbeddingCache(
            contract.indexGenerationId,
            contract.contractSha256,
            refresh.scope === 'item' ? refresh.knowledgeItemId : undefined
          )
      return { alreadyActive, clearedCount }
    })()
  }

  #clearEmbeddingCache(
    indexGenerationId: string,
    contractSha256: string,
    knowledgeItemId?: string
  ): number {
    const itemPredicate = knowledgeItemId === undefined ? '' : 'AND knowledge_item_id = ?'
    const parameters =
      knowledgeItemId === undefined
        ? [contractSha256, indexGenerationId]
        : [contractSha256, indexGenerationId, knowledgeItemId]
    return this.#database
      .prepare(
        `DELETE FROM embedding_vector_cache
          WHERE contract_sha256 = ?
            AND content_sha256 IN (
              SELECT content_sha256
                FROM chunks
               WHERE generation_id = ? ${itemPredicate}
            )`
      )
      .run(...parameters).changes
  }

  upsertVectors(
    embeddingGenerationId: string,
    values: Array<{ chunkId: string; contentSha256: string; vector: number[] }>
  ): void {
    this.#vectors.upsert(embeddingGenerationId, values)
  }

  activateEmbedding(embeddingGenerationId: string, contractSha256: string): void {
    this.#database.transaction(() => {
      this.#vectors.activate(embeddingGenerationId, contractSha256)
      this.#pruneObsoleteEmbeddings()
    })()
  }

  queryVectors(
    embeddingGenerationId: string,
    vector: number[],
    limit: number,
    filters: KnowledgeSearchFilters = emptyFilters()
  ) {
    return this.#vectors.query(embeddingGenerationId, vector, limit, filters)
  }

  async build(input: {
    generationId: string
    chunkerVersion: number
    sources: IndexSource[]
  }): Promise<{
    generationId: string
    sourceSetSha256: string
    chunkSetSha256: string
    chunkCount: number
    sourceCount: number
  }> {
    const sourceSetSha256 = hashSourceSet(input.sources, input.chunkerVersion)
    const expectedGenerationId = generationIdFor(sourceSetSha256, input.chunkerVersion)
    if (input.generationId !== expectedGenerationId) {
      throw new Error('Index generation ID does not match the source set')
    }
    const existing = this.#database
      .prepare(
        'SELECT source_set_sha256, chunk_set_sha256, chunk_count, source_count, state FROM index_generations WHERE generation_id = ?'
      )
      .get(input.generationId) as
      | {
          source_set_sha256: string
          chunk_set_sha256: string | null
          chunk_count: number | null
          source_count: number
          state: string
        }
      | undefined
    if (
      existing !== undefined &&
      ['built', 'active', 'obsolete'].includes(existing.state) &&
      existing.source_set_sha256 === sourceSetSha256 &&
      existing.chunk_set_sha256 !== null &&
      existing.chunk_count !== null
    ) {
      return {
        generationId: input.generationId,
        sourceSetSha256,
        chunkSetSha256: existing.chunk_set_sha256,
        chunkCount: existing.chunk_count,
        sourceCount: existing.source_count
      }
    }

    const chunks = await buildDeterministicChunks(input.sources, input.chunkerVersion)
    const chunkSetSha256 = hashChunkSet(
      chunks.map(({ knowledgeItemId, ordinal, chunkId, contentSha256, sources }) => ({
        knowledgeItemId,
        ordinal,
        chunkId,
        contentSha256,
        sources: sources.map((source) => source.blockId)
      }))
    )
    const now = new Date().toISOString()
    this.#database.transaction(() => {
      const current = this.#database
        .prepare('SELECT state FROM index_generations WHERE generation_id = ?')
        .pluck()
        .get(input.generationId) as string | undefined
      if (current === 'active') throw new Error('Active index generation cannot be rebuilt')
      this.#database
        .prepare('DELETE FROM chunk_fts_unicode61 WHERE generation_id = ?')
        .run(input.generationId)
      this.#database
        .prepare('DELETE FROM chunk_fts_trigram WHERE generation_id = ?')
        .run(input.generationId)
      this.#database
        .prepare('DELETE FROM index_sources WHERE generation_id = ?')
        .run(input.generationId)
      this.#database
        .prepare('DELETE FROM index_generations WHERE generation_id = ?')
        .run(input.generationId)
      this.#database
        .prepare(
          `INSERT INTO index_generations (
             generation_id, state, chunker_version, source_set_sha256, chunk_set_sha256,
             chunk_count, source_count, created_at, built_at, activated_at
           ) VALUES (?, 'building', ?, ?, NULL, NULL, ?, ?, NULL, NULL)`
        )
        .run(input.generationId, input.chunkerVersion, sourceSetSha256, input.sources.length, now)
      const insertChunk = this.#database.prepare(
        `INSERT INTO chunks (
           generation_id, chunk_id, knowledge_item_id, display_name, extension, parse_revision_id,
           normalization_run_id, ordinal, text, content_sha256, heading_path_json,
           source_block_start, source_block_end
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertSourceRecord = this.#database.prepare(
        `INSERT INTO index_sources (
           generation_id, knowledge_item_id, extension, parse_revision_id,
           normalization_run_id, manifest_sha256
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      const insertSource = this.#database.prepare(
        `INSERT INTO chunk_sources (
           generation_id, chunk_id, source_ordinal, block_id, block_ordinal, block_type,
           page, bbox_json, asset_refs_json, provider_block_id, segment_start, segment_end
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      const insertUnicode = this.#database.prepare(
        'INSERT INTO chunk_fts_unicode61 (generation_id, chunk_id, text) VALUES (?, ?, ?)'
      )
      const insertTrigram = this.#database.prepare(
        'INSERT INTO chunk_fts_trigram (generation_id, chunk_id, text) VALUES (?, ?, ?)'
      )
      for (const chunk of chunks) {
        insertChunk.run(
          input.generationId,
          chunk.chunkId,
          chunk.knowledgeItemId,
          chunk.displayName,
          chunk.extension,
          chunk.parseRevisionId,
          chunk.normalizationRunId,
          chunk.ordinal,
          chunk.text,
          chunk.contentSha256,
          chunk.headingPathJson,
          chunk.sourceBlockStart,
          chunk.sourceBlockEnd
        )
        insertUnicode.run(input.generationId, chunk.chunkId, chunk.text)
        insertTrigram.run(input.generationId, chunk.chunkId, chunk.text)
        for (const source of chunk.sources) {
          insertSource.run(
            input.generationId,
            chunk.chunkId,
            source.sourceOrdinal,
            source.blockId,
            source.blockOrdinal,
            source.blockType,
            source.page,
            source.bboxJson,
            source.assetRefsJson,
            source.providerBlockId,
            source.segmentStart,
            source.segmentEnd
          )
        }
      }
      for (const source of input.sources) {
        insertSourceRecord.run(
          input.generationId,
          source.knowledgeItemId,
          source.extension,
          source.parseRevisionId,
          source.normalizationRunId,
          source.manifestSha256
        )
      }
      this.#database
        .prepare(
          `UPDATE index_generations
              SET state = 'built', chunk_set_sha256 = ?, chunk_count = ?, built_at = ?
            WHERE generation_id = ? AND state = 'building'`
        )
        .run(chunkSetSha256, chunks.length, now, input.generationId)
    })()
    return {
      generationId: input.generationId,
      sourceSetSha256,
      chunkSetSha256,
      chunkCount: chunks.length,
      sourceCount: input.sources.length
    }
  }

  activate(generationId: string): IndexSnapshot {
    const now = new Date().toISOString()
    this.#database.transaction(() => {
      const target = this.#database
        .prepare('SELECT state FROM index_generations WHERE generation_id = ?')
        .pluck()
        .get(generationId) as string | undefined
      if (target === undefined || !['built', 'active'].includes(target)) {
        throw new Error('Index generation is not ready for activation')
      }
      if (target !== 'active') {
        this.#database
          .prepare("UPDATE index_generations SET state = 'obsolete' WHERE state = 'active'")
          .run()
        this.#database
          .prepare(
            "UPDATE index_generations SET state = 'active', activated_at = ? WHERE generation_id = ? AND state = 'built'"
          )
          .run(now, generationId)
      }
    })()
    this.#cleanupDerivedStorage()
    return this.inspect()
  }

  #verifyLogicalIntegrity(): void {
    const active = this.#database
      .prepare(
        "SELECT generation_id, chunker_version, source_set_sha256, chunk_set_sha256, chunk_count, source_count FROM index_generations WHERE state = 'active'"
      )
      .get() as
      | {
          generation_id: string
          chunker_version: number
          source_set_sha256: string
          chunk_set_sha256: string | null
          chunk_count: number | null
          source_count: number
        }
      | undefined
    if (active === undefined) return
    const sources = this.#database
      .prepare(
        `SELECT knowledge_item_id, extension, parse_revision_id, normalization_run_id, manifest_sha256
           FROM index_sources WHERE generation_id = ?`
      )
      .all(active.generation_id) as Array<{
      knowledge_item_id: string
      extension: string | null
      parse_revision_id: string
      normalization_run_id: string
      manifest_sha256: string
    }>
    const sourceFingerprint = hashSourceSet(
      sources.map((source) => ({
        knowledgeItemId: source.knowledge_item_id,
        extension: source.extension,
        parseRevisionId: source.parse_revision_id,
        normalizationRunId: source.normalization_run_id,
        manifestSha256: source.manifest_sha256
      })),
      active.chunker_version
    )
    if (sources.length !== active.source_count || sourceFingerprint !== active.source_set_sha256) {
      throw new Error('Index source fingerprint verification failed')
    }
    const chunks = this.#database
      .prepare(
        `SELECT knowledge_item_id, ordinal, chunk_id, content_sha256 FROM chunks
          WHERE generation_id = ?`
      )
      .all(active.generation_id) as Array<{
      knowledge_item_id: string
      ordinal: number
      chunk_id: string
      content_sha256: string
    }>
    const sourceIds = this.#database
      .prepare(
        `SELECT chunk_id, block_id FROM chunk_sources
          WHERE generation_id = ? ORDER BY chunk_id, source_ordinal`
      )
      .iterate(active.generation_id) as IterableIterator<{ chunk_id: string; block_id: string }>
    const blocks = new Map<string, string[]>()
    for (const source of sourceIds) {
      const group = blocks.get(source.chunk_id)
      if (group === undefined) blocks.set(source.chunk_id, [source.block_id])
      else group.push(source.block_id)
    }
    const chunkFingerprint = hashChunkSet(
      chunks.map((chunk) => ({
        knowledgeItemId: chunk.knowledge_item_id,
        ordinal: chunk.ordinal,
        chunkId: chunk.chunk_id,
        contentSha256: chunk.content_sha256,
        sources: blocks.get(chunk.chunk_id) ?? []
      }))
    )
    if (
      active.chunk_set_sha256 === null ||
      active.chunk_count !== chunks.length ||
      active.chunk_set_sha256 !== chunkFingerprint
    ) {
      throw new Error('Index chunk fingerprint verification failed')
    }
  }

  #pruneObsoleteEmbeddings(): number {
    const expired = this.#database
      .prepare(
        `SELECT embedding_generation_id FROM embedding_generations
          WHERE state = 'obsolete'
          ORDER BY COALESCE(activated_at, created_at) DESC, created_at DESC, embedding_generation_id DESC
          LIMIT -1 OFFSET ?`
      )
      .all(RETAINED_NON_ACTIVE_GENERATIONS) as Array<{ embedding_generation_id: string }>
    for (const generation of expired) this.#vectors.delete(generation.embedding_generation_id)
    return expired.length
  }

  #cleanupDerivedStorage(): IndexStartupReport['cleanup'] {
    let removedEmbeddingGenerations = this.#pruneObsoleteEmbeddings()
    const inactiveIndex = this.#database
      .prepare(
        `SELECT generation_id FROM index_generations
          WHERE state <> 'active'
          ORDER BY COALESCE(activated_at, built_at, created_at) DESC, generation_id DESC`
      )
      .all() as Array<{ generation_id: string }>
    let removedIndexGenerations = 0
    for (const generation of inactiveIndex.slice(RETAINED_NON_ACTIVE_GENERATIONS)) {
      const embeddings = this.#database
        .prepare(
          'SELECT embedding_generation_id FROM embedding_generations WHERE index_generation_id = ?'
        )
        .all(generation.generation_id) as Array<{ embedding_generation_id: string }>
      for (const embedding of embeddings) {
        this.#vectors.delete(embedding.embedding_generation_id)
        removedEmbeddingGenerations += 1
      }
      this.#database
        .prepare('DELETE FROM chunk_fts_unicode61 WHERE generation_id = ?')
        .run(generation.generation_id)
      this.#database
        .prepare('DELETE FROM chunk_fts_trigram WHERE generation_id = ?')
        .run(generation.generation_id)
      this.#database
        .prepare('DELETE FROM index_generations WHERE generation_id = ?')
        .run(generation.generation_id)
      removedIndexGenerations += 1
    }
    const orphanUnicode = this.#database
      .prepare(
        'DELETE FROM chunk_fts_unicode61 WHERE generation_id NOT IN (SELECT generation_id FROM index_generations)'
      )
      .run().changes
    const orphanTrigram = this.#database
      .prepare(
        'DELETE FROM chunk_fts_trigram WHERE generation_id NOT IN (SELECT generation_id FROM index_generations)'
      )
      .run().changes
    const liveVectorTables = new Set(
      (
        this.#database
          .prepare('SELECT embedding_generation_id FROM embedding_generations')
          .all() as Array<{ embedding_generation_id: string }>
      ).map((row) => vectorTableName(row.embedding_generation_id))
    )
    const vectorTables = this.#database
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type = 'table' AND name LIKE 'vec_%'
            AND lower(sql) LIKE 'create virtual table%'`
      )
      .all() as Array<{ name: string }>
    let removedOrphanVectorTables = 0
    for (const table of vectorTables) {
      if (liveVectorTables.has(table.name)) continue
      this.#database.exec(`DROP TABLE "${table.name.replaceAll('"', '""')}"`)
      removedOrphanVectorTables += 1
    }
    const cacheCount = this.#database
      .prepare('SELECT count(*) FROM embedding_vector_cache')
      .pluck()
      .get() as number
    const removedCacheRows = Math.max(0, cacheCount - EMBEDDING_CACHE_LIMIT)
    if (removedCacheRows > 0) {
      this.#database
        .prepare(
          'DELETE FROM embedding_vector_cache WHERE rowid IN (SELECT rowid FROM embedding_vector_cache ORDER BY rowid LIMIT ?)'
        )
        .run(removedCacheRows)
    }
    return {
      indexGenerations: removedIndexGenerations,
      embeddingGenerations: removedEmbeddingGenerations,
      orphanFtsRows: orphanUnicode + orphanTrigram,
      orphanVectorTables: removedOrphanVectorTables,
      embeddingCacheRows: removedCacheRows
    }
  }

  #migrate(): void {
    const userVersion = this.#database.pragma('user_version', { simple: true }) as number
    if (userVersion > INDEX_SCHEMA_VERSION) throw new Error('Index schema is newer than this app')
    if (userVersion === 0) {
      this.#database.transaction(() => {
        this.#database.exec(`
          CREATE TABLE index_manifests (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            schema_version INTEGER NOT NULL,
            application_id INTEGER NOT NULL,
            created_at TEXT NOT NULL
          ) STRICT;
          CREATE TABLE index_generations (
            generation_id TEXT PRIMARY KEY NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('building', 'built', 'active', 'obsolete')),
            chunker_version INTEGER NOT NULL,
            source_set_sha256 TEXT NOT NULL CHECK (length(source_set_sha256) = 64),
            chunk_set_sha256 TEXT CHECK (chunk_set_sha256 IS NULL OR length(chunk_set_sha256) = 64),
            chunk_count INTEGER CHECK (chunk_count IS NULL OR chunk_count >= 0),
            source_count INTEGER NOT NULL CHECK (source_count >= 0),
            created_at TEXT NOT NULL,
            built_at TEXT,
            activated_at TEXT
          ) STRICT;
          CREATE UNIQUE INDEX index_generations_one_active
            ON index_generations(state) WHERE state = 'active';
          CREATE TABLE chunks (
            generation_id TEXT NOT NULL,
            chunk_id TEXT NOT NULL,
            knowledge_item_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            parse_revision_id TEXT NOT NULL,
            normalization_run_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
            text TEXT NOT NULL,
            content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
            heading_path_json TEXT NOT NULL,
            source_block_start INTEGER NOT NULL,
            source_block_end INTEGER NOT NULL,
            PRIMARY KEY (generation_id, chunk_id),
            FOREIGN KEY (generation_id) REFERENCES index_generations(generation_id) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX chunks_generation_item_ordinal
            ON chunks(generation_id, knowledge_item_id, ordinal);
          CREATE TABLE chunk_sources (
            generation_id TEXT NOT NULL,
            chunk_id TEXT NOT NULL,
            source_ordinal INTEGER NOT NULL,
            block_id TEXT NOT NULL,
            block_ordinal INTEGER NOT NULL,
            block_type TEXT NOT NULL,
            page INTEGER,
            bbox_json TEXT NOT NULL,
            asset_refs_json TEXT NOT NULL,
            provider_block_id TEXT,
            segment_start INTEGER NOT NULL,
            segment_end INTEGER NOT NULL,
            PRIMARY KEY (generation_id, chunk_id, source_ordinal),
            FOREIGN KEY (generation_id, chunk_id) REFERENCES chunks(generation_id, chunk_id) ON DELETE CASCADE
          ) STRICT;
        `)
        this.#database
          .prepare(
            'INSERT INTO index_manifests (singleton, schema_version, application_id, created_at) VALUES (1, ?, ?, ?)'
          )
          .run(INDEX_SCHEMA_VERSION, INDEX_DATABASE_APPLICATION_ID, new Date().toISOString())
        this.#database.pragma('user_version = 1')
      })()
    }
    if (userVersion <= 1) {
      this.#database.transaction(() => {
        this.#database.exec(`
          CREATE VIRTUAL TABLE chunk_fts_unicode61 USING fts5(
            generation_id UNINDEXED, chunk_id UNINDEXED, text,
            tokenize = 'unicode61 remove_diacritics 2'
          );
          CREATE VIRTUAL TABLE chunk_fts_trigram USING fts5(
            generation_id UNINDEXED, chunk_id UNINDEXED, text,
            tokenize = 'trigram case_sensitive 0'
          );
          INSERT INTO chunk_fts_unicode61 (generation_id, chunk_id, text)
            SELECT generation_id, chunk_id, text FROM chunks;
          INSERT INTO chunk_fts_trigram (generation_id, chunk_id, text)
            SELECT generation_id, chunk_id, text FROM chunks;
          CREATE TABLE embedding_generations (
            embedding_generation_id TEXT PRIMARY KEY NOT NULL,
            index_generation_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('building', 'built', 'active', 'obsolete')),
            provider_id TEXT NOT NULL,
            model_id TEXT NOT NULL,
            model_revision TEXT NOT NULL,
            dimension INTEGER NOT NULL CHECK (dimension > 0),
            metric TEXT NOT NULL CHECK (metric IN ('cosine', 'l2')),
            normalization TEXT NOT NULL CHECK (normalization IN ('none', 'l2')),
            chunker_version INTEGER NOT NULL,
            contract_sha256 TEXT NOT NULL CHECK (length(contract_sha256) = 64),
            content_fingerprint TEXT NOT NULL CHECK (length(content_fingerprint) = 64),
            vector_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            built_at TEXT,
            activated_at TEXT,
            FOREIGN KEY (index_generation_id) REFERENCES index_generations(generation_id) ON DELETE CASCADE
          ) STRICT;
          CREATE UNIQUE INDEX embedding_generations_one_active
            ON embedding_generations(state) WHERE state = 'active';
          CREATE TABLE chunk_vectors (
            embedding_generation_id TEXT NOT NULL,
            chunk_id TEXT NOT NULL,
            vector_rowid INTEGER NOT NULL,
            content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
            PRIMARY KEY (embedding_generation_id, chunk_id),
            UNIQUE (embedding_generation_id, vector_rowid),
            FOREIGN KEY (embedding_generation_id)
              REFERENCES embedding_generations(embedding_generation_id) ON DELETE CASCADE
          ) STRICT;
          CREATE TABLE embedding_vector_cache (
            contract_sha256 TEXT NOT NULL,
            content_sha256 TEXT NOT NULL,
            dimension INTEGER NOT NULL,
            vector_blob BLOB NOT NULL,
            PRIMARY KEY (contract_sha256, content_sha256)
          ) STRICT;
        `)
        this.#database
          .prepare('UPDATE index_manifests SET schema_version = ? WHERE singleton = 1')
          .run(INDEX_SCHEMA_VERSION)
        this.#database.pragma(`user_version = ${INDEX_SCHEMA_VERSION}`)
      })()
    }
    if (userVersion <= 2) {
      this.#database.transaction(() => {
        this.#database.exec('ALTER TABLE chunks ADD COLUMN extension TEXT;')
        this.#database
          .prepare('UPDATE index_manifests SET schema_version = ? WHERE singleton = 1')
          .run(INDEX_SCHEMA_VERSION)
        this.#database.pragma(`user_version = ${INDEX_SCHEMA_VERSION}`)
      })()
    }
    if (userVersion <= 3) {
      this.#database.transaction(() => {
        this.#database.exec(`
          CREATE TABLE IF NOT EXISTS index_sources (
            generation_id TEXT NOT NULL,
            knowledge_item_id TEXT NOT NULL,
            extension TEXT,
            parse_revision_id TEXT NOT NULL,
            normalization_run_id TEXT NOT NULL,
            manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64),
            PRIMARY KEY (generation_id, knowledge_item_id),
            FOREIGN KEY (generation_id) REFERENCES index_generations(generation_id) ON DELETE CASCADE
          ) STRICT;
          CREATE INDEX IF NOT EXISTS index_sources_generation_idx
            ON index_sources(generation_id, knowledge_item_id);
        `)
        this.#database
          .prepare('UPDATE index_manifests SET schema_version = ? WHERE singleton = 1')
          .run(INDEX_SCHEMA_VERSION)
        this.#database.pragma(`user_version = ${INDEX_SCHEMA_VERSION}`)
      })()
    }
    if (userVersion <= 4) {
      this.#database.transaction(() => {
        this.#database.exec(`
          CREATE TABLE IF NOT EXISTS index_runtime_state (
            singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
            clean_shutdown INTEGER NOT NULL CHECK (clean_shutdown IN (0, 1)),
            updated_at TEXT NOT NULL
          ) STRICT;
        `)
        this.#database
          .prepare(
            `INSERT OR IGNORE INTO index_runtime_state (singleton, clean_shutdown, updated_at)
             VALUES (1, 0, ?)`
          )
          .run(new Date().toISOString())
        this.#database
          .prepare('UPDATE index_manifests SET schema_version = ? WHERE singleton = 1')
          .run(INDEX_SCHEMA_VERSION)
        this.#database.pragma(`user_version = ${INDEX_SCHEMA_VERSION}`)
      })()
    }
    const manifest = this.#database
      .prepare('SELECT schema_version, application_id FROM index_manifests WHERE singleton = 1')
      .get() as { schema_version: number; application_id: number } | undefined
    if (
      manifest?.schema_version !== INDEX_SCHEMA_VERSION ||
      manifest.application_id !== INDEX_DATABASE_APPLICATION_ID
    ) {
      throw new Error('Index manifest is incompatible')
    }
  }
}

function decodeVector(bytes: Buffer): number[] {
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Cached embedding vector is corrupt')
  }
  const values: number[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
    values.push(bytes.readFloatLE(offset))
  }
  return values
}

function readSourceLocation(source: SourceLocationRow) {
  return {
    blockId: source.block_id,
    blockType: source.block_type,
    page: source.page,
    bbox: parseNullableBbox(source.bbox_json),
    providerBlockId: source.provider_block_id,
    segmentStart: source.segment_start,
    segmentEnd: source.segment_end
  }
}

function parseNullableBbox(value: string): [number, number, number, number] | null {
  const parsed: unknown = JSON.parse(value)
  if (
    parsed === null ||
    (Array.isArray(parsed) &&
      parsed.length === 4 &&
      parsed.every((item) => typeof item === 'number' && Number.isFinite(item)))
  ) {
    return parsed as [number, number, number, number] | null
  }
  throw new Error('Index provenance bbox is corrupt')
}

function parseStringArray(value: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error('Index provenance array is corrupt')
  }
  return parsed
}

function citationIdForChunk(chunkId: string): string {
  const match = /^chunk-([a-f0-9]{40})$/.exec(chunkId)
  if (match?.[1] === undefined) throw new Error('Chunk ID cannot form a citation ID')
  return `citation-${match[1]}`
}

function hashChunkSet(
  chunks: Array<{
    knowledgeItemId: string
    ordinal: number
    chunkId: string
    contentSha256: string
    sources: string[]
  }>
): string {
  chunks.sort(
    (a, b) =>
      a.knowledgeItemId.localeCompare(b.knowledgeItemId) ||
      a.ordinal - b.ordinal ||
      a.chunkId.localeCompare(b.chunkId)
  )
  // Keep the JSON array encoding used by existing index generations.
  const hash = createHash('sha256').update('[')
  let separator = ''
  for (const { chunkId, contentSha256, sources } of chunks) {
    hash.update(separator).update(JSON.stringify({ chunkId, contentSha256, sources }))
    separator = ','
  }
  return hash.update(']').digest('hex')
}

function emptyFilters(): KnowledgeSearchFilters {
  return { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] }
}
