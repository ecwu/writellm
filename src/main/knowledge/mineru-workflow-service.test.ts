import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZipFile } from 'yazl'
import type { MineruProviderConfig } from '../../shared/contracts/providers'
import { JobStore, type JobRecord } from '../jobs/job-store'
import type { JobHandlerContext } from '../jobs/scheduler/job-handler-registry'
import { initializeProjectDatabase } from '../project/project-database'
import type { ProjectManifest } from '../project/project-manifest'
import { KnowledgeImportService } from './knowledge-import-service'
import type { MineruGateway } from './mineru-gateway'
import {
  MineruWorkflowService,
  type MineruProviderAccess,
  type SensitiveValueCipher
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
      fixture.jobs.list({ limit: 10 }).filter((job) => job.type === 'mineru.submit')
    ).toHaveLength(1)
    fixture.database.close()
  })

  it('cancels the active task and removes its temporary artifacts', async () => {
    const fixture = await createFixture()
    const service = createService(fixture, createGateway())
    const parseTaskId = await service.start(fixture.knowledgeItemId)
    const temporary = join(fixture.projectRoot, '.writellm', 'temp', 'mineru', parseTaskId)
    await mkdir(temporary, { recursive: true })
    await writeFile(join(temporary, 'partial.zip'), 'partial')

    const references = service.cancelForKnowledgeItem(fixture.knowledgeItemId)
    await service.cleanupCancelledArtifacts(fixture.knowledgeItemId, references)

    expect(taskRow(fixture, parseTaskId).state).toBe('cancelled')
    await expect(readFile(join(temporary, 'partial.zip'))).rejects.toMatchObject({ code: 'ENOENT' })
    fixture.database.close()
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
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru.submit')
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
    expect(allocationCount).toBe(1)
    expect(uploadCount).toBe(1)
    expect(taskRow(fixture, parseTaskId)).toMatchObject({
      state: 'polling',
      upload_url_ciphertext: null
    })
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
    const submit = fixture.jobs.list({ limit: 10 }).find((job) => job.type === 'mineru.submit')
    if (submit === undefined) throw new Error('Submit job was not enqueued')
    await service.handleSubmit(context(submit))
    const pollJob = fakeJob('mineru.poll', parseTaskId)
    await service.handlePoll(context(pollJob))
    expect(taskRow(fixture, parseTaskId)).toMatchObject({ state: 'polling', poll_count: 1 })
    await service.handlePoll(context(pollJob))
    expect(taskRow(fixture, parseTaskId)).toMatchObject({
      state: 'downloading',
      remote_state: 'done'
    })
    expect(JSON.stringify(taskRow(fixture, parseTaskId))).not.toContain('signature=private')

    const downloadJob = fakeJob('mineru.download', parseTaskId)
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
    expect(taskRow(fixture, parseTaskId)).toMatchObject({
      state: 'succeeded',
      upload_url_ciphertext: null,
      download_url_ciphertext: null
    })
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
    await service.handleSubmit(context(fakeJob('mineru.submit', parseTaskId)))
    expect(gateway.allocate).not.toHaveBeenCalled()
    expect(taskRow(fixture, parseTaskId).state).toBe('cancelled')
    fixture.database.close()
  })
})

async function createFixture() {
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
  const database = await initializeProjectDatabase({
    projectRoot,
    manifest,
    applicationVersion: 'test',
    log
  })
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
  faults: ConstructorParameters<typeof MineruWorkflowService>[0]['faults'] = {}
): MineruWorkflowService {
  const providers: MineruProviderAccess = {
    getConfiguredProvider: async () => config,
    withConfiguredProvider: async (operation) => operation(config, 'credential')
  }
  const cipher: SensitiveValueCipher = {
    encrypt: (value) => Buffer.from(value).toString('base64'),
    decrypt: (value) => Buffer.from(value, 'base64').toString()
  }
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']
  return new MineruWorkflowService({
    ...fixture,
    providers,
    cipher,
    gateway,
    log,
    faults,
    createId: () => ids.shift() ?? crypto.randomUUID()
  })
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

async function createZip(path: string): Promise<void> {
  const zip = new ZipFile()
  zip.addBuffer(Buffer.from('# Parsed'), 'full.md')
  zip.addBuffer(Buffer.from('[]'), 'content_list.json')
  zip.end()
  await pipeline(zip.outputStream, createWriteStream(path))
}
