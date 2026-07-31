import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { basename, dirname, extname } from 'node:path'
import type { Logger } from 'pino'
import {
  knowledgeItemSchema,
  knowledgeListResultSchema,
  SUPPORTED_KNOWLEDGE_EXTENSIONS,
  type KnowledgeItem
} from '../../shared/contracts/knowledge'
import type { FileRecordTable, KnowledgeItemTable } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { ProjectFilesystem } from '../project/project-filesystem'
import { PROJECT_TEMP_DIRECTORY } from '../project/project-paths'

const MAX_FILE_BYTES = 250 * 1024 * 1024
const MAX_BATCH_BYTES = 1024 * 1024 * 1024

export class KnowledgeImportError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'KnowledgeImportError'
  }
}

export class KnowledgeImportService {
  readonly #filesystem: ProjectFilesystem
  readonly #projectId: string
  readonly #database: ProjectDatabase
  readonly #log: Pick<Logger, 'info' | 'error'>
  readonly #faults: { beforeTempOpen?(): void | Promise<void>; beforeImportRowCreate?(): void }
  readonly #onStored?: (knowledgeItem: KnowledgeItem) => void | Promise<void>
  readonly #onDeleted?: (knowledgeItemId: string) => void | Promise<void>
  readonly #controllers = new Map<string, AbortController>()
  readonly #operations = new Map<string, Promise<KnowledgeItem>>()
  #queue: Promise<void> = Promise.resolve()
  #publicationQueue: Promise<void> = Promise.resolve()
  #acceptingImports = true

  constructor(options: {
    projectRoot: string
    filesystem?: ProjectFilesystem
    projectId: string
    database: ProjectDatabase
    log: Pick<Logger, 'info' | 'error'>
    faults?: { beforeTempOpen?(): void | Promise<void>; beforeImportRowCreate?(): void }
    onStored?: (knowledgeItem: KnowledgeItem) => void | Promise<void>
    onDeleted?: (knowledgeItemId: string) => void | Promise<void>
  }) {
    this.#filesystem = options.filesystem ?? new ProjectFilesystem(options.projectRoot)
    this.#projectId = options.projectId
    this.#database = options.database
    this.#log = options.log
    this.#faults = options.faults ?? {}
    this.#onStored = options.onStored
    this.#onDeleted = options.onDeleted
  }

  list(): KnowledgeItem[] {
    const startedAt = Date.now()
    const rows = this.#database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT knowledge_items.*, file_records.sha256, file_records.byte_size,
                    file_records.mime_type, file_records.extension, imports.bytes_copied,
                    (
                      SELECT parse_tasks.state FROM parse_tasks
                       WHERE parse_tasks.knowledge_item_id = knowledge_items.knowledge_item_id
                       ORDER BY parse_tasks.created_at DESC, parse_tasks.parse_task_id DESC
                       LIMIT 1
                    ) AS parse_state,
                    (
                      SELECT normalization_runs.state FROM normalization_runs
                       WHERE normalization_runs.knowledge_item_id =
                             knowledge_items.knowledge_item_id
                       ORDER BY normalization_runs.created_at DESC,
                                normalization_runs.normalization_run_id DESC
                       LIMIT 1
                    ) AS normalization_state,
                    active_parse_revisions.parse_revision_id AS active_parse_revision_id,
                    active_parse_revisions.normalization_run_id AS active_normalization_run_id,
                    active_normalization.block_count,
                    active_normalization.asset_count,
                    active_parse_revisions.activated_at
               FROM knowledge_items
               LEFT JOIN file_records USING (file_record_id)
               LEFT JOIN imports USING (knowledge_item_id)
               LEFT JOIN active_parse_revisions USING (knowledge_item_id)
               LEFT JOIN normalization_runs AS active_normalization
                 ON active_normalization.normalization_run_id =
                    active_parse_revisions.normalization_run_id
              ORDER BY knowledge_items.created_at DESC, knowledge_items.rowid DESC`
          )
          .all() as KnowledgeListRow[]
    )
    const result = knowledgeListResultSchema.parse(rows.map(toKnowledgeItem))
    this.#log.info(
      {
        event: 'knowledge.summary.loaded',
        projectId: this.#projectId,
        itemCount: result.length,
        activeDocumentCount: result.filter((item) => item.activeParseRevisionId !== null).length,
        blockCount: result.reduce((total, item) => total + item.blockCount, 0),
        durationMs: Date.now() - startedAt
      },
      'Knowledge summary loaded'
    )
    return result
  }

  async importPaths(paths: readonly string[]): Promise<KnowledgeItem[]> {
    const started = await this.startImportPaths(paths)
    const operations = started
      .map((item) => this.#operations.get(item.knowledgeItemId))
      .filter((operation): operation is Promise<KnowledgeItem> => operation !== undefined)
    await Promise.allSettled(operations)
    return this.list()
  }

  async startImportPaths(paths: readonly string[]): Promise<KnowledgeItem[]> {
    if (paths.length === 0 || paths.length > 50) {
      throw new KnowledgeImportError('batch_count_invalid', 'Choose between 1 and 50 files')
    }
    const sizes = await Promise.all(paths.map(async (path) => (await lstat(path)).size))
    if (sizes.reduce((total, size) => total + size, 0) > MAX_BATCH_BYTES) {
      throw new KnowledgeImportError('batch_too_large', 'The selected batch is too large')
    }
    for (const [index, path] of paths.entries()) {
      try {
        await this.#serialize(async () => {
          if (!this.#acceptingImports) {
            throw new KnowledgeImportError('project_closing', 'The project is closing')
          }
          this.#startImport(path)
        })
      } catch (err) {
        if (err instanceof KnowledgeImportError && err.code === 'project_closing') throw err
        this.#log.error(
          {
            event: 'knowledge.import.start_failed',
            err,
            projectId: this.#projectId,
            batchIndex: index
          },
          'Failed to create a knowledge import record; continuing the batch'
        )
        this.#recordStartFailure(path, err)
      }
    }
    return this.list()
  }

  cancel(knowledgeItemId: string): void {
    this.#database.immediate((database) => {
      database
        .prepare(
          `UPDATE imports SET cancellation_requested = 1, updated_at = ?
            WHERE knowledge_item_id = ? AND state = 'copying'`
        )
        .run(new Date().toISOString(), knowledgeItemId)
    })
    this.#controllers.get(knowledgeItemId)?.abort()
  }

  async cancelAll(): Promise<void> {
    this.#acceptingImports = false
    for (const controller of this.#controllers.values()) controller.abort()
    await Promise.allSettled(this.#operations.values())
  }

  async delete(knowledgeItemId: string): Promise<void> {
    this.cancel(knowledgeItemId)
    try {
      await this.#operations.get(knowledgeItemId)
    } catch (err) {
      this.#log.error(
        { event: 'knowledge.delete.import_wait_failed', err, knowledgeItemId },
        'Knowledge import ended with an error before deletion'
      )
    }
    const relativePath = this.#database.immediate((database) => {
      const row = database
        .prepare(
          `SELECT file_records.relative_path
             FROM knowledge_items
             LEFT JOIN file_records USING (file_record_id)
            WHERE knowledge_item_id = ?`
        )
        .get(knowledgeItemId) as { relative_path?: string } | undefined
      return row?.relative_path
    })
    if (relativePath) {
      try {
        await this.#filesystem.assertExistingRegularFile(relativePath)
      } catch (err) {
        if ((err as { code?: string }).code !== 'path_missing') throw err
      }
    }
    this.#database.immediate((database) => {
      database
        .prepare('DELETE FROM knowledge_items WHERE knowledge_item_id = ?')
        .run(knowledgeItemId)
      if (relativePath) {
        database.prepare('DELETE FROM file_records WHERE relative_path = ?').run(relativePath)
      }
    })
    if (relativePath) await this.#filesystem.removeFile(relativePath)
    try {
      await this.#onDeleted?.(knowledgeItemId)
    } catch (err) {
      this.#log.error(
        { event: 'knowledge.delete.index_queue_failed', err, knowledgeItemId },
        'Failed to queue index deletion after knowledge deletion'
      )
      throw new KnowledgeImportError('index_queue_failed', 'Knowledge index update failed', {
        cause: err
      })
    }
  }

  originalRelativePath(knowledgeItemId: string): string {
    const row = this.#database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT file_records.relative_path
               FROM knowledge_items
               JOIN file_records USING (file_record_id)
              WHERE knowledge_item_id = ? AND knowledge_items.state = 'stored'`
          )
          .get(knowledgeItemId) as { relative_path: string } | undefined
    )
    if (!row) throw new KnowledgeImportError('original_unavailable', 'Original is unavailable')
    return row.relative_path
  }

  // A row-creation failure leaves no knowledge item behind; record a failed placeholder so
  // the batch result and the list/status surface still show the file as failed.
  #recordStartFailure(sourcePath: string, cause: unknown): void {
    const originalName = basename(sourcePath).normalize('NFC')
    const knowledgeItemId = randomUUID()
    const now = new Date().toISOString()
    try {
      this.#database.immediate((database) => {
        database
          .prepare(
            `INSERT INTO knowledge_items (
              knowledge_item_id, file_record_id, original_name, display_name,
              state, error_code, created_at, updated_at
            ) VALUES (?, NULL, ?, ?, 'failed', 'start_failed', ?, ?)`
          )
          .run(knowledgeItemId, originalName, sanitizeDisplayName(originalName), now, now)
        database
          .prepare(
            `INSERT INTO imports (
              import_id, knowledge_item_id, state, bytes_copied,
              cancellation_requested, error_code, created_at, updated_at
            ) VALUES (?, ?, 'failed', 0, 0, 'start_failed', ?, ?)`
          )
          .run(randomUUID(), knowledgeItemId, now, now)
      })
    } catch (err) {
      this.#log.error(
        {
          event: 'knowledge.import.start_failure_record_failed',
          err,
          originalError: cause,
          projectId: this.#projectId
        },
        'Failed to record the knowledge import start failure'
      )
    }
  }

  #startImport(sourcePath: string): void {
    this.#faults.beforeImportRowCreate?.()
    const knowledgeItemId = randomUUID()
    const importId = randomUUID()
    const originalName = basename(sourcePath).normalize('NFC')
    const displayName = sanitizeDisplayName(originalName)
    const now = new Date().toISOString()
    this.#database.immediate((database) => {
      database
        .prepare(
          `INSERT INTO knowledge_items (
            knowledge_item_id, file_record_id, original_name, display_name,
            state, error_code, created_at, updated_at
          ) VALUES (?, NULL, ?, ?, 'importing', NULL, ?, ?)`
        )
        .run(knowledgeItemId, originalName, displayName, now, now)
      database
        .prepare(
          `INSERT INTO imports (
            import_id, knowledge_item_id, state, bytes_copied,
            cancellation_requested, error_code, created_at, updated_at
          ) VALUES (?, ?, 'copying', 0, 0, NULL, ?, ?)`
        )
        .run(importId, knowledgeItemId, now, now)
    })
    const controller = new AbortController()
    this.#controllers.set(knowledgeItemId, controller)
    const operation = this.#importOne({
      sourcePath,
      originalName,
      displayName,
      knowledgeItemId,
      importId,
      signal: controller.signal
    })
    this.#operations.set(knowledgeItemId, operation)
    void operation
      .catch(() => undefined)
      .finally(() => {
        this.#controllers.delete(knowledgeItemId)
        this.#operations.delete(knowledgeItemId)
      })
  }

  async #importOne(input: {
    sourcePath: string
    originalName: string
    displayName: string
    knowledgeItemId: string
    importId: string
    signal: AbortSignal
  }): Promise<KnowledgeItem> {
    const startedAt = Date.now()
    const tempRelativePath = `${PROJECT_TEMP_DIRECTORY}/imports/${input.importId}.partial`
    let uncommittedDestination: string | undefined
    try {
      const before = await lstat(input.sourcePath)
      if (!before.isFile() || before.isSymbolicLink()) {
        throw new KnowledgeImportError('source_not_regular', 'Source must be a regular file')
      }
      if (before.size <= 0 || before.size > MAX_FILE_BYTES) {
        throw new KnowledgeImportError('file_size_invalid', 'Source file size is unsupported')
      }
      const capability = await inspectCapability(input.sourcePath, input.originalName, before.size)
      await this.#filesystem.ensureDirectory(`${PROJECT_TEMP_DIRECTORY}/imports`)
      await this.#faults.beforeTempOpen?.()
      const created = await this.#filesystem.createExclusiveFile(tempRelativePath)
      const handle = created.handle
      const hash = createHash('sha256')
      let copied = 0
      let lastReported = 0
      try {
        for await (const chunk of createReadStream(input.sourcePath, { signal: input.signal })) {
          const bytes = Buffer.from(chunk)
          await handle.write(bytes)
          hash.update(bytes)
          copied += bytes.byteLength
          if (copied - lastReported >= 4 * 1024 * 1024) {
            lastReported = copied
            this.#database.immediate((database) => {
              database
                .prepare('UPDATE imports SET bytes_copied = ?, updated_at = ? WHERE import_id = ?')
                .run(copied, new Date().toISOString(), input.importId)
            })
          }
        }
        await handle.sync()
      } finally {
        await handle.close()
      }
      if (input.signal.aborted) throw new KnowledgeImportError('cancelled', 'Import cancelled')
      const after = await lstat(input.sourcePath)
      if (
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        copied !== before.size
      ) {
        throw new KnowledgeImportError('source_changed', 'Source changed while it was copied')
      }
      const sha256 = hash.digest('hex')
      const publication = await this.#serializePublication(async () => {
        const duplicate = this.#database.immediate(
          (database) =>
            database
              .prepare(
                `SELECT knowledge_items.knowledge_item_id
                   FROM knowledge_items
                   JOIN file_records USING (file_record_id)
                  WHERE file_records.sha256 = ? AND knowledge_items.state = 'stored'`
              )
              .get(sha256) as { knowledge_item_id: string } | undefined
        )
        if (duplicate) {
          await this.#filesystem.removeFile(tempRelativePath)
          this.#database.immediate((database) => {
            database
              .prepare('DELETE FROM knowledge_items WHERE knowledge_item_id = ?')
              .run(input.knowledgeItemId)
          })
          return {
            duplicate: true,
            item: this.list().find(
              (item) => item.knowledgeItemId === duplicate.knowledge_item_id
            ) as KnowledgeItem
          }
        }
        const relativePath = `knowledge/originals/sha256/${sha256.slice(0, 2)}/${sha256}/${input.displayName}`
        await this.#filesystem.ensureDirectory(
          `knowledge/originals/sha256/${sha256.slice(0, 2)}/${sha256}`
        )
        const destination = await this.#filesystem.publish(tempRelativePath, relativePath)
        uncommittedDestination = relativePath
        await syncDirectory(dirname(destination))
        const fileRecordId = randomUUID()
        const completedAt = new Date().toISOString()
        this.#database.immediate((database) => {
          database
            .prepare(
              `INSERT INTO file_records (
                file_record_id, sha256, byte_size, mime_type, extension, relative_path, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              fileRecordId,
              sha256,
              copied,
              capability.mimeType,
              capability.extension,
              relativePath,
              completedAt
            )
          database
            .prepare(
              `UPDATE knowledge_items
                  SET file_record_id = ?, state = 'stored', error_code = NULL, updated_at = ?
                WHERE knowledge_item_id = ?`
            )
            .run(fileRecordId, completedAt, input.knowledgeItemId)
          database
            .prepare(
              `UPDATE imports
                  SET state = 'stored', bytes_copied = ?, error_code = NULL, updated_at = ?
                WHERE import_id = ?`
            )
            .run(copied, completedAt, input.importId)
        })
        uncommittedDestination = undefined
        return {
          duplicate: false,
          item: this.list().find(
            (item) => item.knowledgeItemId === input.knowledgeItemId
          ) as KnowledgeItem
        }
      })
      if (publication.duplicate) return publication.item
      const stored = publication.item
      await this.#onStored?.(stored)
      this.#log.info(
        {
          event: 'knowledge.import.stored',
          projectId: this.#projectId,
          knowledgeItemId: input.knowledgeItemId,
          byteSize: copied,
          mimeType: capability.mimeType,
          durationMs: Date.now() - startedAt
        },
        'Knowledge original imported'
      )
      return stored
    } catch (err) {
      try {
        await this.#filesystem.removeFile(tempRelativePath)
      } catch (cleanupErr) {
        this.#log.error(
          {
            event: 'knowledge.import.temp_cleanup_failed',
            err: cleanupErr,
            knowledgeItemId: input.knowledgeItemId
          },
          'Failed to clean import temporary file'
        )
      }
      if (uncommittedDestination) {
        try {
          await this.#filesystem.removeFile(uncommittedDestination)
        } catch (cleanupErr) {
          this.#log.error(
            {
              event: 'knowledge.import.destination_cleanup_failed',
              err: cleanupErr,
              knowledgeItemId: input.knowledgeItemId
            },
            'Failed to clean unpublished import destination'
          )
        }
      }
      const cancelled =
        input.signal.aborted || (err instanceof KnowledgeImportError && err.code === 'cancelled')
      const code = cancelled
        ? 'cancelled'
        : err instanceof KnowledgeImportError
          ? err.code
          : (err as NodeJS.ErrnoException).code === 'ENOSPC'
            ? 'insufficient_disk_space'
            : 'copy_failed'
      const failedAt = new Date().toISOString()
      try {
        this.#database.immediate((database) => {
          database
            .prepare(
              'UPDATE knowledge_items SET state = ?, error_code = ?, updated_at = ? WHERE knowledge_item_id = ?'
            )
            .run(cancelled ? 'cancelled' : 'failed', code, failedAt, input.knowledgeItemId)
          database
            .prepare(
              'UPDATE imports SET state = ?, error_code = ?, updated_at = ? WHERE import_id = ?'
            )
            .run(cancelled ? 'cancelled' : 'failed', code, failedAt, input.importId)
        })
      } catch (databaseErr) {
        this.#log.error(
          {
            event: 'knowledge.import.failure_state_persist_failed',
            err: databaseErr,
            projectId: this.#projectId,
            knowledgeItemId: input.knowledgeItemId,
            importId: input.importId,
            originalError: err
          },
          'Failed to persist the original import failure state'
        )
      }
      this.#log.error(
        {
          event: 'knowledge.import.failed',
          err,
          projectId: this.#projectId,
          knowledgeItemId: input.knowledgeItemId,
          errorCode: code,
          durationMs: Date.now() - startedAt
        },
        'Knowledge original import failed'
      )
      throw new KnowledgeImportError(code, 'Knowledge import failed', { cause: err })
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation, operation)
    this.#queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  #serializePublication<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#publicationQueue.then(operation, operation)
    this.#publicationQueue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

type KnowledgeListRow = KnowledgeItemTable &
  Partial<FileRecordTable> & {
    bytes_copied: number
    parse_state: string | null
    normalization_state: 'staging' | 'published' | 'failed' | null
    active_parse_revision_id: string | null
    active_normalization_run_id: string | null
    block_count: number | null
    asset_count: number | null
    activated_at: string | null
  }

function toKnowledgeItem(row: KnowledgeListRow): KnowledgeItem {
  return knowledgeItemSchema.parse({
    knowledgeItemId: row.knowledge_item_id,
    originalName: row.original_name,
    displayName: row.display_name,
    state: row.state,
    errorCode: row.error_code,
    mimeType: row.mime_type ?? null,
    extension: row.extension ?? null,
    byteSize: row.byte_size ?? null,
    bytesCopied: row.bytes_copied,
    sha256: row.sha256 ?? null,
    parseState: row.parse_state,
    normalizationState: row.normalization_state,
    activeParseRevisionId: row.active_parse_revision_id,
    activeNormalizationRunId: row.active_normalization_run_id,
    blockCount: row.block_count ?? 0,
    assetCount: row.asset_count ?? 0,
    activatedAt: row.activated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
}

function sanitizeDisplayName(value: string): string {
  const extension = extname(value).toLowerCase()
  const stem = value.slice(0, Math.max(0, value.length - extension.length))
  const sanitized =
    Array.from(stem)
      .map((character) => {
        const code = character.charCodeAt(0)
        return code < 32 || code === 127 || '/\\:'.includes(character) ? '_' : character
      })
      .join('')
      .trim() || 'source'
  return `${sanitized.slice(0, 180 - extension.length)}${extension}`
}

async function inspectCapability(
  path: string,
  originalName: string,
  size: number
): Promise<{ extension: string; mimeType: string }> {
  const extension = extname(originalName).slice(1).toLowerCase()
  if (extension === 'doc' || extension === 'ppt') {
    throw new KnowledgeImportError('legacy_format_unsupported', 'Legacy DOC/PPT is unsupported')
  }
  if (!(SUPPORTED_KNOWLEDGE_EXTENSIONS as readonly string[]).includes(extension)) {
    throw new KnowledgeImportError('format_unsupported', 'Source format is unsupported')
  }
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(Math.min(32, size))
    await handle.read(head, 0, head.length, 0)
    const tail = Buffer.alloc(Math.min(2 * 1024 * 1024, size))
    await handle.read(tail, 0, tail.length, Math.max(0, size - tail.length))
    const zip = head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    const checks: Record<string, { valid: boolean; mimeType: string }> = {
      pdf: { valid: head.subarray(0, 5).toString() === '%PDF-', mimeType: 'application/pdf' },
      docx: {
        valid: zip && tail.includes(Buffer.from('word/')),
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      },
      pptx: {
        valid: zip && tail.includes(Buffer.from('ppt/')),
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      },
      png: {
        valid: head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        mimeType: 'image/png'
      },
      jpg: {
        valid: head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
        mimeType: 'image/jpeg'
      },
      jpeg: {
        valid: head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
        mimeType: 'image/jpeg'
      },
      gif: {
        valid: ['GIF87a', 'GIF89a'].includes(head.subarray(0, 6).toString()),
        mimeType: 'image/gif'
      },
      webp: {
        valid:
          head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WEBP',
        mimeType: 'image/webp'
      },
      tif: {
        valid: ['II*\u0000', 'MM\u0000*'].includes(head.subarray(0, 4).toString()),
        mimeType: 'image/tiff'
      },
      tiff: {
        valid: ['II*\u0000', 'MM\u0000*'].includes(head.subarray(0, 4).toString()),
        mimeType: 'image/tiff'
      },
      bmp: { valid: head.subarray(0, 2).toString() === 'BM', mimeType: 'image/bmp' }
    }
    const capability = checks[extension]
    if (!capability?.valid)
      throw new KnowledgeImportError('mime_mismatch', 'File content does not match its extension')
    return { extension, mimeType: capability.mimeType }
  } finally {
    await handle.close()
  }
}

async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, 'r')
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}
