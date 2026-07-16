import { createHash, randomUUID } from 'node:crypto'
import { copyFile, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { Logger } from 'pino'
import { mineruRawManifestSchema, type MineruRawManifest } from '../../shared/contracts/mineru'
import type { MineruProviderConfig } from '../../shared/contracts/providers'
import { getProviderCapability } from '../providers/capability-registry'
import type { JobStore } from '../jobs/job-store'
import type { JobHandlerContext, JobHandlerRegistry } from '../jobs/scheduler/job-handler-registry'
import type {
  MineruRemoteState,
  ParseRevisionTable,
  ParseTaskState,
  ParseTaskTable
} from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { resolveProjectPath } from '../project/project-paths'
import { extractMineruArchive } from './mineru-archive'
import type { MineruGateway } from './mineru-gateway'

const DOWNLOAD_LIMIT_BYTES = 512 * 1024 * 1024
const POLL_DELAY_MS = 2_000

export interface SensitiveValueCipher {
  encrypt(value: string): string
  decrypt(ciphertext: string): string
}

export interface MineruProviderAccess {
  getConfiguredProvider(): Promise<MineruProviderConfig>
  withConfiguredProvider<T>(
    operation: (config: MineruProviderConfig, credential: string) => Promise<T>
  ): Promise<T>
}

export interface MineruWorkflowFaults {
  afterRemoteIdPersisted?(): void | Promise<void>
  afterUpload?(): void | Promise<void>
  afterArchivePersisted?(): void | Promise<void>
  afterExtraction?(): void | Promise<void>
  afterPublishRename?(): void | Promise<void>
}

export interface MineruWorkReferences {
  parseTaskIds: string[]
  parseRevisionIds: string[]
  normalizationRunIds: string[]
}

interface SourceRow {
  original_name: string
  relative_path: string
  sha256: string
  byte_size: number
  file_record_id: string
  extension: string
}

export class MineruWorkflowService {
  readonly #projectRoot: string
  readonly #projectId: string
  readonly #database: ProjectDatabase
  readonly #jobs: JobStore
  readonly #providers: MineruProviderAccess
  readonly #cipher: SensitiveValueCipher
  readonly #gateway: MineruGateway
  readonly #log: Pick<Logger, 'info' | 'warn' | 'error'>
  readonly #faults: MineruWorkflowFaults
  readonly #now: () => Date
  readonly #createId: () => string

  constructor(options: {
    projectRoot: string
    projectId: string
    database: ProjectDatabase
    jobs: JobStore
    providers: MineruProviderAccess
    cipher: SensitiveValueCipher
    gateway: MineruGateway
    log: Pick<Logger, 'info' | 'warn' | 'error'>
    faults?: MineruWorkflowFaults
    now?: () => Date
    createId?: () => string
  }) {
    this.#projectRoot = options.projectRoot
    this.#projectId = options.projectId
    this.#database = options.database
    this.#jobs = options.jobs
    this.#providers = options.providers
    this.#cipher = options.cipher
    this.#gateway = options.gateway
    this.#log = options.log
    this.#faults = options.faults ?? {}
    this.#now = options.now ?? (() => new Date())
    this.#createId = options.createId ?? randomUUID
  }

  async start(knowledgeItemId: string): Promise<string> {
    const active = this.#database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT parse_tasks.parse_task_id
               FROM parse_tasks
               LEFT JOIN parse_revisions USING (parse_task_id)
               LEFT JOIN normalization_runs USING (parse_revision_id, knowledge_item_id)
              WHERE parse_tasks.knowledge_item_id = ?
                AND (
                  parse_tasks.state NOT IN ('succeeded', 'failed', 'cancelled')
                  OR normalization_runs.state = 'staging'
                )
              ORDER BY parse_tasks.created_at DESC, parse_tasks.parse_task_id DESC
              LIMIT 1`
          )
          .get(knowledgeItemId) as { parse_task_id: string } | undefined
    )
    if (active !== undefined) return active.parse_task_id
    const config = await this.#providers.getConfiguredProvider()
    if (config.role !== 'mineru' || config.fileSizeLimitMb === null) {
      throw new Error('MinerU provider configuration is invalid')
    }
    const source = this.#readSource(knowledgeItemId)
    if (!getProviderCapability('mineru').supportedFormats.includes(source.extension)) {
      throw new Error(`MinerU does not support the imported .${source.extension} format`)
    }
    if (source.byte_size > config.fileSizeLimitMb * 1024 * 1024) {
      throw new Error('Knowledge source exceeds the configured MinerU file limit')
    }
    const parseTaskId = this.#createId()
    const now = this.#now().toISOString()
    const fingerprint = providerFingerprint(config)
    this.#database.immediate((database) => {
      database
        .prepare(
          `INSERT INTO parse_tasks (
             parse_task_id, knowledge_item_id, source_file_record_id, provider_id,
             provider_fingerprint, model_version, state, created_at, updated_at
           ) VALUES (?, ?, ?, 'mineru', ?, ?, 'queued', ?, ?)`
        )
        .run(
          parseTaskId,
          knowledgeItemId,
          source.file_record_id,
          fingerprint,
          config.model,
          now,
          now
        )
      insertEvent(database, parseTaskId, null, 'queued', 'parse.requested', null, null, now)
    })
    this.#jobs.enqueue({
      type: 'mineru.submit',
      payload: { parseTaskId },
      deduplicationKey: `mineru-submit:${parseTaskId}`,
      maxAttempts: 8
    })
    this.#log.info(
      { event: 'mineru.parse.queued', projectId: this.#projectId, parseTaskId, knowledgeItemId },
      'MinerU parse queued'
    )
    return parseTaskId
  }

  cancelForKnowledgeItem(knowledgeItemId: string): MineruWorkReferences {
    const now = this.#now().toISOString()
    const result = this.#database.immediate((database) => {
      const references = readWorkReferences(database, knowledgeItemId)
      const tasks = database
        .prepare(
          `SELECT * FROM parse_tasks
             WHERE knowledge_item_id = ?
               AND state NOT IN ('succeeded', 'failed', 'cancelled')`
        )
        .all(knowledgeItemId) as ParseTaskTable[]
      for (const task of tasks) {
        database
          .prepare(
            `UPDATE parse_tasks
                SET state = 'cancelled', upload_url_ciphertext = NULL,
                    download_url_ciphertext = NULL, completed_at = ?, updated_at = ?
              WHERE parse_task_id = ? AND state NOT IN ('succeeded', 'failed', 'cancelled')`
          )
          .run(now, now, task.parse_task_id)
        insertEvent(
          database,
          task.parse_task_id,
          task.state,
          'cancelled',
          'parse.cancelled',
          task.remote_state,
          null,
          now
        )
      }
      database
        .prepare(
          `UPDATE normalization_runs
              SET state = 'failed', error_code = 'cancelled', updated_at = ?
            WHERE knowledge_item_id = ? AND state = 'staging'`
        )
        .run(now, knowledgeItemId)
      return references
    })
    if (result.parseTaskIds.length > 0 || result.normalizationRunIds.length > 0) {
      this.#log.info(
        {
          event: 'mineru.parse.cancellation_requested',
          projectId: this.#projectId,
          knowledgeItemId,
          parseTaskCount: result.parseTaskIds.length,
          parseRevisionCount: result.parseRevisionIds.length,
          normalizationRunCount: result.normalizationRunIds.length
        },
        'MinerU parsing cancellation requested'
      )
    }
    return result
  }

  async cleanupCancelledArtifacts(
    knowledgeItemId: string,
    references: MineruWorkReferences
  ): Promise<void> {
    const stagingPaths = this.#database.immediate((database) => {
      if (references.parseRevisionIds.length === 0) return []
      const placeholders = references.parseRevisionIds.map(() => '?').join(', ')
      return database
        .prepare(
          `SELECT relative_path FROM parse_revisions
             WHERE knowledge_item_id = ?
               AND parse_revision_id IN (${placeholders})
               AND state = 'staging'`
        )
        .pluck()
        .all(knowledgeItemId, ...references.parseRevisionIds) as string[]
    })
    const paths = [
      ...references.parseTaskIds.map((parseTaskId) =>
        resolveProjectPath(this.#projectRoot, `.writellm/temp/mineru/${parseTaskId}`)
      ),
      ...references.normalizationRunIds.map((normalizationRunId) =>
        resolveProjectPath(
          this.#projectRoot,
          `.writellm/temp/normalization/${normalizationRunId}.staging`
        )
      ),
      ...stagingPaths.map((relativePath) => resolveProjectPath(this.#projectRoot, relativePath))
    ]
    await this.#removeArtifacts(paths, knowledgeItemId, 'cancelled')
  }

  async cleanupAllArtifacts(
    knowledgeItemId: string,
    references: MineruWorkReferences
  ): Promise<void> {
    const paths = [
      resolveProjectPath(this.#projectRoot, `knowledge/parsed/${knowledgeItemId}`),
      ...references.parseTaskIds.map((parseTaskId) =>
        resolveProjectPath(this.#projectRoot, `.writellm/temp/mineru/${parseTaskId}`)
      ),
      ...references.normalizationRunIds.map((normalizationRunId) =>
        resolveProjectPath(
          this.#projectRoot,
          `.writellm/temp/normalization/${normalizationRunId}.staging`
        )
      )
    ]
    await this.#removeArtifacts(paths, knowledgeItemId, 'deleted')
  }

  cancel(parseTaskId: string): void {
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const task = readTask(database, parseTaskId)
      if (task === undefined || terminal(task.state)) return
      database
        .prepare(
          `UPDATE parse_tasks
              SET state = 'cancelled', upload_url_ciphertext = NULL,
                  download_url_ciphertext = NULL, completed_at = ?, updated_at = ?
            WHERE parse_task_id = ?`
        )
        .run(now, now, parseTaskId)
      insertEvent(
        database,
        parseTaskId,
        task.state,
        'cancelled',
        'parse.cancelled',
        task.remote_state,
        null,
        now
      )
    })
  }

  async #removeArtifacts(
    paths: readonly string[],
    knowledgeItemId: string,
    reason: 'cancelled' | 'deleted'
  ): Promise<void> {
    try {
      await Promise.all(paths.map((path) => rm(path, { recursive: true, force: true })))
    } catch (err) {
      this.#log.error(
        {
          event: `mineru.artifact_cleanup.${reason}.failed`,
          err,
          projectId: this.#projectId,
          knowledgeItemId,
          artifactCount: paths.length
        },
        'Failed to clean MinerU artifacts'
      )
      throw new Error('MinerU artifact cleanup failed', { cause: err })
    }
    this.#log.info(
      {
        event: `mineru.artifact_cleanup.${reason}.completed`,
        projectId: this.#projectId,
        knowledgeItemId,
        artifactCount: paths.length
      },
      'MinerU artifacts cleaned'
    )
  }

  recordRetry(parseTaskId: string, error: unknown): void {
    const now = this.#now().toISOString()
    const errorCode = safeOperationErrorCode(error)
    this.#database.immediate((database) => {
      const task = readTask(database, parseTaskId)
      if (task === undefined || terminal(task.state)) return
      database
        .prepare(
          `UPDATE parse_tasks SET retry_count = retry_count + 1,
                  error_code = ?, updated_at = ? WHERE parse_task_id = ?`
        )
        .run(errorCode, now, parseTaskId)
      insertEvent(
        database,
        parseTaskId,
        task.state,
        task.state,
        'operation.retry_scheduled',
        task.remote_state,
        errorCode,
        now
      )
    })
  }

  recordPermanentFailure(parseTaskId: string, error: unknown): void {
    const now = this.#now().toISOString()
    const errorCode = safeOperationErrorCode(error)
    this.#database.immediate((database) => {
      const task = readTask(database, parseTaskId)
      if (task === undefined || terminal(task.state) || task.state === 'cancelled') return
      database
        .prepare(
          `UPDATE parse_tasks SET state = 'failed', error_code = ?, completed_at = ?, updated_at = ?
             WHERE parse_task_id = ? AND state NOT IN ('succeeded', 'failed', 'cancelled')`
        )
        .run(errorCode, now, now, parseTaskId)
      insertEvent(
        database,
        parseTaskId,
        task.state,
        'failed',
        'operation.failed_permanently',
        task.remote_state,
        errorCode,
        now
      )
    })
    this.#log.error(
      {
        event: 'mineru.parse.failed_permanently',
        err: error,
        projectId: this.#projectId,
        parseTaskId,
        errorCode
      },
      'MinerU parse reached a terminal failure'
    )
  }

  async handleSubmit(context: JobHandlerContext): Promise<void> {
    const parseTaskId = payloadTaskId(context)
    let task = this.#requireTask(parseTaskId)
    if (terminal(task.state)) return
    const source = this.#readSource(task.knowledge_item_id)

    if (task.remote_task_id === null) {
      this.#transition(task, 'allocating', 'remote.allocate.started')
      const allocated = await this.#providers.withConfiguredProvider((config, credential) =>
        this.#gateway.allocate(
          config,
          credential,
          { parseTaskId, fileName: basename(source.original_name) },
          context.signal
        )
      )
      const ciphertext = this.#cipher.encrypt(allocated.uploadUrl)
      const now = this.#now().toISOString()
      this.#database.immediate((database) => {
        const current = requireTask(database, parseTaskId)
        if (current.state === 'cancelled') return
        database
          .prepare(
            `UPDATE parse_tasks
                SET state = 'awaiting_upload', remote_task_id = ?, upload_url_ciphertext = ?,
                    trace_id = ?, submitted_at = ?, updated_at = ?
              WHERE parse_task_id = ? AND remote_task_id IS NULL`
          )
          .run(allocated.remoteTaskId, ciphertext, allocated.traceId, now, now, parseTaskId)
        insertEvent(
          database,
          parseTaskId,
          current.state,
          'awaiting_upload',
          'remote.id.persisted',
          null,
          null,
          now
        )
      })
      await this.#faults.afterRemoteIdPersisted?.()
      task = this.#requireTask(parseTaskId)
    }
    if (task.state === 'cancelled' || terminal(task.state)) return
    if (task.upload_url_ciphertext === null) {
      if (task.state === 'polling' || task.state === 'downloading') return
      throw new Error('MinerU upload recovery capability is missing')
    }
    const uploadUrl = this.#cipher.decrypt(task.upload_url_ciphertext)
    await this.#gateway.upload(
      {
        uploadUrl,
        sourcePath: resolveProjectPath(this.#projectRoot, source.relative_path),
        expectedBytes: source.byte_size
      },
      context.signal
    )
    await this.#faults.afterUpload?.()
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const current = requireTask(database, parseTaskId)
      if (current.state === 'cancelled') return
      database
        .prepare(
          `UPDATE parse_tasks
              SET state = 'polling', upload_url_ciphertext = NULL,
                  remote_state = 'pending', uploaded_at = ?, updated_at = ?
            WHERE parse_task_id = ?`
        )
        .run(now, now, parseTaskId)
      insertEvent(
        database,
        parseTaskId,
        current.state,
        'polling',
        'source.uploaded',
        'pending',
        null,
        now
      )
    })
    this.#enqueuePoll(parseTaskId, 0)
  }

  async handlePoll(context: JobHandlerContext): Promise<void> {
    const parseTaskId = payloadTaskId(context)
    const task = this.#requireTask(parseTaskId)
    if (terminal(task.state)) return
    if (task.remote_task_id === null) throw new Error('MinerU remote task ID is missing')
    const result = await this.#providers.withConfiguredProvider((config, credential) =>
      this.#gateway.poll(
        config,
        credential,
        { parseTaskId, remoteTaskId: task.remote_task_id as string },
        context.signal
      )
    )
    if (this.#requireTask(parseTaskId).state === 'cancelled') return
    const now = this.#now().toISOString()
    const nextPollCount = task.poll_count + 1
    if (result.remoteState === 'failed') {
      this.#database.immediate((database) => {
        const current = requireTask(database, parseTaskId)
        if (current.state === 'cancelled') return
        database
          .prepare(
            `UPDATE parse_tasks SET state = 'failed', remote_state = 'failed',
                    trace_id = COALESCE(?, trace_id), poll_count = ?, error_code = ?,
                    completed_at = ?, updated_at = ? WHERE parse_task_id = ?`
          )
          .run(
            result.traceId,
            nextPollCount,
            result.remoteErrorCode ?? 'remote_parse_failed',
            now,
            now,
            parseTaskId
          )
        insertEvent(
          database,
          parseTaskId,
          current.state,
          'failed',
          'remote.parse.failed',
          'failed',
          result.remoteErrorCode ?? 'remote_parse_failed',
          now
        )
      })
      return
    }
    if (result.remoteState === 'done') {
      if (result.downloadUrl === undefined) throw new Error('MinerU result URL is missing')
      const ciphertext = this.#cipher.encrypt(result.downloadUrl)
      this.#database.immediate((database) => {
        const current = requireTask(database, parseTaskId)
        if (current.state === 'cancelled') return
        database
          .prepare(
            `UPDATE parse_tasks SET state = 'downloading', remote_state = 'done',
                    download_url_ciphertext = ?, trace_id = COALESCE(?, trace_id),
                    poll_count = ?, updated_at = ? WHERE parse_task_id = ?`
          )
          .run(ciphertext, result.traceId, nextPollCount, now, parseTaskId)
        insertEvent(
          database,
          parseTaskId,
          current.state,
          'downloading',
          'remote.parse.completed',
          'done',
          null,
          now
        )
      })
      this.#jobs.enqueue({
        type: 'mineru.download',
        payload: { parseTaskId },
        deduplicationKey: `mineru-download:${parseTaskId}`,
        maxAttempts: 8
      })
      return
    }
    this.#database.immediate((database) => {
      const current = requireTask(database, parseTaskId)
      if (current.state === 'cancelled') return
      database
        .prepare(
          `UPDATE parse_tasks SET remote_state = ?, trace_id = COALESCE(?, trace_id),
                  poll_count = ?, updated_at = ? WHERE parse_task_id = ?`
        )
        .run(result.remoteState, result.traceId, nextPollCount, now, parseTaskId)
      insertEvent(
        database,
        parseTaskId,
        current.state,
        'polling',
        'remote.poll.observed',
        result.remoteState,
        null,
        now
      )
    })
    context.reportProgress({
      stage: result.remoteState,
      ...(result.extractedPages === null ? {} : { completed: result.extractedPages }),
      ...(result.totalPages === null ? {} : { total: result.totalPages })
    })
    this.#enqueuePoll(parseTaskId, nextPollCount)
  }

  async handleDownload(context: JobHandlerContext): Promise<void> {
    const parseTaskId = payloadTaskId(context)
    let task = this.#requireTask(parseTaskId)
    if (terminal(task.state)) return
    if (task.remote_task_id === null) throw new Error('MinerU remote task ID is missing')
    const source = this.#readSource(task.knowledge_item_id)
    const revision = this.#ensureRevision(task, source.sha256)
    const finalPath = resolveProjectPath(this.#projectRoot, revision.relative_path)
    if (await this.#reconcilePublishedDirectory(task, revision, finalPath)) return

    const tempRoot = resolveProjectPath(
      this.#projectRoot,
      `.writellm/temp/mineru/${parseTaskId}/${revision.parse_revision_id}`
    )
    const downloadPath = `${tempRoot}.zip.partial`
    const stagingPath = `${tempRoot}.staging`
    const archivePath = `${stagingPath}/raw/provider-result.zip`

    if (task.state === 'downloading') {
      if (task.download_url_ciphertext === null) {
        throw new Error('MinerU download recovery capability is missing')
      }
      await rm(downloadPath, { force: true })
      await mkdir(dirname(downloadPath), { recursive: true })
      let downloaded: Awaited<ReturnType<MineruGateway['download']>>
      try {
        downloaded = await this.#gateway.download(
          {
            downloadUrl: this.#cipher.decrypt(task.download_url_ciphertext),
            destinationPath: downloadPath,
            maxBytes: DOWNLOAD_LIMIT_BYTES
          },
          context.signal
        )
      } catch (err) {
        if (isExpiredDownloadCapability(err)) {
          this.#log.warn(
            { event: 'mineru.download.capability_expired', err, parseTaskId },
            'MinerU download capability expired; refreshing through the existing remote task'
          )
          const now = this.#now().toISOString()
          this.#database.immediate((database) => {
            const current = requireTask(database, parseTaskId)
            database
              .prepare(
                `UPDATE parse_tasks SET state = 'polling', download_url_ciphertext = NULL,
                        updated_at = ? WHERE parse_task_id = ?`
              )
              .run(now, parseTaskId)
            insertEvent(
              database,
              parseTaskId,
              current.state,
              'polling',
              'download.capability.refresh_requested',
              current.remote_state,
              null,
              now
            )
          })
          this.#enqueuePoll(parseTaskId, task.poll_count)
          return
        }
        throw err
      }
      await rm(stagingPath, { recursive: true, force: true })
      await mkdir(dirname(archivePath), { recursive: true })
      await copyFile(downloadPath, archivePath)
      await syncFile(archivePath)
      const now = this.#now().toISOString()
      this.#database.immediate((database) => {
        const current = requireTask(database, parseTaskId)
        if (current.state === 'cancelled') return
        database
          .prepare(
            `UPDATE parse_revisions SET archive_sha256 = ?, archive_byte_size = ?, updated_at = ?
              WHERE parse_revision_id = ?`
          )
          .run(downloaded.sha256, downloaded.byteSize, now, revision.parse_revision_id)
        database
          .prepare(
            `UPDATE parse_tasks SET state = 'extracting', download_url_ciphertext = NULL,
                    updated_at = ? WHERE parse_task_id = ?`
          )
          .run(now, parseTaskId)
        insertEvent(
          database,
          parseTaskId,
          current.state,
          'extracting',
          'archive.persisted',
          current.remote_state,
          null,
          now
        )
      })
      await this.#faults.afterArchivePersisted?.()
      task = this.#requireTask(parseTaskId)
    }

    if (task.state === 'extracting') {
      const currentRevision = this.#requireRevision(revision.parse_revision_id)
      if (currentRevision.archive_sha256 === null || currentRevision.archive_byte_size === null) {
        throw new Error('MinerU archive metadata is missing')
      }
      await rm(`${stagingPath}/raw/extracted`, { recursive: true, force: true })
      const extracted = await extractMineruArchive({
        archivePath,
        destinationRoot: `${stagingPath}/raw/extracted`,
        manifestPrefix: 'raw/extracted'
      })
      const manifest: MineruRawManifest = {
        schemaVersion: 1,
        parseRevisionId: revision.parse_revision_id,
        knowledgeItemId: task.knowledge_item_id,
        sourceSha256: source.sha256,
        providerId: 'mineru',
        providerApiVersion: 'v4',
        providerFingerprint: task.provider_fingerprint,
        modelVersion: task.model_version,
        remoteTaskId: task.remote_task_id as string,
        archive: {
          relativePath: 'raw/provider-result.zip',
          sha256: currentRevision.archive_sha256,
          byteSize: currentRevision.archive_byte_size
        },
        files: extracted.files,
        createdAt: this.#now().toISOString()
      }
      const bytes = Buffer.from(`${JSON.stringify(mineruRawManifestSchema.parse(manifest))}\n`)
      await rm(`${stagingPath}/manifest.json`, { force: true })
      await writeDurable(`${stagingPath}/manifest.json`, bytes)
      const manifestSha256 = createHash('sha256').update(bytes).digest('hex')
      const now = this.#now().toISOString()
      this.#database.immediate((database) => {
        const current = requireTask(database, parseTaskId)
        if (current.state === 'cancelled') return
        database
          .prepare(
            `UPDATE parse_revisions SET expanded_byte_size = ?, file_count = ?,
                    manifest_sha256 = ?, updated_at = ? WHERE parse_revision_id = ?`
          )
          .run(
            extracted.expandedByteSize,
            extracted.files.length,
            manifestSha256,
            now,
            revision.parse_revision_id
          )
        database
          .prepare(
            "UPDATE parse_tasks SET state = 'publishing', updated_at = ? WHERE parse_task_id = ?"
          )
          .run(now, parseTaskId)
        insertEvent(
          database,
          parseTaskId,
          current.state,
          'publishing',
          'archive.extracted',
          current.remote_state,
          null,
          now
        )
      })
      await this.#faults.afterExtraction?.()
      task = this.#requireTask(parseTaskId)
    }

    if (task.state === 'publishing') {
      await mkdir(dirname(finalPath), { recursive: true })
      await rename(stagingPath, finalPath)
      await this.#faults.afterPublishRename?.()
      await this.#commitPublished(task, this.#requireRevision(revision.parse_revision_id))
      await rm(downloadPath, { force: true })
    }
  }

  #enqueuePoll(parseTaskId: string, sequence: number): void {
    this.#jobs.enqueue({
      type: 'mineru.poll',
      payload: { parseTaskId },
      deduplicationKey: `mineru-poll:${parseTaskId}:${sequence}`,
      maxAttempts: 8,
      runAfter: new Date(this.#now().getTime() + POLL_DELAY_MS)
    })
  }

  #readSource(knowledgeItemId: string): SourceRow {
    const row = this.#database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT knowledge_items.original_name, file_records.relative_path,
                    file_records.sha256, file_records.byte_size, file_records.file_record_id,
                    file_records.extension
               FROM knowledge_items JOIN file_records USING (file_record_id)
              WHERE knowledge_item_id = ? AND knowledge_items.state = 'stored'`
          )
          .get(knowledgeItemId) as SourceRow | undefined
    )
    if (row === undefined) throw new Error('Stored knowledge source is unavailable')
    return row
  }

  #requireTask(parseTaskId: string): ParseTaskTable {
    return this.#database.immediate((database) => requireTask(database, parseTaskId))
  }

  #transition(task: ParseTaskTable, state: ParseTaskState, event: string): void {
    if (task.state === state) return
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      database
        .prepare('UPDATE parse_tasks SET state = ?, updated_at = ? WHERE parse_task_id = ?')
        .run(state, now, task.parse_task_id)
      insertEvent(
        database,
        task.parse_task_id,
        task.state,
        state,
        event,
        task.remote_state,
        null,
        now
      )
    })
  }

  #ensureRevision(task: ParseTaskTable, sourceSha256: string): ParseRevisionTable {
    return this.#database.immediate((database) => {
      const existing = database
        .prepare('SELECT * FROM parse_revisions WHERE parse_task_id = ?')
        .get(task.parse_task_id) as ParseRevisionTable | undefined
      if (existing !== undefined) return existing
      const parseRevisionId = this.#createId()
      const next = database
        .prepare(
          'SELECT COALESCE(MAX(revision_number), 0) + 1 FROM parse_revisions WHERE knowledge_item_id = ?'
        )
        .pluck()
        .get(task.knowledge_item_id) as number
      const now = this.#now().toISOString()
      const relativePath = `knowledge/parsed/${task.knowledge_item_id}/${parseRevisionId}`
      database
        .prepare(
          `INSERT INTO parse_revisions (
             parse_revision_id, parse_task_id, knowledge_item_id, revision_number, state,
             source_sha256, provider_id, provider_api_version, provider_fingerprint,
             model_version, remote_task_id, relative_path, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'staging', ?, 'mineru', 'v4', ?, ?, ?, ?, ?, ?)`
        )
        .run(
          parseRevisionId,
          task.parse_task_id,
          task.knowledge_item_id,
          next,
          sourceSha256,
          task.provider_fingerprint,
          task.model_version,
          task.remote_task_id,
          relativePath,
          now,
          now
        )
      return database
        .prepare('SELECT * FROM parse_revisions WHERE parse_revision_id = ?')
        .get(parseRevisionId) as ParseRevisionTable
    })
  }

  #requireRevision(parseRevisionId: string): ParseRevisionTable {
    const row = this.#database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM parse_revisions WHERE parse_revision_id = ?')
          .get(parseRevisionId) as ParseRevisionTable | undefined
    )
    if (row === undefined) throw new Error('MinerU parse revision is missing')
    return row
  }

  async #reconcilePublishedDirectory(
    task: ParseTaskTable,
    revision: ParseRevisionTable,
    finalPath: string
  ): Promise<boolean> {
    try {
      const bytes = await readFile(`${finalPath}/manifest.json`)
      const manifest = mineruRawManifestSchema.parse(JSON.parse(bytes.toString('utf8')))
      const hash = createHash('sha256').update(bytes).digest('hex')
      if (
        manifest.parseRevisionId !== revision.parse_revision_id ||
        manifest.remoteTaskId !== task.remote_task_id ||
        (revision.manifest_sha256 !== null && revision.manifest_sha256 !== hash)
      ) {
        throw new Error('Published MinerU directory provenance does not match')
      }
      await this.#commitPublished(task, { ...revision, manifest_sha256: hash })
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
      this.#log.error(
        { event: 'mineru.publish.reconcile_failed', err, parseTaskId: task.parse_task_id },
        'Failed to reconcile a published MinerU revision'
      )
      throw err
    }
  }

  async #commitPublished(task: ParseTaskTable, revision: ParseRevisionTable): Promise<boolean> {
    const now = this.#now().toISOString()
    const cancelled = this.#database.immediate((database) => {
      const current = requireTask(database, task.parse_task_id)
      if (current.state === 'cancelled') return true
      database
        .prepare(
          `UPDATE parse_revisions SET state = 'raw_published', published_at = ?, updated_at = ?
            WHERE parse_revision_id = ?`
        )
        .run(now, now, revision.parse_revision_id)
      database
        .prepare(
          `UPDATE parse_tasks SET state = 'succeeded', upload_url_ciphertext = NULL,
                  download_url_ciphertext = NULL, completed_at = ?, updated_at = ?
            WHERE parse_task_id = ?`
        )
        .run(now, now, task.parse_task_id)
      insertEvent(
        database,
        task.parse_task_id,
        current.state,
        'succeeded',
        'raw_revision.published',
        current.remote_state,
        null,
        now
      )
      return false
    })
    if (cancelled) {
      await rm(resolveProjectPath(this.#projectRoot, revision.relative_path), {
        recursive: true,
        force: true
      })
      return false
    }
    this.#log.info(
      {
        event: 'mineru.parse.completed',
        projectId: this.#projectId,
        parseTaskId: task.parse_task_id,
        parseRevisionId: revision.parse_revision_id
      },
      'MinerU raw parse revision published'
    )
    this.#jobs.enqueue({
      type: 'mineru.normalize',
      payload: { parseRevisionId: revision.parse_revision_id },
      deduplicationKey: `mineru-normalize:${revision.parse_revision_id}:v1`,
      maxAttempts: 3
    })
    return true
  }
}

export function registerMineruHandlers(
  registry: JobHandlerRegistry,
  service: MineruWorkflowService
): void {
  registry.register('mineru.submit', (context) => audited(service, context, 'submit'), {
    timeoutMs: 10 * 60_000,
    leaseMs: 60_000,
    heartbeatMs: 15_000,
    closePolicy: 'finish'
  })
  registry.register('mineru.poll', (context) => audited(service, context, 'poll'), {
    timeoutMs: 6 * 60_000,
    leaseMs: 60_000,
    heartbeatMs: 15_000,
    closePolicy: 'abort-and-requeue'
  })
  registry.register('mineru.download', (context) => audited(service, context, 'download'), {
    timeoutMs: 30 * 60_000,
    leaseMs: 60_000,
    heartbeatMs: 15_000,
    closePolicy: 'abort-and-requeue'
  })
}

async function audited(
  service: MineruWorkflowService,
  context: JobHandlerContext,
  operation: 'submit' | 'poll' | 'download'
): Promise<void> {
  try {
    if (operation === 'submit') await service.handleSubmit(context)
    else if (operation === 'poll') await service.handlePoll(context)
    else await service.handleDownload(context)
  } catch (err) {
    const value = context.job.payload.parseTaskId
    if (typeof value === 'string') {
      if (context.job.attempts >= context.job.maxAttempts)
        service.recordPermanentFailure(value, err)
      else service.recordRetry(value, err)
    }
    throw err
  }
}

function providerFingerprint(config: MineruProviderConfig): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        providerId: config.providerId,
        baseUrl: config.baseUrl,
        model: config.model,
        batchLimit: config.batchLimit,
        fileSizeLimitMb: config.fileSizeLimitMb
      })
    )
    .digest('hex')
}

function readWorkReferences(
  database: import('better-sqlite3').Database,
  knowledgeItemId: string
): MineruWorkReferences {
  const parseTaskIds = database
    .prepare('SELECT parse_task_id FROM parse_tasks WHERE knowledge_item_id = ?')
    .pluck()
    .all(knowledgeItemId) as string[]
  const parseRevisionIds = database
    .prepare('SELECT parse_revision_id FROM parse_revisions WHERE knowledge_item_id = ?')
    .pluck()
    .all(knowledgeItemId) as string[]
  const normalizationRunIds = database
    .prepare('SELECT normalization_run_id FROM normalization_runs WHERE knowledge_item_id = ?')
    .pluck()
    .all(knowledgeItemId) as string[]
  return { parseTaskIds, parseRevisionIds, normalizationRunIds }
}

function payloadTaskId(context: JobHandlerContext): string {
  const value = context.job.payload.parseTaskId
  if (typeof value !== 'string') throw new Error('MinerU job payload is invalid')
  return value
}

function terminal(state: ParseTaskState): boolean {
  return state === 'succeeded' || state === 'failed' || state === 'cancelled'
}

function readTask(
  database: import('better-sqlite3').Database,
  parseTaskId: string
): ParseTaskTable | undefined {
  return database.prepare('SELECT * FROM parse_tasks WHERE parse_task_id = ?').get(parseTaskId) as
    | ParseTaskTable
    | undefined
}

function requireTask(
  database: import('better-sqlite3').Database,
  parseTaskId: string
): ParseTaskTable {
  const task = readTask(database, parseTaskId)
  if (task === undefined) throw new Error('MinerU parse task is missing')
  return task
}

function insertEvent(
  database: import('better-sqlite3').Database,
  parseTaskId: string,
  fromState: ParseTaskState | null,
  toState: ParseTaskState,
  event: string,
  remoteState: MineruRemoteState | null,
  errorCode: string | null,
  occurredAt: string
): void {
  database
    .prepare(
      `INSERT INTO parse_task_events (
         parse_task_id, from_state, to_state, event, remote_state, error_code, occurred_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(parseTaskId, fromState, toState, event, remoteState, errorCode, occurredAt)
}

async function writeDurable(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(bytes)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function syncFile(path: string): Promise<void> {
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function isExpiredDownloadCapability(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('httpStatus' in error)) return false
  return error.httpStatus === 401 || error.httpStatus === 403
}

function safeOperationErrorCode(error: unknown): string {
  if (error !== null && typeof error === 'object') {
    if ('providerCode' in error && typeof error.providerCode === 'string') {
      const normalized = error.providerCode.replaceAll(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)
      return normalized.length === 0 ? 'provider_error' : `provider_${normalized}`
    }
    if ('retryable' in error && error.retryable === true) return 'provider_retryable'
    if ('name' in error && error.name === 'AbortError') return 'operation_aborted'
  }
  return 'operation_failed'
}
