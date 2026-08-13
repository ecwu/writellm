import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, rm } from 'node:fs/promises'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import type { JobStore } from '../jobs/job-store'
import {
  manuscriptAssetIdSchema,
  manuscriptAssetMimeTypeSchema,
  manuscriptAssetResultSchema,
  manuscriptAssetUrlSchema,
  type BlockNoteDocument,
  type ManuscriptAssetResult
} from '../../shared/contracts/manuscript'
import {
  deleteManuscriptAssetResultSchema,
  manuscriptAssetWorkspacePageSchema,
  type DeleteManuscriptAssetResult,
  type ManuscriptAssetWorkspaceInput,
  type ManuscriptAssetWorkspaceItem,
  type ManuscriptAssetWorkspacePage
} from '../../shared/contracts/manuscript-assets'
import type { ManuscriptAssetTable } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { MANUSCRIPT_ASSETS_DIRECTORY, resolveProjectPath } from '../project/project-paths'
import { writeAtomicFile } from '../storage/atomic-file'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_EDGE = 8_192
const MAX_IMAGE_PIXELS = 40_000_000
const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1_000

export interface ValidatedImage {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  extension: '.png' | '.jpg' | '.webp'
  width: number
  height: number
}

interface AssetProjectionRow extends ManuscriptAssetTable {
  current_reference_count: number
  historical_reference_count: number
  proposal_reference_count: number
  lineage_reference_count: number
}

interface AssetCursor {
  createdAt: string
  assetId: string
}

export class ManuscriptAssetService {
  constructor(
    private readonly options: {
      projectRoot: string
      projectId: string
      database: ProjectDatabase
      jobs?: Pick<JobStore, 'enqueue'>
      log: Pick<Logger, 'info' | 'warn' | 'error'>
      now?: () => Date
      createId?: () => string
    }
  ) {}

  async store(input: {
    bytes: Buffer
    mimeType: string
    sourceType: 'upload' | 'generated'
    originalName?: string | null
    modelRequestId?: string | null
    agentRunId?: string | null
    agentToolCallId?: string | null
    generationRequest?: {
      prompt: string
      aspectRatio: 'auto' | '1:1' | '16:9'
      requestedImageSize: '1K' | '2K'
      effectiveImageSize: '1K' | '2K'
    } | null
  }): Promise<ManuscriptAssetResult> {
    const startedAt = Date.now()
    const validated = validateImageBytes(input.bytes, input.mimeType)
    const sha256 = createHash('sha256').update(input.bytes).digest('hex')
    const existing = this.options.database.immediate(
      (database) =>
        database
          .prepare("SELECT * FROM manuscript_assets WHERE sha256 = ? AND deletion_state = 'active'")
          .get(sha256) as ManuscriptAssetTable | undefined
    )
    if (existing !== undefined) {
      await this.#verifyStored(existing)
      const now = (this.options.now ?? (() => new Date()))()
      this.options.database.immediate((database) => {
        database
          .prepare('UPDATE manuscript_assets SET last_referenced_at = ? WHERE asset_id = ?')
          .run(now.toISOString(), existing.asset_id)
      })
      this.#enqueueCleanup(existing.asset_id, now)
      return resultFromRow(existing)
    }

    const assetId = (this.options.createId ?? randomUUID)()
    const relativePath = `${MANUSCRIPT_ASSETS_DIRECTORY}/${sha256}${validated.extension}`
    const destination = resolveProjectPath(this.options.projectRoot, relativePath)
    const published = await writeAtomicFile(destination, input.bytes, {
      publishWithoutReplacement: true
    })
    if (!published) await verifyStoredAsset(destination, input.bytes.byteLength, sha256)
    const now = (this.options.now ?? (() => new Date()))().toISOString()
    try {
      this.options.database.immediate((database) => {
        database
          .prepare(
            `INSERT INTO manuscript_assets (
               asset_id, sha256, byte_size, mime_type, extension, relative_path,
               source_type, original_name, generation_request_json, model_request_id, agent_run_id,
               agent_tool_call_id, created_at, last_referenced_at, width, height, deletion_state
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`
          )
          .run(
            assetId,
            sha256,
            input.bytes.byteLength,
            validated.mimeType,
            validated.extension,
            relativePath,
            input.sourceType,
            input.originalName?.slice(0, 500) ?? null,
            input.generationRequest === undefined || input.generationRequest === null
              ? null
              : JSON.stringify(input.generationRequest),
            input.modelRequestId ?? null,
            input.agentRunId ?? null,
            input.agentToolCallId ?? null,
            now,
            now,
            validated.width,
            validated.height
          )
      })
    } catch (err) {
      const concurrentlyPublished = this.options.database.immediate(
        (database) =>
          database
            .prepare(
              "SELECT * FROM manuscript_assets WHERE sha256 = ? AND deletion_state = 'active'"
            )
            .get(sha256) as ManuscriptAssetTable | undefined
      )
      if (concurrentlyPublished !== undefined) {
        await this.#verifyStored(concurrentlyPublished)
        this.#enqueueCleanup(concurrentlyPublished.asset_id, new Date(now))
        return resultFromRow(concurrentlyPublished)
      }
      const deletionInProgress = this.options.database.immediate((database) =>
        database
          .prepare(
            "SELECT 1 FROM manuscript_assets WHERE sha256 = ? AND deletion_state = 'deleting'"
          )
          .pluck()
          .get(sha256)
      )
      if (deletionInProgress === 1) {
        this.options.log.warn(
          { event: 'manuscript.asset.store_delete_race', err, projectId: this.options.projectId },
          'Manuscript asset publication raced with deletion'
        )
        throw new Error('Identical manuscript asset deletion is still in progress', { cause: err })
      }
      await rm(destination, { force: true }).catch(() => undefined)
      this.options.log.error(
        { event: 'manuscript.asset.publish_failed', err, projectId: this.options.projectId },
        'Manuscript asset publication failed'
      )
      throw err
    }
    this.options.log.info(
      {
        event: 'manuscript.asset.published',
        projectId: this.options.projectId,
        assetId,
        sourceType: input.sourceType,
        mimeType: validated.mimeType,
        byteSize: input.bytes.byteLength,
        width: validated.width,
        height: validated.height,
        durationMs: Date.now() - startedAt
      },
      'Manuscript asset published'
    )
    this.#enqueueCleanup(assetId, new Date(now))
    return manuscriptAssetResultSchema.parse({
      assetId,
      logicalUrl: assetUrl(assetId),
      mimeType: validated.mimeType,
      byteSize: input.bytes.byteLength
    })
  }

  get(assetId: string): ManuscriptAssetTable {
    const parsed = manuscriptAssetIdSchema.parse(assetId)
    const row = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            "SELECT * FROM manuscript_assets WHERE asset_id = ? AND deletion_state = 'active'"
          )
          .get(parsed) as ManuscriptAssetTable | undefined
    )
    if (row === undefined) throw new Error('Manuscript asset does not exist')
    return row
  }

  resolveImportReference(reference: string): ManuscriptAssetResult['logicalUrl'] {
    const match = /^\.\.\/assets\/([0-9a-f]{64}\.(?:png|jpg|webp))$/.exec(reference)
    if (match?.[1] === undefined) throw new Error('Markdown image reference is not allowed')
    const row = this.options.database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM manuscript_assets WHERE relative_path = ?')
          .get(`${MANUSCRIPT_ASSETS_DIRECTORY}/${match[1]}`) as ManuscriptAssetTable | undefined
    )
    if (row === undefined) throw new Error('Markdown image does not reference a registered asset')
    return assetUrl(row.asset_id)
  }

  markdownReference(assetId: string): string {
    const row = this.get(assetId)
    const filename = row.relative_path.slice(row.relative_path.lastIndexOf('/') + 1)
    return `../assets/${filename}`
  }

  absolutePath(row: ManuscriptAssetTable): string {
    return resolveProjectPath(this.options.projectRoot, row.relative_path)
  }

  async readVerified(assetId: string): Promise<{ row: ManuscriptAssetTable; bytes: Buffer }> {
    const row = this.get(assetId)
    const bytes = await readFile(this.absolutePath(row))
    if (bytes.byteLength !== row.byte_size) throw new Error('Manuscript asset size changed')
    if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
      throw new Error('Manuscript asset hash changed')
    }
    const validated = validateImageBytes(bytes, row.mime_type)
    if (validated.extension !== row.extension) {
      throw new Error('Manuscript asset extension does not match its validated MIME')
    }
    return { row, bytes }
  }

  async listWorkspace(input: ManuscriptAssetWorkspaceInput): Promise<ManuscriptAssetWorkspacePage> {
    const cursor = input.cursor === undefined ? null : decodeAssetCursor(input.cursor)
    const filters: string[] = ["asset.deletion_state = 'active'"]
    const parameters: unknown[] = []
    if (input.usage === 'used') filters.push('usage.current_reference_count > 0')
    if (input.usage === 'unused') filters.push('usage.current_reference_count = 0')
    if (input.source !== 'all') {
      filters.push('asset.source_type = ?')
      parameters.push(input.source === 'uploaded' ? 'upload' : 'generated')
    }
    if (input.sectionId !== undefined) {
      filters.push(`EXISTS (
        SELECT 1 FROM section_revision_assets section_filter
        JOIN sections section ON section.current_revision_id = section_filter.section_revision_id
        WHERE section_filter.asset_id = asset.asset_id AND section.section_id = ?
      )`)
      parameters.push(input.sectionId)
    }
    if (cursor !== null) {
      filters.push('(asset.created_at < ? OR (asset.created_at = ? AND asset.asset_id < ?))')
      parameters.push(cursor.createdAt, cursor.createdAt, cursor.assetId)
    }
    const usageCte = `WITH usage AS (
      SELECT asset_id,
        (SELECT COUNT(*) FROM section_revision_assets reference
          JOIN sections section ON section.current_revision_id = reference.section_revision_id
          WHERE reference.asset_id = manuscript_assets.asset_id) AS current_reference_count,
        (SELECT COUNT(*) FROM section_revision_assets reference
          WHERE reference.asset_id = manuscript_assets.asset_id
            AND NOT EXISTS (
              SELECT 1 FROM sections section
              WHERE section.current_revision_id = reference.section_revision_id
            )) AS historical_reference_count,
        (SELECT COUNT(*) FROM mutation_proposals proposal
          WHERE (
            manuscript_assets.agent_tool_call_id IS NOT NULL
            AND proposal.agent_tool_call_id = manuscript_assets.agent_tool_call_id
          ) OR EXISTS (
              SELECT 1 FROM json_tree(proposal.payload_json) node
              WHERE (node.key = 'assetId' AND node.value = manuscript_assets.asset_id)
                 OR (node.key = 'url' AND node.value = 'writellm-asset:' || manuscript_assets.asset_id)
            )
        ) AS proposal_reference_count,
        (SELECT COUNT(*) FROM manuscript_asset_variants variant
          WHERE variant.parent_asset_id = manuscript_assets.asset_id
             OR variant.candidate_asset_id = manuscript_assets.asset_id) AS lineage_reference_count
      FROM manuscript_assets
    )`
    const where = filters.join(' AND ')
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `${usageCte}
             SELECT asset.*, usage.current_reference_count, usage.historical_reference_count,
                    usage.proposal_reference_count, usage.lineage_reference_count
             FROM manuscript_assets asset JOIN usage ON usage.asset_id = asset.asset_id
             WHERE ${where}
             ORDER BY asset.created_at DESC, asset.asset_id DESC
             LIMIT ?`
          )
          .all(...parameters, input.limit + 1) as AssetProjectionRow[]
    )
    const pageRows = rows.slice(0, input.limit)
    const exactReferences = this.#currentReferences(pageRows.map((row) => row.asset_id))
    const variants = this.#variantReferences(pageRows.map((row) => row.asset_id))
    const items = await Promise.all(
      pageRows.map(async (row) => {
        const inspected = await this.#inspectForWorkspace(row)
        const protectionReasons = protectionReasonsFor(row)
        const currentReferences = exactReferences.get(row.asset_id) ?? []
        return {
          assetId: row.asset_id,
          logicalUrl: assetUrl(row.asset_id),
          mimeType: row.mime_type,
          byteSize: row.byte_size,
          width: inspected.width,
          height: inspected.height,
          sourceType: row.source_type,
          originalName: row.original_name,
          createdAt: row.created_at,
          availability: inspected.availability,
          currentReferences,
          currentReferenceCount: currentReferences.length,
          historicalReferenceCount: row.historical_reference_count,
          proposalReferenceCount: row.proposal_reference_count,
          protectionReasons,
          canDelete: protectionReasons.length === 0,
          generation: this.#generationLineage(row),
          parents: variants.parents.get(row.asset_id) ?? [],
          candidates: variants.candidates.get(row.asset_id) ?? []
        } satisfies ManuscriptAssetWorkspaceItem
      })
    )
    const countParameters = cursor === null ? parameters : parameters.slice(0, -3)
    const countFilters = cursor === null ? filters : filters.slice(0, -1)
    const filteredTotal = this.options.database.immediate((database) =>
      Number(
        database
          .prepare(
            `${usageCte}
             SELECT COUNT(*) FROM manuscript_assets asset
             JOIN usage ON usage.asset_id = asset.asset_id
             WHERE ${countFilters.join(' AND ')}`
          )
          .pluck()
          .get(...countParameters)
      )
    )
    const summary = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT COUNT(*) AS total,
             SUM(CASE WHEN EXISTS (
               SELECT 1 FROM section_revision_assets reference
               JOIN sections section ON section.current_revision_id = reference.section_revision_id
               WHERE reference.asset_id = asset.asset_id
             ) THEN 1 ELSE 0 END) AS used,
             SUM(CASE WHEN NOT EXISTS (
               SELECT 1 FROM section_revision_assets reference
               JOIN sections section ON section.current_revision_id = reference.section_revision_id
               WHERE reference.asset_id = asset.asset_id
             ) THEN 1 ELSE 0 END) AS unused,
             SUM(CASE WHEN source_type = 'generated' THEN 1 ELSE 0 END) AS generated,
             SUM(CASE WHEN source_type = 'upload' THEN 1 ELSE 0 END) AS uploaded
           FROM manuscript_assets asset WHERE deletion_state = 'active'`
          )
          .get() as Record<'total' | 'used' | 'unused' | 'generated' | 'uploaded', number | null>
    )
    const last = pageRows.at(-1)
    return manuscriptAssetWorkspacePageSchema.parse({
      items,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? encodeAssetCursor({ createdAt: last.created_at, assetId: last.asset_id })
          : null,
      filteredTotal,
      summary: {
        total: summary.total ?? 0,
        used: summary.used ?? 0,
        unused: summary.unused ?? 0,
        generated: summary.generated ?? 0,
        uploaded: summary.uploaded ?? 0
      }
    })
  }

  async deleteUnprotected(assetId: string): Promise<DeleteManuscriptAssetResult> {
    const parsed = manuscriptAssetIdSchema.parse(assetId)
    const prepared = this.options.database.immediate((database) => {
      const row = database
        .prepare('SELECT * FROM manuscript_assets WHERE asset_id = ?')
        .get(parsed) as ManuscriptAssetTable | undefined
      if (row === undefined) throw new Error('Manuscript asset does not exist')
      const reasons = this.#protectionReasons(database, parsed)
      if (reasons.length > 0) return { row, reasons }
      database
        .prepare(
          `UPDATE manuscript_assets SET deletion_state = 'deleting'
           WHERE asset_id = ? AND deletion_state = 'active'`
        )
        .run(parsed)
      return { row: { ...row, deletion_state: 'deleting' as const }, reasons }
    })
    if (prepared.reasons.length > 0) {
      return deleteManuscriptAssetResultSchema.parse({
        outcome: 'protected',
        assetId: parsed,
        reasons: prepared.reasons
      })
    }
    return this.#finishDeletion(prepared.row)
  }

  async repairPendingDeletions(): Promise<number> {
    const queried = this.options.database.immediate((database) =>
      database.prepare("SELECT * FROM manuscript_assets WHERE deletion_state = 'deleting'").all()
    )
    const rows = Array.isArray(queried) ? (queried as ManuscriptAssetTable[]) : []
    let completed = 0
    for (const row of rows) {
      if ((await this.#finishDeletion(row)).outcome === 'deleted') completed += 1
    }
    return completed
  }

  async cleanupOrphans(): Promise<number> {
    await this.repairPendingDeletions()
    const cutoff = new Date(
      (this.options.now ?? (() => new Date()))().getTime() - ORPHAN_GRACE_MS
    ).toISOString()
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT asset.* FROM manuscript_assets AS asset
             WHERE asset.last_referenced_at < ? AND asset.deletion_state = 'active'
               AND NOT EXISTS (
                 SELECT 1 FROM section_revision_assets AS reference
                 WHERE reference.asset_id = asset.asset_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM mutation_proposals AS proposal
                 WHERE (
                   asset.agent_tool_call_id IS NOT NULL
                   AND proposal.agent_tool_call_id = asset.agent_tool_call_id
                 ) OR EXISTS (
                     SELECT 1 FROM json_tree(proposal.payload_json) node
                     WHERE (node.key = 'assetId' AND node.value = asset.asset_id)
                        OR (node.key = 'url' AND node.value = 'writellm-asset:' || asset.asset_id)
                   )
               )`
          )
          .all(cutoff) as ManuscriptAssetTable[]
    )
    let removed = 0
    for (const row of rows) {
      const result = await this.deleteUnprotected(row.asset_id)
      if (result.outcome === 'deleted') removed += 1
    }
    return removed
  }

  #currentReferences(
    assetIds: readonly string[]
  ): Map<string, ManuscriptAssetWorkspaceItem['currentReferences']> {
    const result = new Map<string, ManuscriptAssetWorkspaceItem['currentReferences']>()
    if (assetIds.length === 0) return result
    const placeholders = assetIds.map(() => '?').join(', ')
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT reference.asset_id, section.section_id, section.title,
                    revision.section_revision_id, revision.content_json
             FROM section_revision_assets reference
             JOIN sections section ON section.current_revision_id = reference.section_revision_id
             JOIN section_revisions revision
               ON revision.section_revision_id = reference.section_revision_id
             WHERE reference.asset_id IN (${placeholders})
             ORDER BY section.position, section.section_id`
          )
          .all(...assetIds) as Array<{
          asset_id: string
          section_id: string
          title: string
          section_revision_id: string
          content_json: string
        }>
    )
    for (const row of rows) {
      const references = result.get(row.asset_id) ?? []
      collectCurrentAssetReferences(
        JSON.parse(row.content_json) as BlockNoteDocument,
        row.asset_id,
        row,
        references
      )
      result.set(row.asset_id, references.slice(0, 200))
    }
    return result
  }

  #protectionReasons(
    database: Database.Database,
    assetId: string
  ): ManuscriptAssetWorkspaceItem['protectionReasons'] {
    const row = database
      .prepare(
        `SELECT
          EXISTS (
            SELECT 1 FROM section_revision_assets reference
            JOIN sections section ON section.current_revision_id = reference.section_revision_id
            WHERE reference.asset_id = ?
          ) AS current_reference,
          EXISTS (
            SELECT 1 FROM section_revision_assets reference
            WHERE reference.asset_id = ? AND NOT EXISTS (
              SELECT 1 FROM sections section
              WHERE section.current_revision_id = reference.section_revision_id
            )
          ) AS historical_reference,
          EXISTS (
            SELECT 1 FROM mutation_proposals proposal
            JOIN manuscript_assets protected_asset ON protected_asset.asset_id = ?
            WHERE (
              protected_asset.agent_tool_call_id IS NOT NULL
              AND proposal.agent_tool_call_id = protected_asset.agent_tool_call_id
            ) OR EXISTS (
                SELECT 1 FROM json_tree(proposal.payload_json) node
                WHERE (node.key = 'assetId' AND node.value = protected_asset.asset_id)
                   OR (node.key = 'url' AND node.value = 'writellm-asset:' || protected_asset.asset_id)
              )
          ) AS proposal_reference,
          EXISTS (
            SELECT 1 FROM manuscript_asset_variants variant
            WHERE variant.parent_asset_id = ? OR variant.candidate_asset_id = ?
          ) AS lineage_reference`
      )
      .get(assetId, assetId, assetId, assetId, assetId) as {
      current_reference: 0 | 1
      historical_reference: 0 | 1
      proposal_reference: 0 | 1
      lineage_reference: 0 | 1
    }
    return [
      ...(row.current_reference === 1 ? (['current_revision'] as const) : []),
      ...(row.historical_reference === 1 ? (['retained_history'] as const) : []),
      ...(row.proposal_reference === 1 ? (['retained_proposal'] as const) : []),
      ...(row.lineage_reference === 1 ? (['candidate_lineage'] as const) : [])
    ]
  }

  #variantReferences(assetIds: string[]): {
    parents: Map<string, ManuscriptAssetWorkspaceItem['parents']>
    candidates: Map<string, ManuscriptAssetWorkspaceItem['candidates']>
  } {
    const parents = new Map<string, ManuscriptAssetWorkspaceItem['parents']>()
    const candidates = new Map<string, ManuscriptAssetWorkspaceItem['candidates']>()
    if (assetIds.length === 0) return { parents, candidates }
    const placeholders = assetIds.map(() => '?').join(', ')
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT variant.*, proposal.agent_run_id, proposal.agent_tool_call_id
             FROM manuscript_asset_variants variant
             JOIN mutation_proposals proposal
               ON proposal.mutation_proposal_id = variant.generation_proposal_id
             WHERE variant.parent_asset_id IN (${placeholders})
                OR variant.candidate_asset_id IN (${placeholders})
             ORDER BY variant.created_at DESC, variant.manuscript_asset_variant_id DESC
             LIMIT 5000`
          )
          .all(...assetIds, ...assetIds) as Array<{
          manuscript_asset_variant_id: string
          parent_asset_id: string
          candidate_asset_id: string
          generation_proposal_id: string
          candidate_model_request_id: string
          section_proposal_id: string | null
          agent_run_id: string
          agent_tool_call_id: string
          disposition: 'replace' | 'insert_after'
          created_at: string
        }>
    )
    for (const row of rows) {
      const shared = {
        variantId: row.manuscript_asset_variant_id,
        disposition: row.disposition,
        generationProposalId: row.generation_proposal_id,
        modelRequestId: row.candidate_model_request_id,
        agentRunId: row.agent_run_id,
        agentToolCallId: row.agent_tool_call_id,
        sectionProposalId: row.section_proposal_id,
        createdAt: row.created_at
      }
      if (assetIds.includes(row.candidate_asset_id)) {
        const values = parents.get(row.candidate_asset_id) ?? []
        if (values.length < 50) values.push({ ...shared, assetId: row.parent_asset_id })
        parents.set(row.candidate_asset_id, values)
      }
      if (assetIds.includes(row.parent_asset_id)) {
        const values = candidates.get(row.parent_asset_id) ?? []
        if (values.length < 50) values.push({ ...shared, assetId: row.candidate_asset_id })
        candidates.set(row.parent_asset_id, values)
      }
    }
    return { parents, candidates }
  }

  async #inspectForWorkspace(row: ManuscriptAssetTable): Promise<{
    availability: 'available' | 'missing' | 'changed'
    width: number | null
    height: number | null
  }> {
    try {
      const bytes = await readFile(this.absolutePath(row))
      if (bytes.byteLength !== row.byte_size) throw new Error('Manuscript asset size changed')
      if (createHash('sha256').update(bytes).digest('hex') !== row.sha256) {
        throw new Error('Manuscript asset hash changed')
      }
      const validated = validateImageBytes(bytes, row.mime_type)
      if (validated.extension !== row.extension) {
        throw new Error('Manuscript asset extension does not match its validated MIME')
      }
      if (row.width === null || row.height === null) {
        this.options.database.immediate((database) => {
          database
            .prepare(
              `UPDATE manuscript_assets SET width = ?, height = ?
               WHERE asset_id = ? AND deletion_state = 'active'`
            )
            .run(validated.width, validated.height, row.asset_id)
        })
      }
      return { availability: 'available', width: validated.width, height: validated.height }
    } catch (err) {
      const missing = isMissingFileError(err)
      this.options.log.warn(
        {
          event: 'manuscript.asset.workspace_verification_failed',
          err,
          projectId: this.options.projectId,
          assetId: row.asset_id,
          availability: missing ? 'missing' : 'changed'
        },
        'Manuscript asset workspace verification failed'
      )
      return {
        availability: missing ? 'missing' : 'changed',
        width: row.width,
        height: row.height
      }
    }
  }

  #generationLineage(row: ManuscriptAssetTable): ManuscriptAssetWorkspaceItem['generation'] {
    if (row.source_type !== 'generated') return null
    let request: Record<string, unknown> = {}
    try {
      request =
        row.generation_request_json === null
          ? {}
          : (JSON.parse(row.generation_request_json) as Record<string, unknown>)
    } catch (err) {
      this.options.log.warn(
        { event: 'manuscript.asset.generation_metadata_invalid', err, assetId: row.asset_id },
        'Manuscript asset generation metadata is invalid'
      )
    }
    return {
      modelRequestId: row.model_request_id,
      agentRunId: row.agent_run_id,
      agentToolCallId: row.agent_tool_call_id,
      aspectRatio:
        request['aspectRatio'] === 'auto' ||
        request['aspectRatio'] === '1:1' ||
        request['aspectRatio'] === '16:9'
          ? request['aspectRatio']
          : null,
      requestedImageSize:
        request['requestedImageSize'] === '1K' || request['requestedImageSize'] === '2K'
          ? request['requestedImageSize']
          : null,
      effectiveImageSize:
        request['effectiveImageSize'] === '1K' || request['effectiveImageSize'] === '2K'
          ? request['effectiveImageSize']
          : null
    }
  }

  async #finishDeletion(row: ManuscriptAssetTable): Promise<DeleteManuscriptAssetResult> {
    try {
      await rm(this.absolutePath(row), { force: true })
      this.options.database.immediate((database) => {
        database
          .prepare(
            "DELETE FROM manuscript_assets WHERE asset_id = ? AND deletion_state = 'deleting'"
          )
          .run(row.asset_id)
      })
      this.options.log.info(
        {
          event: 'manuscript.asset.deleted',
          projectId: this.options.projectId,
          assetId: row.asset_id
        },
        'Unprotected manuscript asset deleted'
      )
      return deleteManuscriptAssetResultSchema.parse({ outcome: 'deleted', assetId: row.asset_id })
    } catch (err) {
      this.options.log.error(
        {
          event: 'manuscript.asset.delete_failed',
          err,
          projectId: this.options.projectId,
          assetId: row.asset_id
        },
        'Manuscript asset deletion failed'
      )
      this.#enqueueCleanup(row.asset_id, new Date(0))
      return deleteManuscriptAssetResultSchema.parse({ outcome: 'pending', assetId: row.asset_id })
    }
  }

  async #verifyStored(row: ManuscriptAssetTable): Promise<void> {
    await verifyStoredAsset(this.absolutePath(row), row.byte_size, row.sha256)
  }

  #enqueueCleanup(assetId: string, createdAt: Date): void {
    this.options.jobs?.enqueue({
      type: 'artifact_cleanup',
      payload: { cleanupId: `manuscript-asset:${assetId}` },
      deduplicationKey: `manuscript-asset-cleanup:${assetId}`,
      runAfter: new Date(createdAt.getTime() + ORPHAN_GRACE_MS),
      maxAttempts: 3
    })
  }
}

async function verifyStoredAsset(path: string, expectedSize: number, expectedSha256: string) {
  const file = await lstat(path)
  if (!file.isFile() || file.isSymbolicLink() || file.size !== expectedSize) {
    throw new Error('Stored manuscript asset is missing or changed')
  }
  const bytes = await readFile(path)
  if (createHash('sha256').update(bytes).digest('hex') !== expectedSha256) {
    throw new Error('Stored manuscript asset is missing or changed')
  }
}

export function assetUrl(assetId: string): string {
  return manuscriptAssetUrlSchema.parse(`writellm-asset:${assetId}`)
}

export function assetIdFromUrl(url: string): string {
  const parsed = manuscriptAssetUrlSchema.parse(url)
  return manuscriptAssetIdSchema.parse(parsed.slice('writellm-asset:'.length))
}

export function recordRevisionAssetReferences(
  database: Database.Database,
  revisionId: string,
  document: BlockNoteDocument,
  now: string
): void {
  const assetIds = new Set<string>()
  const visit = (blocks: BlockNoteDocument): void => {
    for (const block of blocks) {
      if (block.type === 'image' && typeof block.props.url === 'string') {
        assetIds.add(assetIdFromUrl(block.props.url))
      }
      if (block.children.length > 0) visit(block.children)
    }
  }
  visit(document)
  for (const assetId of assetIds) {
    const exists = database
      .prepare("SELECT 1 FROM manuscript_assets WHERE asset_id = ? AND deletion_state = 'active'")
      .pluck()
      .get(assetId)
    if (exists !== 1) throw new Error('Section references an unknown manuscript asset')
    database
      .prepare(`INSERT INTO section_revision_assets (section_revision_id, asset_id) VALUES (?, ?)`)
      .run(revisionId, assetId)
    database
      .prepare('UPDATE manuscript_assets SET last_referenced_at = ? WHERE asset_id = ?')
      .run(now, assetId)
  }
}

function protectionReasonsFor(
  row: AssetProjectionRow
): ManuscriptAssetWorkspaceItem['protectionReasons'] {
  return [
    ...(row.current_reference_count > 0 ? (['current_revision'] as const) : []),
    ...(row.historical_reference_count > 0 ? (['retained_history'] as const) : []),
    ...(row.proposal_reference_count > 0 ? (['retained_proposal'] as const) : []),
    ...(row.lineage_reference_count > 0 ? (['candidate_lineage'] as const) : [])
  ]
}

function collectCurrentAssetReferences(
  blocks: BlockNoteDocument,
  assetId: string,
  section: { section_id: string; section_revision_id: string; title: string },
  result: ManuscriptAssetWorkspaceItem['currentReferences']
): void {
  for (const block of blocks) {
    if (block.type === 'image' && block.props.url === assetUrl(assetId)) {
      result.push({
        sectionId: section.section_id,
        sectionRevisionId: section.section_revision_id,
        sectionTitle: section.title,
        blockId: block.id,
        figureId: typeof block.props.figureId === 'string' ? block.props.figureId : null
      })
    }
    if (block.children.length > 0) {
      collectCurrentAssetReferences(block.children, assetId, section, result)
    }
  }
}

function encodeAssetCursor(cursor: AssetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeAssetCursor(value: string): AssetCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      typeof (parsed as Record<string, unknown>)['createdAt'] !== 'string' ||
      typeof (parsed as Record<string, unknown>)['assetId'] !== 'string'
    ) {
      throw new Error('Asset cursor shape is invalid')
    }
    return {
      createdAt: String((parsed as Record<string, unknown>)['createdAt']),
      assetId: manuscriptAssetIdSchema.parse((parsed as Record<string, unknown>)['assetId'])
    }
  } catch (err) {
    throw new Error('Manuscript asset cursor is invalid', { cause: err })
  }
}

function isMissingFileError(err: unknown): boolean {
  return (
    err instanceof Error && 'code' in err && (err as Error & { code?: string }).code === 'ENOENT'
  )
}

export function validateImageBytes(bytes: Buffer, claimedMimeType: string): ValidatedImage {
  const mimeType = manuscriptAssetMimeTypeSchema.parse(claimedMimeType)
  if (bytes.byteLength < 12 || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new Error('Image size is outside the supported range')
  }
  const dimensions =
    mimeType === 'image/png'
      ? pngDimensions(bytes)
      : mimeType === 'image/jpeg'
        ? jpegDimensions(bytes)
        : webpDimensions(bytes)
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width > MAX_IMAGE_EDGE ||
    dimensions.height > MAX_IMAGE_EDGE ||
    dimensions.width * dimensions.height > MAX_IMAGE_PIXELS
  ) {
    throw new Error('Image dimensions are outside the supported range')
  }
  return {
    mimeType,
    extension: mimeType === 'image/png' ? '.png' : mimeType === 'image/jpeg' ? '.jpg' : '.webp',
    ...dimensions
  }
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new Error('PNG signature is invalid')
  }
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') throw new Error('PNG header is missing')
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('JPEG signature is invalid')
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    const marker = bytes[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > bytes.length) break
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) break
    if (
      marker !== undefined &&
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker
      )
    ) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) }
    }
    offset += length
  }
  throw new Error('JPEG dimensions are unavailable')
}

function webpDimensions(bytes: Buffer): { width: number; height: number } {
  if (
    bytes.subarray(0, 4).toString('ascii') !== 'RIFF' ||
    bytes.subarray(8, 12).toString('ascii') !== 'WEBP'
  ) {
    throw new Error('WebP signature is invalid')
  }
  const kind = bytes.subarray(12, 16).toString('ascii')
  if (kind === 'VP8X' && bytes.length >= 30) {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    }
  }
  if (
    kind === 'VP8 ' &&
    bytes.length >= 30 &&
    bytes[23] === 0x9d &&
    bytes[24] === 0x01 &&
    bytes[25] === 0x2a
  ) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff }
  }
  if (kind === 'VP8L' && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }
  }
  throw new Error('WebP dimensions are unavailable')
}

function resultFromRow(row: ManuscriptAssetTable): ManuscriptAssetResult {
  return manuscriptAssetResultSchema.parse({
    assetId: row.asset_id,
    logicalUrl: assetUrl(row.asset_id),
    mimeType: row.mime_type,
    byteSize: row.byte_size
  })
}
