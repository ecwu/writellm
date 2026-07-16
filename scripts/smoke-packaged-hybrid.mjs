import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const resourcesArgument = process.argv[2]
if (resourcesArgument === undefined) throw new Error('Packaged Resources path is required')
const resources = resolve(resourcesArgument)
const appPackage = join(resources, 'app.asar', 'package.json')
const requireBase = await access(appPackage)
  .then(() => appPackage)
  .catch(() => join(process.cwd(), 'package.json'))
const require = createRequire(requireBase)
const Database = require('better-sqlite3')
const extension = join(
  resources,
  'native',
  'sqlite-vec',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32'
    ? 'vec0.dll'
    : process.platform === 'darwin'
      ? 'vec0.dylib'
      : 'vec0.so'
)

const root = await mkdtemp(join('/tmp', 'writellm-packaged-hybrid-'))
const database = new Database(join(root, 'index.sqlite'))
try {
  database.loadExtension(extension)
  const source = {
    knowledgeItemId: 'knowledge-packaged-1',
    extension: 'pdf',
    parseRevisionId: 'parse-revision-packaged-1',
    normalizationRunId: 'normalization-packaged-1',
    manifestSha256: sha256('manifest-packaged')
  }
  const sourceSetSha256 = sha256(JSON.stringify({ chunkerVersion: 1, sources: [source] }))
  const generationId = `generation-${sha256(`1\0${sourceSetSha256}`).slice(0, 40)}`
  const chunkId = 'chunk-packaged-1'
  const contentSha256 = sha256('packaged active vector content')
  const contractSha256 = sha256('packaged-vector-contract-v1')
  const embeddingGenerationId = 'embedding-packaged-1'
  const vectorTable = `vec_${sha256(embeddingGenerationId).slice(0, 24)}`

  database.exec(`
    CREATE TABLE index_manifests (
      singleton INTEGER PRIMARY KEY, schema_version INTEGER NOT NULL,
      application_id INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE index_generations (
      generation_id TEXT PRIMARY KEY, state TEXT NOT NULL,
      chunker_version INTEGER NOT NULL, source_set_sha256 TEXT NOT NULL,
      chunk_set_sha256 TEXT, chunk_count INTEGER, source_count INTEGER NOT NULL,
      created_at TEXT NOT NULL, built_at TEXT, activated_at TEXT
    );
    CREATE TABLE index_sources (
      generation_id TEXT NOT NULL, knowledge_item_id TEXT NOT NULL,
      extension TEXT, parse_revision_id TEXT NOT NULL,
      normalization_run_id TEXT NOT NULL, manifest_sha256 TEXT NOT NULL,
      PRIMARY KEY (generation_id, knowledge_item_id)
    );
    CREATE TABLE chunks (
      generation_id TEXT NOT NULL, chunk_id TEXT NOT NULL,
      knowledge_item_id TEXT NOT NULL, display_name TEXT NOT NULL,
      extension TEXT, parse_revision_id TEXT NOT NULL,
      normalization_run_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
      text TEXT NOT NULL, content_sha256 TEXT NOT NULL,
      heading_path_json TEXT NOT NULL, source_block_start INTEGER NOT NULL,
      source_block_end INTEGER NOT NULL, PRIMARY KEY (generation_id, chunk_id)
    );
    CREATE TABLE chunk_sources (
      generation_id TEXT NOT NULL, chunk_id TEXT NOT NULL,
      source_ordinal INTEGER NOT NULL, block_id TEXT NOT NULL,
      block_ordinal INTEGER NOT NULL, block_type TEXT NOT NULL,
      page INTEGER, bbox_json TEXT NOT NULL, asset_refs_json TEXT NOT NULL,
      provider_block_id TEXT, segment_start INTEGER NOT NULL,
      segment_end INTEGER NOT NULL,
      PRIMARY KEY (generation_id, chunk_id, source_ordinal)
    );
    CREATE VIRTUAL TABLE chunk_fts_unicode61 USING fts5(
      generation_id UNINDEXED, chunk_id UNINDEXED, text,
      tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE TABLE embedding_generations (
      embedding_generation_id TEXT PRIMARY KEY, index_generation_id TEXT NOT NULL,
      state TEXT NOT NULL, provider_id TEXT NOT NULL, model_id TEXT NOT NULL,
      model_revision TEXT NOT NULL, dimension INTEGER NOT NULL, metric TEXT NOT NULL,
      normalization TEXT NOT NULL, chunker_version INTEGER NOT NULL,
      contract_sha256 TEXT NOT NULL, content_fingerprint TEXT NOT NULL,
      vector_count INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
      built_at TEXT, activated_at TEXT
    );
    CREATE TABLE chunk_vectors (
      embedding_generation_id TEXT NOT NULL, chunk_id TEXT NOT NULL,
      vector_rowid INTEGER NOT NULL, content_sha256 TEXT NOT NULL,
      PRIMARY KEY (embedding_generation_id, chunk_id)
    );
    CREATE VIRTUAL TABLE "${vectorTable}" USING vec0(
      embedding float[3] distance_metric=cosine
    );
  `)

  database
    .prepare('INSERT INTO index_manifests VALUES (1, 4, ?, ?)')
    .run(0x574c4958, new Date().toISOString())
  database
    .prepare(
      `INSERT INTO index_generations
      VALUES (?, 'building', 1, ?, NULL, NULL, 1, ?, NULL, NULL)`
    )
    .run(generationId, sourceSetSha256, new Date().toISOString())
  database
    .prepare('INSERT INTO index_sources VALUES (?, ?, ?, ?, ?, ?)')
    .run(
      generationId,
      source.knowledgeItemId,
      source.extension,
      source.parseRevisionId,
      source.normalizationRunId,
      source.manifestSha256
    )
  database
    .prepare(`INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      generationId,
      chunkId,
      source.knowledgeItemId,
      'Packaged source',
      source.extension,
      source.parseRevisionId,
      source.normalizationRunId,
      0,
      'packaged active vector content',
      contentSha256,
      JSON.stringify(['Introduction']),
      0,
      0
    )
  database
    .prepare('INSERT INTO chunk_sources VALUES (?, ?, 0, ?, 0, ?, 1, ?, ?, NULL, 0, 34)')
    .run(
      generationId,
      chunkId,
      'block-packaged-1',
      'paragraph',
      JSON.stringify(null),
      JSON.stringify([])
    )
  database
    .prepare('INSERT INTO chunk_fts_unicode61 VALUES (?, ?, ?)')
    .run(generationId, chunkId, 'packaged active vector content')
  const chunkSetSha256 = sha256(
    JSON.stringify([{ chunkId, contentSha256, sources: ['block-packaged-1'] }])
  )
  database
    .prepare(
      `UPDATE index_generations
       SET state = 'active', chunk_set_sha256 = ?, chunk_count = 1,
           built_at = ?, activated_at = ? WHERE generation_id = ?`
    )
    .run(chunkSetSha256, new Date().toISOString(), new Date().toISOString(), generationId)

  database
    .prepare(
      `INSERT INTO embedding_generations
      VALUES (?, ?, 'building', 'local', 'packaged-test-model', 'revision-1',
              3, 'cosine', 'none', 1, ?, ?, 0, ?, NULL, NULL)`
    )
    .run(
      embeddingGenerationId,
      generationId,
      contractSha256,
      sourceSetSha256,
      new Date().toISOString()
    )
  const vectorRowid = 1n
  database
    .prepare(`INSERT INTO "${vectorTable}" (rowid, embedding) VALUES (?, ?)`)
    .run(vectorRowid, vectorBlob([1, 0, 0]))
  database
    .prepare('INSERT INTO chunk_vectors VALUES (?, ?, ?, ?)')
    .run(embeddingGenerationId, chunkId, vectorRowid, contentSha256)
  database
    .prepare(
      `UPDATE embedding_generations
       SET state = 'active', vector_count = 1, built_at = ?, activated_at = ?
     WHERE embedding_generation_id = ?`
    )
    .run(new Date().toISOString(), new Date().toISOString(), embeddingGenerationId)

  const fts = database
    .prepare(
      `SELECT chunk_id FROM chunk_fts_unicode61
        WHERE chunk_fts_unicode61 MATCH ? AND generation_id = ? LIMIT 1`
    )
    .get('packaged', generationId)
  const vector = database
    .prepare(
      `SELECT chunk_vectors.chunk_id AS chunkId, matches.distance
         FROM (SELECT rowid, distance FROM "${vectorTable}"
               WHERE embedding MATCH ? AND k = 1) AS matches
         JOIN chunk_vectors ON chunk_vectors.vector_rowid = matches.rowid
        WHERE chunk_vectors.embedding_generation_id = ?`
    )
    .get(vectorBlob([1, 0, 0]), embeddingGenerationId)
  if (fts?.chunk_id !== chunkId || vector?.chunkId !== chunkId || vector.distance !== 0) {
    throw new Error('Packaged active hybrid query returned an unexpected result')
  }
  process.stdout.write(
    `${JSON.stringify({
      packaged: true,
      activeGenerationId: generationId,
      activeEmbeddingGenerationId: embeddingGenerationId,
      ftsChunkId: fts.chunk_id,
      vectorChunkId: vector.chunkId,
      distance: vector.distance
    })}\n`
  )
} finally {
  database.close()
  await rm(root, { recursive: true, force: true })
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function vectorBlob(values) {
  return Buffer.from(new Float32Array(values).buffer)
}
