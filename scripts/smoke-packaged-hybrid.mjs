import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { access, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
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

// Checkpoint 19.7.10 backfill: drive the packaged app itself through the
// provider-failure retrieval fallback and the stale-session rejection using the
// existing env-gated dialog seams and the renderer IPC surface.
await runPackagedAppScenarios(resources)

async function runPackagedAppScenarios(resources) {
  const repoRequire = createRequire(join(process.cwd(), 'package.json'))
  const { _electron: electron } = repoRequire('@playwright/test')
  const executable = await packagedExecutable(resources)
  const root = await mkdtemp(join('/tmp', 'writellm-packaged-app-'))
  const userData = join(root, 'user-data')
  const projectsParent = join(root, 'projects')
  const sourcePath = join(root, 'packaged fallback.pdf')
  const projectName = 'Packaged fallback'
  const evidence = 'Packaged fallback evidence for hybrid retrieval'
  const zipBytes = await resultZip(evidence)
  const mineru = await startMineruServer(zipBytes)
  const embeddingsState = { requests: 0 }
  const embeddings = await startEmbeddingsServer(embeddingsState)
  const mineruUrl = `http://127.0.0.1:${mineru.address().port}`
  const embeddingsUrl = `http://127.0.0.1:${embeddings.address().port}/v1`
  let app
  try {
    await writeFile(sourcePath, '%PDF-1.7\nPackaged fallback source')
    await mkdir(projectsParent, { recursive: true })
    app = await electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${userData}`],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        WRITELLM_E2E_PROJECT_DIALOG_PATHS: JSON.stringify([projectsParent]),
        WRITELLM_E2E_KNOWLEDGE_DIALOG_PATHS: JSON.stringify([sourcePath])
      }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    await page.evaluate(
      async ({ mineruUrl: mineruBase, embeddingsUrl: embeddingsBase }) => {
        await window.desktop.providers.save({
          config: {
            role: 'mineru',
            providerId: 'mineru',
            baseUrl: mineruBase,
            model: 'pipeline',
            embeddingDimension: null,
            fileSizeLimitMb: 10,
            timeoutMs: 30_000,
            batchLimit: 25
          },
          apiKey: 'packaged-smoke-mineru'
        })
        await window.desktop.providers.save({
          config: {
            role: 'embedding',
            providerId: 'openai-compatible',
            baseUrl: embeddingsBase,
            model: 'packaged-embed',
            modelRevision: 'embed-rev-1',
            embeddingDimension: 3,
            fileSizeLimitMb: null,
            timeoutMs: 30_000,
            batchLimit: 16
          },
          apiKey: 'packaged-smoke-embedding'
        })
      },
      { mineruUrl, embeddingsUrl }
    )

    await page.getByRole('button', { name: 'Create project', exact: true }).click()
    const createDialog = page.getByRole('dialog', { name: 'Create project' })
    await createDialog.getByLabel('Project name').fill(projectName)
    await createDialog.getByRole('button', { name: 'Choose location' }).click()
    await page
      .locator('[data-slot="sidebar-header"]')
      .filter({ hasText: projectName })
      .getByText('Active', { exact: true })
      .waitFor({ timeout: 60_000 })

    await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
    await page.getByTestId('knowledge-upload-button').click()

    const projectSessionId = await pollUntil(() =>
      page.evaluate(async () => {
        const session = (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
        if (session === undefined) return null
        const items = await window.desktop.knowledge.list({ projectSessionId: session })
        const item = items.find((entry) => entry.state === 'stored')
        if (item === undefined) return null
        const parsed = await window.desktop.knowledge.parsedDocument({
          projectSessionId: session,
          knowledgeItemId: item.knowledgeItemId
        })
        return parsed.active !== null && parsed.active !== undefined ? session : null
      })
    )
    const baseline = await pollUntil(async () => {
      const result = await searchPackaged(page, projectSessionId, evidence)
      return result.mode === 'hybrid' && result.hits.some((hit) => hit.snippet.includes(evidence))
        ? result
        : null
    })
    assert(
      baseline.hits.some((hit) => hit.snippet.includes(evidence)),
      `baseline hybrid search missed the evidence chunk: ${JSON.stringify(baseline)}`
    )
    assert(baseline.mode === 'hybrid', `baseline search should be hybrid, was ${baseline.mode}`)
    assert(
      baseline.rerankStatus === 'not-configured',
      `baseline rerank status should be not-configured, was ${baseline.rerankStatus}`
    )

    // Embedding provider failure: the vector leg must degrade to FTS results.
    await closeServer(embeddings)
    const embeddingFailure = await searchPackaged(page, projectSessionId, evidence)
    assert(
      embeddingFailure.hits.some((hit) => hit.snippet.includes(evidence)),
      `embedding-failure search lost the FTS fallback hits: ${JSON.stringify(embeddingFailure)}`
    )
    assert(
      embeddingFailure.mode === 'fts',
      `embedding-failure search should fall back to fts, was ${embeddingFailure.mode}`
    )

    // Rerank provider failure: the fused ordering must still return hits.
    await page.evaluate(async () => {
      await window.desktop.providers.save({
        config: {
          role: 'rerank',
          providerId: 'cohere-compatible',
          baseUrl: 'http://127.0.0.1:1',
          model: 'packaged-rerank',
          modelRevision: 'rerank-rev-1',
          embeddingDimension: null,
          fileSizeLimitMb: null,
          timeoutMs: 5_000,
          batchLimit: 25
        },
        apiKey: 'packaged-smoke-rerank'
      })
    })
    const rerankFailure = await searchPackaged(page, projectSessionId, evidence)
    assert(
      rerankFailure.hits.some((hit) => hit.snippet.includes(evidence)),
      `rerank-failure search lost the fallback hits: ${JSON.stringify(rerankFailure)}`
    )
    assert(
      rerankFailure.rerankStatus === 'unavailable',
      `rerank-failure status should be unavailable, was ${rerankFailure.rerankStatus}`
    )
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'provider-failure-fallback',
        baselineMode: baseline.mode,
        baselineRerankStatus: baseline.rerankStatus,
        baselineHits: baseline.hits.length,
        embeddingRequestsServed: embeddingsState.requests,
        embeddingFailureMode: embeddingFailure.mode,
        embeddingFailureHits: embeddingFailure.hits.length,
        rerankFailureStatus: rerankFailure.rerankStatus,
        rerankFailureHits: rerankFailure.hits.length
      })}\n`
    )

    // Stale sessions: unknown and revoked projectSessionId values must be rejected.
    const unknownSessionSearch = await page.evaluate(async () => {
      try {
        await window.desktop.knowledge.search({
          projectSessionId: '00000000-0000-4000-8000-000000000000',
          query: 'Packaged fallback evidence',
          filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] },
          limits: { fts: 10, vector: 10, fused: 10, results: 5 },
          rerank: false
        })
        return 'accepted'
      } catch {
        return 'rejected'
      }
    })
    const closedSessionList = await page.evaluate(async (session) => {
      await window.desktop.projects.close({ projectSessionId: session })
      try {
        await window.desktop.knowledge.list({ projectSessionId: session })
        return 'accepted'
      } catch {
        return 'rejected'
      }
    }, projectSessionId)
    const lifecycleAfterClose = await page.evaluate(
      async () => (await window.desktop.projects.lifecycle()).state
    )
    assert(unknownSessionSearch === 'rejected', 'unknown projectSessionId search was not rejected')
    assert(closedSessionList === 'rejected', 'closed projectSessionId list was not rejected')
    assert(
      lifecycleAfterClose === 'closed',
      `project should be closed after the stale-session check, was ${lifecycleAfterClose}`
    )
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'stale-session',
        unknownSessionSearch,
        closedSessionList,
        lifecycleAfterClose
      })}\n`
    )
  } finally {
    if (app !== undefined) await app.close()
    await closeServer(mineru)
    await closeServer(embeddings)
    await rm(root, { recursive: true, force: true })
  }
}

async function packagedExecutable(resources) {
  if (process.platform === 'darwin') {
    const macosDirectory = join(resources, '..', 'MacOS')
    const entries = await readdir(macosDirectory)
    const executable = entries.find((entry) => !entry.startsWith('.'))
    if (executable === undefined)
      throw new Error(`No packaged executable found in ${macosDirectory}`)
    return join(macosDirectory, executable)
  }
  const appPackage = join(resources, 'app.asar', 'package.json')
  const metadata = JSON.parse(await readFile(appPackage, 'utf8'))
  const name = metadata.productName ?? metadata.name
  return join(resources, '..', process.platform === 'win32' ? `${name}.exe` : name)
}

async function searchPackaged(page, projectSessionId, query) {
  return page.evaluate(
    async (input) => {
      const { session, query: text } = input
      return window.desktop.knowledge.search({
        projectSessionId: session,
        query: text,
        filters: { knowledgeItemIds: [], fileExtensions: [], parseRevisionIds: [] },
        limits: { fts: 100, vector: 100, fused: 50, results: 20 },
        rerank: true
      })
    },
    { session: projectSessionId, query }
  )
}

async function pollUntil(probe, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await probe()
      if (value !== null && value !== undefined && value !== false) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(
    `Packaged smoke timed out waiting for a condition${lastError ? `: ${lastError.message}` : ''}`
  )
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(() => resolve()))
}

function assert(condition, message) {
  if (!condition) throw new Error(`Packaged smoke assertion failed: ${message}`)
}

function startMineruServer(zipBytes) {
  let parseTaskId = ''
  const server = createServer((request, response) => {
    const port = server.address().port
    if (request.method === 'POST' && request.url === '/api/v4/file-urls/batch') {
      const chunks = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString())
        parseTaskId = body.files[0]?.data_id ?? ''
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            code: 0,
            trace_id: 'packaged-submit-trace',
            data: {
              batch_id: 'packaged-batch-1',
              file_urls: [`http://127.0.0.1:${port}/upload?signature=private`]
            }
          })
        )
      })
      return
    }
    if (request.method === 'PUT' && request.url?.startsWith('/upload')) {
      request.resume()
      request.on('end', () => {
        response.writeHead(200)
        response.end()
      })
      return
    }
    if (
      request.method === 'GET' &&
      request.url === '/api/v4/extract-results/batch/packaged-batch-1'
    ) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(
        JSON.stringify({
          code: 0,
          trace_id: 'packaged-poll-trace',
          data: {
            batch_id: 'packaged-batch-1',
            extract_result: [
              {
                file_name: 'packaged fallback.pdf',
                data_id: parseTaskId,
                state: 'done',
                full_zip_url: `http://127.0.0.1:${port}/result.zip`
              }
            ]
          }
        })
      )
      return
    }
    if (request.method === 'GET' && request.url === '/result.zip') {
      response.writeHead(200, {
        'content-type': 'application/zip',
        'content-length': String(zipBytes.byteLength)
      })
      response.end(zipBytes)
      return
    }
    response.writeHead(404)
    response.end()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function startEmbeddingsServer(state) {
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/embeddings') {
      const chunks = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString())
        const inputs = Array.isArray(body.input) ? body.input : [body.input]
        state.requests += 1
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            object: 'list',
            data: inputs.map((value, index) => ({
              object: 'embedding',
              index,
              embedding: hashVector(String(value), 3)
            })),
            model: body.model ?? 'packaged-embed',
            usage: { prompt_tokens: inputs.length, total_tokens: inputs.length }
          })
        )
      })
      return
    }
    response.writeHead(404)
    response.end()
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function hashVector(value, dimension) {
  const digest = createHash('sha256').update(value).digest()
  return Array.from({ length: dimension }, (_, index) => (digest[index] - 128) / 128)
}

async function resultZip(evidence) {
  const { ZipFile } = createRequire(join(process.cwd(), 'package.json'))('yazl')
  const zip = new ZipFile()
  zip.addBuffer(
    Buffer.from(
      JSON.stringify([
        {
          type: 'text',
          text: evidence,
          page_idx: 0,
          bbox: [10, 20, 900, 80]
        },
        {
          type: 'image',
          img_path: 'images/figure.png',
          page_idx: 0,
          bbox: [20, 100, 800, 700]
        }
      ])
    ),
    'content_list.json'
  )
  zip.addBuffer(Buffer.from(evidence), 'full.md')
  zip.addBuffer(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64'
    ),
    'images/figure.png'
  )
  zip.end()
  const chunks = []
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
