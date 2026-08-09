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
        database.prepare('SELECT * FROM manuscript_assets WHERE sha256 = ?').get(sha256) as
          | ManuscriptAssetTable
          | undefined
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
               agent_tool_call_id, created_at, last_referenced_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            now
          )
      })
    } catch (err) {
      const concurrentlyPublished = this.options.database.immediate(
        (database) =>
          database.prepare('SELECT * FROM manuscript_assets WHERE sha256 = ?').get(sha256) as
            | ManuscriptAssetTable
            | undefined
      )
      if (concurrentlyPublished !== undefined) {
        await this.#verifyStored(concurrentlyPublished)
        this.#enqueueCleanup(concurrentlyPublished.asset_id, new Date(now))
        return resultFromRow(concurrentlyPublished)
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
        database.prepare('SELECT * FROM manuscript_assets WHERE asset_id = ?').get(parsed) as
          | ManuscriptAssetTable
          | undefined
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

  async cleanupOrphans(): Promise<number> {
    const cutoff = new Date(
      (this.options.now ?? (() => new Date()))().getTime() - ORPHAN_GRACE_MS
    ).toISOString()
    const rows = this.options.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT asset.* FROM manuscript_assets AS asset
             WHERE asset.last_referenced_at < ?
               AND NOT EXISTS (
                 SELECT 1 FROM section_revision_assets AS reference
                 WHERE reference.asset_id = asset.asset_id
               )
               AND NOT EXISTS (
                 SELECT 1 FROM mutation_proposals AS proposal
                 WHERE proposal.status IN ('pending', 'generating')
                   AND proposal.payload_json LIKE '%' || asset.asset_id || '%'
               )`
          )
          .all(cutoff) as ManuscriptAssetTable[]
    )
    let removed = 0
    for (const row of rows) {
      try {
        await rm(this.absolutePath(row), { force: true })
        this.options.database.immediate((database) => {
          database.prepare('DELETE FROM manuscript_assets WHERE asset_id = ?').run(row.asset_id)
        })
        removed += 1
      } catch (err) {
        this.options.log.warn(
          { event: 'manuscript.asset.cleanup_failed', err, assetId: row.asset_id },
          'Unreferenced manuscript asset cleanup failed'
        )
      }
    }
    return removed
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
      .prepare('SELECT 1 FROM manuscript_assets WHERE asset_id = ?')
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
