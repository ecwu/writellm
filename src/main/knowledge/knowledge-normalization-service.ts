import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import {
  normalizedKnowledgeBlockSchema,
  normalizedKnowledgeManifestSchema,
  parsedKnowledgeAssetSchema,
  parsedKnowledgeDocumentSchema,
  type NormalizedKnowledgeManifest,
  type ParsedKnowledgeDocument
} from '../../shared/contracts/knowledge'
import { mineruRawManifestSchema } from '../../shared/contracts/mineru'
import type { JobHandlerContext, JobHandlerRegistry } from '../jobs/scheduler/job-handler-registry'
import type { JobStore } from '../jobs/job-store'
import type { NormalizationRunTable, ParseRevisionTable } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { resolveProjectPath } from '../project/project-paths'
import type { MineruGateway, MineruNormalizedResult } from './mineru-gateway'

const MAX_ASSET_BYTES = 10 * 1024 * 1024

export class KnowledgeNormalizationService {
  readonly #projectRoot: string
  readonly #projectId: string
  readonly #database: ProjectDatabase
  readonly #log: Pick<Logger, 'info' | 'error'>
  readonly #normalizerVersion: number
  readonly #now: () => Date
  readonly #createId: () => string
  readonly #normalizeInUtility: MineruGateway['normalize']
  readonly #jobs?: JobStore

  constructor(options: {
    projectRoot: string
    projectId: string
    database: ProjectDatabase
    log: Pick<Logger, 'info' | 'error'>
    normalizerVersion?: number
    now?: () => Date
    createId?: () => string
    normalizeInUtility: MineruGateway['normalize']
    jobs?: JobStore
  }) {
    this.#projectRoot = options.projectRoot
    this.#projectId = options.projectId
    this.#database = options.database
    this.#log = options.log
    this.#normalizerVersion = options.normalizerVersion ?? 1
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
    this.#normalizeInUtility = options.normalizeInUtility
    this.#jobs = options.jobs
  }

  async handle(context: JobHandlerContext): Promise<void> {
    const parseRevisionId = context.job.payload.parseRevisionId
    if (typeof parseRevisionId !== 'string') throw new Error('Normalization job payload is invalid')
    await this.normalize(parseRevisionId, context.signal)
  }

  async detail(knowledgeItemId: string): Promise<ParsedKnowledgeDocument> {
    const snapshot = this.#database.immediate((database) => {
      const latest = database
        .prepare(
          `SELECT state FROM parse_tasks WHERE knowledge_item_id = ?
            ORDER BY created_at DESC, parse_task_id DESC LIMIT 1`
        )
        .get(knowledgeItemId) as { state: string } | undefined
      const normalization = database
        .prepare(
          `SELECT state FROM normalization_runs
            WHERE knowledge_item_id = ?
            ORDER BY created_at DESC, normalization_run_id DESC LIMIT 1`
        )
        .get(knowledgeItemId) as { state: 'staging' | 'published' | 'failed' } | undefined
      const active = database
        .prepare(
          `SELECT active_parse_revisions.activated_at, parse_revisions.*,
                  normalization_runs.normalization_run_id,
                  normalization_runs.normalizer_version,
                  normalization_runs.relative_path AS normalization_relative_path,
                  normalization_runs.manifest_sha256 AS normalization_manifest_sha256
             FROM active_parse_revisions
             JOIN parse_revisions USING (parse_revision_id)
             JOIN normalization_runs USING (normalization_run_id)
            WHERE active_parse_revisions.knowledge_item_id = ?
              AND normalization_runs.state = 'published'`
        )
        .get(knowledgeItemId) as
        | (ParseRevisionTable & {
            activated_at: string
            normalization_run_id: string
            normalizer_version: number
            normalization_relative_path: string
            normalization_manifest_sha256: string
          })
        | undefined
      return { latest, normalization, active }
    })
    if (snapshot.active === undefined) {
      return parsedKnowledgeDocumentSchema.parse({
        knowledgeItemId,
        parseState: snapshot.latest?.state ?? null,
        normalizationState: snapshot.normalization?.state ?? null,
        active: null
      })
    }
    const root = resolveProjectPath(this.#projectRoot, snapshot.active.normalization_relative_path)
    const manifestBytes = await readBounded(`${root}/manifest.json`, 10 * 1024 * 1024)
    if (sha256(manifestBytes) !== snapshot.active.normalization_manifest_sha256) {
      throw new Error('Active normalization manifest hash does not match')
    }
    const manifest = normalizedKnowledgeManifestSchema.parse(
      JSON.parse(manifestBytes.toString('utf8'))
    )
    const blockBytes = await readBounded(`${root}/blocks.jsonl`, 200 * 1024 * 1024)
    const documentBytes = await readBounded(`${root}/document.md`, 20 * 1024 * 1024)
    if (
      sha256(blockBytes) !== manifest.blocks.sha256 ||
      sha256(documentBytes) !== manifest.document.sha256
    ) {
      throw new Error('Active normalized document hash does not match')
    }
    const blocks = blockBytes
      .toString('utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => normalizedKnowledgeBlockSchema.parse(JSON.parse(line)))
    if (blocks.length !== manifest.blocks.count) {
      throw new Error('Active normalized block count does not match')
    }
    return parsedKnowledgeDocumentSchema.parse({
      knowledgeItemId,
      parseState: snapshot.latest?.state ?? null,
      normalizationState: snapshot.normalization?.state ?? null,
      active: {
        parseRevisionId: snapshot.active.parse_revision_id,
        normalizationRunId: snapshot.active.normalization_run_id,
        normalizerVersion: snapshot.active.normalizer_version,
        sourceSha256: snapshot.active.source_sha256,
        remoteTaskId: snapshot.active.remote_task_id,
        providerId: snapshot.active.provider_id,
        modelVersion: snapshot.active.model_version,
        documentMarkdown: documentBytes.toString('utf8'),
        blocks,
        activatedAt: snapshot.active.activated_at
      }
    })
  }

  async asset(
    knowledgeItemId: string,
    parseRevisionId: string,
    assetRef: string
  ): Promise<{ mimeType: string; dataBase64: string }> {
    const row = this.#database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT normalization_runs.relative_path, normalization_runs.manifest_sha256
               FROM parse_revisions
               JOIN normalization_runs USING (parse_revision_id, knowledge_item_id)
              WHERE parse_revisions.knowledge_item_id = ?
                AND parse_revisions.parse_revision_id = ?
                AND normalization_runs.state = 'published'`
          )
          .get(knowledgeItemId, parseRevisionId) as
          | { relative_path: string; manifest_sha256: string }
          | undefined
    )
    if (row === undefined) throw new Error('Active parsed document is unavailable')
    const root = resolveProjectPath(this.#projectRoot, row.relative_path)
    const manifestBytes = await readBounded(`${root}/manifest.json`, 10 * 1024 * 1024)
    if (sha256(manifestBytes) !== row.manifest_sha256) {
      throw new Error('Active normalization manifest hash does not match')
    }
    const manifest = normalizedKnowledgeManifestSchema.parse(
      JSON.parse(manifestBytes.toString('utf8'))
    )
    const record =
      manifest.assets.find((asset) => asset.relativePath === assetRef) ??
      manifest.assets.find((asset) => asset.sourceRelativePath === `raw/extracted/${assetRef}`)
    if (record === undefined) throw new Error('Parsed asset is not in the active manifest')
    const bytes = await readBounded(`${root}/${record.relativePath}`, MAX_ASSET_BYTES)
    if (sha256(bytes) !== record.sha256) throw new Error('Parsed asset hash does not match')
    return parsedKnowledgeAssetSchema.parse({
      mimeType: record.mimeType,
      dataBase64: bytes.toString('base64')
    })
  }

  async normalize(parseRevisionId: string, signal: AbortSignal): Promise<string> {
    const startedAt = Date.now()
    const revision = this.#readRevision(parseRevisionId)
    if (revision.state !== 'raw_published' || revision.manifest_sha256 === null) {
      throw new Error('Raw parse revision is not ready for normalization')
    }
    const rawRoot = resolveProjectPath(this.#projectRoot, revision.relative_path)
    const rawManifestBytes = await readBounded(`${rawRoot}/manifest.json`, 10 * 1024 * 1024)
    const rawManifestHash = sha256(rawManifestBytes)
    if (rawManifestHash !== revision.manifest_sha256) {
      throw new Error('Raw parse manifest hash does not match the database')
    }
    const rawManifest = mineruRawManifestSchema.parse(JSON.parse(rawManifestBytes.toString('utf8')))
    if (
      rawManifest.parseRevisionId !== revision.parse_revision_id ||
      rawManifest.sourceSha256 !== revision.source_sha256
    ) {
      throw new Error('Raw parse manifest provenance does not match the revision')
    }
    const run = this.#ensureRun(revision, rawManifestHash)
    const finalRelativePath = run.relative_path
    const finalPath = resolveProjectPath(this.#projectRoot, finalRelativePath)
    if (await this.#reconcile(finalPath, run, revision)) {
      this.#requestIndex(revision.knowledge_item_id, run.normalization_run_id)
      return run.normalization_run_id
    }

    const stagingPath = resolveProjectPath(
      this.#projectRoot,
      `.writellm/temp/normalization/${run.normalization_run_id}.staging`
    )
    await rm(stagingPath, { recursive: true, force: true })
    await mkdir(`${stagingPath}/images`, { recursive: true })
    try {
      const normalized = await this.#normalizeInUtility(
        {
          rawRoot,
          stagingPath,
          parseRevisionId: revision.parse_revision_id,
          normalizerVersion: this.#normalizerVersion,
          files: rawManifest.files
        },
        signal
      )
      await verifyUtilityOutput(stagingPath, normalized)
      const manifest: NormalizedKnowledgeManifest = {
        schemaVersion: 1,
        normalizerVersion: this.#normalizerVersion,
        normalizationRunId: run.normalization_run_id,
        parseRevisionId: revision.parse_revision_id,
        knowledgeItemId: revision.knowledge_item_id,
        sourceSha256: revision.source_sha256,
        sourceManifestSha256: rawManifestHash,
        blocks: {
          relativePath: 'blocks.jsonl',
          sha256: normalized.blocksSha256,
          count: normalized.blockCount
        },
        document: { relativePath: 'document.md', sha256: normalized.documentSha256 },
        assets: normalized.assets,
        createdAt: this.#now().toISOString()
      }
      const manifestBytes = Buffer.from(
        `${JSON.stringify(normalizedKnowledgeManifestSchema.parse(manifest))}\n`
      )
      await writeDurable(`${stagingPath}/manifest.json`, manifestBytes)
      await mkdir(dirname(finalPath), { recursive: true })
      await rename(stagingPath, finalPath)
      this.#activate(run, revision, manifest, sha256(manifestBytes))
      this.#requestIndex(revision.knowledge_item_id, run.normalization_run_id)
      this.#log.info(
        {
          event: 'knowledge.normalization.completed',
          projectId: this.#projectId,
          knowledgeItemId: revision.knowledge_item_id,
          parseRevisionId,
          normalizationRunId: run.normalization_run_id,
          normalizerVersion: this.#normalizerVersion,
          blockCount: normalized.blockCount,
          assetCount: normalized.assets.length,
          durationMs: Date.now() - startedAt
        },
        'Knowledge parse revision normalized and activated'
      )
      return run.normalization_run_id
    } catch (err) {
      try {
        await rm(stagingPath, { recursive: true, force: true })
      } catch (cleanupErr) {
        this.#log.error(
          {
            event: 'knowledge.normalization.cleanup_failed',
            err: cleanupErr,
            projectId: this.#projectId,
            knowledgeItemId: revision.knowledge_item_id,
            parseRevisionId,
            normalizationRunId: run.normalization_run_id
          },
          'Failed to clean normalization staging directory'
        )
      }
      const now = this.#now().toISOString()
      this.#database.immediate((database) => {
        database
          .prepare(
            `UPDATE normalization_runs SET state = 'failed', error_code = 'normalization_failed',
                    updated_at = ? WHERE normalization_run_id = ? AND state <> 'published'`
          )
          .run(now, run.normalization_run_id)
      })
      this.#log.error(
        {
          event: 'knowledge.normalization.failed',
          err,
          projectId: this.#projectId,
          knowledgeItemId: revision.knowledge_item_id,
          parseRevisionId,
          normalizationRunId: run.normalization_run_id,
          normalizerVersion: this.#normalizerVersion,
          durationMs: Date.now() - startedAt
        },
        'Knowledge normalization failed'
      )
      throw new Error('Knowledge normalization failed', { cause: err })
    }
  }

  #readRevision(parseRevisionId: string): ParseRevisionTable {
    const row = this.#database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM parse_revisions WHERE parse_revision_id = ?')
          .get(parseRevisionId) as ParseRevisionTable | undefined
    )
    if (row === undefined) throw new Error('Parse revision is missing')
    return row
  }

  #ensureRun(revision: ParseRevisionTable, sourceManifestHash: string): NormalizationRunTable {
    return this.#database.immediate((database) => {
      const existing = database
        .prepare(
          'SELECT * FROM normalization_runs WHERE parse_revision_id = ? AND normalizer_version = ?'
        )
        .get(revision.parse_revision_id, this.#normalizerVersion) as
        | NormalizationRunTable
        | undefined
      if (existing !== undefined) {
        if (existing.source_manifest_sha256 !== sourceManifestHash) {
          throw new Error('Normalization input manifest changed unexpectedly')
        }
        if (existing.state === 'failed') {
          database
            .prepare(
              "UPDATE normalization_runs SET state = 'staging', error_code = NULL, updated_at = ? WHERE normalization_run_id = ?"
            )
            .run(this.#now().toISOString(), existing.normalization_run_id)
          return { ...existing, state: 'staging', error_code: null }
        }
        return existing
      }
      const id = this.#createId()
      const now = this.#now().toISOString()
      const relativePath = `${revision.relative_path}/normalization/v${this.#normalizerVersion}`
      database
        .prepare(
          `INSERT INTO normalization_runs (
             normalization_run_id, parse_revision_id, knowledge_item_id, normalizer_version,
             state, relative_path, source_manifest_sha256, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'staging', ?, ?, ?, ?)`
        )
        .run(
          id,
          revision.parse_revision_id,
          revision.knowledge_item_id,
          this.#normalizerVersion,
          relativePath,
          sourceManifestHash,
          now,
          now
        )
      return database
        .prepare('SELECT * FROM normalization_runs WHERE normalization_run_id = ?')
        .get(id) as NormalizationRunTable
    })
  }

  async #reconcile(
    finalPath: string,
    run: NormalizationRunTable,
    revision: ParseRevisionTable
  ): Promise<boolean> {
    try {
      const bytes = await readBounded(`${finalPath}/manifest.json`, 10 * 1024 * 1024)
      const manifest = normalizedKnowledgeManifestSchema.parse(JSON.parse(bytes.toString('utf8')))
      if (
        manifest.normalizationRunId !== run.normalization_run_id ||
        manifest.parseRevisionId !== revision.parse_revision_id ||
        manifest.normalizerVersion !== this.#normalizerVersion
      ) {
        throw new Error('Published normalization provenance does not match')
      }
      await verifyPublished(finalPath, manifest)
      this.#activate(run, revision, manifest, sha256(bytes))
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw err
    }
  }

  #activate(
    run: NormalizationRunTable,
    revision: ParseRevisionTable,
    manifest: NormalizedKnowledgeManifest,
    manifestHash: string
  ): void {
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      database
        .prepare(
          `UPDATE normalization_runs SET state = 'published', blocks_sha256 = ?,
                  document_sha256 = ?, manifest_sha256 = ?, block_count = ?, asset_count = ?,
                  error_code = NULL, published_at = COALESCE(published_at, ?), updated_at = ?
            WHERE normalization_run_id = ?`
        )
        .run(
          manifest.blocks.sha256,
          manifest.document.sha256,
          manifestHash,
          manifest.blocks.count,
          manifest.assets.length,
          now,
          now,
          run.normalization_run_id
        )
      const active = database
        .prepare(
          `SELECT parse_revisions.revision_number
             FROM active_parse_revisions
             JOIN parse_revisions USING (parse_revision_id)
            WHERE active_parse_revisions.knowledge_item_id = ?`
        )
        .get(revision.knowledge_item_id) as { revision_number: number } | undefined
      if (active !== undefined && active.revision_number > revision.revision_number) return
      database
        .prepare(
          `INSERT INTO active_parse_revisions (
             knowledge_item_id, parse_revision_id, normalization_run_id, activated_at, updated_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(knowledge_item_id) DO UPDATE SET
             parse_revision_id = excluded.parse_revision_id,
             normalization_run_id = excluded.normalization_run_id,
             activated_at = excluded.activated_at,
             updated_at = excluded.updated_at`
        )
        .run(
          revision.knowledge_item_id,
          revision.parse_revision_id,
          run.normalization_run_id,
          now,
          now
        )
    })
  }

  #requestIndex(knowledgeItemId: string, normalizationRunId: string): void {
    this.#jobs?.enqueue({
      type: 'index.item-upsert',
      payload: { knowledgeItemId },
      deduplicationKey: `index-upsert:${normalizationRunId}`,
      maxAttempts: 8
    })
  }
}

export function registerNormalizationHandler(
  registry: JobHandlerRegistry,
  service: KnowledgeNormalizationService
): void {
  registry.register('mineru.normalize', (context) => service.handle(context), {
    timeoutMs: 10 * 60_000,
    leaseMs: 60_000,
    heartbeatMs: 15_000,
    closePolicy: 'abort-and-requeue'
  })
}

async function verifyPublished(path: string, manifest: NormalizedKnowledgeManifest): Promise<void> {
  await verifyUtilityOutput(path, {
    blocksSha256: manifest.blocks.sha256,
    documentSha256: manifest.document.sha256,
    blockCount: manifest.blocks.count,
    assets: manifest.assets
  })
}

async function verifyUtilityOutput(path: string, output: MineruNormalizedResult): Promise<void> {
  const rootEntries = await readdir(path, { withFileTypes: true })
  const rootNames = new Set(rootEntries.map((entry) => entry.name))
  if (
    rootEntries.some((entry) => entry.isSymbolicLink()) ||
    !rootNames.has('blocks.jsonl') ||
    !rootNames.has('document.md') ||
    !rootNames.has('images') ||
    [...rootNames].some((name) => !['blocks.jsonl', 'document.md', 'images'].includes(name))
  ) {
    throw new Error('Normalizer staging layout is invalid')
  }
  const imageEntries = await readdir(`${path}/images`, { withFileTypes: true })
  if (imageEntries.some((entry) => !entry.isFile() || entry.isSymbolicLink())) {
    throw new Error('Normalizer image layout is invalid')
  }
  const expectedImages = new Set(output.assets.map((asset) => asset.relativePath.slice(7)))
  if (
    imageEntries.length !== expectedImages.size ||
    imageEntries.some((entry) => !expectedImages.has(entry.name))
  ) {
    throw new Error('Normalizer image inventory does not match its output')
  }
  const blocks = await readBounded(`${path}/blocks.jsonl`, 200 * 1024 * 1024)
  const document = await readBounded(`${path}/document.md`, 200 * 1024 * 1024)
  if (sha256(blocks) !== output.blocksSha256 || sha256(document) !== output.documentSha256) {
    throw new Error('Normalized content hash does not match the utility response')
  }
  const parsedBlocks = blocks
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => normalizedKnowledgeBlockSchema.parse(JSON.parse(line)))
  if (
    parsedBlocks.length !== output.blockCount ||
    parsedBlocks.some((block, ordinal) => block.ordinal !== ordinal) ||
    parsedBlocks.some((block) =>
      block.assetRefs.some((asset) => !expectedImages.has(asset.slice(7)))
    )
  ) {
    throw new Error('Normalized block provenance does not match the utility response')
  }
  for (const asset of output.assets) {
    const bytes = await readBounded(`${path}/${asset.relativePath}`, MAX_ASSET_BYTES)
    if (bytes.byteLength !== asset.byteSize || sha256(bytes) !== asset.sha256) {
      throw new Error('Normalized asset does not match the utility response')
    }
  }
}

async function readBounded(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) {
      throw new Error('Normalized input file size is invalid')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function writeDurable(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
