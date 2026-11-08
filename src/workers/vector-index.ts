import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { VectorGenerationContract } from '../shared/contracts/indexing'
import type { KnowledgeSearchFilters } from '../shared/contracts/search'
import { compileKnowledgeSearchFilters } from './shared/knowledge-search-filter-sql'

export interface VectorIndex {
  begin(contract: VectorGenerationContract): boolean
  upsert(
    embeddingGenerationId: string,
    values: Array<{ chunkId: string; contentSha256: string; vector: number[] }>
  ): void
  activate(embeddingGenerationId: string, expectedContractSha256: string): void
  query(
    embeddingGenerationId: string,
    vector: number[],
    limit: number,
    filters: KnowledgeSearchFilters
  ): Array<{ chunkId: string; distance: number }>
  preview(
    embeddingGenerationId: string,
    chunkIds: string[],
    dimensions: number
  ): Array<{
    chunkId: string
    norm: number
    preview: number[]
  }>
  delete(embeddingGenerationId: string): void
}

interface GenerationRow {
  state: string
  dimension: number
  metric: 'cosine' | 'l2'
  normalization: 'none' | 'l2'
  contract_sha256: string
  index_generation_id: string
}

export class SqliteVecVectorIndex implements VectorIndex {
  constructor(private readonly database: Database.Database) {}

  begin(contract: VectorGenerationContract): boolean {
    validateDimension(contract.dimension)
    const indexGeneration = this.database
      .prepare(
        'SELECT state, chunker_version, source_set_sha256 FROM index_generations WHERE generation_id = ?'
      )
      .get(contract.indexGenerationId) as
      | { state: string; chunker_version: number; source_set_sha256: string }
      | undefined
    if (indexGeneration?.state !== 'active') {
      throw new Error('Embedding source index generation is not active')
    }
    if (
      indexGeneration.chunker_version !== contract.chunkerVersion ||
      indexGeneration.source_set_sha256 !== contract.contentFingerprint
    ) {
      throw new Error('Embedding source contract is incompatible')
    }
    const existing = this.database
      .prepare(
        `SELECT state, index_generation_id, contract_sha256, content_fingerprint
           FROM embedding_generations WHERE embedding_generation_id = ?`
      )
      .get(contract.embeddingGenerationId) as
      | {
          state: string
          index_generation_id: string
          contract_sha256: string
          content_fingerprint: string
        }
      | undefined
    if (existing !== undefined) {
      if (
        existing.index_generation_id !== contract.indexGenerationId ||
        existing.contract_sha256 !== contract.contractSha256 ||
        existing.content_fingerprint !== contract.contentFingerprint ||
        (existing.state !== 'active' && existing.state !== 'building')
      ) {
        throw new Error('Embedding generation ID contract collision')
      }
      return existing.state === 'active'
    }
    const table = vectorTableName(contract.embeddingGenerationId)
    const metric = contract.metric === 'cosine' ? 'cosine' : 'L2'
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT INTO embedding_generations (
             embedding_generation_id, index_generation_id, state, provider_id, model_id,
             model_revision, dimension, metric, normalization, chunker_version,
             contract_sha256, content_fingerprint, created_at
           ) VALUES (?, ?, 'building', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          contract.embeddingGenerationId,
          contract.indexGenerationId,
          contract.providerId,
          contract.modelId,
          contract.modelRevision,
          contract.dimension,
          contract.metric,
          contract.normalization,
          contract.chunkerVersion,
          contract.contractSha256,
          contract.contentFingerprint,
          new Date().toISOString()
        )
      this.database.exec(
        `CREATE VIRTUAL TABLE "${table}" USING vec0(embedding float[${contract.dimension}] distance_metric=${metric})`
      )
    })()
    return false
  }

  upsert(
    embeddingGenerationId: string,
    values: Array<{ chunkId: string; contentSha256: string; vector: number[] }>
  ): void {
    const generation = this.#requireGeneration(embeddingGenerationId)
    if (generation.state !== 'building') throw new Error('Embedding generation is not writable')
    const table = vectorTableName(embeddingGenerationId)
    this.database.transaction(() => {
      const sourceChunk = this.database
        .prepare('SELECT content_sha256 FROM chunks WHERE generation_id = ? AND chunk_id = ?')
        .pluck()
      const readCached = this.database
        .prepare(
          `SELECT vector_blob FROM embedding_vector_cache
            WHERE contract_sha256 = ? AND content_sha256 = ? AND dimension = ?`
        )
        .pluck()
      const insertCache = this.database.prepare(
        `INSERT OR IGNORE INTO embedding_vector_cache
          (contract_sha256, content_sha256, dimension, vector_blob) VALUES (?, ?, ?, ?)`
      )
      // sqlite-vec rejects INSERT OR REPLACE when the row already exists.
      const deletePrevious = this.database.prepare(
        `DELETE FROM "${table}" WHERE rowid = (
           SELECT vector_rowid FROM chunk_vectors
            WHERE embedding_generation_id = ? AND chunk_id = ?
         )`
      )
      const insertVector = this.database.prepare(
        `INSERT INTO "${table}" (rowid, embedding) VALUES (?, ?)`
      )
      const insertMap = this.database.prepare(
        `INSERT INTO chunk_vectors
          (embedding_generation_id, chunk_id, vector_rowid, content_sha256) VALUES (?, ?, ?, ?)
         ON CONFLICT(embedding_generation_id, chunk_id) DO UPDATE SET
           vector_rowid = excluded.vector_rowid, content_sha256 = excluded.content_sha256`
      )
      for (const value of values) {
        if (
          sourceChunk.get(generation.index_generation_id, value.chunkId) !== value.contentSha256
        ) {
          throw new Error('Embedding input does not match its source chunk')
        }
        const vector = normalizeAndValidate(
          value.vector,
          generation.dimension,
          generation.normalization
        )
        const cached = readCached.get(
          generation.contract_sha256,
          value.contentSha256,
          generation.dimension
        ) as Buffer | undefined
        const blob = cached ?? vectorBlob(vector)
        const rowid = stableRowid(value.chunkId)
        deletePrevious.run(embeddingGenerationId, value.chunkId)
        insertVector.run(rowid, blob)
        insertMap.run(embeddingGenerationId, value.chunkId, rowid, value.contentSha256)
        insertCache.run(generation.contract_sha256, value.contentSha256, generation.dimension, blob)
      }
    })()
  }

  activate(embeddingGenerationId: string, expectedContractSha256: string): void {
    this.database.transaction(() => {
      const generation = this.#requireGeneration(embeddingGenerationId)
      if (generation.contract_sha256 !== expectedContractSha256)
        throw new Error('Embedding contract is incompatible')
      this.#assertSourceIndexIsActive(generation.index_generation_id)
      if (generation.state === 'active') return
      if (generation.state !== 'building' && generation.state !== 'built') {
        throw new Error('Embedding generation is not ready for activation')
      }

      const expected = this.database
        .prepare('SELECT count(*) FROM chunks WHERE generation_id = ?')
        .pluck()
        .get(generation.index_generation_id) as number
      const { actual, matched } = this.database
        .prepare(
          `SELECT count(*) AS actual, count(chunks.chunk_id) AS matched
             FROM chunk_vectors
             LEFT JOIN chunks
               ON chunks.generation_id = ?
              AND chunks.chunk_id = chunk_vectors.chunk_id
              AND chunks.content_sha256 = chunk_vectors.content_sha256
            WHERE chunk_vectors.embedding_generation_id = ?`
        )
        .get(generation.index_generation_id, embeddingGenerationId) as {
        actual: number
        matched: number
      }
      if (actual !== matched) {
        throw new Error('Embedding generation contains vectors for invalid source chunks')
      }
      if (matched !== expected) throw new Error('Embedding generation is incomplete')

      const now = new Date().toISOString()
      this.database
        .prepare("UPDATE embedding_generations SET state = 'obsolete' WHERE state = 'active'")
        .run()
      this.database
        .prepare(
          "UPDATE embedding_generations SET state = 'active', vector_count = ?, built_at = COALESCE(built_at, ?), activated_at = ? WHERE embedding_generation_id = ?"
        )
        .run(matched, now, now, embeddingGenerationId)
    })()
  }

  query(
    embeddingGenerationId: string,
    vector: number[],
    limit: number,
    filters: KnowledgeSearchFilters
  ) {
    const generation = this.#requireReadableGeneration(embeddingGenerationId)
    if (limit < 1 || limit > 1_000) throw new Error('Vector query limit is invalid')
    const normalized = normalizeAndValidate(vector, generation.dimension, generation.normalization)
    const table = vectorTableName(embeddingGenerationId)
    const queryBlob = vectorBlob(normalized)
    const filter = compileKnowledgeSearchFilters(filters)
    if (filter.clause !== '') {
      const distanceFunction =
        generation.metric === 'cosine' ? 'vec_distance_cosine' : 'vec_distance_L2'
      return this.database
        .prepare(
          `SELECT chunk_vectors.chunk_id AS chunkId,
                  ${distanceFunction}("${table}".embedding, ?) AS distance
             FROM chunk_vectors
             JOIN "${table}" ON "${table}".rowid = chunk_vectors.vector_rowid
             JOIN chunks ON chunks.generation_id = ?
                        AND chunks.chunk_id = chunk_vectors.chunk_id
            WHERE chunk_vectors.embedding_generation_id = ?
              ${filter.clause}
            ORDER BY distance, chunk_vectors.chunk_id
            LIMIT ?`
        )
        .all(
          queryBlob,
          generation.index_generation_id,
          embeddingGenerationId,
          ...filter.parameters,
          limit
        ) as Array<{
        chunkId: string
        distance: number
      }>
    }
    return this.database
      .prepare(
        `SELECT chunk_vectors.chunk_id AS chunkId, matches.distance
           FROM (SELECT rowid, distance FROM "${table}" WHERE embedding MATCH ? AND k = ?) AS matches
           JOIN chunk_vectors ON chunk_vectors.vector_rowid = matches.rowid
           JOIN chunks ON chunks.generation_id = ? AND chunks.chunk_id = chunk_vectors.chunk_id
          WHERE chunk_vectors.embedding_generation_id = ?
          ORDER BY matches.distance, chunk_vectors.chunk_id
          LIMIT ?`
      )
      .all(
        queryBlob,
        limit,
        generation.index_generation_id,
        embeddingGenerationId,
        limit
      ) as Array<{
      chunkId: string
      distance: number
    }>
  }

  preview(
    embeddingGenerationId: string,
    chunkIds: string[],
    dimensions: number
  ): Array<{ chunkId: string; norm: number; preview: number[] }> {
    const generation = this.#requireReadableGeneration(embeddingGenerationId)
    if (dimensions < 1 || dimensions > 16) throw new Error('Vector preview dimension is invalid')
    if (chunkIds.length > 5_000) throw new Error('Vector preview chunk count is invalid')
    if (chunkIds.length === 0) return []
    const placeholders = chunkIds.map(() => '?').join(', ')
    const table = vectorTableName(embeddingGenerationId)
    const rows = this.database
      .prepare(
        `SELECT chunk_vectors.chunk_id AS chunkId, "${table}".embedding AS embedding
           FROM chunk_vectors
           JOIN "${table}" ON "${table}".rowid = chunk_vectors.vector_rowid
          WHERE chunk_vectors.embedding_generation_id = ?
            AND chunk_vectors.chunk_id IN (${placeholders})`
      )
      .all(embeddingGenerationId, ...chunkIds) as Array<{
      chunkId: string
      embedding: Buffer | Uint8Array
    }>
    return rows.flatMap((row) => {
      const value = row.embedding
      if (value === undefined) return []
      const vector = decodeVector(Buffer.from(value))
      if (vector.length !== generation.dimension)
        throw new Error('Stored vector dimension mismatch')
      let norm = 0
      for (const component of vector) norm += component * component
      return [{ chunkId: row.chunkId, norm: Math.sqrt(norm), preview: vector.slice(0, dimensions) }]
    })
  }

  delete(embeddingGenerationId: string): void {
    const table = vectorTableName(embeddingGenerationId)
    this.database.transaction(() => {
      this.database.exec(`DROP TABLE IF EXISTS "${table}"`)
      this.database
        .prepare('DELETE FROM embedding_generations WHERE embedding_generation_id = ?')
        .run(embeddingGenerationId)
    })()
  }

  #requireReadableGeneration(id: string): GenerationRow {
    const generation = this.#requireGeneration(id)
    if (generation.state !== 'active') throw new Error('Embedding generation is not active')
    this.#assertSourceIndexIsActive(generation.index_generation_id)
    return generation
  }

  #assertSourceIndexIsActive(indexGenerationId: string): void {
    const active = this.database
      .prepare("SELECT 1 FROM index_generations WHERE generation_id = ? AND state = 'active'")
      .pluck()
      .get(indexGenerationId)
    if (active !== 1) throw new Error('Embedding source index generation is no longer active')
  }

  #requireGeneration(id: string): GenerationRow {
    const row = this.database
      .prepare(
        'SELECT state, dimension, metric, normalization, contract_sha256, index_generation_id FROM embedding_generations WHERE embedding_generation_id = ?'
      )
      .get(id) as GenerationRow | undefined
    if (row === undefined) throw new Error('Embedding generation is missing')
    return row
  }
}

function decodeVector(bytes: Buffer): number[] {
  if (bytes.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) {
    throw new Error('Stored embedding vector is corrupt')
  }
  const values: number[] = []
  for (let offset = 0; offset < bytes.byteLength; offset += Float32Array.BYTES_PER_ELEMENT) {
    values.push(bytes.readFloatLE(offset))
  }
  return values
}

export function vectorTableName(id: string): string {
  return `vec_${createHash('sha256').update(id).digest('hex').slice(0, 24)}`
}

function stableRowid(chunkId: string): bigint {
  const value = createHash('sha256').update(chunkId).digest().readBigUInt64BE(0)
  return value & 0x7fffffffffffffffn
}

function validateDimension(dimension: number): void {
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > 65_536)
    throw new Error('Vector dimension is invalid')
}

function normalizeAndValidate(
  values: number[],
  dimension: number,
  normalization: 'none' | 'l2'
): number[] {
  if (values.length !== dimension || values.some((value) => !Number.isFinite(value)))
    throw new Error('Vector dimension or values are invalid')
  if (normalization === 'none') return values
  const magnitude = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
  if (magnitude === 0) throw new Error('Zero vector cannot be normalized')
  return values.map((value) => value / magnitude)
}

function vectorBlob(values: number[]): Buffer {
  return Buffer.from(new Float32Array(values).buffer)
}
