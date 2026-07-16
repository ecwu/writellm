import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'

const resources = resolve(process.argv[2] ?? '')
if (resources.length === 0) throw new Error('Packaged Resources path is required')
const require = createRequire(join(resources, 'app.asar', 'package.json'))
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

const database = new Database(':memory:')
database.loadExtension(extension)
database.exec(
  'CREATE VIRTUAL TABLE smoke_vectors USING vec0(embedding float[3] distance_metric=cosine)'
)
database
  .prepare('INSERT INTO smoke_vectors (rowid, embedding) VALUES (?, ?)')
  .run(1n, vectorBlob([1, 0, 0]))
const result = database
  .prepare('SELECT rowid, distance FROM smoke_vectors WHERE embedding MATCH ? AND k = 1')
  .get(vectorBlob([1, 0, 0]))
if (result?.rowid !== 1 || result.distance !== 0) {
  throw new Error('Packaged sqlite-vec query returned an unexpected result')
}
database.close()
process.stdout.write(
  `${JSON.stringify({ extensionLoaded: true, rowid: result.rowid, distance: result.distance })}\n`
)

function vectorBlob(values) {
  return Buffer.from(new Float32Array(values).buffer)
}
