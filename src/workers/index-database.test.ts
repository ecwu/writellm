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
import { INDEX_CHUNKER_VERSION, type IndexSource } from '../shared/contracts/indexing'
import { buildDeterministicChunks } from './index-chunker'
import { generationIdFor, hashSourceSet, IndexDatabase } from './index-database'
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

  it('releases the SQLite handle when startup rejects a corrupt index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-index-corrupt-'))
    roots.push(root)
    const databasePath = join(root, 'index.sqlite')
    await writeFile(databasePath, 'corrupt derived index')

    expect(() => new IndexDatabase(databasePath)).toThrow()
    await expect(rm(databasePath)).resolves.toBeUndefined()
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
    verified.close()
  })

  it('creates stable golden chunks from normalized blocks with complete provenance', async () => {
    const fixture = await createSource()
    const first = await buildDeterministicChunks([fixture.source], INDEX_CHUNKER_VERSION)
    const second = await buildDeterministicChunks([fixture.source], INDEX_CHUNKER_VERSION)

    expect(second).toEqual(first)
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
    expect(reopened.beginEmbedding(contract)).toBe(true)
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
    database.deleteVectors(embeddingGenerationId)
    expect(() => database.queryVectors(embeddingGenerationId, [1, 0, 0], 3)).toThrow('missing')

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

  it('clears cached vectors only for content referenced by the selected knowledge item', async () => {
    const first = await createSource(false, { heading: 'First unique heading' })
    const second = await createSource(false, {
      knowledgeItemId: randomUUID(),
      parseRevisionId: randomUUID(),
      normalizationRunId: randomUUID(),
      heading: 'Second unique heading'
    })
    const database = new IndexDatabase(join(first.root, 'index.sqlite'), getLoadablePath())
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
      inputs.map((input, index) => ({
        chunkId: input.chunkId,
        contentSha256: input.contentSha256,
        vector: [1, index + 1, 1]
      }))
    )

    expect(
      database.clearEmbeddingCache(generationId, contractSha256, first.source.knowledgeItemId)
    ).toBeGreaterThan(0)
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
    expect(database.clearEmbeddingCache(generationId, contractSha256)).toBeGreaterThan(0)
    expect(
      database
        .embeddingInputs(generationId, 0, 256, contractSha256, 3)
        .values.every((input) => input.cachedVector === undefined)
    ).toBe(true)
    expect(() => database.clearEmbeddingCache('stale-generation', contractSha256)).toThrow(
      'active index generation'
    )
    database.close()
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
    largeAtomicCount?: number
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
          block(ordinal, 'table', `<table><tr><td>Bulk ${ordinal}</td></tr></table>`, {
            headingPath: [heading],
            ...(options.omitProvenance ? {} : { page: ordinal })
          })
        )
  if (includeBilingual) {
    rawBlocks.push(
      block(4, 'paragraph', '人工智能写作与 English retrieval', {
        headingPath: ['双语'],
        page: 3
      })
    )
  }
  const blocks = rawBlocks.map((value) => normalizedKnowledgeBlockSchema.parse(value))
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
