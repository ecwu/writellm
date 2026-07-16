import { createHash, randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    expect(database.searchFts('人工', 10).some((item) => item.strategy === 'unicode61')).toBe(true)
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
  const rawBlocks = [
    block(0, 'heading', heading, { markdown: `# ${heading}`, headingPath: [heading], page: 0 }),
    block(1, 'paragraph', 'Short paragraph', { headingPath: [heading], page: 0 }),
    block(2, 'table', '<table><tr><td>Cell</td></tr></table>', {
      headingPath: [heading],
      page: 1,
      bbox: [0, 10, 1000, 500]
    }),
    block(3, 'paragraph', 'x'.repeat(2_200), { headingPath: [heading], page: 2 })
  ]
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
