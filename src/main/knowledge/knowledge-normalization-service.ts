import { createHash, randomUUID } from 'node:crypto'
import { open, readdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from 'pino'
import {
  normalizedKnowledgeBlockSchema,
  normalizedKnowledgeManifestSchema,
  PARSED_KNOWLEDGE_BLOCK_PAGE_LIMIT,
  PARSED_KNOWLEDGE_MARKDOWN_MAX_BYTES,
  PARSED_KNOWLEDGE_PAGE_MAX_BYTES,
  parsedKnowledgeAssetSchema,
  parsedKnowledgeBlockPageSchema,
  parsedKnowledgeMarkdownSchema,
  parsedKnowledgeMetadataSchema,
  type NormalizedKnowledgeBlock,
  type NormalizedKnowledgeManifest,
  type ParsedKnowledgeBlockPage,
  type ParsedKnowledgeMarkdown,
  type ParsedKnowledgeMetadata
} from '../../shared/contracts/knowledge'
import { mineruRawManifestSchema } from '../../shared/contracts/mineru'
import type { JobHandlerContext, JobHandlerRegistry } from '../jobs/scheduler/job-handler-registry'
import type { JobStore } from '../jobs/job-store'
import type { NormalizationRunTable, ParseRevisionTable } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { ProjectFilesystem } from '../project/project-filesystem'
import type { MineruGateway, MineruNormalizedResult } from './mineru-gateway'

const MAX_ASSET_BYTES = 10 * 1024 * 1024
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024
const MAX_BLOCKS_BYTES = 200 * 1024 * 1024
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
const MAX_BLOCK_LINE_BYTES = 2 * 1024 * 1024
const PAGE_ENVELOPE_RESERVE_BYTES = 8 * 1024

type ActiveNormalizationRow = ParseRevisionTable & {
  activated_at: string
  normalization_run_id: string
  normalizer_version: number
  normalization_relative_path: string
  normalization_manifest_sha256: string
}

type VerifiedNormalization = {
  active: ActiveNormalizationRow
  manifest: NormalizedKnowledgeManifest
  blocksPath: string
  documentPath: string
  blocksSize: number
  documentSize: number
}

export class KnowledgeNormalizationService {
  readonly #filesystem: ProjectFilesystem
  readonly #projectId: string
  readonly #database: ProjectDatabase
  readonly #log: Pick<Logger, 'info' | 'error'>
  readonly #normalizerVersion: number
  readonly #now: () => Date
  readonly #createId: () => string
  readonly #normalizeInUtility: MineruGateway['normalize']
  readonly #jobs?: JobStore
  readonly #verificationCache = new Map<
    string,
    {
      manifestSha256: string
      blocksIdentity: string
      blocksSize: number
      blocksMtimeMs: number
      documentIdentity: string
      documentSize: number
      documentMtimeMs: number
    }
  >()

  constructor(options: {
    projectRoot: string
    filesystem?: ProjectFilesystem
    projectId: string
    database: ProjectDatabase
    log: Pick<Logger, 'info' | 'error'>
    normalizerVersion?: number
    now?: () => Date
    createId?: () => string
    normalizeInUtility: MineruGateway['normalize']
    jobs?: JobStore
  }) {
    this.#filesystem = options.filesystem ?? new ProjectFilesystem(options.projectRoot)
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

  async metadata(knowledgeItemId: string): Promise<ParsedKnowledgeMetadata> {
    const startedAt = Date.now()
    try {
      const snapshot = this.#readActiveSnapshot(knowledgeItemId)
      if (snapshot.active === undefined) {
        const result = parsedKnowledgeMetadataSchema.parse({
          knowledgeItemId,
          parseState: snapshot.latest?.state ?? null,
          normalizationState: snapshot.normalization?.state ?? null,
          active: null
        })
        this.#log.info(
          {
            event: 'knowledge.metadata.loaded',
            projectId: this.#projectId,
            knowledgeItemId,
            active: false,
            blockCount: 0,
            durationMs: Date.now() - startedAt
          },
          'Knowledge metadata loaded'
        )
        return result
      }
      const verified = await this.#verifyActive(snapshot.active)
      const result = parsedKnowledgeMetadataSchema.parse({
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
          blockCount: verified.manifest.blocks.count,
          documentByteSize: verified.documentSize,
          activatedAt: snapshot.active.activated_at
        }
      })
      this.#log.info(
        {
          event: 'knowledge.metadata.loaded',
          projectId: this.#projectId,
          knowledgeItemId,
          active: true,
          blockCount: verified.manifest.blocks.count,
          assetCount: verified.manifest.assets.length,
          documentByteSize: verified.documentSize,
          durationMs: Date.now() - startedAt
        },
        'Knowledge metadata loaded'
      )
      return result
    } catch (err) {
      this.#log.error(
        {
          event: 'knowledge.metadata.failed',
          err,
          projectId: this.#projectId,
          knowledgeItemId,
          durationMs: Date.now() - startedAt
        },
        'Knowledge metadata failed'
      )
      throw err
    }
  }

  async blockPage(
    knowledgeItemId: string,
    parseRevisionId: string,
    cursor = 0,
    limit = PARSED_KNOWLEDGE_BLOCK_PAGE_LIMIT
  ): Promise<ParsedKnowledgeBlockPage> {
    const verified = await this.#requireVerifiedActive(knowledgeItemId, parseRevisionId)
    const boundedLimit = Math.min(PARSED_KNOWLEDGE_BLOCK_PAGE_LIMIT, Math.max(1, Math.floor(limit)))
    const blocks: NormalizedKnowledgeBlock[] = []
    let nextCursor = Math.max(0, Math.floor(cursor))
    let returnedBytes = 0
    let stoppedForBudget = false
    for await (const entry of readJsonlLines(verified.blocksPath, nextCursor)) {
      if (entry.bytes.byteLength === 0) continue
      const block = normalizedKnowledgeBlockSchema.parse(JSON.parse(entry.bytes.toString('utf8')))
      const blockBytes = Buffer.byteLength(JSON.stringify(block))
      if (
        blocks.length > 0 &&
        returnedBytes + blockBytes > PARSED_KNOWLEDGE_PAGE_MAX_BYTES - PAGE_ENVELOPE_RESERVE_BYTES
      ) {
        nextCursor = entry.startOffset
        stoppedForBudget = true
        break
      }
      blocks.push(block)
      returnedBytes += blockBytes
      nextCursor = entry.nextOffset
      if (blocks.length >= boundedLimit) break
    }
    const hasMore = stoppedForBudget || nextCursor < verified.blocksSize
    const result = parsedKnowledgeBlockPageSchema.parse({
      parseRevisionId,
      blocks,
      nextCursor,
      hasMore,
      returnedBytes
    })
    this.#log.info(
      {
        event: 'knowledge.blocks_page.loaded',
        projectId: this.#projectId,
        knowledgeItemId,
        parseRevisionId,
        blockCount: blocks.length,
        returnedBytes,
        hasMore
      },
      'Knowledge block page loaded'
    )
    return result
  }

  async markdown(
    knowledgeItemId: string,
    parseRevisionId: string
  ): Promise<ParsedKnowledgeMarkdown> {
    const verified = await this.#requireVerifiedActive(knowledgeItemId, parseRevisionId)
    if (verified.documentSize > PARSED_KNOWLEDGE_MARKDOWN_MAX_BYTES) {
      return parsedKnowledgeMarkdownSchema.parse({
        state: 'too_large',
        parseRevisionId,
        byteSize: verified.documentSize
      })
    }
    const bytes = await readBounded(
      verified.documentPath,
      PARSED_KNOWLEDGE_MARKDOWN_MAX_BYTES,
      true
    )
    return parsedKnowledgeMarkdownSchema.parse({
      state: 'ready',
      parseRevisionId,
      byteSize: bytes.byteLength,
      markdown: bytes.toString('utf8')
    })
  }

  async readBlocksForMapping(
    knowledgeItemId: string,
    parseRevisionId: string,
    select: (block: NormalizedKnowledgeBlock) => boolean,
    limits: { maxBlocks: number; maxBytes: number }
  ): Promise<{ blocks: NormalizedKnowledgeBlock[]; tooComplex: boolean }> {
    const verified = await this.#requireVerifiedActive(knowledgeItemId, parseRevisionId)
    const blocks: NormalizedKnowledgeBlock[] = []
    let bytes = 0
    for await (const entry of readJsonlLines(verified.blocksPath, 0)) {
      if (entry.bytes.byteLength === 0) continue
      const block = normalizedKnowledgeBlockSchema.parse(JSON.parse(entry.bytes.toString('utf8')))
      if (!select(block)) continue
      const encodedBytes = Buffer.byteLength(JSON.stringify(block))
      if (blocks.length >= limits.maxBlocks || bytes + encodedBytes > limits.maxBytes) {
        return { blocks: [], tooComplex: true }
      }
      blocks.push(block)
      bytes += encodedBytes
    }
    return { blocks, tooComplex: false }
  }

  #readActiveSnapshot(knowledgeItemId: string): {
    latest: { state: string } | undefined
    normalization: { state: 'staging' | 'published' | 'failed' } | undefined
    active: ActiveNormalizationRow | undefined
  } {
    return this.#database.immediate((database) => {
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
        .get(knowledgeItemId) as ActiveNormalizationRow | undefined
      return { latest, normalization, active }
    })
  }

  async #requireVerifiedActive(
    knowledgeItemId: string,
    parseRevisionId: string
  ): Promise<VerifiedNormalization> {
    const active = this.#readActiveSnapshot(knowledgeItemId).active
    if (active === undefined || active.parse_revision_id !== parseRevisionId) {
      throw new Error('Active parsed document revision is unavailable')
    }
    return this.#verifyActive(active)
  }

  async #verifyActive(active: ActiveNormalizationRow): Promise<VerifiedNormalization> {
    const manifestPath = await this.#filesystem.assertExistingRegularFile(
      `${active.normalization_relative_path}/manifest.json`
    )
    const blocksPath = await this.#filesystem.assertExistingRegularFile(
      `${active.normalization_relative_path}/blocks.jsonl`
    )
    const documentPath = await this.#filesystem.assertExistingRegularFile(
      `${active.normalization_relative_path}/document.md`
    )
    const manifestBytes = await readBounded(manifestPath, MAX_MANIFEST_BYTES)
    if (sha256(manifestBytes) !== active.normalization_manifest_sha256) {
      throw new Error('Active normalization manifest hash does not match')
    }
    const manifest = normalizedKnowledgeManifestSchema.parse(
      JSON.parse(manifestBytes.toString('utf8'))
    )
    if (
      manifest.parseRevisionId !== active.parse_revision_id ||
      manifest.normalizationRunId !== active.normalization_run_id
    ) {
      throw new Error('Active normalization manifest provenance does not match')
    }
    const blocksMetadata = await fileMetadata(blocksPath, MAX_BLOCKS_BYTES)
    const documentMetadata = await fileMetadata(documentPath, MAX_DOCUMENT_BYTES, true)
    const cached = this.#verificationCache.get(active.normalization_run_id)
    if (
      cached?.manifestSha256 !== active.normalization_manifest_sha256 ||
      cached.blocksIdentity !== blocksMetadata.identity ||
      cached.blocksSize !== blocksMetadata.size ||
      cached.blocksMtimeMs !== blocksMetadata.mtimeMs ||
      cached.documentIdentity !== documentMetadata.identity ||
      cached.documentSize !== documentMetadata.size ||
      cached.documentMtimeMs !== documentMetadata.mtimeMs
    ) {
      const [blocksSha256, documentSha256, blockCount] = await Promise.all([
        hashFile(blocksPath),
        hashFile(documentPath),
        validateBlocksJsonl(blocksPath)
      ])
      if (
        blocksSha256 !== manifest.blocks.sha256 ||
        documentSha256 !== manifest.document.sha256 ||
        blockCount !== manifest.blocks.count
      ) {
        throw new Error('Active normalized document hash or block count does not match')
      }
      this.#verificationCache.set(active.normalization_run_id, {
        manifestSha256: active.normalization_manifest_sha256,
        blocksIdentity: blocksMetadata.identity,
        blocksSize: blocksMetadata.size,
        blocksMtimeMs: blocksMetadata.mtimeMs,
        documentIdentity: documentMetadata.identity,
        documentSize: documentMetadata.size,
        documentMtimeMs: documentMetadata.mtimeMs
      })
    }
    return {
      active,
      manifest,
      blocksPath,
      documentPath,
      blocksSize: blocksMetadata.size,
      documentSize: documentMetadata.size
    }
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
    const manifestBytes = await readBounded(
      await this.#filesystem.assertExistingRegularFile(`${row.relative_path}/manifest.json`),
      MAX_MANIFEST_BYTES
    )
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
    const bytes = await readBounded(
      await this.#filesystem.assertExistingRegularFile(
        `${row.relative_path}/${record.relativePath}`
      ),
      MAX_ASSET_BYTES
    )
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
    const rawRoot = await this.#filesystem.assertExistingDirectory(revision.relative_path)
    const rawManifestBytes = await readBounded(
      await this.#filesystem.assertExistingRegularFile(`${revision.relative_path}/manifest.json`),
      10 * 1024 * 1024
    )
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
    if (await this.#reconcile(finalRelativePath, run, revision)) {
      this.#requestIndex(revision.knowledge_item_id, run.normalization_run_id)
      return run.normalization_run_id
    }

    const stagingRelativePath = `.writellm/temp/normalization/${run.normalization_run_id}.staging`
    const stagingPath = await this.#filesystem.createFreshDirectory(stagingRelativePath)
    await this.#filesystem.ensureDirectory(`${stagingRelativePath}/images`)
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
      await writeDurable(
        await this.#filesystem.resolveForCreation(`${stagingRelativePath}/manifest.json`),
        manifestBytes
      )
      await this.#filesystem.ensureDirectory(dirname(finalRelativePath))
      await this.#filesystem.publish(stagingRelativePath, finalRelativePath)
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
        await this.#filesystem.removeTree(stagingRelativePath)
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
    finalRelativePath: string,
    run: NormalizationRunTable,
    revision: ParseRevisionTable
  ): Promise<boolean> {
    try {
      const finalPath = await this.#filesystem.assertExistingDirectory(finalRelativePath)
      const bytes = await readBounded(
        await this.#filesystem.assertExistingRegularFile(`${finalRelativePath}/manifest.json`),
        10 * 1024 * 1024
      )
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
      if (
        (err as NodeJS.ErrnoException).code === 'ENOENT' ||
        (err as { code?: string }).code === 'path_missing'
      ) {
        return false
      }
      throw err
    }
  }

  #activate(
    run: NormalizationRunTable,
    revision: ParseRevisionTable,
    manifest: NormalizedKnowledgeManifest,
    manifestHash: string
  ): void {
    this.#verificationCache.clear()
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

  #requestIndex(_knowledgeItemId: string, _normalizationRunId: string): void {
    this.#jobs?.enqueue({
      type: 'rebuild_index',
      payload: { generationId: 'requested' },
      deduplicationKey: 'index-rebuild:pending',
      maxAttempts: 8
    })
  }
}

export function registerNormalizationHandler(
  registry: JobHandlerRegistry,
  service: KnowledgeNormalizationService
): void {
  registry.register('normalize_parse_revision', (context) => service.handle(context), {
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
    // A published directory also contains the manifest.json written before the
    // atomic rename; staging directories are verified before it exists.
    [...rootNames].some(
      (name) => !['blocks.jsonl', 'document.md', 'images', 'manifest.json'].includes(name)
    )
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
  const blocksPath = `${path}/blocks.jsonl`
  const documentPath = `${path}/document.md`
  const [blocksSha256, documentSha256, blockCount] = await Promise.all([
    hashFile(blocksPath),
    hashFile(documentPath),
    validateBlocksJsonl(blocksPath, expectedImages)
  ])
  if (blocksSha256 !== output.blocksSha256 || documentSha256 !== output.documentSha256) {
    throw new Error('Normalized content hash does not match the utility response')
  }
  if (blockCount !== output.blockCount) {
    throw new Error('Normalized block provenance does not match the utility response')
  }
  for (const asset of output.assets) {
    const bytes = await readBounded(`${path}/${asset.relativePath}`, MAX_ASSET_BYTES)
    if (bytes.byteLength !== asset.byteSize || sha256(bytes) !== asset.sha256) {
      throw new Error('Normalized asset does not match the utility response')
    }
  }
}

async function readBounded(path: string, maxBytes: number, allowEmpty = false): Promise<Buffer> {
  const handle = await open(path, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || (!allowEmpty && stat.size <= 0) || stat.size > maxBytes) {
      throw new Error('Normalized input file size is invalid')
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

async function fileMetadata(
  path: string,
  maxBytes: number,
  allowEmpty = false
): Promise<{ identity: string; size: number; mtimeMs: number }> {
  const handle = await open(path, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || (!allowEmpty && metadata.size <= 0) || metadata.size > maxBytes) {
      throw new Error('Normalized input file size is invalid')
    }
    return {
      identity: `${metadata.dev}:${metadata.ino}`,
      size: metadata.size,
      mtimeMs: metadata.mtimeMs
    }
  } finally {
    await handle.close()
  }
}

async function hashFile(path: string): Promise<string> {
  const handle = await open(path, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  try {
    let position = 0
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return hash.digest('hex')
  } finally {
    await handle.close()
  }
}

async function validateBlocksJsonl(
  path: string,
  expectedImages?: ReadonlySet<string>
): Promise<number> {
  let count = 0
  for await (const entry of readJsonlLines(path, 0)) {
    if (entry.bytes.byteLength === 0) throw new Error('Normalized block line is empty')
    const block = normalizedKnowledgeBlockSchema.parse(JSON.parse(entry.bytes.toString('utf8')))
    if (block.ordinal !== count) throw new Error('Normalized block ordinal is invalid')
    if (
      expectedImages !== undefined &&
      block.assetRefs.some((asset) => !expectedImages.has(asset.slice(7)))
    ) {
      throw new Error('Normalized block asset reference is invalid')
    }
    count += 1
  }
  return count
}

async function* readJsonlLines(
  path: string,
  startOffset: number
): AsyncGenerator<{ bytes: Buffer; startOffset: number; nextOffset: number }> {
  const handle = await open(path, 'r')
  try {
    const metadata = await handle.stat()
    const start = Math.floor(startOffset)
    if (!Number.isSafeInteger(start) || start < 0 || start > metadata.size) {
      throw new Error('Normalized block cursor is invalid')
    }
    if (start > 0) {
      const previous = Buffer.allocUnsafe(1)
      const { bytesRead } = await handle.read(previous, 0, 1, start - 1)
      if (bytesRead !== 1 || previous[0] !== 0x0a) {
        throw new Error('Normalized block cursor is not on a line boundary')
      }
    }
    let position = start
    let pending = Buffer.alloc(0)
    while (position < metadata.size) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, metadata.size - position))
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position)
      if (bytesRead === 0) break
      const current = chunk.subarray(0, bytesRead)
      const combined = pending.length === 0 ? current : Buffer.concat([pending, current])
      const combinedStart = position - pending.length
      position += bytesRead
      let lineStartIndex = 0
      while (true) {
        const newlineIndex = combined.indexOf(0x0a, lineStartIndex)
        if (newlineIndex < 0) break
        const bytes = combined.subarray(lineStartIndex, newlineIndex)
        if (bytes.byteLength > MAX_BLOCK_LINE_BYTES) {
          throw new Error('Normalized block line exceeds the size limit')
        }
        yield {
          bytes,
          startOffset: combinedStart + lineStartIndex,
          nextOffset: combinedStart + newlineIndex + 1
        }
        lineStartIndex = newlineIndex + 1
      }
      pending = Buffer.from(combined.subarray(lineStartIndex))
      if (pending.byteLength > MAX_BLOCK_LINE_BYTES) {
        throw new Error('Normalized block line exceeds the size limit')
      }
    }
    if (pending.byteLength > 0) {
      yield {
        bytes: pending,
        startOffset: metadata.size - pending.byteLength,
        nextOffset: metadata.size
      }
    }
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
