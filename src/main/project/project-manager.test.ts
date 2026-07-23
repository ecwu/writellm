import { mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openAppDatabase } from '../app-db/connection'
import { RecentProjectsRepository } from '../app-db/repositories/recent-projects'
import { JobStore } from '../jobs/job-store'
import { JobHandlerRegistry } from '../jobs/scheduler/job-handler-registry'
import { ProjectRuntime } from '../jobs/scheduler/project-runtime'
import { createProject, ProjectCreateError } from './project-lifecycle'
import { openProjectDatabase } from './project-database'
import { inspectProjectWriteLock } from './project-lock'
import { ProjectManager, ProjectSessionError } from './project-manager'
import {
  INDEX_DATABASE_RELATIVE_PATH,
  PROJECT_LOCK_RELATIVE_PATH,
  resolveProjectPath
} from './project-paths'

const temporaryDirectories: string[] = []
const silentLog = pino({ level: 'silent' })

async function testEnvironment() {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-project-manager-'))
  temporaryDirectories.push(parent)
  const appDatabase = await openAppDatabase({
    path: join(parent, 'app.sqlite'),
    applicationVersion: '1.0.0-test',
    log: silentLog
  })
  const recentProjects = new RecentProjectsRepository(appDatabase)
  const manager = new ProjectManager({
    applicationVersion: '1.0.0-test',
    logger: silentLog,
    recentProjects,
    lockOptions: { heartbeatIntervalMs: 0 }
  })
  return { parent, appDatabase, recentProjects, manager }
}

async function existingProject(parent: string, name: string) {
  const created = await createProject({
    destination: join(parent, name),
    forbiddenApplicationDirectories: [],
    applicationVersion: '1.0.0-test',
    log: silentLog
  })
  await created.writeLock.release()
  return created
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('ProjectManager', () => {
  it('creates through staging and immediately opens with a path-free public snapshot', async () => {
    const { parent, appDatabase, recentProjects, manager } = await testEnvironment()
    const destination = join(parent, '新项目.writellm')

    expect(manager.snapshot()).toEqual({ state: 'closed', activeProject: null })
    const snapshot = await manager.create({ parentDirectory: parent, name: '新项目' })

    expect(snapshot.state).toBe('open')
    expect(snapshot.activeProject?.displayName).toBe('新项目')
    expect(JSON.stringify(snapshot)).not.toContain(destination)
    expect(await inspectProjectWriteLock(destination, { logger: silentLog })).not.toBeNull()
    expect(await recentProjects.list()).toEqual([
      expect.objectContaining({
        projectId: snapshot.activeProject?.projectId,
        projectPath: await realpath(destination),
        displayName: '新项目'
      })
    ])

    await manager.close()
    appDatabase.close()
  })

  it('returns to closed after a clean create failure and permits a retry', async () => {
    const { parent, appDatabase, recentProjects } = await testEnvironment()
    let attempts = 0
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      lockOptions: { heartbeatIntervalMs: 0 },
      dependencies: {
        createProject: async (options) => {
          attempts += 1
          if (attempts === 1) {
            throw new ProjectCreateError(new Error('destination rejected'), 'clean')
          }
          return createProject(options)
        }
      }
    })

    await expect(manager.create({ parentDirectory: parent, name: 'retry' })).rejects.toThrow(
      'Failed to create and open project'
    )
    expect(manager.snapshot()).toEqual({ state: 'closed', activeProject: null })

    const retried = await manager.create({ parentDirectory: parent, name: 'retry' })
    expect(retried.state).toBe('open')
    await manager.close()
    appDatabase.close()
  })

  it('keeps ambiguous create failures in recovery-required', async () => {
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects: { upsert: vi.fn() },
      dependencies: {
        createProject: async () => {
          throw new ProjectCreateError(new Error('rollback failed'), 'recovery-required')
        }
      }
    })

    await expect(manager.create({ parentDirectory: '/', name: 'selected' })).rejects.toThrow(
      'Failed to create and open project'
    )
    expect(manager.snapshot()).toEqual({
      state: 'recovery-required',
      activeProject: null,
      recovery: { kind: 'create' }
    })
  })

  it('keeps an opened project authoritative when recent metadata update fails', async () => {
    const calls: string[] = []
    const database = {
      immediate: vi.fn(() => ({ recovered: 0, cancelled: 0, failed: 0 })),
      close: vi.fn(() => calls.push('database.close'))
    }
    const lock = { release: vi.fn(async () => calls.push('lock.release')) }
    const manifest = {
      format: 'writellm-project' as const,
      formatVersion: 1,
      projectId: '11111111-1111-4111-8111-111111111111',
      createdAt: '2026-07-14T00:00:00.000Z'
    }
    const recentProjects = {
      upsert: vi.fn(async () => {
        throw new Error('recent failed')
      })
    }
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      createManuscriptService: () => ({ listSections: () => [] }) as never,
      lockOptions: { heartbeatIntervalMs: 0 },
      dependencies: {
        canonicalizeRoot: async () => {
          calls.push('realpath')
          return '/canonical/project'
        },
        readManifest: async () => {
          calls.push('manifest')
          return manifest
        },
        acquireLock: async () => {
          calls.push('lock')
          return lock as never
        },
        openDatabase: async () => {
          calls.push('database')
          return database as never
        }
      }
    })

    await expect(manager.open('/selected/alias')).resolves.toMatchObject({ state: 'open' })
    expect(calls).toEqual(['realpath', 'manifest', 'lock', 'database'])
    expect(manager.snapshot()).toMatchObject({ state: 'open' })
    await manager.close()
    expect(calls).toEqual([
      'realpath',
      'manifest',
      'lock',
      'database',
      'database.close',
      'lock.release'
    ])
  })

  it('allows at most one active project and creates a fresh session on every open', async () => {
    const { parent, appDatabase, manager } = await testEnvironment()
    const created = await existingProject(parent, 'one')

    const first = await manager.open(created.projectRoot)
    await expect(manager.open(created.projectRoot)).rejects.toThrow('must be closed')
    await manager.close()
    const second = await manager.open(created.projectRoot)

    expect(second.activeProject?.projectSessionId).not.toBe(first.activeProject?.projectSessionId)
    await manager.close()
    appDatabase.close()
  })

  it('recovers expired job leases before publishing an open project session', async () => {
    const { parent, appDatabase, manager } = await testEnvironment()
    const created = await existingProject(parent, 'lease-recovery')
    const database = await openProjectDatabase({
      projectRoot: created.projectRoot,
      manifest: created.manifest,
      applicationVersion: '1.0.0-test',
      log: silentLog
    })
    const store = new JobStore({
      database,
      projectId: created.manifest.projectId,
      log: silentLog,
      now: () => new Date('2020-01-01T00:00:00.000Z')
    })
    const job = store.enqueue({ type: 'rebuild_index', payload: { generationId: 'old' } }).job
    store.claimNext({ workerId: 'crashed-worker', leaseMs: 1_000 })
    database.close()

    await expect(manager.open(created.projectRoot)).resolves.toMatchObject({ state: 'open' })
    await manager.close()
    const verified = await openProjectDatabase({
      projectRoot: created.projectRoot,
      manifest: created.manifest,
      applicationVersion: '1.0.0-test',
      log: silentLog
    })
    expect(
      await verified.kysely
        .selectFrom('jobs')
        .select(['state', 'attempts', 'lease_owner'])
        .where('job_id', '=', job.jobId)
        .executeTakeFirstOrThrow()
    ).toEqual({ state: 'queued', attempts: 1, lease_owner: null })
    verified.close()
    appDatabase.close()
  })

  it('opens without an index and reports rebuild required without rebuilding it', async () => {
    const { parent, appDatabase, manager } = await testEnvironment()
    const created = await existingProject(parent, 'missing-index')
    const indexPath = resolveProjectPath(created.projectRoot, INDEX_DATABASE_RELATIVE_PATH)
    await rm(indexPath, { force: true })

    const opened = await manager.open(created.projectRoot)
    expect(opened.activeProject?.indexRebuildRequired).toBe(true)
    await expect(realpath(indexPath)).rejects.toMatchObject({ code: 'ENOENT' })

    await manager.close()
    appDatabase.close()
  })

  it('opens with an incompatible index role and reports rebuild required', async () => {
    const { parent, appDatabase, manager } = await testEnvironment()
    const created = await existingProject(parent, 'incompatible-index')
    const indexPath = resolveProjectPath(created.projectRoot, INDEX_DATABASE_RELATIVE_PATH)
    const index = new (await import('better-sqlite3')).default(indexPath)
    index.pragma('application_id = 123')
    index.close()

    const opened = await manager.open(created.projectRoot)
    expect(opened.activeProject?.indexRebuildRequired).toBe(true)

    await manager.close()
    appDatabase.close()
  })

  it('restores only through a locked manager transition and reopens with a new session', async () => {
    const { parent, appDatabase, manager } = await testEnvironment()
    const created = await existingProject(parent, 'managed-restore')
    const databasePath = resolveProjectPath(created.projectRoot, '.writellm/project.sqlite')
    const candidate = join(parent, 'candidate.sqlite')
    const database = new (await import('better-sqlite3')).default(databasePath)
    await database.backup(candidate)
    database.prepare("UPDATE project_meta SET updated_at = 'changed'").run()
    database.close()

    const restored = await manager.restoreDatabase({
      selectedRoot: created.projectRoot,
      candidateDatabase: candidate
    })
    expect(restored.state).toBe('open')
    expect(restored.activeProject?.projectId).toBe(created.manifest.projectId)
    expect(await inspectProjectWriteLock(created.projectRoot, { logger: silentLog })).not.toBeNull()
    const restoredDatabase = new (await import('better-sqlite3')).default(databasePath, {
      readonly: true
    })
    expect(restoredDatabase.prepare('SELECT updated_at FROM project_meta').pluck().get()).not.toBe(
      'changed'
    )
    restoredDatabase.close()

    await manager.close()
    appDatabase.close()
  })

  it('creates a verified snapshot through the live manager and restores it elsewhere', async () => {
    const { parent, appDatabase, manager } = await testEnvironment()
    const created = await existingProject(parent, 'snapshot-source')
    const opened = await manager.open(created.projectRoot)
    const sessionId = opened.activeProject?.projectSessionId
    if (sessionId === undefined) throw new Error('Missing project session')
    const snapshotRoot = join(parent, 'snapshot.writellm-snapshot')
    const manifest = await manager.createSnapshot(sessionId, snapshotRoot)
    expect(manifest.projectId).toBe(created.manifest.projectId)
    await manager.close()

    const restored = await manager.restoreSnapshot({
      snapshotRoot,
      destination: join(parent, 'snapshot-restored.writellm')
    })
    expect(restored.state).toBe('open')
    expect(restored.activeProject?.projectId).toBe(created.manifest.projectId)
    expect(restored.activeProject?.projectSessionId).not.toBe(sessionId)
    await manager.close()
    appDatabase.close()
  })

  it('rejects stale sessions, rejects immediately while closing, and guards delayed results', async () => {
    const { parent, appDatabase, manager } = await testEnvironment()
    const created = await existingProject(parent, 'session')
    const opened = await manager.open(created.projectRoot)
    const sessionId = opened.activeProject?.projectSessionId as string
    let resolveFlush: (() => void) | undefined
    const flush = new Promise<void>((resolve) => {
      resolveFlush = resolve
    })
    const closeManager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects: { upsert: vi.fn() },
      closeParticipants: { flushEditors: () => flush },
      lockOptions: { heartbeatIntervalMs: 0 }
    })
    await manager.close()
    const reopened = await closeManager.open(created.projectRoot)
    const currentSession = reopened.activeProject?.projectSessionId as string

    expect(() => closeManager.assertActiveSession(sessionId)).toThrow(ProjectSessionError)
    let resolveResult: ((value: string) => void) | undefined
    const delayed = new Promise<string>((resolve) => {
      resolveResult = resolve
    })
    const guarded = closeManager.guardDelayedResult(currentSession, delayed)
    const closing = closeManager.close()
    expect(closeManager.snapshot().state).toBe('closing')
    expect(() => closeManager.assertActiveSession(currentSession)).toThrow(ProjectSessionError)
    resolveResult?.('late')
    await expect(guarded).rejects.toThrow(ProjectSessionError)
    resolveFlush?.()
    await closing
    appDatabase.close()
  })

  it('closes in strict order and revokes the external session last', async () => {
    const { parent, appDatabase, recentProjects } = await testEnvironment()
    const created = await existingProject(parent, 'ordered')
    const order: string[] = []
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      lockOptions: { heartbeatIntervalMs: 0 },
      closeParticipants: {
        flushEditors: async () => {
          order.push('flush')
        },
        stopJobClaims: async () => {
          order.push('claims')
        },
        parkWorkers: async () => {
          order.push('park')
        },
        stopWorkersAndIndex: async () => {
          order.push('workers')
        },
        revokeSubscriptions: async () => {
          order.push('revoke')
        }
      },
      dependencies: {
        openDatabase: async (options) => {
          const actual = await import('./project-database').then(({ openProjectDatabase }) =>
            openProjectDatabase(options)
          )
          const close = actual.close.bind(actual)
          actual.close = () => {
            order.push('database')
            close()
          }
          return actual
        },
        acquireLock: async (root, options) => {
          const actual = await import('./project-lock').then(({ ProjectWriteLock }) =>
            ProjectWriteLock.acquire(root, options)
          )
          const release = actual.release.bind(actual)
          actual.release = async () => {
            order.push('lock')
            return release()
          }
          return actual
        }
      }
    })

    await manager.open(created.projectRoot)
    await manager.close()
    expect(order).toEqual(['flush', 'claims', 'park', 'workers', 'database', 'lock', 'revoke'])
    appDatabase.close()
  })

  it('authorizes and bounds the final editor flush', async () => {
    const { parent, appDatabase, recentProjects } = await testEnvironment()
    const created = await existingProject(parent, 'flush-boundary')
    let authorization:
      | { projectSessionId: string; currentRevision: string | null; closingToken: string }
      | undefined
    let verifiedAuthorization: typeof authorization
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      finalFlushTimeoutMs: 10,
      lockOptions: { heartbeatIntervalMs: 0 },
      closeParticipants: {
        getCurrentRevision: async () => 'revision-1',
        flushEditors: async (_context, value) => {
          authorization = value
          expect(manager.authorizeFinalFlush(value.projectSessionId, value.closingToken)).toBe(
            _context
          )
          expect(() =>
            manager.authorizeFinalFlush(value.projectSessionId, value.closingToken)
          ).toThrow('not authorized')
          expect(() =>
            manager.authorizeFinalFlush(value.projectSessionId, crypto.randomUUID())
          ).toThrow('not authorized')
        },
        verifyFinalEditorFlush: async (_context, value) => {
          verifiedAuthorization = value
        }
      }
    })
    const opened = await manager.open(created.projectRoot)
    await manager.close()
    expect(authorization).toMatchObject({
      projectSessionId: opened.activeProject?.projectSessionId,
      currentRevision: 'revision-1'
    })
    expect(authorization?.closingToken).toMatch(/^[0-9a-f-]{36}$/)
    expect(verifiedAuthorization).toBe(authorization)
    expect(() =>
      manager.authorizeFinalFlush(
        authorization?.projectSessionId ?? '',
        authorization?.closingToken ?? ''
      )
    ).toThrow('not authorized')
    appDatabase.close()

    const timedOut = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects: { upsert: vi.fn() },
      finalFlushTimeoutMs: 10,
      closeParticipants: { flushEditors: () => new Promise<void>(() => undefined) },
      lockOptions: { heartbeatIntervalMs: 0 }
    })
    await timedOut.open(created.projectRoot)
    await expect(timedOut.close()).rejects.toThrow('Failed to close project cleanly')
    expect(timedOut.snapshot().state).toBe('recovery-required')
  })

  it('revokes authority and enters recovery-required while continuing cleanup after close failure', async () => {
    const { parent, appDatabase, recentProjects } = await testEnvironment()
    const created = await existingProject(parent, 'recovery')
    const error = new Error('flush failed')
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const revoke = vi.fn()
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger,
      recentProjects,
      lockOptions: { heartbeatIntervalMs: 0 },
      closeParticipants: {
        flushEditors: async () => {
          throw error
        },
        revokeSubscriptions: revoke
      }
    })
    const opened = await manager.open(created.projectRoot)

    await expect(manager.close()).rejects.toMatchObject({ cause: error })
    expect(manager.snapshot()).toEqual({
      state: 'recovery-required',
      activeProject: null,
      recovery: { kind: 'close' }
    })
    expect(() =>
      manager.assertActiveSession(opened.activeProject?.projectSessionId as string)
    ).toThrow()
    expect(revoke).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'project_manager.close.editor_flush_failed', err: error }),
      expect.any(String)
    )
    expect(await inspectProjectWriteLock(created.projectRoot, { logger: silentLog })).toBeNull()
    appDatabase.close()
  })

  it('retries the unresolved close steps after a recovery-required close', async () => {
    const { parent, appDatabase, recentProjects } = await testEnvironment()
    const created = await existingProject(parent, 'retry-close')
    const stopWorkers = vi.fn().mockRejectedValueOnce(new Error('worker stop failed'))
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      lockOptions: { heartbeatIntervalMs: 0 },
      closeParticipants: { stopWorkersAndIndex: stopWorkers }
    })
    await manager.open(created.projectRoot)
    await expect(manager.close()).rejects.toThrow('Failed to close project cleanly')
    expect(manager.snapshot().state).toBe('recovery-required')
    await expect(manager.retryClose()).resolves.toEqual({ state: 'closed', activeProject: null })
    expect(stopWorkers).toHaveBeenCalledTimes(2)
    appDatabase.close()
  })

  it('supports retry-open, locate-moved, diagnostics export, return-to-closed, and create discard exits', async () => {
    const { parent, appDatabase, recentProjects } = await testEnvironment()
    const created = await existingProject(parent, 'recovery-exits')
    let failOpen = true
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      lockOptions: { heartbeatIntervalMs: 0 },
      dependencies: {
        openDatabase: async (options) => {
          if (failOpen) {
            failOpen = false
            throw new Error('open failed')
          }
          return openProjectDatabase(options)
        }
      },
      exportDiagnostics: async () => ({ exported: true })
    })
    await expect(manager.open(created.projectRoot)).rejects.toThrow('Failed to open project')
    await expect(manager.retryOpen()).resolves.toMatchObject({ state: 'open' })
    await manager.close()

    await expect(manager.open(join(parent, 'missing-project'))).rejects.toThrow()
    await expect(manager.exportDiagnostics()).resolves.toEqual({ exported: true })
    await expect(manager.returnToClosed()).resolves.toEqual({
      state: 'closed',
      activeProject: null
    })

    await expect(manager.open(join(parent, 'missing-project'))).rejects.toThrow()
    await expect(manager.locateMovedProject(created.projectRoot)).resolves.toMatchObject({
      state: 'open'
    })
    await manager.close()

    const incompleteRoot = join(parent, 'incomplete.writellm')
    await mkdir(incompleteRoot, { recursive: true })
    await mkdir(join(incompleteRoot, '.writellm'), { recursive: true })
    const discardManager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      dependencies: {
        createProject: async () => {
          throw new ProjectCreateError(new Error('ambiguous create'), 'recovery-required')
        }
      }
    })
    await expect(
      discardManager.create({ parentDirectory: parent, name: 'incomplete' })
    ).rejects.toThrow('Failed to create and open project')
    await expect(discardManager.discardIncompleteCreate()).resolves.toEqual({
      state: 'closed',
      activeProject: null
    })
    await expect(realpath(incompleteRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    appDatabase.close()
  })

  it('recovers an observed stale lock and retries the failed open', async () => {
    const { parent, appDatabase, manager } = await testEnvironment()
    const created = await existingProject(parent, 'stale-lock-recovery')
    const ownerToken = '11111111-1111-4111-8111-111111111111'
    const lockDirectory = resolveProjectPath(created.projectRoot, PROJECT_LOCK_RELATIVE_PATH)
    await mkdir(lockDirectory)
    await writeFile(
      join(lockDirectory, `${ownerToken}.json`),
      JSON.stringify({
        ownerToken,
        pid: 1234,
        host: 'stale-host',
        acquiredAt: '2000-01-01T00:00:00.000Z',
        heartbeatAt: '2000-01-01T00:00:00.000Z'
      })
    )

    await expect(manager.open(created.projectRoot)).rejects.toThrow('Failed to open project')
    expect(manager.snapshot()).toEqual({
      state: 'recovery-required',
      activeProject: null,
      recovery: { kind: 'open', reason: 'lock-contended' }
    })

    await expect(manager.recoverStaleLockAndRetryOpen()).resolves.toMatchObject({ state: 'open' })
    await manager.close()
    appDatabase.close()
  })

  it('switches strictly by completing close before opening the selected project', async () => {
    const { parent, appDatabase, recentProjects } = await testEnvironment()
    const first = await existingProject(parent, 'first')
    const second = await existingProject(parent, 'second')
    const events: string[] = []
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      lockOptions: { heartbeatIntervalMs: 0 },
      closeParticipants: {
        revokeSubscriptions: async () => {
          events.push('closed')
        }
      },
      dependencies: {
        canonicalizeRoot: async (root) => {
          events.push(`open:${basename(root)}`)
          return realpath(root)
        }
      }
    })
    await manager.open(first.projectRoot)
    events.length = 0

    const switched = await manager.switch(second.projectRoot)
    expect(events).toEqual(['closed', 'open:second'])
    expect(switched.activeProject?.projectId).toBe(second.manifest.projectId)
    await manager.close()
    appDatabase.close()
  })

  it('requeues runtime work on close and completes it once after reopen without spending an attempt', async () => {
    const { parent, appDatabase, recentProjects } = await testEnvironment()
    const created = await existingProject(parent, 'runtime-reopen')
    let firstExecutions = 0
    const firstRegistry = new JobHandlerRegistry()
    firstRegistry.register('artifact_cleanup', async ({ signal }) => {
      firstExecutions += 1
      await new Promise<void>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      })
    })
    const firstManager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      lockOptions: { heartbeatIntervalMs: 0 },
      createRuntime: (options) =>
        new ProjectRuntime({ ...options, registry: firstRegistry, pollIntervalMs: 5 })
    })
    const firstOpen = await firstManager.open(created.projectRoot)
    const firstContext = firstManager.assertActiveSession(
      firstOpen.activeProject?.projectSessionId as string
    )
    const job = firstContext.jobs.enqueue({
      type: 'artifact_cleanup',
      payload: { cleanupId: 'manager-runtime' },
      maxAttempts: 1
    }).job
    firstContext.runtime.scheduler.wake()
    await waitFor(() => firstContext.jobs.require(job.jobId).state === 'running')
    await firstManager.close()
    expect(firstExecutions).toBe(1)

    let resumedExecutions = 0
    const secondRegistry = new JobHandlerRegistry()
    secondRegistry.register('artifact_cleanup', async () => {
      resumedExecutions += 1
    })
    const secondManager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects,
      lockOptions: { heartbeatIntervalMs: 0 },
      createRuntime: (options) =>
        new ProjectRuntime({ ...options, registry: secondRegistry, pollIntervalMs: 5 })
    })
    const reopened = await secondManager.open(created.projectRoot)
    const secondContext = secondManager.assertActiveSession(
      reopened.activeProject?.projectSessionId as string
    )
    await waitFor(() => secondContext.jobs.require(job.jobId).state === 'succeeded')
    expect(secondContext.jobs.require(job.jobId).attempts).toBe(1)
    expect(resumedExecutions).toBe(1)
    expect(secondContext.jobs.listTransitions(job.jobId).map(({ event }) => event)).toEqual([
      'enqueued',
      'claimed',
      'project_close_requeued',
      'claimed',
      'completed'
    ])
    await secondManager.close()
    appDatabase.close()
  })

  it('updates recent metadata by stable manifest ID after a project move', async () => {
    const { parent, appDatabase, recentProjects, manager } = await testEnvironment()
    const created = await existingProject(parent, 'original')
    await manager.open(created.projectRoot)
    await manager.close()
    const moved = join(parent, 'renamed')
    await rename(created.projectRoot, moved)

    await manager.open(moved)
    expect(await recentProjects.list()).toEqual([
      expect.objectContaining({
        projectId: created.manifest.projectId,
        projectPath: await realpath(moved),
        displayName: 'renamed'
      })
    ])
    await manager.close()
    appDatabase.close()
  })

  it('exposes stale-lock recovery only as an explicit root and observed-owner operation', async () => {
    const recover = vi.fn(async () => true)
    const manager = new ProjectManager({
      applicationVersion: 'test',
      logger: silentLog,
      recentProjects: { upsert: vi.fn() },
      dependencies: {
        canonicalizeRoot: async () => '/canonical/selected',
        recoverStaleLock: recover
      }
    })
    const staleBefore = new Date('2026-07-14T12:00:00.000Z')

    await expect(
      manager.recoverStaleLock({
        selectedRoot: '/selected',
        observedOwnerToken: 'observed-owner',
        staleBefore
      })
    ).resolves.toBe(true)
    expect(recover).toHaveBeenCalledWith(
      '/canonical/selected',
      expect.objectContaining({
        expectedOwnerToken: 'observed-owner',
        staleBefore
      })
    )
    expect(manager.snapshot()).toEqual({ state: 'closed', activeProject: null })
  })
})

async function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for project runtime state')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}
