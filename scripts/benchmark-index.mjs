import { performance } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { getLoadablePath } from 'sqlite-vec'

const sizes = (process.env.WRITELLM_BENCHMARK_SIZES ?? '10000,50000,100000')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value > 0)
const dimension = Number.parseInt(process.env.WRITELLM_BENCHMARK_DIMENSION ?? '1536', 10)
if (sizes.length === 0 || !Number.isInteger(dimension) || dimension < 1) {
  throw new Error('Benchmark sizes and dimension must be positive integers')
}

const root = join(tmpdir(), `writellm-index-benchmark-${randomUUID()}`)
await mkdir(root, { recursive: true })
try {
  const results = []
  for (const chunkCount of sizes) results.push(await benchmark(chunkCount))
  const debounce = await measureGenerationBuildDebounce()
  if (debounce.persistedRebuildJobs !== 1) {
    throw new Error('Ten-file generation-build debounce did not coalesce to one durable job')
  }
  process.stdout.write(
    `${JSON.stringify({ dimension, sizes, results, debounce, generatedAt: new Date().toISOString() }, null, 2)}\n`
  )
} finally {
  await rm(root, { recursive: true, force: true })
}

async function measureGenerationBuildDebounce() {
  const path = join(root, 'generation-build-debounce.sqlite')
  const database = new Database(path)
  database.exec(`
    CREATE TABLE jobs (
      job_id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      state TEXT NOT NULL,
      deduplication_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX jobs_active_deduplication
      ON jobs(type, deduplication_key)
      WHERE deduplication_key IS NOT NULL
        AND state IN ('queued', 'running');
  `)

  const findActive = database.prepare(`
    SELECT job_id FROM jobs
     WHERE type = ? AND deduplication_key = ?
       AND state IN ('queued', 'running')
  `)
  const insertJob = database.prepare(`
    INSERT INTO jobs (
      job_id, type, payload_json, state, deduplication_key, created_at, updated_at
    ) VALUES (?, 'rebuild_index', ?, 'queued', 'index-rebuild:pending', ?, ?)
  `)
  const enqueueRebuild = database.transaction((fileIndex) => {
    if (findActive.get('rebuild_index', 'index-rebuild:pending') !== undefined) return false
    const now = new Date().toISOString()
    insertJob.run(randomUUID(), JSON.stringify({ generationId: 'requested' }), now, now)
    return fileIndex === 0
  })

  const startedAt = Date.now()
  let created = 0
  for (let fileIndex = 0; fileIndex < 10; fileIndex += 1) {
    if (enqueueRebuild(fileIndex)) created += 1
    await new Promise((resolve) => setImmediate(resolve))
  }
  const createdAt = database
    .prepare("SELECT created_at FROM jobs WHERE type = 'rebuild_index' LIMIT 1")
    .pluck()
    .get()
  if (typeof createdAt !== 'string') throw new Error('Debounce job was not persisted')
  const dueAt = Date.parse(createdAt) + 1_500
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, dueAt - Date.now())))
  const persistedRebuildJobs = database
    .prepare(
      "SELECT COUNT(*) FROM jobs WHERE type = 'rebuild_index' AND deduplication_key = 'index-rebuild:pending'"
    )
    .pluck()
    .get()
  const debounce = {
    inputFiles: 10,
    debounceMs: 1_500,
    elapsedMs: Date.now() - startedAt,
    createdRequests: created,
    deduplicatedRequests: 10 - created,
    persistedRebuildJobs,
    windowElapsed: Date.now() >= dueAt
  }
  database.close()
  return debounce
}

async function benchmark(chunkCount) {
  const path = join(root, `index-${chunkCount}.sqlite`)
  const database = new Database(path)
  database.loadExtension(getLoadablePath())
  createSchema(database)
  let peakRssBytes = process.memoryUsage().rss
  const sampleRss = () => {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss)
  }
  const buildMs = timed(() => insertRange(database, 1, chunkCount + 1))
  sampleRss()
  const incrementalUpdateMs = timed(() => {
    insertRange(database, chunkCount + 1, chunkCount + 1_000 + 1)
    deleteRange(database, 1, 1_001)
  })
  sampleRss()
  const queryTimings = measureQueries(database, chunkCount)
  sampleRss()
  const vectorTableBytes = readVectorTableBytes(database)
  checkpoint(database)
  database.close()

  const coldStart = timed(() => {
    const reopened = new Database(path, { readonly: true })
    reopened.loadExtension(getLoadablePath())
    reopened.prepare('SELECT count(*) FROM chunk_meta').pluck().get()
    reopened.close()
  })

  const rebuilt = new Database(path)
  rebuilt.loadExtension(getLoadablePath())
  const rebuildMs = timed(() => {
    rebuilt.exec(
      'DELETE FROM chunk_fts_unicode61; DELETE FROM chunk_fts_trigram; DELETE FROM chunk_meta; DELETE FROM vectors;'
    )
    insertRange(rebuilt, 1, chunkCount + 1)
  })
  checkpoint(rebuilt)
  sampleRss()
  const finalVectorTableBytes = readVectorTableBytes(rebuilt)
  rebuilt.close()

  return {
    chunkCount,
    buildMs: round(buildMs),
    incrementalUpdateMs: round(incrementalUpdateMs),
    rebuildMs: round(rebuildMs),
    coldStartOpenMs: round(coldStart),
    queryTop20P50Ms: percentile(queryTimings, 0.5),
    queryTop20P95Ms: percentile(queryTimings, 0.95),
    rssPeakBytes: peakRssBytes,
    indexFileBytes: (await stat(path)).size,
    vectorTableBytes: finalVectorTableBytes ?? vectorTableBytes
  }
}

function createSchema(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE chunk_meta (
      chunk_id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      heading_path TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      content_sha256 TEXT NOT NULL
    ) STRICT;
    CREATE VIRTUAL TABLE chunk_fts_unicode61 USING fts5(
      chunk_id UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2'
    );
    CREATE VIRTUAL TABLE chunk_fts_trigram USING fts5(
      chunk_id UNINDEXED, text, tokenize = 'trigram case_sensitive 0'
    );
    CREATE VIRTUAL TABLE vectors USING vec0(embedding float[${dimension}] distance_metric=cosine);
  `)
}

function insertRange(database, start, end) {
  const insertMeta = database.prepare(
    'INSERT INTO chunk_meta (chunk_id, source_id, heading_path, ordinal, content_sha256) VALUES (?, ?, ?, ?, ?)'
  )
  const insertUnicode = database.prepare(
    'INSERT INTO chunk_fts_unicode61 (chunk_id, text) VALUES (?, ?)'
  )
  const insertTrigram = database.prepare(
    'INSERT INTO chunk_fts_trigram (chunk_id, text) VALUES (?, ?)'
  )
  const insertVector = database.prepare('INSERT INTO vectors (rowid, embedding) VALUES (?, ?)')
  database.transaction(() => {
    for (let index = start; index < end; index += 1) {
      const chunkId = `chunk-${index}`
      const text = `Section ${index} discusses retrieval quality for bilingual research writing with representative metadata.`
      insertMeta.run(
        chunkId,
        `source-${Math.floor(index / 200)}`,
        `Chapter ${Math.floor(index / 500)}`,
        index,
        `${index.toString(16).padStart(64, '0')}`
      )
      insertUnicode.run(chunkId, text)
      insertTrigram.run(chunkId, text)
      insertVector.run(BigInt(index), vectorBlob(index))
    }
  })()
}

function deleteRange(database, start, end) {
  const deleteMeta = database.prepare('DELETE FROM chunk_meta WHERE chunk_id = ?')
  const deleteUnicode = database.prepare('DELETE FROM chunk_fts_unicode61 WHERE chunk_id = ?')
  const deleteTrigram = database.prepare('DELETE FROM chunk_fts_trigram WHERE chunk_id = ?')
  const deleteVector = database.prepare('DELETE FROM vectors WHERE rowid = ?')
  database.transaction(() => {
    for (let index = start; index < end; index += 1) {
      const chunkId = `chunk-${index}`
      deleteMeta.run(chunkId)
      deleteUnicode.run(chunkId)
      deleteTrigram.run(chunkId)
      deleteVector.run(BigInt(index))
    }
  })()
}

function measureQueries(database, chunkCount) {
  const vectorQuery = database.prepare(
    'SELECT rowid, distance FROM vectors WHERE embedding MATCH ? AND k = 20'
  )
  const ftsQuery = database.prepare(
    "SELECT chunk_id FROM chunk_fts_trigram WHERE text MATCH 'retrieval' LIMIT 20"
  )
  const timings = []
  for (let index = 0; index < 30; index += 1) {
    const started = performance.now()
    vectorQuery.all(vectorBlob(Math.max(1, chunkCount - index)))
    ftsQuery.all()
    timings.push(performance.now() - started)
  }
  return timings
}

function readVectorTableBytes(database) {
  try {
    database.exec('CREATE VIRTUAL TABLE temp.dbstat USING dbstat')
    const bytes = database
      .prepare("SELECT sum(pgsize) AS bytes FROM dbstat WHERE name LIKE 'vectors%'")
      .pluck()
      .get()
    database.exec('DROP TABLE temp.dbstat')
    return bytes ?? null
  } catch {
    return null
  }
}

function checkpoint(database) {
  database.pragma('wal_checkpoint(TRUNCATE)')
}

function timed(operation) {
  const started = performance.now()
  operation()
  return performance.now() - started
}

function vectorBlob(seed) {
  const values = Array.from({ length: dimension }, (_, index) => ((seed + index * 17) % 997) / 997)
  return Buffer.from(new Float32Array(values).buffer)
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b)
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0)
}

function round(value) {
  return Math.round(value * 100) / 100
}
