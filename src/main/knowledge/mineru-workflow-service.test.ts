import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZipFile } from 'yazl'
import type { MineruProviderConfig } from '../../shared/contracts/providers'
import { JobStore, type JobRecord } from '../jobs/job-store'
import { JobHandlerRegistry, type JobHandlerContext } from '../jobs/scheduler/job-handler-registry'
import { openDatabase } from '../db/open-database'
import type { ProjectDatabaseSchema } from '../project/database-types'
import { projectMigrations } from '../project/migrations'
import {
  PROJECT_DATABASE_APPLICATION_ID,
  initializeProjectDatabase,
  openProjectDatabase
} from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { KnowledgeImportService } from './knowledge-import-service'
import type { MineruGateway } from './mineru-gateway'
import {
  MineruWorkflowService,
  registerMineruHandlers,
  type MineruProviderAccess
} from './mineru-workflow-service'

const roots: string[] = []
const log = pino({ level: 'silent' })
const config: MineruProviderConfig = {
  role: 'mineru',
  providerId: 'mineru',
  baseUrl: 'https://mineru.net',
  model: 'pipeline',
  timeoutMs: 30_000,
  embeddingDimension: null,
  batchLimit: 50,
  fileSizeLimitMb: 200
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('MineruWorkflowService', () => {
  it('does not create a second task when parsing is already active', async () => {
    const fixture = await createFixture()
    const service = createService(fixture, createGateway())

    const first = await service.start(fixture.knowledgeItemId)
    const second = await service.start(fixture.knowledgeItemId)

    expect(second).toBe(first)
    expect(
      fixture.jobs.list({ limit: 10 }).filter((job) => job.type === 'mineru_parse')
    ).toHaveLength(1)
    fixture.database.close()
  })

  it('uses the saved source after default changes, and retries the same remote task after restore', async () => {
    const fixture = await createFixture()
    let defaultSource = 'source-one'
    let originalAddress = config.baseUrl
    const resolve = vi.fn<MineruProviderAccess['resolve']>(async (selection) => {
      const sourceId = selection?.sourceId ?? defaultSource
      return {
        sourceId,
        configId: selection?.configId ?? 'pipeline-mode',
        providerConfigId: `mineru:${sourceId}`,
        config: {
          ...config,
          baseUrl: sourceId === 'source-one' ? originalAddress : 'https://other.example'
        }
      }
    })
    const gateway = createGateway()
    const credentialCalls = vi.fn()
    const service = createService(
      fixture,
      gateway,
      {},
      {
        resolve,
        withResolved: async (source, operation) => {
          credentialCalls(source.sourceId)
          return operation(source.config, 'credential')
        }
      }
    )
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    expect(taskRow(fixture, parseTaskId)).toMatchObject({
      provider_source_id: 'source-one',
      provider_config_id: 'pipeline-mode',
      model_version: 'pipeline'
    })
    defaultSource = 'source-two'
    const job = context(fakeJob('mineru_parse', parseTaskId))
    await service.handleParse(job)
    expect(gateway.allocate).toHaveBeenCalledWith(
      config,
      'credential',
      expect.anything(),
      job.signal
    )
    expect(credentialCalls).toHaveBeenCalledTimes(1)

    originalAddress = 'https://replacement.example'
    const registry = new JobHandlerRegistry()
    registerMineruHandlers(registry, service)
    const handle = registry.require('mineru_parse').handler
    await expect(handle(job)).rejects.toMatchObject({
      code: 'mineru_source_unavailable',
      retryable: false
    })
    expect(gateway.poll).not.toHaveBeenCalled()
    expect(credentialCalls).toHaveBeenCalledTimes(1)
    expect(taskRow(fixture, parseTaskId)).toMatchObject({
      state: 'failed',
      remote_task_id: 'remote-1',
      error_code: 'mineru_source_unavailable'
    })
    originalAddress = config.baseUrl
    expect(await service.start(fixture.knowledgeItemId)).toBe(parseTaskId)
    expect(taskRow(fixture, parseTaskId)).toMatchObject({
      state: 'polling',
      remote_task_id: 'remote-1'
    })
    await handle(job)
    expect(gateway.poll).toHaveBeenCalledWith(
      config,
      'credential',
      { parseTaskId, remoteTaskId: 'remote-1' },
      job.signal
    )
    expect(gateway.allocate).toHaveBeenCalledTimes(1)
    fixture.database.close()
  })

  it('binds an upgraded submitted task to the verified legacy source and preserves its audit', async () => {
    const fixture = await createFixture(true)
    const now = fixture.manifest.createdAt
    const fingerprint = createHash('sha256')
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
    fixture.database.immediate((db) => {
      const sourceId = db
        .prepare('SELECT file_record_id FROM knowledge_items WHERE knowledge_item_id = ?')
        .pluck()
        .get(fixture.knowledgeItemId)
      db.prepare(`INSERT INTO parse_tasks (
        parse_task_id, knowledge_item_id, source_file_record_id, provider_id, provider_fingerprint,
        model_version, state, remote_task_id, created_at, updated_at
      ) VALUES ('legacy-task', ?, ?, 'mineru', ?, 'pipeline', 'polling', 'existing-remote', ?, ?)`).run(
        fixture.knowledgeItemId,
        sourceId,
        fingerprint,
        now,
        now
      )
      db.prepare(`INSERT INTO parse_task_events (parse_task_id, from_state, to_state, event, occurred_at)
        VALUES ('legacy-task', 'awaiting_upload', 'polling', 'source.uploaded', ?)`).run(now)
      db.prepare(`INSERT INTO parse_revisions (
        parse_revision_id, parse_task_id, knowledge_item_id, revision_number, state,
        source_sha256, provider_id, provider_api_version, provider_fingerprint, model_version,
        remote_task_id, relative_path, created_at, updated_at
      ) VALUES ('legacy-revision', 'legacy-task', ?, 1, 'staging', ?, 'mineru', 'v4', ?,
                'pipeline', 'existing-remote', '.writellm/imports/legacy-revision', ?, ?)`).run(
        fixture.knowledgeItemId,
        fixture.sourceSha256,
        fingerprint,
        now,
        now
      )
    })
    fixture.database.close()
    const database = await openProjectDatabase({
      projectRoot: fixture.projectRoot,
      manifest: fixture.manifest,
      applicationVersion: 'test',
      log
    })
    const upgraded = {
      ...fixture,
      database,
      jobs: new JobStore({ database, projectId: fixture.projectId, log })
    }
    expect(database.read((db) => db.pragma('user_version', { simple: true }))).toBe(50)
    expect(database.read((db) => db.pragma('integrity_check', { simple: true }))).toBe('ok')
    expect(database.read((db) => db.pragma('foreign_key_check'))).toEqual([])
    expect(await readdir(join(fixture.projectRoot, '.writellm', 'backups'))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^migration-.*\.sqlite$/)])
    )
    expect(taskRow(upgraded, 'legacy-task')).toMatchObject({
      provider_source_id: 'legacy',
      provider_config_id: 'legacy',
      remote_task_id: 'existing-remote'
    })
    expect(taskEvents(upgraded, 'legacy-task')).toMatchObject([{ event: 'source.uploaded' }])
    expect(
      database.read((db) =>
        db
          .prepare('SELECT parse_revision_id FROM parse_revisions WHERE parse_task_id = ?')
          .pluck()
          .get('legacy-task')
      )
    ).toBe('legacy-revision')
    const resolve = vi.fn(fixtureProviders().resolve)
    const gateway = createGateway()
    const service = createService(upgraded, gateway, {}, { ...fixtureProviders(), resolve })
    await service.handleParse(context(fakeJob('mineru_parse', 'legacy-task')))
    expect(resolve).toHaveBeenCalledExactlyOnceWith({ sourceId: 'legacy', configId: 'legacy' })
    expect(gateway.allocate).not.toHaveBeenCalled()
    expect(gateway.poll).toHaveBeenCalledWith(
      config,
      'credential',
      {
        parseTaskId: 'legacy-task',
        remoteTaskId: 'existing-remote'
      },
      expect.anything()
    )
    const anotherPdf = join(fixture.root, 'other.pdf')
    await writeFile(anotherPdf, '%PDF-1.7\nsecond source')
    const imports = new KnowledgeImportService({ ...upgraded, log })
    const [another] = await imports.importPaths([anotherPdf])
    const anotherGateway = createGateway({
      allocate: async () => ({
        remoteTaskId: 'existing-remote',
        uploadUrl: 'https://upload.example/file',
        traceId: null
      })
    })
    const anotherService = createService(upgraded, anotherGateway)
    const anotherTaskId = await anotherService.start(another.knowledgeItemId)
    await anotherService.handleParse(context(fakeJob('mineru_parse', anotherTaskId)))
    expect(taskRow(upgraded, anotherTaskId)).toMatchObject({
      provider_source_id: 'source-one',
      remote_task_id: 'existing-remote',
      state: 'polling'
    })
    database.close()
  })

  it('cancels the active task and removes its temporary artifacts', async () => {
    const fixture = await createFixture()
    const service = createService(fixture, createGateway())
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const temporary = join(fixture.projectRoot, '.writellm', 'temp', 'mineru', parseTaskId)
    await mkdir(temporary, { recursive: true })
    await writeFile(join(temporary, 'partial.zip'), 'partial')

    const references = service.cancelForKnowledgeItem(fixture.knowledgeItemId)
    const cleanupId = await service.cleanupCancelledArtifacts(fixture.knowledgeItemId, references)
    const cleanupJob = fixture.jobs
      .list({ limit: 20 })
      .find((job) => job.type === 'artifact_cleanup' && job.payload.cleanupId === cleanupId)
    if (cleanupJob === undefined) throw new Error('Cleanup job was not enqueued')
    await service.handleArtifactCleanup(context(cleanupJob))

    expect(taskRow(fixture, parseTaskId).state).toBe('cancelled')
    await expect(readFile(join(temporary, 'partial.zip'))).rejects.toMatchObject({ code: 'ENOENT' })
    fixture.database.close()
  })

  it('refuses cleanup through a symbolic-link temp directory and preserves the external sentinel', async () => {
    const fixture = await createFixture()
    const service = createService(fixture, createGateway())
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const outside = join(fixture.root, 'outside-cleanup')
    await mkdir(outside)
    await writeFile(join(outside, 'sentinel.txt'), 'safe')
    await symlink(outside, join(fixture.projectRoot, '.writellm', 'temp', 'mineru'))

    const cleanupId = await service.cleanupCancelledArtifacts(fixture.knowledgeItemId, {
      parseTaskIds: [parseTaskId],
      parseRevisionIds: [],
      normalizationRunIds: []
    })
    const cleanupJob = fixture.jobs
      .list({ limit: 20 })
      .find((job) => job.type === 'artifact_cleanup' && job.payload.cleanupId === cleanupId)
    if (cleanupJob === undefined) throw new Error('Cleanup job was not enqueued')

    await expect(service.handleArtifactCleanup(context(cleanupJob))).rejects.toThrow(
      'MinerU artifact cleanup failed'
    )
    expect(await readFile(join(outside, 'sentinel.txt'), 'utf8')).toBe('safe')
    expect(
      fixture.database.immediate((database) =>
        database
          .prepare('SELECT state FROM artifact_cleanup_requests WHERE cleanup_id = ?')
          .pluck()
          .get(cleanupId)
      )
    ).toBe('queued')
    fixture.database.close()
  })

  it('requeues a cleanup request left running when the project reopens', async () => {
    const fixture = await createFixture()
    const service = createService(fixture, createGateway())
    const cleanupId = await service.cleanupCancelledArtifacts(fixture.knowledgeItemId, {
      parseTaskIds: ['parse-crashed'],
      parseRevisionIds: [],
      normalizationRunIds: []
    })
    fixture.database.immediate((database) => {
      database
        .prepare(
          `UPDATE artifact_cleanup_requests
              SET state = 'running', updated_at = ?
            WHERE cleanup_id = ?`
        )
        .run(new Date().toISOString(), cleanupId)
    })
    fixture.database.close()

    const database = await openProjectDatabase({
      projectRoot: fixture.projectRoot,
      manifest: fixture.manifest,
      applicationVersion: 'test',
      log
    })
    const jobs = new JobStore({ database, projectId: fixture.projectId, log })
    const reopened = createService({ ...fixture, database, jobs }, createGateway())
    reopened.requeuePendingArtifactCleanups()

    expect(
      jobs
        .list({ limit: 20 })
        .filter((job) => job.type === 'artifact_cleanup' && job.payload.cleanupId === cleanupId)
    ).toHaveLength(1)
    expect(
      database.immediate((current) =>
        current
          .prepare('SELECT state FROM artifact_cleanup_requests WHERE cleanup_id = ?')
          .pluck()
          .get(cleanupId)
      )
    ).toBe('queued')
    database.close()
  })

  it('persists the remote ID before upload and resumes without a duplicate allocation', async () => {
    const fixture = await createFixture()
    let allocationCount = 0
    let uploadCount = 0
    const gateway = createGateway({
      allocate: async () => {
        allocationCount += 1
        return {
          remoteTaskId: 'remote-1',
          uploadUrl: 'https://upload.example/result?signature=private',
          traceId: 'trace-1'
        }
      },
      upload: async () => {
        uploadCount += 1
      }
    })
    let faulted = false
    const first = createService(fixture, gateway, {
      afterRemoteIdPersisted: () => {
        if (!faulted) {
          faulted = true
          throw new Error('simulated process loss after ID barrier')
        }
      }
    })
    const parseTaskId = await first.start(fixture.knowledgeItemId)
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru_parse')
    if (submit === undefined) throw new Error('Submit job was not enqueued')

    await expect(first.handleSubmit(context(submit))).rejects.toThrow('simulated process loss')
    const persisted = taskRow(fixture, parseTaskId)
    expect(persisted).toMatchObject({
      state: 'awaiting_upload',
      remote_task_id: 'remote-1'
    })
    expect(JSON.stringify(persisted)).not.toContain('signature=private')

    const reopened = createService(fixture, gateway)
    await reopened.handleSubmit(context(submit))
    expect(allocationCount).toBe(2)
    expect(uploadCount).toBe(1)
    expect(taskRow(fixture, parseTaskId)).toMatchObject({ state: 'polling' })
    fixture.database.close()
  })

  it('polls durably, publishes one raw revision, and reconciles a crash after rename', async () => {
    const fixture = await createFixture()
    const archive = join(fixture.root, 'mineru-result.zip')
    await createZip(archive)
    const archiveBytes = await readFile(archive)
    let pollCount = 0
    let downloadCount = 0
    const gateway = createGateway({
      poll: async () => {
        pollCount += 1
        return pollCount === 1
          ? {
              remoteState: 'running',
              traceId: 'trace-2',
              extractedPages: 1,
              totalPages: 2,
              remoteErrorCode: null
            }
          : {
              remoteState: 'done',
              downloadUrl: 'https://download.example/result?signature=private',
              traceId: 'trace-2',
              extractedPages: 2,
              totalPages: 2,
              remoteErrorCode: null
            }
      },
      download: async ({ destinationPath }) => {
        downloadCount += 1
        await copyFile(archive, destinationPath)
        return {
          sha256: createHash('sha256').update(archiveBytes).digest('hex'),
          byteSize: archiveBytes.byteLength,
          contentType: 'application/zip'
        }
      }
    })
    const service = createService(fixture, gateway)
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru_parse')
    if (submit === undefined) throw new Error('Submit job was not enqueued')
    await service.handleSubmit(context(submit))
    const pollJob = fakeJob('mineru_parse', parseTaskId)
    await service.handlePoll(context(pollJob))
    expect(taskRow(fixture, parseTaskId)).toMatchObject({ state: 'polling', poll_count: 1 })
    await service.handlePoll(context(pollJob))
    expect(taskRow(fixture, parseTaskId)).toMatchObject({
      state: 'downloading',
      remote_state: 'done'
    })
    expect(JSON.stringify(taskRow(fixture, parseTaskId))).not.toContain('signature=private')

    const downloadJob = fakeJob('mineru_parse', parseTaskId)
    const afterDownload = createService(fixture, gateway, {
      afterArchivePersisted: () => {
        throw new Error('simulated process loss after durable download')
      }
    })
    await expect(afterDownload.handleDownload(context(downloadJob))).rejects.toThrow(
      'simulated process loss after durable download'
    )
    expect(taskRow(fixture, parseTaskId).state).toBe('extracting')

    const afterExtraction = createService(fixture, gateway, {
      afterExtraction: () => {
        throw new Error('simulated process loss after extraction')
      }
    })
    await expect(afterExtraction.handleDownload(context(downloadJob))).rejects.toThrow(
      'simulated process loss after extraction'
    )
    expect(taskRow(fixture, parseTaskId).state).toBe('publishing')

    const afterRename = createService(fixture, gateway, {
      afterPublishRename: () => {
        throw new Error('simulated process loss after publish rename')
      }
    })
    await expect(afterRename.handleDownload(context(downloadJob))).rejects.toThrow(
      'simulated process loss'
    )
    expect(taskRow(fixture, parseTaskId).state).toBe('publishing')

    const reopened = createService(fixture, gateway)
    await reopened.handleDownload(context(downloadJob))
    expect(downloadCount).toBe(1)
    expect(taskRow(fixture, parseTaskId)).toMatchObject({ state: 'succeeded' })
    const revision = fixture.database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM parse_revisions WHERE parse_task_id = ?')
          .get(parseTaskId) as { state: string; relative_path: string; file_count: number }
    )
    expect(revision).toMatchObject({ state: 'raw_published', file_count: 2 })
    const manifest = JSON.parse(
      await readFile(join(fixture.projectRoot, revision.relative_path, 'manifest.json'), 'utf8')
    )
    expect(manifest).toMatchObject({ remoteTaskId: 'remote-1', sourceSha256: fixture.sourceSha256 })
    fixture.database.close()
  })

  it('makes cancellation terminal before any remote side effect', async () => {
    const fixture = await createFixture()
    const gateway = createGateway()
    const service = createService(fixture, gateway)
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    service.cancel(parseTaskId)
    await service.handleSubmit(context(fakeJob('mineru_parse', parseTaskId)))
    expect(gateway.allocate).not.toHaveBeenCalled()
    expect(taskRow(fixture, parseTaskId).state).toBe('cancelled')
    fixture.database.close()
  })

  it('does not download or publish when cancellation races an in-flight poll', async () => {
    const fixture = await createFixture()
    const pollStarted = deferred()
    const releasePoll = deferred()
    const gateway = createGateway({
      poll: vi.fn(async () => {
        pollStarted.resolve()
        await releasePoll.promise
        return {
          remoteState: 'done' as const,
          downloadUrl: 'https://download.example/result?signature=private',
          traceId: 'trace-race',
          extractedPages: null,
          totalPages: null,
          remoteErrorCode: null
        }
      })
    })
    const service = createService(fixture, gateway)
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru_parse')
    if (submit === undefined) throw new Error('Submit job was not enqueued')
    await service.handleSubmit(context(submit))
    expect(taskRow(fixture, parseTaskId).state).toBe('polling')

    const pending = service.handlePoll(context(fakeJob('mineru_parse', parseTaskId)))
    await pollStarted.promise
    // Cancel while the gateway poll is in flight, then deliver the late response.
    service.cancel(parseTaskId)
    releasePoll.resolve()
    await pending

    expect(taskRow(fixture, parseTaskId).state).toBe('cancelled')
    expect(gateway.download).not.toHaveBeenCalled()
    expect(
      fixture.jobs
        .list({ limit: 20 })
        .some((job) => job.deduplicationKey === `mineru-download:${parseTaskId}`)
    ).toBe(false)
    expect(taskEvents(fixture, parseTaskId).some((event) => event.to_state === 'downloading')).toBe(
      false
    )
    fixture.database.close()
  })

  it('does not publish when cancellation races an in-flight download', async () => {
    const fixture = await createFixture()
    const archive = join(fixture.root, 'mineru-result.zip')
    await createZip(archive)
    const archiveBytes = await readFile(archive)
    const downloadStarted = deferred()
    const releaseDownload = deferred()
    const gateway = createGateway({
      download: vi.fn(async ({ destinationPath }) => {
        downloadStarted.resolve()
        await releaseDownload.promise
        await copyFile(archive, destinationPath)
        return {
          sha256: createHash('sha256').update(archiveBytes).digest('hex'),
          byteSize: archiveBytes.byteLength,
          contentType: 'application/zip'
        }
      })
    })
    const service = createService(fixture, gateway)
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru_parse')
    if (submit === undefined) throw new Error('Submit job was not enqueued')
    await service.handleSubmit(context(submit))
    await service.handlePoll(context(fakeJob('mineru_parse', parseTaskId)))
    expect(taskRow(fixture, parseTaskId).state).toBe('downloading')

    const pending = service.handleDownload(context(fakeJob('mineru_parse', parseTaskId)))
    await downloadStarted.promise
    // Cancel while the archive download is in flight, then deliver the late bytes.
    service.cancel(parseTaskId)
    releaseDownload.resolve()
    await pending

    expect(taskRow(fixture, parseTaskId).state).toBe('cancelled')
    const revision = fixture.database.immediate(
      (database) =>
        database
          .prepare('SELECT * FROM parse_revisions WHERE parse_task_id = ?')
          .get(parseTaskId) as Record<string, unknown>
    )
    expect(revision).toMatchObject({ state: 'staging', archive_sha256: null })
    expect(
      fixture.jobs.list({ limit: 20 }).some((job) => job.type === 'normalize_parse_revision')
    ).toBe(false)
    const events = taskEvents(fixture, parseTaskId)
    expect(events.some((event) => event.event === 'archive.persisted')).toBe(false)
    expect(events.some((event) => event.event === 'raw_revision.published')).toBe(false)
    fixture.database.close()
  })

  it('records a terminal parse failure with a structured error and stops retrying', async () => {
    const fixture = await createFixture()
    const gateway = createGateway()
    const errorLog = vi.fn()
    const service = new MineruWorkflowService({
      projectRoot: fixture.projectRoot,
      projectId: fixture.projectId,
      database: fixture.database,
      jobs: fixture.jobs,
      providers: fixtureProviders(),
      gateway,
      log: { info: vi.fn(), warn: vi.fn(), error: errorLog }
    })
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru_parse')
    if (submit === undefined) throw new Error('Submit job was not enqueued')
    await service.handleSubmit(context(submit))
    expect(taskRow(fixture, parseTaskId).state).toBe('polling')

    const failure = Object.assign(new Error('provider exploded'), { providerCode: 'GLMT-404' })
    service.recordPermanentFailure(parseTaskId, failure)

    const row = taskRow(fixture, parseTaskId)
    expect(row).toMatchObject({ state: 'failed', error_code: 'provider_GLMT-404', retry_count: 0 })
    expect(row.completed_at).not.toBeNull()
    const terminalEvents = taskEvents(fixture, parseTaskId).filter(
      (event) => event.event === 'operation.failed_permanently'
    )
    expect(terminalEvents).toHaveLength(1)
    expect(terminalEvents[0]).toMatchObject({
      from_state: 'polling',
      to_state: 'failed',
      error_code: 'provider_GLMT-404'
    })
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'mineru.parse.failed_permanently',
        err: failure,
        projectId: fixture.projectId,
        parseTaskId,
        errorCode: 'provider_GLMT-404'
      }),
      expect.any(String)
    )

    // A terminal task records no further retries or failures and performs no remote work.
    service.recordPermanentFailure(parseTaskId, new Error('duplicate failure'))
    service.recordRetry(parseTaskId, new Error('late retry'))
    await service.handleParse(context(fakeJob('mineru_parse', parseTaskId)))
    expect(taskRow(fixture, parseTaskId)).toMatchObject({
      state: 'failed',
      error_code: 'provider_GLMT-404',
      retry_count: 0
    })
    expect(gateway.poll).not.toHaveBeenCalled()
    const events = taskEvents(fixture, parseTaskId)
    expect(events.filter((event) => event.event === 'operation.failed_permanently')).toHaveLength(1)
    expect(events.some((event) => event.event === 'operation.retry_scheduled')).toBe(false)
    fixture.database.close()
  })

  it('does not reopen a task that failed permanently while a poll was in flight', async () => {
    const fixture = await createFixture()
    const pollStarted = deferred()
    const releasePoll = deferred()
    const gateway = createGateway({
      poll: vi.fn(async () => {
        pollStarted.resolve()
        await releasePoll.promise
        return {
          remoteState: 'done' as const,
          downloadUrl: 'https://download.example/result?signature=private',
          traceId: 'trace-late',
          extractedPages: null,
          totalPages: null,
          remoteErrorCode: null
        }
      })
    })
    const service = createService(fixture, gateway)
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru_parse')
    if (submit === undefined) throw new Error('Submit job was not enqueued')
    await service.handleSubmit(context(submit))

    const pending = service.handlePoll(context(fakeJob('mineru_parse', parseTaskId)))
    await pollStarted.promise
    // A duplicate delivery exhausts its attempts while this poll is still in flight.
    service.recordPermanentFailure(parseTaskId, new Error('duplicate delivery failed'))
    releasePoll.resolve()
    await pending

    expect(taskRow(fixture, parseTaskId)).toMatchObject({
      state: 'failed',
      remote_state: 'pending',
      error_code: 'operation_failed'
    })
    expect(
      fixture.jobs
        .list({ limit: 20 })
        .some((job) => job.deduplicationKey === `mineru-download:${parseTaskId}`)
    ).toBe(false)
    expect(taskEvents(fixture, parseTaskId).some((event) => event.to_state === 'downloading')).toBe(
      false
    )
    fixture.database.close()
  })

  it('does not start polling when the task fails during upload', async () => {
    const fixture = await createFixture()
    const uploadStarted = deferred()
    const releaseUpload = deferred()
    const gateway = createGateway({
      upload: vi.fn(async () => {
        uploadStarted.resolve()
        await releaseUpload.promise
      })
    })
    const service = createService(fixture, gateway)
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru_parse')
    if (submit === undefined) throw new Error('Submit job was not enqueued')

    const pending = service.handleSubmit(context(submit))
    await uploadStarted.promise
    service.recordPermanentFailure(parseTaskId, new Error('duplicate delivery failed'))
    releaseUpload.resolve()
    await pending

    expect(taskRow(fixture, parseTaskId).state).toBe('failed')
    expect(
      fixture.jobs
        .list({ limit: 20 })
        .some((job) => job.deduplicationKey === `mineru-poll:${parseTaskId}:0`)
    ).toBe(false)
    expect(
      taskEvents(fixture, parseTaskId).some((event) => event.event === 'source.uploaded')
    ).toBe(false)
    fixture.database.close()
  })

  it('does not resume polling when cancellation races an expired download capability', async () => {
    const fixture = await createFixture()
    const downloadStarted = deferred()
    const releaseDownload = deferred()
    const gateway = createGateway({
      download: vi.fn(async () => {
        downloadStarted.resolve()
        await releaseDownload.promise
        throw Object.assign(new Error('download capability expired'), { httpStatus: 403 })
      })
    })
    const service = createService(fixture, gateway)
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru_parse')
    if (submit === undefined) throw new Error('Submit job was not enqueued')
    await service.handleSubmit(context(submit))
    await service.handlePoll(context(fakeJob('mineru_parse', parseTaskId)))
    expect(taskRow(fixture, parseTaskId).state).toBe('downloading')

    const pending = service.handleDownload(context(fakeJob('mineru_parse', parseTaskId)))
    await downloadStarted.promise
    service.cancel(parseTaskId)
    releaseDownload.resolve()
    await pending

    expect(taskRow(fixture, parseTaskId).state).toBe('cancelled')
    expect(
      fixture.jobs
        .list({ limit: 20 })
        .some((job) => job.deduplicationKey === `mineru-poll:${parseTaskId}:1`)
    ).toBe(false)
    expect(
      taskEvents(fixture, parseTaskId).some(
        (event) => event.event === 'download.capability.refresh_requested'
      )
    ).toBe(false)
    fixture.database.close()
  })
})

async function createFixture(previousSchema = false) {
  const root = await mkdtemp(join(tmpdir(), 'writellm-mineru-workflow-'))
  roots.push(root)
  const projectRoot = join(root, 'project.writellm')
  await mkdir(projectRoot)
  const manifest: ProjectManifest = {
    format: 'writellm-project',
    formatVersion: 1,
    projectId: crypto.randomUUID(),
    createdAt: '2026-07-16T00:00:00.000Z'
  }
  const database = previousSchema
    ? await openDatabase<ProjectDatabaseSchema>({
        path: join(projectRoot, '.writellm', 'project.sqlite'),
        applicationId: PROJECT_DATABASE_APPLICATION_ID,
        applicationVersion: 'test',
        databaseRole: 'project',
        migrations: projectMigrations.filter(({ version }) => version <= 49),
        log
      })
    : await initializeProjectDatabase({ projectRoot, manifest, applicationVersion: 'test', log })
  if (previousSchema) {
    database.immediate((db) =>
      db
        .prepare(
          'INSERT INTO project_meta (singleton_id, project_id, created_at, updated_at) VALUES (1, ?, ?, ?)'
        )
        .run(manifest.projectId, manifest.createdAt, manifest.createdAt)
    )
  }
  const source = join(root, 'source.pdf')
  await writeFile(source, '%PDF-1.7\nworkflow source')
  const imports = new KnowledgeImportService({
    projectRoot,
    projectId: manifest.projectId,
    database,
    log
  })
  const [item] = await imports.importPaths([source])
  if (item?.sha256 === null || item?.sha256 === undefined) throw new Error('Import failed')
  const jobs = new JobStore({ database, projectId: manifest.projectId, log })
  return {
    root,
    projectRoot,
    manifest,
    database,
    jobs,
    projectId: manifest.projectId,
    knowledgeItemId: item.knowledgeItemId,
    sourceSha256: item.sha256
  }
}

function createService(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  gateway: MineruGateway,
  faults: ConstructorParameters<typeof MineruWorkflowService>[0]['faults'] = {},
  providers = fixtureProviders()
): MineruWorkflowService {
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
  return new MineruWorkflowService({
    ...fixture,
    providers,
    gateway,
    log,
    faults,
    createId: () => ids.shift() ?? crypto.randomUUID()
  })
}

function fixtureProviders(): MineruProviderAccess {
  return {
    resolve: async (selection) => ({
      sourceId: selection?.sourceId ?? 'source-one',
      configId: selection?.configId ?? 'pipeline-mode',
      providerConfigId: 'mineru',
      config
    }),
    withResolved: async (source, operation) => operation(source.config, 'credential')
  }
}

function createGateway(overrides: Partial<MineruGateway> = {}): MineruGateway {
  return {
    allocate: vi.fn(async () => ({
      remoteTaskId: 'remote-1',
      uploadUrl: 'https://upload.example/result?signature=private',
      traceId: 'trace-1'
    })),
    upload: vi.fn(async () => undefined),
    poll: vi.fn(async () => ({
      remoteState: 'done' as const,
      downloadUrl: 'https://download.example/result?signature=private',
      traceId: null,
      extractedPages: null,
      totalPages: null,
      remoteErrorCode: null
    })),
    download: vi.fn(async () => {
      throw new Error('download fixture is missing')
    }),
    normalize: vi.fn(async () => {
      throw new Error('normalization fixture is missing')
    }),
    ...overrides
  }
}

function context(job: JobRecord): JobHandlerContext {
  return { job, signal: new AbortController().signal, reportProgress: vi.fn() }
}

function fakeJob(type: JobRecord['type'], parseTaskId: string): JobRecord {
  return {
    jobId: crypto.randomUUID(),
    type,
    payload: { parseTaskId },
    state: 'running',
    priority: 0,
    attempts: 1,
    maxAttempts: 8,
    runAfter: new Date().toISOString(),
    leaseOwner: 'test',
    lockedUntil: null,
    heartbeatAt: null,
    progress: null,
    deduplicationKey: null,
    cancellationRequested: false,
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    startedAt: null,
    completedAt: null,
    resumeSameAttempt: false
  }
}

function taskRow(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  parseTaskId: string
): Record<string, unknown> & { state: string } {
  return fixture.database.immediate(
    (database) =>
      database
        .prepare('SELECT * FROM parse_tasks WHERE parse_task_id = ?')
        .get(parseTaskId) as Record<string, unknown> & { state: string }
  )
}

function taskEvents(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  parseTaskId: string
): Array<{
  event: string
  from_state: string | null
  to_state: string
  error_code: string | null
}> {
  return fixture.database.immediate(
    (database) =>
      database
        .prepare(
          'SELECT event, from_state, to_state, error_code FROM parse_task_events WHERE parse_task_id = ?'
        )
        .all(parseTaskId) as Array<{
        event: string
        from_state: string | null
        to_state: string
        error_code: string | null
      }>
  )
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function createZip(path: string): Promise<void> {
  const zip = new ZipFile()
  zip.addBuffer(Buffer.from('# Parsed'), 'full.md')
  zip.addBuffer(Buffer.from('[]'), 'content_list.json')
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path))
}
