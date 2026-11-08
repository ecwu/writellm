import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import {
  normalizedKnowledgeBlockSchema,
  normalizedKnowledgeManifestSchema,
  type NormalizedKnowledgeBlock
} from '../shared/contracts/knowledge'
import {
  INDEX_CHUNKER_VERSION,
  INDEX_SCHEMA_VERSION,
  indexCandidateSchema,
  type IndexSource
} from '../shared/contracts/indexing'
import type { KnowledgeSearchFilters } from '../shared/contracts/search'
import { buildDeterministicChunks } from './index-chunker'
import { generationIdFor, hashSourceSet } from '../shared/index-generation'
import { IndexDatabase } from './index-database'
import { vectorTableName } from './vector-index'
import { getLoadablePath } from 'sqlite-vec'

const roots: string[] = []
const knowledgeItemId = '11111111-1111-4111-8111-111111111111'
const parseRevisionId = '22222222-2222-4222-8222-222222222222'
const normalizationRunId = '33333333-3333-4333-8333-333333333333'

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('IndexDatabase and deterministic chunking', () => {
  it('uses the clean-shutdown fast path and falls back to a full check after an unclean close', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-index-startup-'))
    roots.push(root)
    const databasePath = join(root, 'index.sqlite')
    const created = new IndexDatabase(databasePath)
    expect(created.startupReport.integrityMode).toBe('new')
    created.close()

    const cleanReopen = new IndexDatabase(databasePath)
    expect(cleanReopen.startupReport.integrityMode).toBe('clean-shutdown-fast-path')
    cleanReopen.close()

    const raw = new Database(databasePath)
    raw
      .prepare(
        'UPDATE index_runtime_state SET clean_shutdown = 0, updated_at = ? WHERE singleton = 1'
      )
      .run(new Date().toISOString())
    raw.close()

    const uncleanReopen = new IndexDatabase(databasePath)
    expect(uncleanReopen.startupReport.integrityMode).toBe('full')
    uncleanReopen.close()
  })

  it('initializes a header-only index created by an older project lifecycle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-legacy-index-'))
    roots.push(root)
    const path = join(root, 'index.sqlite')
    const placeholder = new Database(path)
    try {
      placeholder.pragma('journal_mode = WAL')
      placeholder.pragma('application_id = 0x574c4958')
    } finally {
      placeholder.close()
    }

    const database = new IndexDatabase(path)
    try {
      expect(database.inspect()).toMatchObject({
        schemaVersion: INDEX_SCHEMA_VERSION,
        activeGenerationId: null,
        generationCount: 0
      })
    } finally {
      database.close()
    }
  })

  it('verifies an active mixed-case source generation on clean reopen', async () => {
    const upper = await createSource(false, {
      knowledgeItemId: 'B0000000-0000-4000-8000-000000000002',
      parseRevisionId: randomUUID()
    })
    const lower = await createSource(false, {
      knowledgeItemId: 'a0000000-0000-4000-8000-000000000001',
      parseRevisionId: randomUUID()
    })
    const sources = [upper.source, lower.source]
    const generationId = generationIdFor(
      hashSourceSet(sources, INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    const path = join(upper.root, 'index.sqlite')
    const initial = new IndexDatabase(path)
    try {
      await initial.build({ generationId, chunkerVersion: INDEX_CHUNKER_VERSION, sources })
      initial.activate(generationId)
    } finally {
      initial.close()
    }

    const reopened = new IndexDatabase(path)
    try {
      expect(reopened.startupReport.integrityMode).toBe('clean-shutdown-fast-path')
      expect(reopened.inspect()).toMatchObject({ activeGenerationId: generationId, sourceCount: 2 })
    } finally {
      reopened.close()
    }
  })

  it('rebuilds a legacy generation while preserving its citation IDs', async () => {
    const { root, source } = await createSource()
    const path = join(root, 'index.sqlite')
    const request = {
      generationId: generationIdFor(
        hashSourceSet([source], INDEX_CHUNKER_VERSION),
        INDEX_CHUNKER_VERSION
      ),
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources: [source]
    }
    const first = new IndexDatabase(path)
    let citationId: string
    try {
      await first.build(request)
      first.activate(request.generationId)
      const [hit] =
        first.searchCandidates({
          indexGenerationId: request.generationId,
          query: 'Cell',
          mode: 'phrase',
          limit: 1,
          filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] }
        }) ?? []
      if (hit === undefined) throw new Error('Expected a citation before rebuilding')
      citationId = hit.citationId
    } finally {
      first.close()
    }
    const raw = new Database(path)
    try {
      raw.pragma('foreign_keys = OFF')
      for (const table of [
        'index_generations',
        'index_sources',
        'chunks',
        'chunk_sources',
        'chunk_fts_unicode61',
        'chunk_fts_trigram'
      ]) {
        raw
          .prepare(
            `UPDATE ${table} SET generation_id = replace(generation_id, 'generation-v2-', 'generation-')`
          )
          .run()
      }
    } finally {
      raw.close()
    }

    const reopened = new IndexDatabase(path)
    try {
      expect(reopened.inspect()).toMatchObject({ activeGenerationId: null, generationCount: 1 })
      expect(reopened.expandCitations([citationId])).toEqual([])
      await reopened.build(request)
      reopened.activate(request.generationId)
      expect(reopened.inspect()).toMatchObject({
        activeGenerationId: request.generationId,
        generationCount: 2
      })
      expect(reopened.expandCitations([citationId])).toMatchObject([{ citationId, page: 1 }])
    } finally {
      reopened.close()
    }
  })

  it('releases the SQLite handle when startup rejects a corrupt index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-index-corrupt-'))
    roots.push(root)
    const databasePath = join(root, 'index.sqlite')
    await writeFile(databasePath, 'corrupt derived index')

    expect(() => new IndexDatabase(databasePath)).toThrow()
    await expect(rm(databasePath)).resolves.toBeUndefined()
  })

  it('rejects reordered source IDs on clean reopen', async () => {
    const { root, source, blocks } = await createSource()
    const [first, second] = blocks
    if (first === undefined || second === undefined) throw new Error('Expected two source blocks')
    const databasePath = join(root, 'index.sqlite')
    const generationId = generationIdFor(
      hashSourceSet([source], INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    const database = new IndexDatabase(databasePath)
    try {
      await database.build({
        generationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [source]
      })
      database.activate(generationId)
    } finally {
      database.close()
    }

    const raw = new Database(databasePath)
    try {
      const changed = raw
        .prepare(
          `UPDATE chunk_sources SET block_id = CASE block_ordinal WHEN 0 THEN ? ELSE ? END
            WHERE generation_id = ? AND block_ordinal IN (0, 1)`
        )
        .run(second.id, first.id, generationId)
      expect(changed.changes).toBe(2)
    } finally {
      raw.close()
    }

    expect(() => new IndexDatabase(databasePath)).toThrow(
      'Index chunk fingerprint verification failed'
    )
  })

  it('retains the active and three recent generations and removes orphan search storage', async () => {
    const fixtures = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createSource(false, {
          knowledgeItemId,
          parseRevisionId: randomUUID(),
          normalizationRunId: randomUUID(),
          heading: `Generation ${index}`
        })
      )
    )
    const databasePath = join(fixtures[0]?.root as string, 'index.sqlite')
    const database = new IndexDatabase(databasePath, getLoadablePath())
    let activeGenerationId = ''
    const embeddingGenerationIds: string[] = []
    const contractSha256 = 'e'.repeat(64)
    for (const fixture of fixtures) {
      activeGenerationId = generationIdFor(
        hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION),
        INDEX_CHUNKER_VERSION
      )
      await database.build({
        generationId: activeGenerationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [fixture.source]
      })
      database.activate(activeGenerationId)
      const embeddingGenerationId = `embedding-${activeGenerationId}`
      embeddingGenerationIds.push(embeddingGenerationId)
      database.beginEmbedding({
        embeddingGenerationId,
        indexGenerationId: activeGenerationId,
        providerId: 'openai-compatible',
        modelId: 'embedding-model',
        modelRevision: 'revision-1',
        dimension: 3,
        metric: 'cosine',
        normalization: 'l2',
        chunkerVersion: INDEX_CHUNKER_VERSION,
        contractSha256,
        contentFingerprint: hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION)
      })
      database.upsertVectors(
        embeddingGenerationId,
        database.embeddingInputs(activeGenerationId).values.map((input) => ({
          chunkId: input.chunkId,
          contentSha256: input.contentSha256,
          vector: [1, 0, 0]
        }))
      )
      database.activateEmbedding(embeddingGenerationId, contractSha256)
    }
    expect(database.inspect()).toMatchObject({
      activeGenerationId,
      generationCount: 4
    })
    database.close()

    const raw = new Database(databasePath)
    raw.loadExtension(getLoadablePath())
    raw
      .prepare('INSERT INTO chunk_fts_unicode61 (generation_id, chunk_id, text) VALUES (?, ?, ?)')
      .run('orphan-generation', 'orphan-chunk', 'orphan')
    raw
      .prepare('INSERT INTO chunk_fts_trigram (generation_id, chunk_id, text) VALUES (?, ?, ?)')
      .run('orphan-generation', 'orphan-chunk', 'orphan')
    raw.exec(
      'CREATE VIRTUAL TABLE "vec_orphan_fixture" USING vec0(embedding float[3] distance_metric=cosine)'
    )
    raw.close()

    const cleaned = new IndexDatabase(databasePath, getLoadablePath())
    expect(cleaned.startupReport.cleanup).toMatchObject({
      orphanFtsRows: 2,
      orphanVectorTables: 1
    })
    expect(cleaned.inspect()).toMatchObject({
      activeGenerationId,
      generationCount: 4
    })
    expect(cleaned.retrievalState().activeEmbeddingContract).toMatchObject({
      embeddingGenerationId: embeddingGenerationIds.at(-1)
    })
    cleaned.close()

    const verified = new Database(databasePath)
    expect(
      verified
        .prepare(
          "SELECT count(*) FROM chunk_fts_unicode61 WHERE generation_id = 'orphan-generation'"
        )
        .pluck()
        .get()
    ).toBe(0)
    expect(
      verified
        .prepare("SELECT count(*) FROM sqlite_master WHERE name = 'vec_orphan_fixture'")
        .pluck()
        .get()
    ).toBe(0)
    expect(verified.prepare('SELECT count(*) FROM embedding_generations').pluck().get()).toBe(4)
    const [oldest] = embeddingGenerationIds
    if (oldest === undefined) throw new Error('Expected a vector generation')
    expect(
      verified.prepare('SELECT 1 FROM sqlite_master WHERE name = ?').get(vectorTableName(oldest))
    ).toBeUndefined()
    verified.close()
  })

  it('prunes obsolete vectors during repeated refreshes of one text generation', async () => {
    const fixture = await createSource()
    const path = join(fixture.root, 'index.sqlite')
    const database = new IndexDatabase(path, getLoadablePath())
    const contentFingerprint = hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION)
    const generationId = generationIdFor(contentFingerprint, INDEX_CHUNKER_VERSION)
    const contract = {
      indexGenerationId: generationId,
      providerId: 'openai-compatible',
      modelId: 'embedding-model',
      modelRevision: 'revision-1',
      dimension: 3,
      metric: 'cosine',
      normalization: 'l2',
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256: 'e'.repeat(64),
      contentFingerprint
    } as const
    const raw = new Database(path)
    try {
      await database.build({
        generationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [fixture.source]
      })
      database.activate(generationId)
      const values = database.embeddingInputs(generationId).values.map((input) => ({
        chunkId: input.chunkId,
        contentSha256: input.contentSha256,
        vector: [1, 0, 0]
      }))
      for (let index = 0; index < 5; index += 1) {
        const embeddingGenerationId = `embedding-refresh-${index}`
        database.beginEmbedding({ ...contract, embeddingGenerationId })
        database.upsertVectors(embeddingGenerationId, values)
        if (index === 4) {
          raw.exec(`
            CREATE TRIGGER reject_embedding_delete BEFORE DELETE ON embedding_generations
            BEGIN SELECT RAISE(ABORT, 'embedding cleanup rejected'); END;
          `)
          expect(() =>
            database.activateEmbedding(embeddingGenerationId, contract.contractSha256)
          ).toThrow('embedding cleanup rejected')
          expect(database.retrievalState().activeEmbeddingContract).toMatchObject({
            embeddingGenerationId: 'embedding-refresh-3'
          })
          raw.exec('DROP TRIGGER reject_embedding_delete')
        }
        database.activateEmbedding(embeddingGenerationId, contract.contractSha256)
      }

      expect(raw.prepare('SELECT count(*) FROM embedding_generations').pluck().get()).toBe(4)
      expect(database.retrievalState().activeEmbeddingContract).toMatchObject({
        embeddingGenerationId: 'embedding-refresh-4'
      })
      expect(
        raw
          .prepare('SELECT 1 FROM sqlite_master WHERE name = ?')
          .get(vectorTableName('embedding-refresh-0'))
      ).toBeUndefined()
    } finally {
      raw.close()
      database.close()
    }
  })

  it('creates stable golden chunks from normalized blocks with complete provenance', async () => {
    const fixture = await createSource()
    const first = await buildDeterministicChunks([fixture.source], INDEX_CHUNKER_VERSION)
    const second = await buildDeterministicChunks([fixture.source], INDEX_CHUNKER_VERSION)

    expect(second).toEqual(first)
    const legacyBytes = Buffer.from(
      fixture.blocks.map((block) => JSON.stringify(block)).join('\r\n')
    )
    const legacySource = await replaceSourceBlocks(fixture.source, legacyBytes)
    await expect(buildDeterministicChunks([legacySource], INDEX_CHUNKER_VERSION)).resolves.toEqual(
      first
    )
    expect(first.map((chunk) => chunk.text)).toEqual([
      '# Heading\n\nShort paragraph',
      '<table><tr><td>Cell</td></tr></table>',
      'x'.repeat(2_000),
      'x'.repeat(400)
    ])
    expect(first.map((chunk) => chunk.chunkId)).toMatchInlineSnapshot(`
      [
        "chunk-65cb71126114ebfe6b3a404b33e50b6a5ec71d68",
        "chunk-bf1fcb55adc40de2d82bb3141634f7720505ec55",
        "chunk-1517019cdf3133ac01f4efdbcd3827dbea16a753",
        "chunk-1304e2dc3250e06d60deab724a2036d18bda6398",
      ]
    `)
    expect(first[0]?.sources.map((source) => source.blockId)).toEqual([
      fixture.blocks[0]?.id,
      fixture.blocks[1]?.id
    ])
    expect(first[1]?.sources[0]).toMatchObject({
      blockType: 'table',
      page: 1,
      bboxJson: '[0,10,1000,500]'
    })
  })

  it('keeps source rows and page filters local to each segment of a large caption group', async () => {
    const provider = { sourceProviderBlockId: 'figure' }
    const figure = block(0, 'image', 'Figure heading', { ...provider, page: 0 })
    const captions = Array.from({ length: 1_350 }, (_, index) =>
      block(index + 1, 'caption', index === 1_349 ? 'tailmarker' : '🙂', {
        ...provider,
        page: index < 900 ? 0 : 1
      })
    )
    const { root, source } = await createSource(false, { blocks: [figure, ...captions] })
    const database = new IndexDatabase(join(root, 'index.sqlite'))
    try {
      const { generationId } = await database.build({
        generationId: generationIdFor(
          hashSourceSet([source], INDEX_CHUNKER_VERSION),
          INDEX_CHUNKER_VERSION
        ),
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [source]
      })
      database.activate(generationId)
      const search = (query: string) =>
        database.searchCandidates({
          indexGenerationId: generationId,
          query,
          mode: 'phrase',
          limit: 10,
          filters: {
            knowledgeItemIds: [],
            fileExtensions: [],
            parseRevisionIds: [],
            pageFrom: 1,
            pageTo: 1
          }
        })
      expect(search('Figure')).toEqual([])
      const [hit] = indexCandidateSchema.array().parse(search('tailmarker'))
      if (hit === undefined) throw new Error('Expected the last caption segment')
      expect(hit.page).toBe(1)
      expect(hit.sourceBlockIds).toContain(captions.at(-1)?.id)
      expect(hit.sourceBlockIds).not.toContain(figure.id)
      const legacyChunkId = `chunk-${hash(
        Buffer.from(
          [
            source.parseRevisionId,
            0,
            captions.length,
            INDEX_CHUNKER_VERSION,
            hash(Buffer.from(hit.text)),
            3_600,
            Array.from([figure, ...captions].map((entry) => entry.text).join('\n\n')).length
          ].join('\0')
        )
      ).slice(0, 40)}`
      expect(hit.chunkId).toBe(legacyChunkId)

      const [expanded] = indexCandidateSchema
        .array()
        .parse(database.expandCitations([hit.citationId]))
      expect(expanded?.sources.map((entry) => entry.blockId)).toEqual(hit.sourceBlockIds)
      const mapping = database.inspectKnowledgeMapping({
        knowledgeItemId: source.knowledgeItemId,
        parseRevisionId: source.parseRevisionId,
        pageIndex: 1
      })
      expect(mapping.state).toBe('ready')
      const mapped = mapping.chunks.find((chunk) => chunk.chunkId === hit.chunkId)
      expect(mapped?.sourceBlockStart).toBeGreaterThan(900)
      expect(mapped?.sourceBlockEnd).toBe(captions.length)
      expect(mapped?.sources.at(-1)).toMatchObject({
        blockId: captions.at(-1)?.id,
        segmentStart: 0
      })
    } finally {
      database.close()
    }
  })

  it('keeps all asset references by splitting groups at the shared response limit', async () => {
    const blocks = Array.from({ length: 100 }, (_, ordinal) =>
      block(ordinal, 'paragraph', 'assetmarker', {
        assetRefs: Array.from({ length: 20 }, (_, index) => `images/${ordinal}-${index}.png`)
      })
    )
    blocks.push(
      block(100, 'paragraph', 'assetmarker', { assetRefs: ['images/0-0.png'] }),
      block(101, 'paragraph', 'assetmarker', { assetRefs: ['images/extra.png'] })
    )
    const { root, source } = await createSource(false, { blocks })
    const database = new IndexDatabase(join(root, 'index.sqlite'))
    try {
      const { generationId } = await database.build({
        generationId: generationIdFor(
          hashSourceSet([source], INDEX_CHUNKER_VERSION),
          INDEX_CHUNKER_VERSION
        ),
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [source]
      })
      database.activate(generationId)
      const hits = indexCandidateSchema.array().parse(
        database.searchCandidates({
          indexGenerationId: generationId,
          query: 'assetmarker',
          mode: 'phrase',
          limit: 10,
          filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] }
        })
      )
      expect(hits).toHaveLength(2)
      expect(hits.find((hit) => hit.assetRefs.length === 2_000)?.sourceBlockIds).toEqual(
        blocks.slice(0, 101).map((entry) => entry.id)
      )
      expect(hits.find((hit) => hit.assetRefs.length === 1)?.assetRefs).toEqual([
        'images/extra.png'
      ])
      expect(new Set(hits.flatMap((hit) => hit.assetRefs))).toEqual(
        new Set(blocks.flatMap((entry) => entry.assetRefs))
      )
    } finally {
      database.close()
    }
  })

  it('loads bounding boxes only when expanding a ranked citation', async () => {
    const { root, source, blocks } = await createSource()
    const path = join(root, 'index.sqlite')
    const generationId = generationIdFor(
      hashSourceSet([source], INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    const database = new IndexDatabase(path)
    try {
      await database.build({
        generationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [source]
      })
      database.activate(generationId)
      const search = () =>
        database.searchCandidates({
          indexGenerationId: generationId,
          query: 'Cell',
          mode: 'phrase',
          limit: 1,
          filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] }
        })
      const [hit] = search() ?? []
      if (hit === undefined) throw new Error('Expected the table search hit')
      expect(hit).toMatchObject({ page: 1, sourceBlockIds: [blocks[2]?.id], sources: [] })
      expect(database.expandCitations([hit.citationId])).toMatchObject([
        { sources: [{ blockId: blocks[2]?.id, bbox: [0, 10, 1000, 500] }] }
      ])

      const raw = new Database(path)
      try {
        const updateBbox = raw.prepare(
          'UPDATE chunk_sources SET bbox_json = ? WHERE generation_id = ? AND chunk_id = ?'
        )
        updateBbox.run('invalid-json', generationId, hit.chunkId)
        expect(search()).toEqual([hit])
        expect(() => database.expandCitations([hit.citationId])).toThrow(SyntaxError)

        updateBbox.run('[0,10,1000]', generationId, hit.chunkId)
        expect(() => database.expandCitations([hit.citationId])).toThrow(
          'Index provenance bbox is corrupt'
        )
        expect(() =>
          database.inspectKnowledgeMapping({
            knowledgeItemId: source.knowledgeItemId,
            parseRevisionId: source.parseRevisionId,
            pageIndex: 1
          })
        ).toThrow('Index provenance bbox is corrupt')
      } finally {
        raw.close()
      }
    } finally {
      database.close()
    }
  })

  it.each([
    { line: 'blank', expectedError: 'Normalized block line is empty' },
    { line: 'oversized', expectedError: 'Normalized block line exceeds the size limit' }
  ])('rejects a $line normalized block line before chunking', async ({ line, expectedError }) => {
    const fixture = await createSource()
    const [first, ...rest] = fixture.blocks
    const firstLine =
      line === 'blank' ? '\n' : `${JSON.stringify({ ...first, text: 'é'.repeat(1_100_000) })}\n`
    const bytes = Buffer.from(firstLine + rest.map((block) => JSON.stringify(block)).join('\n'))
    const source = await replaceSourceBlocks(fixture.source, bytes)

    await expect(buildDeterministicChunks([source], INDEX_CHUNKER_VERSION)).rejects.toThrow(
      expectedError
    )
  })

  it('rejects a verified normalization manifest for a different Knowledge item', async () => {
    const { source } = await createSource()
    await expect(
      buildDeterministicChunks(
        [{ ...source, knowledgeItemId: source.parseRevisionId }],
        INDEX_CHUNKER_VERSION
      )
    ).rejects.toThrow('Normalized manifest provenance does not match')
  })

  it('builds idempotently, activates atomically, and rebuilds equivalently after deletion', async () => {
    const fixture = await createSource()
    const databasePath = join(fixture.root, 'index.sqlite')
    const generationId = generationIdFor(
      hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    const database = new IndexDatabase(databasePath)
    const built = await database.build({
      generationId,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources: [fixture.source]
    })
    expect(built.chunkSetSha256).toBe(
      'f2184a026b728532022459f40a51db76e2b989dd8c17d1fcb00b8b5c20aec215'
    )
    expect(database.inspect()).toMatchObject({ activeGenerationId: null, chunkCount: 0 })
    expect(
      await database.build({
        generationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [fixture.source]
      })
    ).toEqual(built)
    expect(database.activate(generationId)).toMatchObject({
      activeGenerationId: generationId,
      chunkCount: 4,
      sourceCount: 1
    })
    database.close()

    await rm(databasePath, { force: true })
    await rm(`${databasePath}-wal`, { force: true })
    await rm(`${databasePath}-shm`, { force: true })
    const rebuiltDatabase = new IndexDatabase(databasePath)
    const rebuilt = await rebuiltDatabase.build({
      generationId,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources: [fixture.source]
    })
    expect(rebuilt).toEqual(built)
    rebuiltDatabase.activate(generationId)
    expect(rebuiltDatabase.inspect()).toMatchObject({
      activeGenerationId: generationId,
      chunkCount: 4,
      activeSourceSetSha256: built.sourceSetSha256
    })
    rebuiltDatabase.close()
  })

  it('preserves the active index and embedding generation when the database reopens', async () => {
    const first = await createSource(false, { heading: 'First persisted source' })
    const second = await createSource(false, {
      knowledgeItemId: randomUUID(),
      parseRevisionId: randomUUID(),
      normalizationRunId: randomUUID(),
      heading: 'Second persisted source'
    })
    const databasePath = join(first.root, 'index.sqlite')
    const sources = [second.source, first.source]
    const generationId = generationIdFor(
      hashSourceSet(sources, INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    const contractSha256 = 'd'.repeat(64)
    const contract = {
      embeddingGenerationId: 'embedding-persisted-generation',
      indexGenerationId: generationId,
      providerId: 'openai-compatible',
      modelId: 'embedding-model',
      modelRevision: 'revision-1',
      dimension: 3,
      metric: 'cosine' as const,
      normalization: 'l2' as const,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256,
      contentFingerprint: hashSourceSet(sources, INDEX_CHUNKER_VERSION)
    }
    const database = new IndexDatabase(databasePath, getLoadablePath())
    await database.build({
      generationId,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources
    })
    database.activate(generationId)
    const inputs = database.embeddingInputs(generationId).values
    database.beginEmbedding(contract)
    database.upsertVectors(
      contract.embeddingGenerationId,
      inputs.map((input, index) => ({
        chunkId: input.chunkId,
        contentSha256: input.contentSha256,
        vector: [1, index + 1, 1]
      }))
    )
    database.activateEmbedding(contract.embeddingGenerationId, contractSha256)
    database.close()

    const reopened = new IndexDatabase(databasePath, getLoadablePath())
    expect(reopened.inspect()).toMatchObject({
      activeGenerationId: generationId,
      chunkCount: inputs.length,
      sourceCount: sources.length
    })
    expect(reopened.retrievalState()).toMatchObject({
      activeIndexGenerationId: generationId,
      activeEmbeddingContract: contract
    })
    expect(reopened.beginEmbedding(contract)).toEqual({ alreadyActive: true, clearedCount: null })
    expect(
      reopened
        .embeddingInputs(generationId, 0, 256, contractSha256, contract.dimension)
        .values.every((input) => input.cachedVector?.length === contract.dimension)
    ).toBe(true)
    expect(
      reopened.queryVectors(contract.embeddingGenerationId, [1, 1, 1], inputs.length)
    ).toHaveLength(inputs.length)
    reopened.close()
  })

  it('inspects active page provenance and previews only the active embedding vectors', async () => {
    const fixture = await createSource()
    const database = new IndexDatabase(join(fixture.root, 'index.sqlite'), getLoadablePath())
    const built = await database.build({
      generationId: generationIdFor(
        hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION),
        INDEX_CHUNKER_VERSION
      ),
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources: [fixture.source]
    })
    database.activate(built.generationId)
    const contractSha256 = 'f'.repeat(64)
    const embeddingGenerationId = 'mapping-embedding-generation'
    database.beginEmbedding({
      embeddingGenerationId,
      indexGenerationId: built.generationId,
      providerId: 'test-provider',
      modelId: 'test-embedding',
      modelRevision: 'test-revision',
      dimension: 4,
      metric: 'l2',
      normalization: 'none',
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256,
      contentFingerprint: built.sourceSetSha256
    })
    const inputs = database.embeddingInputs(built.generationId).values
    database.upsertVectors(
      embeddingGenerationId,
      inputs.map((input) => ({
        chunkId: input.chunkId,
        contentSha256: input.contentSha256,
        vector: [1, 2, 3, 4]
      }))
    )
    database.activateEmbedding(embeddingGenerationId, contractSha256)

    const page = database.inspectKnowledgeMapping({
      knowledgeItemId: fixture.source.knowledgeItemId,
      parseRevisionId: fixture.source.parseRevisionId,
      pageIndex: 0
    })
    expect(page.state).toBe('ready')
    expect(page.chunks).toHaveLength(1)
    expect(page.chunks[0]?.sources).toHaveLength(2)
    expect(page.chunks[0]?.embedding).toMatchObject({
      embeddingGenerationId,
      dimension: 4,
      preview: [1, 2, 3, 4],
      norm: Math.sqrt(30)
    })
    expect(
      database.inspectKnowledgeMapping({
        knowledgeItemId: fixture.source.knowledgeItemId,
        parseRevisionId: randomUUID(),
        pageIndex: 0
      }).state
    ).toBe('indexing')
    database.close()
  })

  it('accepts 5,000 Mapping rows and rejects either chunk or source overflow', async () => {
    const { root, source } = await createSource(false, { largeAtomicCount: 5_001 })
    const path = join(root, 'index.sqlite')
    const database = new IndexDatabase(path)
    try {
      const { generationId } = await database.build({
        generationId: generationIdFor(
          hashSourceSet([source], INDEX_CHUNKER_VERSION),
          INDEX_CHUNKER_VERSION
        ),
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [source]
      })
      database.activate(generationId)
      const inspect = () =>
        database.inspectKnowledgeMapping({
          knowledgeItemId: source.knowledgeItemId,
          parseRevisionId: source.parseRevisionId,
          pageIndex: 0
        })
      const raw = new Database(path)
      try {
        raw.exec('UPDATE chunk_sources SET page = 0 WHERE block_ordinal < 5000')
        const page = inspect()
        expect(page.state).toBe('ready')
        expect(page.chunks).toHaveLength(5_000)
        expect(page.chunks[4_999]?.ordinal).toBe(4_999)

        raw.exec('UPDATE chunk_sources SET page = 0 WHERE block_ordinal = 5000')
        expect(inspect()).toMatchObject({ state: 'too_complex', chunks: [] })

        raw.exec('UPDATE chunk_sources SET page = 5000 WHERE block_ordinal = 5000')
        raw.exec(`
          INSERT INTO chunk_sources (
            generation_id, chunk_id, source_ordinal, block_id, block_ordinal, block_type,
            page, bbox_json, asset_refs_json, provider_block_id, segment_start, segment_end
          )
          SELECT included.generation_id, included.chunk_id, included.source_ordinal + 1,
                 other.block_id, other.block_ordinal, other.block_type, other.page,
                 other.bbox_json, other.asset_refs_json, other.provider_block_id,
                 other.segment_start, other.segment_end
            FROM chunk_sources AS included
            JOIN chunk_sources AS other ON other.generation_id = included.generation_id
           WHERE included.block_ordinal = 0 AND other.block_ordinal = 5000
        `)
        expect(inspect()).toMatchObject({ state: 'too_complex', chunks: [] })
      } finally {
        raw.close()
      }
    } finally {
      database.close()
    }
  })

  it('selects legacy null-page chunks by recovered block ordinal', async () => {
    const fixture = await createSource(false, { omitProvenance: true })
    const database = new IndexDatabase(join(fixture.root, 'index.sqlite'), getLoadablePath())
    const built = await database.build({
      generationId: generationIdFor(
        hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION),
        INDEX_CHUNKER_VERSION
      ),
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources: [fixture.source]
    })
    database.activate(built.generationId)

    expect(
      database.inspectKnowledgeMapping({
        knowledgeItemId: fixture.source.knowledgeItemId,
        parseRevisionId: fixture.source.parseRevisionId,
        pageIndex: 0
      }).chunks
    ).toEqual([])
    const recoveredPage = database.inspectKnowledgeMapping({
      knowledgeItemId: fixture.source.knowledgeItemId,
      parseRevisionId: fixture.source.parseRevisionId,
      pageIndex: 0,
      fallbackBlockOrdinals: [0, 1]
    })
    expect(recoveredPage.state).toBe('ready')
    expect(recoveredPage.chunks.length).toBeGreaterThan(0)
    expect(
      recoveredPage.chunks.some((chunk) =>
        chunk.sources.some((source) => source.blockOrdinal === 0 && source.page === null)
      )
    ).toBe(true)
    database.close()
  })

  it('never replaces an active generation when a newer source is corrupt', async () => {
    const fixture = await createSource()
    const database = new IndexDatabase(join(fixture.root, 'index.sqlite'))
    const activeGeneration = generationIdFor(
      hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    await database.build({
      generationId: activeGeneration,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources: [fixture.source]
    })
    database.activate(activeGeneration)

    const invalidSource = { ...fixture.source, manifestSha256: 'f'.repeat(64) }
    const invalidGeneration = generationIdFor(
      hashSourceSet([invalidSource], INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    await expect(
      database.build({
        generationId: invalidGeneration,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [invalidSource]
      })
    ).rejects.toThrow('manifest hash')
    expect(database.inspect().activeGenerationId).toBe(activeGeneration)
    database.close()
  })

  it('indexes Chinese and English FTS paths and enforces vector-generation compatibility', async () => {
    const fixture = await createSource(true)
    const database = new IndexDatabase(join(fixture.root, 'index.sqlite'), getLoadablePath())
    const generationId = generationIdFor(
      hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    await database.build({
      generationId,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources: [fixture.source]
    })
    database.activate(generationId)
    expect(database.searchFts('Heading', 10).some((item) => item.strategy === 'trigram')).toBe(true)
    expect(database.searchFts('What does the Heading explain?', 10)).toEqual([])
    expect(
      database.searchFts('What does the Heading explain?', 10, undefined, 'terms')
    ).not.toEqual([])
    expect(database.searchFts('人工', 10).some((item) => item.strategy === 'substring')).toBe(true)
    expect(database.searchFts('工智', 10).some((item) => item.strategy === 'substring')).toBe(true)
    expect(database.searchFts('工', 10).some((item) => item.strategy === 'substring')).toBe(true)
    expect(database.searchFts('工智能', 10).some((item) => item.strategy === 'trigram')).toBe(true)
    expect(database.searchFts('不存在', 10)).toEqual([])
    expect(
      database.searchFts('工智', 10, {
        knowledgeItemIds: [fixture.source.knowledgeItemId],
        fileExtensions: ['pdf'],
        parseRevisionIds: [fixture.source.parseRevisionId],
        pageFrom: 3,
        pageTo: 3,
        heading: '双语'
      })
    ).toHaveLength(1)
    expect(() => database.searchFts('" OR', 10)).not.toThrow()

    const inputs = database.embeddingInputs(generationId).values
    const bilingual = database.hydrateCandidates(
      inputs.map((input) => input.chunkId),
      {
        knowledgeItemIds: [fixture.source.knowledgeItemId],
        fileExtensions: ['pdf'],
        parseRevisionIds: [fixture.source.parseRevisionId],
        pageFrom: 3,
        pageTo: 3,
        heading: '双语'
      }
    )
    expect(bilingual).toHaveLength(1)
    expect(bilingual[0]).toMatchObject({
      citationId: expect.stringMatching(/^citation-[a-f0-9]{40}$/),
      page: 3,
      headingPath: ['双语']
    })
    expect(database.expandCitations([bilingual[0]?.citationId as string])[0]).toMatchObject({
      chunkId: bilingual[0]?.chunkId,
      sourceBlockIds: expect.arrayContaining([expect.stringMatching(/^kb_[a-f0-9]{32}$/)])
    })
    expect(
      database.hydrateCandidates(
        inputs.map((input) => input.chunkId),
        {
          knowledgeItemIds: [],
          fileExtensions: ['docx'],
          parseRevisionIds: []
        }
      )
    ).toEqual([])
    const embeddingGenerationId = 'embedding-test-generation'
    const contractSha256 = 'e'.repeat(64)
    const contentFingerprint = hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION)
    expect(() =>
      database.beginEmbedding({
        embeddingGenerationId: 'embedding-wrong-chunker',
        indexGenerationId: generationId,
        providerId: 'openai-compatible',
        modelId: 'embedding-model',
        modelRevision: 'revision-1',
        dimension: 3,
        metric: 'cosine',
        normalization: 'l2',
        chunkerVersion: INDEX_CHUNKER_VERSION + 1,
        contractSha256: '1'.repeat(64),
        contentFingerprint
      })
    ).toThrow('source contract')
    database.beginEmbedding({
      embeddingGenerationId,
      indexGenerationId: generationId,
      providerId: 'openai-compatible',
      modelId: 'embedding-model',
      modelRevision: 'revision-1',
      dimension: 3,
      metric: 'cosine',
      normalization: 'l2',
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256,
      contentFingerprint
    })
    database.upsertVectors(
      embeddingGenerationId,
      inputs.map((input, index) => ({
        chunkId: input.chunkId,
        contentSha256: input.contentSha256,
        vector: index === 0 ? [1, 0, 0] : [0, 1, index + 1]
      }))
    )
    expect(() => database.activateEmbedding(embeddingGenerationId, '0'.repeat(64))).toThrow(
      'contract'
    )
    database.activateEmbedding(embeddingGenerationId, contractSha256)
    expect(database.queryVectors(embeddingGenerationId, [1, 0, 0], 3)[0]).toMatchObject({
      chunkId: inputs[0]?.chunkId,
      distance: 0
    })
    expect(() => database.queryVectors(embeddingGenerationId, [1, 0], 3)).toThrow('dimension')
    expect(() =>
      database.beginEmbedding({
        embeddingGenerationId,
        indexGenerationId: generationId,
        providerId: 'openai-compatible',
        modelId: 'embedding-model-v2',
        modelRevision: 'revision-2',
        dimension: 3,
        metric: 'cosine',
        normalization: 'none',
        chunkerVersion: INDEX_CHUNKER_VERSION,
        contractSha256: '2'.repeat(64),
        contentFingerprint
      })
    ).toThrow('collision')
    expect(database.queryVectors(embeddingGenerationId, [1, 0, 0], 1)).toHaveLength(1)
    expect(
      database
        .embeddingInputs(generationId, 0, 256, contractSha256, 3)
        .values.every((input) => input.cachedVector?.length === 3)
    ).toBe(true)
    const l2EmbeddingGenerationId = 'embedding-l2-test-generation'
    const l2ContractSha256 = 'f'.repeat(64)
    database.beginEmbedding({
      embeddingGenerationId: l2EmbeddingGenerationId,
      indexGenerationId: generationId,
      providerId: 'openai-compatible',
      modelId: 'embedding-model',
      modelRevision: 'revision-1',
      dimension: 3,
      metric: 'l2',
      normalization: 'none',
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256: l2ContractSha256,
      contentFingerprint
    })
    database.upsertVectors(
      l2EmbeddingGenerationId,
      inputs.map((input, index) => ({
        chunkId: input.chunkId,
        contentSha256: input.contentSha256,
        vector: index === 0 ? [1, 0, 0] : [0, 1, index + 1]
      }))
    )
    database.activateEmbedding(l2EmbeddingGenerationId, l2ContractSha256)
    expect(() => database.queryVectors(embeddingGenerationId, [1, 0, 0], 3)).toThrow('not active')
    expect(
      database.queryVectors(l2EmbeddingGenerationId, [1, 0, 0], 3, {
        knowledgeItemIds: [fixture.source.knowledgeItemId],
        fileExtensions: ['pdf'],
        parseRevisionIds: [fixture.source.parseRevisionId],
        pageFrom: 0,
        pageTo: 0
      })[0]
    ).toMatchObject({ chunkId: inputs[0]?.chunkId, distance: 0 })
    database.close()
  })

  it('matches literal decoded headings before applying text and vector limits', async () => {
    const target = await createSource(false, { heading: 'CAFÉ 100%_ "Audit"' })
    const decoy = await createSource(false, {
      knowledgeItemId: randomUUID(),
      parseRevisionId: randomUUID(),
      normalizationRunId: randomUUID(),
      heading: 'CAFÉ 100AB "Audit"'
    })
    const sources = [target.source, decoy.source]
    const contentFingerprint = hashSourceSet(sources, INDEX_CHUNKER_VERSION)
    const generationId = generationIdFor(contentFingerprint, INDEX_CHUNKER_VERSION)
    const database = new IndexDatabase(join(target.root, 'index.sqlite'), getLoadablePath())
    try {
      await database.build({ generationId, chunkerVersion: INDEX_CHUNKER_VERSION, sources })
      database.activate(generationId)
      const embeddingGenerationId = 'embedding-heading-filter'
      const contractSha256 = 'e'.repeat(64)
      const inputs = database.embeddingInputs(generationId).values
      database.beginEmbedding({
        embeddingGenerationId,
        indexGenerationId: generationId,
        providerId: 'test',
        modelId: 'test',
        modelRevision: '1',
        dimension: 2,
        metric: 'l2',
        normalization: 'none',
        chunkerVersion: INDEX_CHUNKER_VERSION,
        contractSha256,
        contentFingerprint
      })
      const baseFilters = { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] }
      const targets = database.hydrateCandidates(
        inputs.map((input) => input.chunkId),
        {
          ...baseFilters,
          knowledgeItemIds: [target.source.knowledgeItemId]
        }
      )
      const targetIds = new Set(targets.map((candidate) => candidate.chunkId))
      database.upsertVectors(
        embeddingGenerationId,
        inputs.map((input) => ({
          chunkId: input.chunkId,
          contentSha256: input.contentSha256,
          vector: targetIds.has(input.chunkId) ? [0, 1] : [1, 0]
        }))
      )
      database.activateEmbedding(embeddingGenerationId, contractSha256)

      for (const heading of ['100%_', 'cafe\u0301 100%_ "audit"']) {
        const filters = { ...baseFilters, heading }
        expect(
          database.searchCandidates({
            indexGenerationId: generationId,
            query: 'Short paragraph',
            mode: 'phrase',
            limit: 1,
            filters
          })
        ).toMatchObject([{ knowledgeItemId: target.source.knowledgeItemId }])
        expect(
          database.searchCandidates({
            indexGenerationId: generationId,
            embeddingGenerationId,
            vector: [1, 0],
            limit: 1,
            filters
          })
        ).toMatchObject([{ knowledgeItemId: target.source.knowledgeItemId }])
      }
      const directFilters: KnowledgeSearchFilters = {
        knowledgeItemIds: [target.source.knowledgeItemId],
        fileExtensions: ['pdf'],
        parseRevisionIds: [target.source.parseRevisionId],
        pageFrom: 1,
        pageTo: 1,
        heading: 'cafe\u0301 100%_ "audit"'
      }
      const chunkIds = inputs.map((input) => input.chunkId)
      expect(database.hydrateCandidates(chunkIds, directFilters, true)).toMatchObject([
        { knowledgeItemId: target.source.knowledgeItemId, sources: [{ page: 1 }] }
      ])
      expect(
        database.hydrateCandidates(chunkIds, { ...directFilters, pageFrom: 7, pageTo: 8 })
      ).toEqual([])
    } finally {
      database.close()
    }
  })

  it('clears the selected cache at refresh setup and keeps progress on reopen', async () => {
    const first = await createSource(false, { heading: 'First unique heading' })
    const second = await createSource(false, {
      knowledgeItemId: randomUUID(),
      parseRevisionId: randomUUID(),
      normalizationRunId: randomUUID(),
      heading: 'Second unique heading'
    })
    const path = join(first.root, 'index.sqlite')
    let database = new IndexDatabase(path, getLoadablePath())
    const sources = [first.source, second.source]
    const generationId = generationIdFor(
      hashSourceSet(sources, INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    await database.build({
      generationId,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources
    })
    database.activate(generationId)
    const contractSha256 = 'e'.repeat(64)
    const embeddingGenerationId = 'embedding-cache-refresh-fixture'
    const inputs = database.embeddingInputs(generationId).values
    const seedContract = {
      embeddingGenerationId,
      indexGenerationId: generationId,
      providerId: 'openai-compatible',
      modelId: 'embedding-model',
      modelRevision: 'revision-1',
      dimension: 3,
      metric: 'cosine',
      normalization: 'l2',
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256,
      contentFingerprint: hashSourceSet(sources, INDEX_CHUNKER_VERSION)
    } as const
    database.beginEmbedding(seedContract)
    database.upsertVectors(
      embeddingGenerationId,
      inputs.map((input, index) => ({
        chunkId: input.chunkId,
        contentSha256: input.contentSha256,
        vector: [1, index + 1, 1]
      }))
    )

    const refreshContract = { ...seedContract, embeddingGenerationId: 'embedding-item-refresh' }
    const itemRefresh = { scope: 'item', knowledgeItemId: first.source.knowledgeItemId } as const
    // An older process can leave a building generation before clearing any cache rows.
    database.beginEmbedding(refreshContract)
    expect(database.beginEmbedding(refreshContract, itemRefresh).clearedCount).toBeGreaterThan(0)
    const refreshedInputs = database.embeddingInputs(generationId, 0, 256, contractSha256, 3).values
    const byKnowledgeItem = new Map<string, typeof refreshedInputs>()
    for (const input of refreshedInputs) {
      const candidate = database.hydrateCandidates([input.chunkId], {
        knowledgeItemIds: [],
        fileExtensions: [],
        parseRevisionIds: []
      })[0]
      if (candidate === undefined) throw new Error('Expected embedding input provenance')
      const values = byKnowledgeItem.get(candidate.knowledgeItemId) ?? []
      values.push(input)
      byKnowledgeItem.set(candidate.knowledgeItemId, values)
    }
    expect(
      byKnowledgeItem
        .get(first.source.knowledgeItemId)
        ?.every((input) => input.cachedVector === undefined)
    ).toBe(true)
    expect(
      byKnowledgeItem
        .get(second.source.knowledgeItemId)
        ?.some((input) => input.cachedVector !== undefined)
    ).toBe(true)
    const input = byKnowledgeItem.get(first.source.knowledgeItemId)?.[0]
    if (input === undefined) throw new Error('Expected a selected embedding input')
    database.upsertVectors(refreshContract.embeddingGenerationId, [
      { chunkId: input.chunkId, contentSha256: input.contentSha256, vector: [0, 1, 0] }
    ])
    database.close()
    database = new IndexDatabase(path, getLoadablePath())
    expect(database.beginEmbedding(refreshContract, itemRefresh)).toEqual({
      alreadyActive: false,
      clearedCount: null
    })
    expect(database.embeddingInputs(generationId, 0, 256, contractSha256, 3).values).toContainEqual(
      expect.objectContaining({ chunkId: input.chunkId, cachedVector: [0, 1, 0] })
    )

    // Main restarts the page scan on retry and sends committed inputs again.
    database.upsertVectors(refreshContract.embeddingGenerationId, [
      { chunkId: input.chunkId, contentSha256: input.contentSha256, vector: [0, 1, 0] }
    ])
    const allContract = { ...seedContract, embeddingGenerationId: 'embedding-all-refresh' }
    const raw = new Database(path)
    try {
      raw.exec(`
        CREATE TRIGGER reject_cache_clear BEFORE DELETE ON embedding_vector_cache
        BEGIN SELECT RAISE(ABORT, 'cache clear rejected'); END;
      `)
      expect(() => database.beginEmbedding(allContract, { scope: 'all' })).toThrow(
        'cache clear rejected'
      )
      expect(
        raw
          .prepare('SELECT 1 FROM embedding_generations WHERE embedding_generation_id = ?')
          .get(allContract.embeddingGenerationId)
      ).toBeUndefined()
      raw.exec('DROP TRIGGER reject_cache_clear')
    } finally {
      raw.close()
    }
    expect(database.beginEmbedding(allContract, { scope: 'all' }).clearedCount).toBeGreaterThan(0)
    expect(
      database
        .embeddingInputs(generationId, 0, 256, contractSha256, 3)
        .values.every((input) => input.cachedVector === undefined)
    ).toBe(true)
    expect(() =>
      database.beginEmbedding(
        { ...allContract, indexGenerationId: 'stale-generation' },
        { scope: 'all' }
      )
    ).toThrow('source index generation is not active')
    database.close()
  })

  it('rolls back vector and cache writes when a batch contains an invalid chunk reference', async () => {
    const fixture = await createSource()
    const path = join(fixture.root, 'index.sqlite')
    const database = new IndexDatabase(path, getLoadablePath())
    const contentFingerprint = hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION)
    const generationId = generationIdFor(contentFingerprint, INDEX_CHUNKER_VERSION)
    const contract = {
      embeddingGenerationId: 'embedding-correlation-test',
      indexGenerationId: generationId,
      providerId: 'openai-compatible',
      modelId: 'embedding-model',
      modelRevision: 'revision-1',
      dimension: 3,
      metric: 'cosine',
      normalization: 'l2',
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256: 'e'.repeat(64),
      contentFingerprint
    } as const
    try {
      await database.build({
        generationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [fixture.source]
      })
      database.activate(generationId)
      database.beginEmbedding(contract)
      const [first, second] = database.embeddingInputs(generationId).values
      if (first === undefined || second === undefined) throw new Error('Expected two source chunks')
      const good = { chunkId: first.chunkId, contentSha256: first.contentSha256, vector: [1, 0, 0] }
      const wrongId = {
        chunkId: 'chunk-unknown',
        contentSha256: second.contentSha256,
        vector: [1, 0, 0]
      }
      const wrongHash = { ...wrongId, chunkId: second.chunkId, contentSha256: first.contentSha256 }
      for (const invalid of [wrongId, wrongHash]) {
        expect(() =>
          database.upsertVectors(contract.embeddingGenerationId, [good, invalid])
        ).toThrow('Embedding input does not match its source chunk')
      }

      const raw = new Database(path)
      try {
        expect(raw.prepare('SELECT count(*) FROM chunk_vectors').pluck().get()).toBe(0)
        expect(raw.prepare('SELECT count(*) FROM embedding_vector_cache').pluck().get()).toBe(0)
      } finally {
        raw.close()
      }
    } finally {
      database.close()
    }
  })

  it('preserves the active vectors when a replacement has invalid coverage or is obsolete', async () => {
    const fixture = await createSource()
    const path = join(fixture.root, 'index.sqlite')
    const database = new IndexDatabase(path, getLoadablePath())
    const contentFingerprint = hashSourceSet([fixture.source], INDEX_CHUNKER_VERSION)
    const generationId = generationIdFor(contentFingerprint, INDEX_CHUNKER_VERSION)
    const contract = {
      embeddingGenerationId: 'embedding-current',
      indexGenerationId: generationId,
      providerId: 'openai-compatible',
      modelId: 'embedding-model',
      modelRevision: 'revision-1',
      dimension: 3,
      metric: 'cosine',
      normalization: 'l2',
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256: 'e'.repeat(64),
      contentFingerprint
    } as const
    const replacement = { ...contract, embeddingGenerationId: 'embedding-replacement' }
    try {
      await database.build({
        generationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [fixture.source]
      })
      database.activate(generationId)
      const values = database.embeddingInputs(generationId).values.map((input) => ({
        chunkId: input.chunkId,
        contentSha256: input.contentSha256,
        vector: [1, 0, 0]
      }))
      database.beginEmbedding(contract)
      database.upsertVectors(contract.embeddingGenerationId, values)
      database.activateEmbedding(contract.embeddingGenerationId, contract.contractSha256)

      database.beginEmbedding(replacement)
      database.upsertVectors(replacement.embeddingGenerationId, values)
      const first = values[0]
      if (first === undefined) throw new Error('Expected a source chunk')
      const raw = new Database(path)
      try {
        // Simulate a legacy row whose ID is valid but whose hash is wrong.
        raw
          .prepare(
            'UPDATE chunk_vectors SET content_sha256 = ? WHERE embedding_generation_id = ? AND chunk_id = ?'
          )
          .run('0'.repeat(64), replacement.embeddingGenerationId, first.chunkId)
      } finally {
        raw.close()
      }
      expect(() =>
        database.activateEmbedding(replacement.embeddingGenerationId, replacement.contractSha256)
      ).toThrow('invalid source chunks')
      expect(database.retrievalState().activeEmbeddingContract).toMatchObject(contract)

      database.upsertVectors(replacement.embeddingGenerationId, [first])
      database.activateEmbedding(replacement.embeddingGenerationId, replacement.contractSha256)
      expect(() =>
        database.activateEmbedding(contract.embeddingGenerationId, contract.contractSha256)
      ).toThrow('not ready for activation')
      expect(database.retrievalState().activeEmbeddingContract).toMatchObject(replacement)
    } finally {
      database.close()
    }
  })

  it('rejects reuse of a vector generation after its text generation is superseded', async () => {
    const first = await createSource()
    const second = await createSource(false, { parseRevisionId: randomUUID() })
    const database = new IndexDatabase(join(first.root, 'index.sqlite'), getLoadablePath())
    const sourceContract = (source: IndexSource) => {
      const contentFingerprint = hashSourceSet([source], INDEX_CHUNKER_VERSION)
      return {
        indexGenerationId: generationIdFor(contentFingerprint, INDEX_CHUNKER_VERSION),
        contentFingerprint
      }
    }
    const firstContract = {
      ...sourceContract(first.source),
      embeddingGenerationId: 'embedding-before-source-change',
      providerId: 'openai-compatible',
      modelId: 'embedding-model',
      modelRevision: 'revision-1',
      dimension: 3,
      metric: 'cosine',
      normalization: 'l2',
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256: 'e'.repeat(64)
    } as const
    try {
      await database.build({
        generationId: firstContract.indexGenerationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [first.source]
      })
      database.activate(firstContract.indexGenerationId)
      database.beginEmbedding(firstContract)
      database.upsertVectors(
        firstContract.embeddingGenerationId,
        database.embeddingInputs(firstContract.indexGenerationId).values.map((input) => ({
          chunkId: input.chunkId,
          contentSha256: input.contentSha256,
          vector: [1, 0, 0]
        }))
      )
      database.activateEmbedding(firstContract.embeddingGenerationId, firstContract.contractSha256)

      const currentSource = sourceContract(second.source)
      await database.build({
        generationId: currentSource.indexGenerationId,
        chunkerVersion: INDEX_CHUNKER_VERSION,
        sources: [second.source]
      })
      database.activate(currentSource.indexGenerationId)

      const filters = { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] }
      expect(
        database.searchCandidates({
          indexGenerationId: firstContract.indexGenerationId,
          query: 'Heading',
          mode: 'phrase',
          limit: 10,
          filters
        })
      ).toBeNull()
      expect(
        database.searchCandidates({
          indexGenerationId: firstContract.indexGenerationId,
          embeddingGenerationId: firstContract.embeddingGenerationId,
          vector: [1, 0, 0],
          limit: 10,
          filters
        })
      ).toBeNull()
      expect(
        database.searchCandidates({
          indexGenerationId: currentSource.indexGenerationId,
          query: 'Heading',
          mode: 'phrase',
          limit: 10,
          filters
        })
      ).toEqual([expect.objectContaining({ parseRevisionId: second.source.parseRevisionId })])
      expect(database.retrievalState().activeEmbeddingContract).toBeNull()
      expect(() =>
        database.queryVectors(firstContract.embeddingGenerationId, [1, 0, 0], 1)
      ).toThrow('Embedding source index generation is no longer active')

      expect(() => database.beginEmbedding({ ...firstContract, ...currentSource })).toThrow(
        'Embedding generation ID contract collision'
      )
      expect(() =>
        database.activateEmbedding(
          firstContract.embeddingGenerationId,
          firstContract.contractSha256
        )
      ).toThrow('Embedding source index generation is no longer active')
    } finally {
      database.close()
    }
  })

  it('removes deleted citations and ranks only the updated active parse revision', async () => {
    const first = await createSource(false, { heading: 'Alpha original' })
    const second = await createSource(false, {
      knowledgeItemId: randomUUID(),
      parseRevisionId: randomUUID(),
      normalizationRunId: randomUUID(),
      displayName: 'Beta.docx',
      extension: 'docx',
      heading: 'Beta deleted'
    })
    const database = new IndexDatabase(join(first.root, 'index.sqlite'), getLoadablePath())
    const initialGeneration = generationIdFor(
      hashSourceSet([first.source, second.source], INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    await database.build({
      generationId: initialGeneration,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources: [first.source, second.source]
    })
    database.activate(initialGeneration)
    const deletedCandidate = database.hydrateCandidates(
      database.searchFts('Beta deleted', 10).map((candidate) => candidate.chunkId),
      { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] }
    )[0]
    expect(deletedCandidate?.knowledgeItemId).toBe(second.source.knowledgeItemId)

    const updated = await createSource(false, {
      knowledgeItemId: first.source.knowledgeItemId,
      parseRevisionId: randomUUID(),
      normalizationRunId: randomUUID(),
      heading: 'Alpha updated'
    })
    const updatedGeneration = generationIdFor(
      hashSourceSet([updated.source], INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    await database.build({
      generationId: updatedGeneration,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources: [updated.source]
    })
    database.activate(updatedGeneration)
    expect(database.searchFts('Beta deleted', 10)).toEqual([])
    expect(database.expandCitations([deletedCandidate?.citationId as string])).toEqual([])
    const updatedCandidate = database.hydrateCandidates(
      database.searchFts('Alpha updated', 10).map((candidate) => candidate.chunkId),
      { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] }
    )[0]
    expect(updatedCandidate).toMatchObject({
      knowledgeItemId: first.source.knowledgeItemId,
      parseRevisionId: updated.source.parseRevisionId,
      title: updated.source.displayName
    })
    database.close()
  })

  it('retrieves and excludes a source beyond 300 entries with FTS and vectors', async () => {
    const fixtures = []
    for (let index = 0; index < 301; index += 1) {
      fixtures.push(
        await createSource(false, {
          knowledgeItemId: `019d0000-0000-7000-8000-${String(index).padStart(12, '0')}`,
          parseRevisionId: randomUUID(),
          normalizationRunId: randomUUID(),
          heading: index === 300 ? 'Needlephrase' : 'Background',
          atomicText: index === 300 ? 'Needlephrase' : 'Background',
          largeAtomicCount: 1
        })
      )
    }
    const sources = fixtures.map((fixture) => fixture.source)
    const target = sources[300]
    const first = fixtures[0]
    if (target === undefined || first === undefined) throw new Error('Missing source fixture')
    const database = new IndexDatabase(join(first.root, 'index.sqlite'), getLoadablePath())
    try {
      const fingerprint = hashSourceSet(sources, INDEX_CHUNKER_VERSION)
      const generationId = generationIdFor(fingerprint, INDEX_CHUNKER_VERSION)
      await database.build({ generationId, chunkerVersion: INDEX_CHUNKER_VERSION, sources })
      database.activate(generationId)
      const inputs = database.embeddingInputs(generationId, 0, 1_000).values
      const filters = {
        knowledgeItemIds: sources.map((source) => source.knowledgeItemId),
        fileExtensions: ['pdf'],
        parseRevisionIds: [target.parseRevisionId],
        pageFrom: 0,
        pageTo: 0,
        heading: 'Needlephrase'
      }
      const targets = database.hydrateCandidates(
        inputs.map((input) => input.chunkId),
        filters
      )
      expect(targets).toHaveLength(1)
      const targetHit = targets[0]
      if (targetHit === undefined) throw new Error('Missing target chunk')
      const targetChunk = targetHit.chunkId
      const embeddingGenerationId = 'embedding-many-sources'
      const contractSha256 = 'd'.repeat(64)
      database.beginEmbedding({
        embeddingGenerationId,
        indexGenerationId: generationId,
        providerId: 'openai-compatible',
        modelId: 'test',
        modelRevision: '1',
        dimension: 3,
        metric: 'cosine',
        normalization: 'l2',
        chunkerVersion: INDEX_CHUNKER_VERSION,
        contractSha256,
        contentFingerprint: fingerprint
      })
      database.upsertVectors(
        embeddingGenerationId,
        inputs.map((input) => ({
          chunkId: input.chunkId,
          contentSha256: input.contentSha256,
          vector: input.chunkId === targetChunk ? [1, 0, 0] : [0, 1, 0]
        }))
      )
      database.activateEmbedding(embeddingGenerationId, contractSha256)
      const allSources = {
        knowledgeItemIds: filters.knowledgeItemIds,
        fileExtensions: [],
        parseRevisionIds: []
      }
      expect(
        database.queryVectors(embeddingGenerationId, [1, 0, 0], 1, allSources)[0]?.chunkId
      ).toBe(targetChunk)
      expect(database.searchFts('Needlephrase', 10, filters).map((hit) => hit.chunkId)).toEqual([
        targetChunk
      ])
      expect(database.queryVectors(embeddingGenerationId, [1, 0, 0], 1, filters)[0]?.chunkId).toBe(
        targetChunk
      )
      const excluded = { ...filters, knowledgeItemIds: filters.knowledgeItemIds.slice(0, 300) }
      expect(database.searchFts('Needlephrase', 10, excluded)).toEqual([])
      expect(database.queryVectors(embeddingGenerationId, [1, 0, 0], 1, excluded)).toEqual([])
      expect(database.expandCitations([targetHit.citationId])[0]?.knowledgeItemId).toBe(
        target.knowledgeItemId
      )
    } finally {
      database.close()
    }
  })

  it('keeps vector queries correct when an active generation exceeds sqlite-vec k limits', async () => {
    const bulk = await createSource(false, {
      knowledgeItemId: randomUUID(),
      largeAtomicCount: 4_096
    })
    const target = await createSource(false, { knowledgeItemId: randomUUID() })
    const sources = [bulk.source, target.source]
    const database = new IndexDatabase(join(bulk.root, 'index.sqlite'), getLoadablePath())
    const generationId = generationIdFor(
      hashSourceSet(sources, INDEX_CHUNKER_VERSION),
      INDEX_CHUNKER_VERSION
    )
    await database.build({
      generationId,
      chunkerVersion: INDEX_CHUNKER_VERSION,
      sources
    })
    database.activate(generationId)
    const inputs = database.embeddingInputs(generationId, 0, 5_000).values
    expect(inputs.length).toBeGreaterThan(4_096)
    const embeddingGenerationId = 'embedding-over-k-limit-generation'
    const contractSha256 = 'a'.repeat(64)
    database.beginEmbedding({
      embeddingGenerationId,
      indexGenerationId: generationId,
      providerId: 'openai-compatible',
      modelId: 'embedding-model',
      modelRevision: 'revision-1',
      dimension: 3,
      metric: 'cosine',
      normalization: 'l2',
      chunkerVersion: INDEX_CHUNKER_VERSION,
      contractSha256,
      contentFingerprint: hashSourceSet(sources, INDEX_CHUNKER_VERSION)
    })
    database.upsertVectors(
      embeddingGenerationId,
      inputs.map((input) => ({
        chunkId: input.chunkId,
        contentSha256: input.contentSha256,
        vector: [1, 0, 0]
      }))
    )
    database.activateEmbedding(embeddingGenerationId, contractSha256)

    expect(database.queryVectors(embeddingGenerationId, [1, 0, 0], 3)).toHaveLength(3)
    const filtered = database.queryVectors(embeddingGenerationId, [1, 0, 0], 10, {
      knowledgeItemIds: [target.source.knowledgeItemId],
      fileExtensions: [],
      parseRevisionIds: []
    })
    const hydrated = database.hydrateCandidates(
      filtered.map((value) => value.chunkId),
      {
        knowledgeItemIds: [],
        fileExtensions: [],
        parseRevisionIds: []
      }
    )
    expect(hydrated.length).toBeGreaterThan(0)
    expect(hydrated.every((value) => value.knowledgeItemId === target.source.knowledgeItemId)).toBe(
      true
    )
    database.close()
  })
})

async function createSource(
  includeBilingual = false,
  options: {
    knowledgeItemId?: string
    parseRevisionId?: string
    normalizationRunId?: string
    displayName?: string
    extension?: string
    heading?: string
    omitProvenance?: boolean
    atomicText?: string
    largeAtomicCount?: number
    blocks?: NormalizedKnowledgeBlock[]
  } = {}
): Promise<{
  root: string
  source: IndexSource
  blocks: NormalizedKnowledgeBlock[]
}> {
  const root = await mkdtemp(join(tmpdir(), 'writellm-index-'))
  roots.push(root)
  const normalizationRoot = join(root, 'normalization')
  const sourceKnowledgeItemId = options.knowledgeItemId ?? knowledgeItemId
  const sourceParseRevisionId = options.parseRevisionId ?? parseRevisionId
  const sourceNormalizationRunId = options.normalizationRunId ?? normalizationRunId
  const heading = options.heading ?? 'Heading'
  await mkdir(join(normalizationRoot, 'images'), { recursive: true })
  const rawBlocks =
    options.largeAtomicCount === undefined
      ? [
          block(0, 'heading', heading, {
            markdown: `# ${heading}`,
            headingPath: [heading],
            ...(options.omitProvenance ? {} : { page: 0 })
          }),
          block(1, 'paragraph', 'Short paragraph', {
            headingPath: [heading],
            ...(options.omitProvenance ? {} : { page: 0 })
          }),
          block(2, 'table', '<table><tr><td>Cell</td></tr></table>', {
            headingPath: [heading],
            ...(options.omitProvenance ? {} : { page: 1, bbox: [0, 10, 1000, 500] as const })
          }),
          block(3, 'paragraph', 'x'.repeat(2_200), {
            headingPath: [heading],
            ...(options.omitProvenance ? {} : { page: 2 })
          })
        ]
      : Array.from({ length: options.largeAtomicCount }, (_, ordinal) =>
          block(
            ordinal,
            'table',
            `<table><tr><td>${options.atomicText ?? 'Bulk'} ${ordinal}</td></tr></table>`,
            {
              headingPath: [heading],
              ...(options.omitProvenance ? {} : { page: ordinal })
            }
          )
        )
  if (includeBilingual) {
    rawBlocks.push(
      block(4, 'paragraph', '人工智能写作与 English retrieval', {
        headingPath: ['双语'],
        page: 3
      })
    )
  }
  const blocks = (options.blocks ?? rawBlocks).map((value) =>
    normalizedKnowledgeBlockSchema.parse(value)
  )
  const blockBytes = Buffer.from(`${blocks.map((value) => JSON.stringify(value)).join('\n')}\n`)
  const documentBytes = Buffer.from(
    `${blocks.map((value) => value.markdown ?? value.text).join('\n\n')}\n`
  )
  await writeFile(join(normalizationRoot, 'blocks.jsonl'), blockBytes)
  await writeFile(join(normalizationRoot, 'document.md'), documentBytes)
  const manifestBytes = Buffer.from(
    `${JSON.stringify(
      normalizedKnowledgeManifestSchema.parse({
        schemaVersion: 1,
        normalizerVersion: 1,
        normalizationRunId: sourceNormalizationRunId,
        parseRevisionId: sourceParseRevisionId,
        knowledgeItemId: sourceKnowledgeItemId,
        sourceSha256: 'a'.repeat(64),
        sourceManifestSha256: 'b'.repeat(64),
        blocks: { relativePath: 'blocks.jsonl', sha256: hash(blockBytes), count: blocks.length },
        document: { relativePath: 'document.md', sha256: hash(documentBytes) },
        assets: [],
        createdAt: '2026-07-16T00:00:00.000Z'
      })
    )}\n`
  )
  await writeFile(join(normalizationRoot, 'manifest.json'), manifestBytes)
  expect((await readFile(join(normalizationRoot, 'manifest.json'))).byteLength).toBeGreaterThan(0)
  return {
    root,
    blocks,
    source: {
      knowledgeItemId: sourceKnowledgeItemId,
      displayName: options.displayName ?? 'Golden.pdf',
      extension: options.extension ?? 'pdf',
      parseRevisionId: sourceParseRevisionId,
      normalizationRunId: sourceNormalizationRunId,
      normalizationRoot,
      manifestSha256: hash(manifestBytes)
    }
  }
}

async function replaceSourceBlocks(source: IndexSource, bytes: Buffer): Promise<IndexSource> {
  const manifestPath = join(source.normalizationRoot, 'manifest.json')
  const manifest = normalizedKnowledgeManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8'))
  )
  manifest.blocks.sha256 = hash(bytes)
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  await writeFile(join(source.normalizationRoot, manifest.blocks.relativePath), bytes)
  await writeFile(manifestPath, manifestBytes)
  return { ...source, manifestSha256: hash(manifestBytes) }
}

function block(
  ordinal: number,
  type: NormalizedKnowledgeBlock['type'],
  text: string,
  extra: Partial<NormalizedKnowledgeBlock>
): NormalizedKnowledgeBlock {
  const contentHash = hash(Buffer.from(`${type}\0${text}`))
  return {
    id: `kb_${hash(Buffer.from(String(ordinal))).slice(0, 32)}`,
    ordinal,
    type,
    text,
    headingPath: [],
    assetRefs: [],
    contentHash,
    ...extra
  }
}

function hash(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
