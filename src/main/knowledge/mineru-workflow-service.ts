import { cachedStatement } from '../db/statement-cache'
import { canTransition, isTerminalState, type StateTransitions } from '../db/state-transitions'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, open } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import type { Logger } from 'pino'
import { syncFile, writeDurable } from '../storage/durable-sync'
import { mineruRawManifestSchema, type MineruRawManifest } from '../../shared/contracts/mineru'
import type { MineruProviderConfig } from '../../shared/contracts/providers'
import { getProviderCapability } from '../providers/capability-registry'
import type { JobStore } from '../jobs/job-store'
import type { JobHandlerContext, JobHandlerRegistry } from '../jobs/scheduler/job-handler-registry'
import type {
  ArtifactCleanupRequestTable,
  MineruRemoteState,
  ParseRevisionTable,
  ParseTaskState,
  ParseTaskTable
} from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { sha256 as hashSha256 } from '../../shared/hash'
import { ProjectFilesystem } from '../project/project-filesystem'
import { extractMineruArchive } from './mineru-archive'
import type { MineruGateway } from './mineru-gateway'
import { readMineruRawManifest } from './mineru-raw-manifest'

const DOWNLOAD_LIMIT_BYTES = 512 * 1024 * 1024
const POLL_DELAY_MS = 2_000

/**
 * Legal `parse_tasks.state` transitions. Every state write goes through `#advance`, which
 * rejects anything not listed here so that a duplicate, stale, or out-of-order job cannot
 * reopen a terminal task or skip a stage.
 */
const PARSE_TASK_TRANSITIONS: StateTransitions<ParseTaskState> = {
  queued: ['allocating', 'failed', 'cancelled'],
  allocating: ['awaiting_upload', 'failed', 'cancelled'],
  awaiting_upload: ['polling', 'failed', 'cancelled'],
  // polling -> polling records a remote progress observation.
  polling: ['polling', 'downloading', 'failed', 'cancelled'],
  // downloading -> polling refreshes an expired download capability; downloading and
  // extracting -> succeeded reconcile a revision published before a crash.
  downloading: ['polling', 'extracting', 'succeeded', 'failed', 'cancelled'],
  extracting: ['publishing', 'succeeded', 'failed', 'cancelled'],
  publishing: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: []
}

interface ParseTaskAdvance {
  /** Extra `, column = ?` assignments, as constant SQL text. */
  assignments?: string
  values?: readonly unknown[]
  /** Remote state recorded on the audit event. Defaults to the current remote state. */
  remoteState?: MineruRemoteState | null
  errorCode?: string | null
  now: string
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
  readonly #filesystem: ProjectFilesystem
  readonly #projectId: string
  readonly #database: ProjectDatabase
  readonly #jobs: JobStore
  readonly #providers: MineruProviderAccess
  readonly #gateway: MineruGateway
  readonly #log: Pick<Logger, 'info' | 'warn' | 'error'>
  readonly #faults: MineruWorkflowFaults
  readonly #now: () => Date
  readonly #createId: () => string

  constructor(options: {
    projectRoot: string
    filesystem?: ProjectFilesystem
    projectId: string
    database: ProjectDatabase
    jobs: JobStore
    providers: MineruProviderAccess
    gateway: MineruGateway
    log: Pick<Logger, 'info' | 'warn' | 'error'>
    faults?: MineruWorkflowFaults
    now?: () => Date
    createId?: () => string
  }) {
    this.#filesystem = options.filesystem ?? new ProjectFilesystem(options.projectRoot)
    this.#projectId = options.projectId
    this.#database = options.database
    this.#jobs = options.jobs
    this.#providers = options.providers
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
      type: 'mineru_parse',
      payload: { parseTaskId },
      deduplicationKey: `mineru-parse:${parseTaskId}`,
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
        this.#advance(database, task.parse_task_id, 'cancelled', 'parse.cancelled', {
          assignments: ', completed_at = ?',
          values: [now],
          now
        })
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
  ): Promise<string> {
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
    return this.#enqueueArtifactCleanup(knowledgeItemId, references, stagingPaths, 'cancelled')
  }

  async cleanupAllArtifacts(
    knowledgeItemId: string,
    references: MineruWorkReferences
  ): Promise<string> {
    const stagingPaths = this.#readStagingPaths(references, knowledgeItemId)
    return this.#enqueueArtifactCleanup(knowledgeItemId, references, stagingPaths, 'deleted')
  }

  requeuePendingArtifactCleanups(): void {
    const requests = this.#database.immediate((database) => {
      database
        .prepare(
          `UPDATE artifact_cleanup_requests
              SET state = 'queued', updated_at = ?
            WHERE state = 'running'`
        )
        .run(this.#now().toISOString())
      return database
        .prepare(
          `SELECT cleanup_id FROM artifact_cleanup_requests
            WHERE state IN ('queued', 'running')
            ORDER BY created_at, cleanup_id`
        )
        .pluck()
        .all() as string[]
    })
    for (const cleanupId of requests) {
      this.#jobs.enqueue({
        type: 'artifact_cleanup',
        payload: { cleanupId },
        deduplicationKey: `artifact-cleanup:${cleanupId}`,
        maxAttempts: 8
      })
    }
  }

  async handleArtifactCleanup(context: JobHandlerContext): Promise<void> {
    const cleanupId = context.job.payload.cleanupId
    if (typeof cleanupId !== 'string') throw new Error('Artifact cleanup job payload is invalid')
    const request = this.#database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM artifact_cleanup_requests WHERE cleanup_id = ?')
          .get(cleanupId) as ArtifactCleanupRequestTable | undefined
    )
    if (request === undefined) throw new Error('Artifact cleanup request is missing')
    if (request.state === 'succeeded') return
    this.#database.immediate((database) => {
      database
        .prepare(
          `UPDATE artifact_cleanup_requests
              SET state = 'running', error_code = NULL, updated_at = ?
            WHERE cleanup_id = ? AND state IN ('queued', 'running')`
        )
        .run(this.#now().toISOString(), cleanupId)
    })

    const parseTaskIds = readStringArray(request.parse_task_ids_json, 'parse task IDs')
    const normalizationRunIds = readStringArray(
      request.normalization_run_ids_json,
      'normalization run IDs'
    )
    const stagingRelativePaths = readStringArray(
      request.staging_relative_paths_json,
      'staging paths'
    )
    const paths = [
      ...(request.reason === 'deleted' ? [`knowledge/parsed/${request.knowledge_item_id}`] : []),
      ...parseTaskIds.map((parseTaskId) => `.writellm/temp/mineru/${parseTaskId}`),
      ...normalizationRunIds.map(
        (normalizationRunId) => `.writellm/temp/normalization/${normalizationRunId}.staging`
      ),
      ...stagingRelativePaths
    ]
    try {
      await this.#removeArtifacts(paths, request.knowledge_item_id, request.reason)
      this.#database.immediate((database) => {
        database
          .prepare(
            `UPDATE artifact_cleanup_requests
                SET state = 'succeeded', completed_at = ?, updated_at = ?
              WHERE cleanup_id = ? AND state = 'running'`
          )
          .run(this.#now().toISOString(), this.#now().toISOString(), cleanupId)
      })
    } catch (err) {
      this.#database.immediate((database) => {
        database
          .prepare(
            `UPDATE artifact_cleanup_requests
                SET state = 'queued', error_code = 'cleanup_failed', updated_at = ?
              WHERE cleanup_id = ? AND state = 'running'`
          )
          .run(this.#now().toISOString(), cleanupId)
      })
      throw err
    }
  }

  cancel(parseTaskId: string): void {
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      const task = readTask(database, parseTaskId)
      if (task === undefined || terminal(task.state)) return
      this.#advance(database, parseTaskId, 'cancelled', 'parse.cancelled', {
        assignments: ', completed_at = ?',
        values: [now],
        now
      })
    })
  }

  async #removeArtifacts(
    paths: readonly string[],
    knowledgeItemId: string,
    reason: 'cancelled' | 'deleted'
  ): Promise<void> {
    try {
      await Promise.all(paths.map((path) => this.#filesystem.removeTree(path)))
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

  #readStagingPaths(references: MineruWorkReferences, knowledgeItemId: string): string[] {
    if (references.parseRevisionIds.length === 0) return []
    const placeholders = references.parseRevisionIds.map(() => '?').join(', ')
    return this.#database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT relative_path FROM parse_revisions
               WHERE knowledge_item_id = ?
                 AND parse_revision_id IN (${placeholders})
                 AND state = 'staging'`
          )
          .pluck()
          .all(knowledgeItemId, ...references.parseRevisionIds) as string[]
    )
  }

  #enqueueArtifactCleanup(
    knowledgeItemId: string,
    references: MineruWorkReferences,
    stagingRelativePaths: readonly string[],
    reason: 'cancelled' | 'deleted'
  ): string {
    const cleanupId = this.#createId()
    const now = this.#now().toISOString()
    this.#database.immediate((database) => {
      database
        .prepare(
          `INSERT INTO artifact_cleanup_requests (
             cleanup_id, knowledge_item_id, reason,
             parse_task_ids_json, parse_revision_ids_json, normalization_run_ids_json,
             staging_relative_paths_json, state, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`
        )
        .run(
          cleanupId,
          knowledgeItemId,
          reason,
          JSON.stringify(references.parseTaskIds),
          JSON.stringify(references.parseRevisionIds),
          JSON.stringify(references.normalizationRunIds),
          JSON.stringify(stagingRelativePaths),
          now,
          now
        )
    })
    this.#jobs.enqueue({
      type: 'artifact_cleanup',
      payload: { cleanupId },
      deduplicationKey: `artifact-cleanup:${cleanupId}`,
      maxAttempts: 8
    })
    this.#log.info(
      {
        event: 'mineru.artifact_cleanup.queued',
        projectId: this.#projectId,
        cleanupId,
        knowledgeItemId,
        reason,
        artifactReferenceCount:
          references.parseTaskIds.length +
          references.normalizationRunIds.length +
          stagingRelativePaths.length
      },
      'MinerU artifact cleanup queued'
    )
    return cleanupId
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
      if (task === undefined || terminal(task.state)) return
      this.#advance(database, parseTaskId, 'failed', 'operation.failed_permanently', {
        assignments: ', error_code = ?, completed_at = ?',
        values: [errorCode, now],
        errorCode,
        now
      })
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

  async handleParse(context: JobHandlerContext): Promise<void> {
    const task = this.#requireTask(payloadTaskId(context))
    if (terminal(task.state)) return
    if (
      task.state === 'queued' ||
      task.state === 'allocating' ||
      task.state === 'awaiting_upload'
    ) {
      await this.handleSubmit(context)
      return
    }
    if (task.state === 'polling') {
      await this.handlePoll(context)
      return
    }
    await this.handleDownload(context)
  }

  async handleSubmit(context: JobHandlerContext): Promise<void> {
    const parseTaskId = payloadTaskId(context)
    let task = this.#requireTask(parseTaskId)
    if (terminal(task.state)) return
    const source = this.#readSource(task.knowledge_item_id)
    let uploadUrl: string | undefined

    if (task.remote_task_id === null) {
      const allocating = this.#database.immediate((database) => {
        const current = requireTask(database, parseTaskId)
        if (current.state === 'allocating') return true
        return this.#advance(database, parseTaskId, 'allocating', 'remote.allocate.started', {
          now: this.#now().toISOString()
        })
      })
      if (!allocating) return
      const allocated = await this.#providers.withConfiguredProvider((config, credential) =>
        this.#gateway.allocate(
          config,
          credential,
          { parseTaskId, fileName: basename(source.original_name) },
          context.signal
        )
      )
      const now = this.#now().toISOString()
      this.#database.immediate((database) => {
        if (requireTask(database, parseTaskId).remote_task_id !== null) return
        this.#advance(database, parseTaskId, 'awaiting_upload', 'remote.id.persisted', {
          assignments: ', remote_task_id = ?, trace_id = ?, submitted_at = ?',
          values: [allocated.remoteTaskId, allocated.traceId, now],
          remoteState: null,
          now
        })
      })
      uploadUrl = allocated.uploadUrl
      await this.#faults.afterRemoteIdPersisted?.()
      task = this.#requireTask(parseTaskId)
    }
    if (task.state !== 'awaiting_upload') return
    if (uploadUrl === undefined) {
      const refreshed = await this.#providers.withConfiguredProvider((config, credential) =>
        this.#gateway.allocate(
          config,
          credential,
          { parseTaskId, fileName: basename(source.original_name) },
          context.signal
        )
      )
      if (refreshed.remoteTaskId !== task.remote_task_id) {
        throw new Error('MinerU remote task allocation changed during upload recovery')
      }
      uploadUrl = refreshed.uploadUrl
    }
    await this.#gateway.upload(
      {
        uploadUrl,
        sourcePath: await this.#filesystem.assertExistingRegularFile(source.relative_path),
        expectedBytes: source.byte_size
      },
      context.signal
    )
    await this.#faults.afterUpload?.()
    const now = this.#now().toISOString()
    const uploaded = this.#database.immediate((database) =>
      this.#advance(database, parseTaskId, 'polling', 'source.uploaded', {
        assignments: ", remote_state = 'pending', uploaded_at = ?",
        values: [now],
        remoteState: 'pending',
        now
      })
    )
    if (uploaded) this.#enqueuePoll(parseTaskId, 0)
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
    const now = this.#now().toISOString()
    const nextPollCount = task.poll_count + 1
    if (result.remoteState === 'failed') {
      const errorCode = result.remoteErrorCode ?? 'remote_parse_failed'
      this.#database.immediate((database) =>
        this.#advance(database, parseTaskId, 'failed', 'remote.parse.failed', {
          assignments: `, remote_state = 'failed', trace_id = COALESCE(?, trace_id),
                        poll_count = ?, error_code = ?, completed_at = ?`,
          values: [result.traceId, nextPollCount, errorCode, now],
          remoteState: 'failed',
          errorCode,
          now
        })
      )
      return
    }
    if (result.remoteState === 'done') {
      if (result.downloadUrl === undefined) throw new Error('MinerU result URL is missing')
      const completed = this.#database.immediate((database) =>
        this.#advance(database, parseTaskId, 'downloading', 'remote.parse.completed', {
          assignments: `, remote_state = 'done', trace_id = COALESCE(?, trace_id), poll_count = ?`,
          values: [result.traceId, nextPollCount],
          remoteState: 'done',
          now
        })
      )
      if (!completed) return
      this.#jobs.enqueue({
        type: 'mineru_parse',
        payload: { parseTaskId },
        deduplicationKey: `mineru-download:${parseTaskId}`,
        maxAttempts: 8
      })
      return
    }
    const observed = this.#database.immediate((database) =>
      this.#advance(database, parseTaskId, 'polling', 'remote.poll.observed', {
        assignments: ', remote_state = ?, trace_id = COALESCE(?, trace_id), poll_count = ?',
        values: [result.remoteState, result.traceId, nextPollCount],
        remoteState: result.remoteState,
        now
      })
    )
    if (!observed) return
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
    if (await this.#reconcilePublishedDirectory(task, revision)) return
    await this.#filesystem.ensureDirectory(dirname(revision.relative_path))

    const tempRootRelativePath = `.writellm/temp/mineru/${parseTaskId}/${revision.parse_revision_id}`
    const downloadRelativePath = `${tempRootRelativePath}.zip.partial`
    const stagingRelativePath = `${tempRootRelativePath}.staging`
    const archiveRelativePath = `${stagingRelativePath}/raw/provider-result.zip`
    await this.#filesystem.ensureDirectory(dirname(tempRootRelativePath))
    const downloadPath = await this.#filesystem.resolveForCreation(downloadRelativePath)
    let archivePath: string | undefined

    if (task.state === 'downloading') {
      const refreshed = await this.#providers.withConfiguredProvider((config, credential) =>
        this.#gateway.poll(
          config,
          credential,
          { parseTaskId, remoteTaskId: task.remote_task_id as string },
          context.signal
        )
      )
      if (this.#requireTask(parseTaskId).state !== 'downloading') return
      if (refreshed.remoteState !== 'done' || refreshed.downloadUrl === undefined) {
        throw new Error('MinerU download URL was not available during recovery polling')
      }
      await this.#filesystem.removeFile(downloadRelativePath)
      let downloaded: Awaited<ReturnType<MineruGateway['download']>>
      try {
        downloaded = await this.#gateway.download(
          {
            downloadUrl: refreshed.downloadUrl,
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
          const refreshing = this.#database.immediate((database) =>
            this.#advance(
              database,
              parseTaskId,
              'polling',
              'download.capability.refresh_requested',
              {
                now
              }
            )
          )
          if (refreshing) this.#enqueuePoll(parseTaskId, task.poll_count)
          return
        }
        throw err
      }
      await this.#filesystem.createFreshDirectory(stagingRelativePath)
      await this.#filesystem.ensureDirectory(`${stagingRelativePath}/raw`)
      archivePath = await this.#filesystem.resolveForCreation(archiveRelativePath)
      await copyFile(downloadPath, archivePath)
      await syncFile(archivePath)
      const now = this.#now().toISOString()
      this.#database.immediate((database) => {
        if (!this.#advance(database, parseTaskId, 'extracting', 'archive.persisted', { now }))
          return
        database
          .prepare(
            `UPDATE parse_revisions SET archive_sha256 = ?, archive_byte_size = ?, updated_at = ?
              WHERE parse_revision_id = ?`
          )
          .run(downloaded.sha256, downloaded.byteSize, now, revision.parse_revision_id)
      })
      await this.#faults.afterArchivePersisted?.()
      task = this.#requireTask(parseTaskId)
    }

    if (task.state === 'extracting') {
      archivePath ??= await this.#filesystem.assertExistingRegularFile(archiveRelativePath)
      const currentRevision = this.#requireRevision(revision.parse_revision_id)
      if (currentRevision.archive_sha256 === null || currentRevision.archive_byte_size === null) {
        throw new Error('MinerU archive metadata is missing')
      }
      const extractionRelativePath = `${stagingRelativePath}/raw/extracted`
      const extractionPath = await this.#filesystem.createFreshDirectory(extractionRelativePath)
      const extracted = await extractMineruArchive({
        archivePath,
        destinationRoot: extractionPath,
        manifestPrefix: 'raw/extracted',
        log: this.#log
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
      await this.#filesystem.removeFile(`${stagingRelativePath}/manifest.json`)
      await writeDurable(
        await this.#filesystem.resolveForCreation(`${stagingRelativePath}/manifest.json`),
        bytes
      )
      const manifestSha256 = hashSha256(bytes)
      const now = this.#now().toISOString()
      this.#database.immediate((database) => {
        if (!this.#advance(database, parseTaskId, 'publishing', 'archive.extracted', { now }))
          return
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
      })
      await this.#faults.afterExtraction?.()
      task = this.#requireTask(parseTaskId)
    }

    if (task.state === 'publishing') {
      await this.#filesystem.publish(stagingRelativePath, revision.relative_path)
      await this.#faults.afterPublishRename?.()
      await this.#commitPublished(task, this.#requireRevision(revision.parse_revision_id))
      await this.#filesystem.removeFile(downloadRelativePath)
    }
  }

  #enqueuePoll(parseTaskId: string, sequence: number): void {
    this.#jobs.enqueue({
      type: 'mineru_parse',
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

  /**
   * Move a parse task to `to` and audit the transition. Must run inside an immediate
   * transaction. Returns false without writing when the current state does not permit the
   * transition, for example after cancellation or when a duplicate job arrives late.
   */
  #advance(
    database: import('better-sqlite3').Database,
    parseTaskId: string,
    to: ParseTaskState,
    event: string,
    options: ParseTaskAdvance
  ): boolean {
    const current = requireTask(database, parseTaskId)
    if (!canTransition(PARSE_TASK_TRANSITIONS, current.state, to)) {
      this.#log.info(
        {
          event: 'mineru.parse.transition_skipped',
          projectId: this.#projectId,
          parseTaskId,
          fromState: current.state,
          toState: to,
          transitionEvent: event
        },
        'MinerU parse transition is not permitted from the current state'
      )
      return false
    }
    const changes = cachedStatement(
      database,
      `UPDATE parse_tasks SET state = ?, updated_at = ?${options.assignments ?? ''}
        WHERE parse_task_id = ? AND state = ?`
    ).run(to, options.now, ...(options.values ?? []), parseTaskId, current.state).changes
    if (changes !== 1) throw new Error('MinerU parse task changed during its transition')
    insertEvent(
      database,
      parseTaskId,
      current.state,
      to,
      event,
      options.remoteState === undefined ? current.remote_state : options.remoteState,
      options.errorCode ?? null,
      options.now
    )
    return true
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
    revision: ParseRevisionTable
  ): Promise<boolean> {
    try {
      await this.#filesystem.assertExistingDirectory(revision.relative_path)
      const { manifest, manifestHash } = await readMineruRawManifest(
        this.#filesystem,
        revision,
        'publication-recovery'
      )
      if (manifest.remoteTaskId !== task.remote_task_id) {
        throw new Error('Published MinerU directory provenance does not match')
      }
      await this.#verifyPublishedFiles(revision.relative_path, manifest)
      await this.#commitPublished(task, { ...revision, manifest_sha256: manifestHash })
      return true
    } catch (err) {
      if (
        (err as NodeJS.ErrnoException).code === 'ENOENT' ||
        (err as { code?: string }).code === 'path_missing'
      ) {
        return false
      }
      this.#log.error(
        { event: 'mineru.publish.reconcile_failed', err, parseTaskId: task.parse_task_id },
        'Failed to reconcile a published MinerU revision'
      )
      throw err
    }
  }

  async #verifyPublishedFiles(
    revisionRelativePath: string,
    manifest: MineruRawManifest
  ): Promise<void> {
    const archive = await digestFile(
      await this.#filesystem.assertExistingRegularFile(
        `${revisionRelativePath}/${manifest.archive.relativePath}`
      )
    )
    if (
      archive.byteSize !== manifest.archive.byteSize ||
      archive.sha256 !== manifest.archive.sha256
    ) {
      throw new Error('Published MinerU archive does not match its manifest')
    }
    for (const file of manifest.files) {
      const digest = await digestFile(
        await this.#filesystem.assertExistingRegularFile(
          `${revisionRelativePath}/${file.relativePath}`
        )
      )
      if (digest.byteSize !== file.byteSize || digest.sha256 !== file.sha256) {
        throw new Error('Published MinerU file does not match its manifest')
      }
    }
  }

  async #commitPublished(task: ParseTaskTable, revision: ParseRevisionTable): Promise<boolean> {
    const now = this.#now().toISOString()
    const outcome = this.#database.immediate((database) => {
      const advanced = this.#advance(
        database,
        task.parse_task_id,
        'succeeded',
        'raw_revision.published',
        { assignments: ', completed_at = ?', values: [now], now }
      )
      if (!advanced) {
        return requireTask(database, task.parse_task_id).state === 'cancelled'
          ? 'cancelled'
          : 'skipped'
      }
      database
        .prepare(
          `UPDATE parse_revisions SET state = 'raw_published', published_at = ?, updated_at = ?
            WHERE parse_revision_id = ?`
        )
        .run(now, now, revision.parse_revision_id)
      return 'published'
    })
    if (outcome === 'cancelled') {
      await this.#filesystem.removeTree(revision.relative_path)
      return false
    }
    // Another delivery already finished or failed this task; leave its revision in place.
    if (outcome === 'skipped') return false
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
      type: 'normalize_parse_revision',
      payload: { parseRevisionId: revision.parse_revision_id },
      deduplicationKey: `mineru-normalize:${revision.parse_revision_id}:v1`,
      maxAttempts: 3
    })
    return true
  }
}

export function registerMineruHandlers(
  registry: JobHandlerRegistry,
  service: MineruWorkflowService,
  cleanupManuscriptAssets?: () => Promise<number>
): void {
  service.requeuePendingArtifactCleanups()
  registry.register('mineru_parse', (context) => audited(service, context), {
    timeoutMs: 30 * 60_000,
    leaseMs: 60_000,
    heartbeatMs: 15_000
  })
  registry.register(
    'artifact_cleanup',
    async (context) => {
      const cleanupId = context.job.payload.cleanupId
      if (typeof cleanupId === 'string' && cleanupId.startsWith('manuscript-asset:')) {
        await cleanupManuscriptAssets?.()
        return
      }
      await service.handleArtifactCleanup(context)
    },
    {
      timeoutMs: 10 * 60_000,
      leaseMs: 60_000,
      heartbeatMs: 15_000
    }
  )
}

async function audited(service: MineruWorkflowService, context: JobHandlerContext): Promise<void> {
  try {
    await service.handleParse(context)
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
  return hashSha256(
    JSON.stringify({
      providerId: config.providerId,
      baseUrl: config.baseUrl,
      model: config.model,
      batchLimit: config.batchLimit,
      fileSizeLimitMb: config.fileSizeLimitMb
    })
  )
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

function readStringArray(value: string, label: string): string[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) {
    throw new Error(`Artifact cleanup ${label} are invalid`)
  }
  return parsed
}

function payloadTaskId(context: JobHandlerContext): string {
  const value = context.job.payload.parseTaskId
  if (typeof value !== 'string') throw new Error('MinerU job payload is invalid')
  return value
}

function terminal(state: ParseTaskState): boolean {
  return isTerminalState(PARSE_TASK_TRANSITIONS, state)
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

async function digestFile(path: string): Promise<{ sha256: string; byteSize: number }> {
  const handle = await open(path, 'r')
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let byteSize = 0
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, byteSize)
      if (bytesRead === 0) break
      digest.update(buffer.subarray(0, bytesRead))
      byteSize += bytesRead
    }
    return { sha256: digest.digest('hex'), byteSize }
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
