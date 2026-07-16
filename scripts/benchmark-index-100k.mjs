import { performance } from 'node:perf_hooks'
import Database from 'better-sqlite3'
import { getLoadablePath } from 'sqlite-vec'

const chunkCount = 100_000
const dimension = 8
const database = new Database(':memory:')
database.loadExtension(getLoadablePath())
database.exec(`
  CREATE VIRTUAL TABLE chunk_fts_unicode61 USING fts5(
    chunk_id UNINDEXED, text, tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE VIRTUAL TABLE chunk_fts_trigram USING fts5(
    chunk_id UNINDEXED, text, tokenize = 'trigram case_sensitive 0'
  );
  CREATE VIRTUAL TABLE vectors USING vec0(embedding float[${dimension}] distance_metric=cosine);
`)

const insertUnicode = database.prepare(
  'INSERT INTO chunk_fts_unicode61 (chunk_id, text) VALUES (?, ?)'
)
const insertTrigram = database.prepare(
  'INSERT INTO chunk_fts_trigram (chunk_id, text) VALUES (?, ?)'
)
const insertVector = database.prepare('INSERT INTO vectors (rowid, embedding) VALUES (?, ?)')
const started = performance.now()
database.transaction(() => {
  for (let index = 1; index <= chunkCount; index += 1) {
    const text = `Section ${index} representative English retrieval passage 人工智能写作第${index}段`
    insertUnicode.run(`chunk-${index}`, text)
    insertTrigram.run(`chunk-${index}`, text)
    insertVector.run(BigInt(index), vectorBlob(index))
  }
})()
const buildMs = performance.now() - started

const timings = {
  englishTrigramMs: timed(() =>
    database
      .prepare("SELECT count(*) FROM chunk_fts_trigram WHERE text MATCH 'retrieval'")
      .pluck()
      .get()
  ),
  chineseUnicodeMs: timed(() =>
    database
      .prepare("SELECT count(*) FROM chunk_fts_unicode61 WHERE text MATCH '人工智能写作第50000段'")
      .pluck()
      .get()
  ),
  shortUnicodeMs: timed(() =>
    database
      .prepare("SELECT count(*) FROM chunk_fts_unicode61 WHERE text MATCH '人工*'")
      .pluck()
      .get()
  ),
  vectorTop20Ms: timed(() =>
    database
      .prepare('SELECT rowid, distance FROM vectors WHERE embedding MATCH ? AND k = 20')
      .all(vectorBlob(50_000))
  )
}

process.stdout.write(
  `${JSON.stringify({ chunkCount, dimension, buildMs: round(buildMs), ...timings }, null, 2)}\n`
)
database.close()

function timed(operation) {
  const startedAt = performance.now()
  operation()
  return round(performance.now() - startedAt)
}

function vectorBlob(seed) {
  const values = Array.from({ length: dimension }, (_, index) => ((seed + index * 17) % 997) / 997)
  return Buffer.from(new Float32Array(values).buffer)
}

function round(value) {
  return Math.round(value * 100) / 100
}
