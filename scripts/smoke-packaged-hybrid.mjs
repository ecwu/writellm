import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  utimes,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const resourcesArgument = process.argv[2]
if (resourcesArgument === undefined) throw new Error('Packaged Resources path is required')
const linuxPasswordStoreArguments = (() => {
  if (process.platform !== 'linux') return []
  const passwordStore = process.env['WRITELLM_E2E_PASSWORD_STORE']
  if (passwordStore !== 'gnome-libsecret') {
    throw new Error(
      'Linux packaged smoke requires WRITELLM_E2E_PASSWORD_STORE=gnome-libsecret and a running Secret Service'
    )
  }
  return [`--password-store=${passwordStore}`]
})()
const resources = resolve(resourcesArgument)
const appPackage = join(resources, 'app.asar', 'package.json')
await access(appPackage)
const require = createRequire(appPackage)
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

const root = await mkdtemp(join(tmpdir(), 'writellm-packaged-hybrid-'))
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
      scenario: 'native-hybrid',
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
  const root = await mkdtemp(join(tmpdir(), 'WriteLLM packaged Ünicode '))
  const userData = join(root, 'user-data')
  const projectsParent = join(root, 'projects')
  const logDirectory = join(root, 'logs')
  const expiredLog = join(logDirectory, 'retention-expired.log')
  const retainedLog = join(logDirectory, 'retention-newest.log')
  const diagnosticPath = join(root, 'writellm-diagnostics.json')
  const sourcePath = join(root, 'packaged fallback.pdf')
  const projectName = 'Packaged 回归 workspace'
  const evidence = 'Packaged fallback evidence for hybrid retrieval'
  const zipBytes = await resultZip(evidence)
  const mineru = await startMineruServer(zipBytes)
  const embeddingsState = { requests: 0 }
  const embeddings = await startEmbeddingsServer(embeddingsState)
  const agentState = { requests: 0 }
  const agent = await startAgentServer(agentState)
  const mineruUrl = `http://127.0.0.1:${mineru.address().port}`
  const embeddingsUrl = `http://127.0.0.1:${embeddings.address().port}/v1`
  const agentUrl = `http://127.0.0.1:${agent.address().port}/v1`
  let app
  try {
    await writeFile(sourcePath, '%PDF-1.7\nPackaged fallback source')
    await mkdir(projectsParent, { recursive: true })
    await mkdir(logDirectory, { recursive: true })
    await writeFile(expiredLog, '{"fixture":"expired"}\n')
    await writeFile(retainedLog, '{"fixture":"retained"}\n')
    await utimes(expiredLog, new Date(0), new Date(0))
    await utimes(retainedLog, new Date(1_000), new Date(1_000))
    app = await electron.launch({
      executablePath: executable,
      args: [
        `--user-data-dir=${userData}`,
        '--writellm-e2e-artifact-loopback',
        ...linuxPasswordStoreArguments
      ],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: undefined,
        WRITELLM_E2E_WINDOW_MODE: 'silent',
        WRITELLM_LOGGING_FIXTURE: '1',
        WRITELLM_E2E_LOG_DIRECTORY: logDirectory,
        WRITELLM_E2E_LOG_ROTATION_SIZE: '1k',
        WRITELLM_E2E_PROJECT_DIALOG_PATHS: JSON.stringify([projectsParent]),
        WRITELLM_E2E_KNOWLEDGE_DIALOG_PATHS: JSON.stringify([sourcePath])
      }
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    try {
      await page.waitForFunction(() => window.desktop?.providers !== undefined, undefined, {
        timeout: 15_000
      })
    } catch (error) {
      const diagnostics = await page.evaluate(() => ({
        url: window.location.href,
        title: document.title,
        body: document.body?.innerText.slice(0, 500) ?? '',
        desktopType: typeof window.desktop
      }))
      process.stderr.write(`${JSON.stringify({ packagedStartupDiagnostics: diagnostics })}\n`)
      throw error
    }
    await pollUntil(async () => {
      try {
        await access(expiredLog)
        return null
      } catch {
        return true
      }
    })
    await access(retainedLog)

    const credentialBackend = await page.evaluate(async () => {
      const snapshot = await window.desktop.providers.snapshot()
      return snapshot.credentialBackend
    })
    assert(
      credentialBackend.persistenceAllowed,
      `packaged loopback credentials require a secure backend, received ${JSON.stringify(credentialBackend)}`
    )
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'credential-backend',
        platform: credentialBackend.platform,
        backend: credentialBackend.backend,
        securePersistence: credentialBackend.securePersistence,
        persistenceAllowed: credentialBackend.persistenceAllowed
      })}\n`
    )

    await page.evaluate(
      async ({ mineruUrl: mineruBase, embeddingsUrl: embeddingsBase, agentUrl: agentBase }) => {
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
        await window.desktop.providers.save({
          config: {
            role: 'agent',
            providerId: 'openai-compatible',
            baseUrl: agentBase,
            model: 'packaged-agent',
            modelRevision: 'packaged-agent-v1',
            embeddingDimension: null,
            fileSizeLimitMb: null,
            timeoutMs: 30_000,
            batchLimit: 1
          },
          apiKey: 'packaged-smoke-agent'
        })
      },
      { mineruUrl, embeddingsUrl, agentUrl }
    )

    await page.getByRole('button', { name: /Start setup/u }).click()
    for (const nextHeading of [
      'Embedding API',
      'Reranking API',
      'MinerU API',
      'Create your first writing project'
    ]) {
      await page.getByRole('button', { name: /Continue|Skip for now/u }).click()
      await page.getByRole('heading', { name: nextHeading, exact: true }).waitFor()
    }
    await page.getByLabel('Project name').fill(projectName)
    await page.getByRole('button', { name: /Choose location & create/u }).click()
    await page
      .locator('[data-slot="sidebar-header"]')
      .filter({ hasText: projectName })
      .getByText('Active', { exact: true })
      .waitFor({ timeout: 60_000 })

    const durableProject = await page.evaluate(async (pngBase64) => {
      const active = (await window.desktop.projects.lifecycle()).activeProject
      if (active === null || active === undefined) throw new Error('Active project missing')
      const workspace = await window.desktop.manuscript.workspace({
        projectSessionId: active.projectSessionId
      })
      const withPackagedSection = await window.desktop.manuscript.createSection({
        projectSessionId: active.projectSessionId,
        create: {
          baseOutlineVersion: workspace.outlineVersion,
          parentSectionId: null,
          position: workspace.sections.length,
          title: 'Packaged persistence fixture',
          objective: null,
          status: 'drafting'
        }
      })
      const sectionId = withPackagedSection.sections.find(
        (entry) => entry.section.title === 'Packaged persistence fixture'
      )?.section.sectionId
      if (sectionId === undefined) throw new Error('Packaged persistence section missing')
      const loaded = await window.desktop.editor.loadSection({
        projectSessionId: active.projectSessionId,
        sectionId
      })
      const asset = await window.desktop.editor.uploadAsset({
        projectSessionId: active.projectSessionId,
        originalName: 'packaged pixel.png',
        mimeType: 'image/png',
        dataBase64: pngBase64
      })
      const saved = await window.desktop.editor.saveSectionDocument({
        projectSessionId: active.projectSessionId,
        sectionId,
        baseRevisionId: loaded.revision.sectionRevisionId,
        baseContentHash: loaded.revision.contentHash,
        document: [
          {
            id: 'packaged-paragraph',
            type: 'paragraph',
            props: {
              backgroundColor: 'default',
              textColor: 'default',
              textAlignment: 'left'
            },
            content: [{ type: 'text', text: 'Packaged schema-v5 persisted body.', styles: {} }],
            children: []
          },
          {
            id: 'packaged-image',
            type: 'image',
            props: {
              backgroundColor: 'default',
              textAlignment: 'center',
              name: 'Packaged pixel',
              url: asset.logicalUrl,
              caption: 'Packaged asset',
              showPreview: true,
              previewWidth: 320
            },
            children: []
          }
        ]
      })
      if (!saved.ok) throw new Error(saved.error.message)
      return {
        projectId: active.projectId,
        sectionId,
        assetId: asset.assetId,
        firstSessionId: active.projectSessionId
      }
    }, 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=')

    await page.getByRole('button', { name: 'Knowledge', exact: true }).click()
    await page.getByTestId('knowledge-upload-button').click()

    const importStarted = await pollUntil(
      () =>
        page.evaluate(async () => {
          const session = (await window.desktop.projects.lifecycle()).activeProject
            ?.projectSessionId
          if (session === undefined) return null
          const items = await window.desktop.knowledge.list({ projectSessionId: session })
          return items.length === 0
            ? null
            : {
                session,
                items: items.map((item) => ({
                  knowledgeItemId: item.knowledgeItemId,
                  state: item.state
                }))
              }
        }),
      30_000
    )
    process.stdout.write(
      `${JSON.stringify({ packaged: true, scenario: 'import-started', ...importStarted })}\n`
    )
    const projectSessionId = await pollUntil(() =>
      page.evaluate(async () => {
        const session = (await window.desktop.projects.lifecycle()).activeProject?.projectSessionId
        if (session === undefined) return null
        const items = await window.desktop.knowledge.list({ projectSessionId: session })
        const item = items.find((entry) => entry.state === 'stored')
        if (item === undefined) return null
        const metadata = await window.desktop.knowledge.parsedMetadata({
          projectSessionId: session,
          knowledgeItemId: item.knowledgeItemId
        })
        if (metadata.active === null) return null
        const [blocks, markdown] = await Promise.all([
          window.desktop.knowledge.parsedBlocks({
            projectSessionId: session,
            knowledgeItemId: item.knowledgeItemId,
            parseRevisionId: metadata.active.parseRevisionId,
            cursor: 0,
            limit: 100
          }),
          window.desktop.knowledge.parsedMarkdown({
            projectSessionId: session,
            knowledgeItemId: item.knowledgeItemId,
            parseRevisionId: metadata.active.parseRevisionId
          })
        ])
        return blocks.blocks.length > 0 &&
          blocks.parseRevisionId === metadata.active.parseRevisionId &&
          markdown.state === 'ready' &&
          markdown.parseRevisionId === metadata.active.parseRevisionId
          ? session
          : null
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

    const agentRun = await page.evaluate(async (session) => {
      const conversation = await window.desktop.agent.createSession({
        projectSessionId: session,
        title: 'Packaged loopback'
      })
      return window.desktop.agent.startRun({
        projectSessionId: session,
        agentSessionId: conversation.agentSessionId,
        prompt: 'Confirm the packaged Agent worker loopback.',
        scope: 'project',
        editorContext: {
          activeSectionId: null,
          activeBlockId: null,
          selectedBlockIds: []
        }
      })
    }, projectSessionId)
    const completedAgentRun = await pollUntil(() =>
      page.evaluate(
        async ({ session, agentSessionId, agentRunId }) => {
          const runs = await window.desktop.agent.listRuns({
            projectSessionId: session,
            agentSessionId,
            limit: 20
          })
          const run = runs.find((candidate) => candidate.agentRunId === agentRunId)
          return run?.status === 'completed' ? run : null
        },
        {
          session: projectSessionId,
          agentSessionId: agentRun.agentSessionId,
          agentRunId: agentRun.agentRunId
        }
      )
    )
    assert(completedAgentRun.status === 'completed', 'packaged Agent run did not complete')
    assert(agentState.requests > 0, 'packaged Agent loopback received no request')

    const processRoles = await pollUntil(() =>
      page.evaluate(async () => {
        const snapshot = await window.desktop.diagnostics.snapshot()
        const roles = [
          ...new Set(
            snapshot.map((entry) => entry.processRole).filter((role) => typeof role === 'string')
          )
        ]
        return ['main', 'agent-worker', 'background-worker', 'index-worker'].every((role) =>
          roles.includes(role)
        )
          ? roles
          : null
      })
    )
    const trustedUrl = page.url()
    const blockedFileFetch = await page.evaluate(async () => {
      try {
        await fetch('file:///private/etc/passwd')
        return false
      } catch {
        return true
      }
    })
    assert(blockedFileFetch, 'Renderer unexpectedly fetched a file URL')
    await page.evaluate(() => {
      window.location.href = 'file:///private/etc/passwd'
    })
    await new Promise((resolve) => setTimeout(resolve, 250))
    const blockedNavigation = page.url() === trustedUrl
    assert(blockedNavigation, `Renderer navigated away from ${trustedUrl} to ${page.url()}`)
    const unauthorizedIpc = await verifyUntrustedRendererIpc(
      app,
      join(resources, 'app.asar', 'out', 'preload', 'index.js')
    )
    assert(unauthorizedIpc === 'rejected', 'an untrusted Renderer invoked privileged IPC')
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'runtime-inventory',
        schemaVersion: 3,
        assetProtocol: 'writellm',
        agentRequests: agentState.requests,
        processRoles
      })}\n`
    )
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'security-boundary',
        blockedFileFetch,
        blockedNavigation,
        unauthorizedIpc
      })}\n`
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

    await page.evaluate(() => {
      for (let index = 0; index < 50; index += 1) {
        window.desktop.diagnostics.reportRendererError({
          event: 'renderer.error',
          message: `Synthetic packaged rotation entry ${index}`,
          stack: `SyntheticError: rotation ${index}\n${'x'.repeat(512)}`
        })
      }
    })
    await pollUntil(() =>
      page.evaluate(async () => {
        const snapshot = await window.desktop.diagnostics.snapshot()
        return snapshot.filter((entry) => entry.event === 'renderer.error').length >= 50
      })
    )

    const loggingEvidence = await page.evaluate(
      async ({ privateRoot, credentials, privateBody }) => {
        const snapshot = await window.desktop.diagnostics.snapshot()
        const serialized = JSON.stringify(snapshot)
        const roles = [
          ...new Set(
            snapshot.map((entry) => entry.processRole).filter((role) => typeof role === 'string')
          )
        ]
        const correlationEntries = snapshot.filter(
          (entry) =>
            typeof entry.operationId === 'string' ||
            typeof entry.jobId === 'string' ||
            typeof entry.requestId === 'string'
        )
        const errorEntries = snapshot.filter(
          (entry) =>
            entry.err !== null &&
            typeof entry.err === 'object' &&
            typeof entry.err.stack === 'string'
        )
        return {
          entries: snapshot.length,
          roles,
          correlationEntries: correlationEntries.length,
          errorEntries: errorEntries.length,
          leaksPrivateRoot: serialized.includes(privateRoot),
          leaksCredential: credentials.some((credential) => serialized.includes(credential)),
          leaksPrivateBody: serialized.includes(privateBody)
        }
      },
      {
        privateRoot: root,
        credentials: [
          'packaged-smoke-mineru',
          'packaged-smoke-embedding',
          'packaged-smoke-agent',
          'packaged-smoke-rerank'
        ],
        privateBody: 'Packaged schema-v2 persisted body.'
      }
    )
    assert(loggingEvidence.correlationEntries > 0, 'packaged logs contain no correlation context')
    assert(loggingEvidence.errorEntries > 0, 'packaged failure logs preserved no Error stack')
    assert(!loggingEvidence.leaksPrivateRoot, 'packaged diagnostics leaked a private path')
    assert(!loggingEvidence.leaksCredential, 'packaged diagnostics leaked a credential')
    assert(!loggingEvidence.leaksPrivateBody, 'packaged diagnostics leaked document content')
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'logging-boundary',
        ...loggingEvidence
      })}\n`
    )

    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
    }, diagnosticPath)
    const diagnosticExport = await page.evaluate(() => window.desktop.diagnostics.exportBundle())
    assert(diagnosticExport.exported, 'packaged diagnostic export was cancelled')
    const diagnosticBytes = await readFile(diagnosticPath)
    const diagnosticBundle = JSON.parse(diagnosticBytes.toString('utf8'))
    const diagnosticText = diagnosticBytes.toString('utf8')
    const diagnosticMode = (await stat(diagnosticPath)).mode & 0o777
    assert(Array.isArray(diagnosticBundle.logs), 'packaged diagnostic export has no log array')
    assert(diagnosticBundle.logs.length <= 5_000, 'packaged diagnostic export exceeded its bound')
    assert(
      diagnosticBytes.byteLength < 3 * 1_024 * 1_024,
      'packaged diagnostic export is unbounded'
    )
    assert(!diagnosticText.includes(root), 'packaged diagnostic export leaked a private path')
    assert(
      !diagnosticText.includes('packaged-smoke-agent'),
      'packaged diagnostic export leaked a credential'
    )
    if (process.platform !== 'win32') {
      assert(diagnosticMode === 0o600, `diagnostic export mode was ${diagnosticMode.toString(8)}`)
    }
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'diagnostic-export',
        entries: diagnosticBundle.logs.length,
        bytes: diagnosticBytes.byteLength,
        mode: process.platform === 'win32' ? 'platform-managed' : diagnosticMode.toString(8)
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
    const reopenResult = await page.evaluate(
      async ({ projectId, firstSessionId, sectionId, assetId }) => {
        try {
          await window.desktop.projects.close({ projectSessionId: firstSessionId })
        } catch (cause) {
          const diagnostics = await window.desktop.diagnostics.snapshot()
          return {
            closeError: cause instanceof Error ? cause.message : String(cause),
            diagnostics: diagnostics
              .filter((entry) => entry.level === 'error' || entry.level === 'fatal')
              .slice(-10)
          }
        }
        let firstSessionAccess = 'accepted'
        try {
          await window.desktop.knowledge.list({ projectSessionId: firstSessionId })
        } catch {
          firstSessionAccess = 'rejected'
        }
        const reopened = await window.desktop.projects.openRecent({ projectId })
        const active = reopened.project
        if (active === null || active === undefined) throw new Error('Reopened project missing')
        const loaded = await window.desktop.editor.loadSection({
          projectSessionId: active.projectSessionId,
          sectionId
        })
        if (
          loaded.revision.contentSchemaVersion !== 5 ||
          !JSON.stringify(loaded.revision.content).includes('Packaged schema-v5 persisted body.')
        ) {
          throw new Error('Schema-v5 content did not survive packaged reopen')
        }
        const resolved = await window.desktop.editor.resolveAsset({
          projectSessionId: active.projectSessionId,
          assetId
        })
        if (!resolved.url.startsWith('writellm://')) {
          throw new Error('Packaged asset did not resolve through the application protocol')
        }
        return {
          closeError: null,
          firstSessionAccess,
          reopenedSessionId: active.projectSessionId,
          lifecycle: (await window.desktop.projects.lifecycle()).state
        }
      },
      durableProject
    )
    if (reopenResult.closeError !== null) {
      throw new Error(`Packaged close failed: ${JSON.stringify(reopenResult)}`)
    }
    assert(unknownSessionSearch === 'rejected', 'unknown projectSessionId search was not rejected')
    assert(
      reopenResult.firstSessionAccess === 'rejected',
      'closed project session was not rejected'
    )
    assert(
      reopenResult.lifecycle === 'open',
      `project should be open after packaged reopen, was ${reopenResult.lifecycle}`
    )
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'stale-session',
        unknownSessionSearch,
        closedSessionList: reopenResult.firstSessionAccess,
        reopenedSessionId: reopenResult.reopenedSessionId,
        lifecycleAfterReopen: reopenResult.lifecycle
      })}\n`
    )
    await app.close()
    app = undefined
    await verifyPackagedLogFiles({
      logDirectory,
      expiredLog,
      retainedLog,
      privateRoot: root
    })
    verifyPackagedAppDatabase(Database, join(userData, 'app.sqlite'))
    if (process.platform === 'linux') {
      await verifyLinuxBasicTextRejection(electron, executable, root)
    }
    await verifyFatalLogFlush(electron, executable, root)
  } finally {
    if (app !== undefined) await app.close()
    await closeServer(mineru)
    await closeServer(embeddings)
    await closeServer(agent)
    await rm(root, { recursive: true, force: true })
  }
}

async function verifyPackagedLogFiles({ logDirectory, expiredLog, retainedLog, privateRoot }) {
  try {
    await access(expiredLog)
    throw new Error('expired packaged log survived retention cleanup')
  } catch (error) {
    if (error instanceof Error && error.message.includes('survived')) throw error
  }
  await access(retainedLog)
  const logs = await pollUntil(async () => {
    const entries = (await readdir(logDirectory)).filter((name) => name.endsWith('.log'))
    return entries.length > 2 ? entries : null
  })
  const contents = (
    await Promise.all(logs.map((name) => readFile(join(logDirectory, name), 'utf8')))
  ).join('\n')
  assert(contents.includes('"event":"app.stopping"'), 'shutdown log flush omitted app.stopping')
  assert(!contents.includes(privateRoot), 'packaged log files leaked a private path')
  assert(!contents.includes('packaged-smoke-agent'), 'packaged log files leaked a credential')
  process.stdout.write(
    `${JSON.stringify({
      packaged: true,
      scenario: 'log-files',
      files: logs.length,
      rotation: 'verified',
      retention: 'verified',
      shutdownFlush: 'verified'
    })}\n`
  )
}

async function verifyFatalLogFlush(electron, executable, root) {
  const userData = join(root, 'fatal-user-data')
  const logDirectory = join(root, 'fatal-logs')
  const app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      WRITELLM_E2E_WINDOW_MODE: 'silent',
      WRITELLM_E2E_LOG_DIRECTORY: logDirectory
    }
  })
  let closed = false
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const close = app.waitForEvent('close').then(() => {
      closed = true
    })
    await app.evaluate(() => {
      setTimeout(() => {
        process.emit('uncaughtException', new Error('synthetic packaged fatal fixture'))
      }, 0)
    })
    await Promise.race([
      close,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('fatal packaged app did not exit')), 10_000)
      )
    ])
    const fatalText = await pollUntil(async () => {
      const entries = (await readdir(logDirectory)).filter((name) => name.endsWith('.log'))
      const text = (
        await Promise.all(entries.map((name) => readFile(join(logDirectory, name), 'utf8')))
      ).join('\n')
      return text.includes('"event":"app.uncaught_exception"') ? text : null
    })
    assert(
      fatalText.includes('synthetic packaged fatal fixture'),
      'fatal Error stack was not flushed'
    )
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'fatal-log-flush',
        event: 'app.uncaught_exception',
        originalError: 'verified'
      })}\n`
    )
  } finally {
    if (!closed) await app.close()
  }
}

async function verifyUntrustedRendererIpc(app, preload) {
  return app.evaluate(async ({ BrowserWindow }, preloadPath) => {
    const window = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })
    try {
      await window.loadURL('data:text/html,<title>untrusted</title>')
      return await window.webContents.executeJavaScript(
        `window.desktop.app.getInfo().then(() => 'accepted', () => 'rejected')`
      )
    } finally {
      window.destroy()
    }
  }, preload)
}

async function verifyLinuxBasicTextRejection(electron, executable, root) {
  const userData = join(root, 'linux-basic-text-user-data')
  const app = await electron.launch({
    executablePath: executable,
    args: [`--user-data-dir=${userData}`, '--password-store=basic'],
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      WRITELLM_E2E_WINDOW_MODE: 'silent'
    }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const result = await page.evaluate(async () => {
      const backend = (await window.desktop.providers.snapshot()).credentialBackend
      let persistence = 'accepted'
      try {
        await window.desktop.providers.save({
          config: {
            role: 'agent',
            providerId: 'openai-compatible',
            baseUrl: 'http://127.0.0.1:1/v1',
            model: 'must-not-persist',
            modelRevision: 'must-not-persist-v1',
            embeddingDimension: null,
            fileSizeLimitMb: null,
            timeoutMs: 5_000,
            batchLimit: 1
          },
          apiKey: 'must-not-persist'
        })
      } catch {
        persistence = 'rejected'
      }
      return { backend, persistence }
    })
    assert(result.backend.backend === 'basic_text', 'Linux basic store was not reported truthfully')
    assert(
      !result.backend.persistenceAllowed && result.persistence === 'rejected',
      'Linux basic_text credential persistence was not rejected'
    )
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'linux-basic-text-rejection',
        backend: result.backend.backend,
        securePersistence: result.backend.securePersistence,
        persistence: result.persistence
      })}\n`
    )
  } finally {
    await app.close()
  }
}

function verifyPackagedAppDatabase(Database, path) {
  const appDatabase = new Database(path, { readonly: true, fileMustExist: true })
  try {
    const applicationId = appDatabase.pragma('application_id', { simple: true })
    const userVersion = appDatabase.pragma('user_version', { simple: true })
    const integrity = appDatabase.pragma('integrity_check', { simple: true })
    assert(applicationId === 0x574c4150, `unexpected app.sqlite application ID ${applicationId}`)
    assert(Number(userVersion) > 0, `app.sqlite user_version was ${userVersion}`)
    assert(integrity === 'ok', `app.sqlite integrity_check returned ${integrity}`)
    process.stdout.write(
      `${JSON.stringify({
        packaged: true,
        scenario: 'app-database',
        applicationId,
        userVersion,
        integrity
      })}\n`
    )
  } finally {
    appDatabase.close()
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

function startAgentServer(state) {
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/v1/chat/completions') {
      request.resume()
      request.on('end', () => {
        state.requests += 1
        response.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-request-id': 'packaged-agent-loopback'
        })
        response.write(
          `data: ${JSON.stringify({
            id: 'packaged-agent-loopback',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'packaged-agent',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'Packaged Agent worker completed.' },
                finish_reason: null
              }
            ]
          })}\n\n`
        )
        response.write(
          `data: ${JSON.stringify({
            id: 'packaged-agent-loopback',
            object: 'chat.completion.chunk',
            created: 1,
            model: 'packaged-agent',
            choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13 }
          })}\n\n`
        )
        response.end('data: [DONE]\n\n')
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
