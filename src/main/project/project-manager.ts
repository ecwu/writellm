import { randomUUID } from 'node:crypto'
import { access, realpath } from 'node:fs/promises'
import { basename, join } from 'node:path'
import Database from 'better-sqlite3'
import type { Logger } from 'pino'
import {
  projectLifecycleSnapshotSchema,
  projectNameSchema,
  type ProjectLifecycleSnapshot,
  type ProjectLifecycleState,
  type ProjectSessionId
} from '../../shared/contracts/projects'
import type { RecentProjectsRepository } from '../app-db/repositories/recent-projects'
import { JobStore } from '../jobs/job-store'
import { type ProjectContext, toActiveProject } from './project-context'
import {
  createProject,
  INDEX_DATABASE_APPLICATION_ID,
  type CreateProjectOptions,
  type CreatedProject,
  ProjectCreateError
} from './project-lifecycle'
import { openProjectDatabase, type ProjectDatabase } from './project-database'
import { readProjectManifest, type ProjectManifest } from './project-manifest'
import {
  ProjectWriteLock,
  recoverStaleProjectWriteLock,
  type ProjectLockOptions
} from './project-lock'
import { INDEX_DATABASE_RELATIVE_PATH, resolveProjectPath } from './project-paths'
import { restoreProjectDatabase } from './project-snapshot'

export interface ProjectCloseParticipants {
  getCurrentRevision(context: ProjectContext): Promise<string | null>
  flushEditors(
    context: ProjectContext,
    authorization: ProjectFinalFlushAuthorization
  ): Promise<void>
  verifyFinalEditorFlush(
    context: ProjectContext,
    authorization: ProjectFinalFlushAuthorization
  ): Promise<void>
  stopJobClaims(context: ProjectContext): Promise<void>
  parkWorkers(context: ProjectContext): Promise<void>
  stopWorkersAndIndex(context: ProjectContext): Promise<void>
  revokeSubscriptions(projectSessionId: ProjectSessionId): Promise<void>
}

const noOpCloseParticipants: ProjectCloseParticipants = {
  getCurrentRevision: async () => null,
  flushEditors: async () => undefined,
  verifyFinalEditorFlush: async () => undefined,
  stopJobClaims: async () => undefined,
  parkWorkers: async () => undefined,
  stopWorkersAndIndex: async () => undefined,
  revokeSubscriptions: async () => undefined
}

export interface ProjectFinalFlushAuthorization {
  readonly projectSessionId: ProjectSessionId
  readonly currentRevision: string | null
  readonly closingToken: string
}

export interface ProjectManagerDependencies {
  canonicalizeRoot: (projectRoot: string) => Promise<string>
  readManifest: (projectRoot: string) => Promise<ProjectManifest>
  acquireLock: (projectRoot: string, options: ProjectLockOptions) => Promise<ProjectWriteLock>
  openDatabase: typeof openProjectDatabase
  createProject: (options: CreateProjectOptions) => Promise<CreatedProject>
  recoverStaleLock: typeof recoverStaleProjectWriteLock
  randomUUID: () => string
  now: () => Date
}

const defaultDependencies: ProjectManagerDependencies = {
  canonicalizeRoot: realpath,
  readManifest: readProjectManifest,
  acquireLock: ProjectWriteLock.acquire,
  openDatabase: openProjectDatabase,
  createProject,
  recoverStaleLock: recoverStaleProjectWriteLock,
  randomUUID,
  now: () => new Date()
}

export interface ProjectManagerOptions {
  applicationVersion: string
  logger: Pick<Logger, 'info' | 'warn' | 'error'>
  recentProjects: Pick<RecentProjectsRepository, 'upsert'>
  forbiddenApplicationDirectories?: readonly string[]
  closeParticipants?: Partial<ProjectCloseParticipants>
  finalFlushTimeoutMs?: number
  lockOptions?: Omit<ProjectLockOptions, 'logger'>
  dependencies?: Partial<ProjectManagerDependencies>
}

export interface CreateManagedProjectOptions {
  parentDirectory: string
  name: string
}

export class ProjectSessionError extends Error {
  constructor(message = 'Project session is not active') {
    super(message)
    this.name = 'ProjectSessionError'
  }
}

export class ProjectManager {
  readonly #applicationVersion: string
  readonly #logger: ProjectManagerOptions['logger']
  readonly #recentProjects: ProjectManagerOptions['recentProjects']
  readonly #forbiddenApplicationDirectories: readonly string[]
  readonly #closeParticipants: ProjectCloseParticipants
  readonly #lockOptions: Omit<ProjectLockOptions, 'logger'>
  readonly #dependencies: ProjectManagerDependencies
  readonly #finalFlushTimeoutMs: number
  #state: ProjectLifecycleState = 'closed'
  #context: ProjectContext | null = null
  #transition: Promise<void> = Promise.resolve()

  constructor(options: ProjectManagerOptions) {
    this.#applicationVersion = options.applicationVersion
    this.#logger = options.logger
    this.#recentProjects = options.recentProjects
    this.#forbiddenApplicationDirectories = options.forbiddenApplicationDirectories ?? []
    this.#closeParticipants = { ...noOpCloseParticipants, ...options.closeParticipants }
    this.#finalFlushTimeoutMs = options.finalFlushTimeoutMs ?? 10_000
    this.#lockOptions = options.lockOptions ?? {}
    this.#dependencies = { ...defaultDependencies, ...options.dependencies }
  }

  snapshot(): ProjectLifecycleSnapshot {
    return projectLifecycleSnapshotSchema.parse({
      state: this.#state,
      activeProject: this.#context === null ? null : toActiveProject(this.#context)
    })
  }

  create(options: CreateManagedProjectOptions): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      const name = projectNameSchema.parse(options.name)
      this.#requireState('closed')
      this.#state = 'creating'
      this.#logger.info(
        { event: 'project_manager.create.started' },
        'Project create transition started'
      )
      let projectPublished = false
      let created: CreatedProject | undefined
      try {
        created = await this.#dependencies.createProject({
          destination: join(options.parentDirectory, `${name}.writellm`),
          forbiddenApplicationDirectories: this.#forbiddenApplicationDirectories,
          applicationVersion: this.#applicationVersion,
          log: this.#logger as Logger,
          initialTitle: name,
          lockOptions: this.#lockOptions
        })
        projectPublished = true
        this.#state = 'opening'
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(created.projectRoot)
        if (canonicalRoot !== created.projectRoot) {
          throw new Error('Created project root identity changed before open')
        }
        await this.#openCanonicalRoot(canonicalRoot, created.writeLock)
        this.#logger.info(
          { event: 'project_manager.create.completed', projectId: created.manifest.projectId },
          'Project create transition completed'
        )
      } catch (err) {
        if (created !== undefined && this.#context === null) {
          try {
            await created.writeLock.release()
          } catch (cleanupErr) {
            this.#logger.error(
              {
                event: 'project_manager.create.lock_cleanup_failed',
                err: cleanupErr,
                projectId: created.manifest.projectId
              },
              'Failed to release project lock after create transition failure'
            )
          }
        }
        this.#logger.error(
          { event: 'project_manager.create.failed', err },
          'Project create transition failed'
        )
        this.#context = null
        this.#state =
          !projectPublished && err instanceof ProjectCreateError && err.disposition === 'clean'
            ? 'closed'
            : 'recovery-required'
        throw new Error('Failed to create and open project', { cause: err })
      }
      return this.snapshot()
    })
  }

  open(selectedRoot: string): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      this.#requireState('closed')
      this.#state = 'opening'
      this.#logger.info(
        { event: 'project_manager.open.started' },
        'Project open transition started'
      )
      try {
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(selectedRoot)
        await this.#openCanonicalRoot(canonicalRoot)
      } catch (err) {
        this.#logger.error(
          { event: 'project_manager.open.failed', err },
          'Project open transition failed'
        )
        this.#context = null
        this.#state = 'recovery-required'
        throw new Error('Failed to open project', { cause: err })
      }
      return this.snapshot()
    })
  }

  close(): Promise<ProjectLifecycleSnapshot> {
    if (this.#state !== 'open' || this.#context === null) {
      return Promise.reject(new Error(`Cannot close project while state is ${this.#state}`))
    }
    const context = this.#context
    this.#state = 'closing'

    return this.#serialize(async () => {
      const startedAt = Date.now()
      this.#logger.info(
        { event: 'project_manager.close.started', projectId: context.manifest.projectId },
        'Project close transition started'
      )
      let firstError: unknown
      const attempt = async (
        event: string,
        operation: () => void | Promise<void>
      ): Promise<void> => {
        try {
          await operation()
        } catch (err) {
          firstError ??= err
          this.#logger.error(
            { event, err, projectId: context.manifest.projectId },
            'Project close step failed'
          )
        }
      }

      let currentRevision: string | null = null
      await attempt('project_manager.close.editor_revision_read_failed', async () => {
        currentRevision = await this.#closeParticipants.getCurrentRevision(context)
      })
      const finalFlushAuthorization: ProjectFinalFlushAuthorization = {
        projectSessionId: context.projectSessionId,
        currentRevision,
        closingToken: this.#dependencies.randomUUID()
      }
      await attempt('project_manager.close.editor_flush_failed', () =>
        withTimeout(
          this.#closeParticipants.flushEditors(context, finalFlushAuthorization),
          this.#finalFlushTimeoutMs,
          'Final editor flush timed out'
        )
      )
      await attempt('project_manager.close.editor_flush_verify_failed', () =>
        this.#closeParticipants.verifyFinalEditorFlush(context, finalFlushAuthorization)
      )
      await attempt('project_manager.close.stop_claims_failed', () =>
        this.#closeParticipants.stopJobClaims(context)
      )
      await attempt('project_manager.close.park_workers_failed', () =>
        this.#closeParticipants.parkWorkers(context)
      )
      await attempt('project_manager.close.stop_workers_failed', () =>
        this.#closeParticipants.stopWorkersAndIndex(context)
      )
      await attempt('project_manager.close.database_failed', () => context.database.close())
      await attempt('project_manager.close.lock_release_failed', async () => {
        await context.writeLock.release()
      })
      await attempt('project_manager.close.subscription_revoke_failed', () =>
        this.#closeParticipants.revokeSubscriptions(context.projectSessionId)
      )

      this.#context = null
      if (firstError !== undefined) {
        this.#state = 'recovery-required'
        this.#logger.error(
          {
            event: 'project_manager.close.failed',
            err: firstError,
            projectId: context.manifest.projectId,
            durationMs: Date.now() - startedAt
          },
          'Project close transition failed'
        )
        throw new Error('Failed to close project cleanly', { cause: firstError })
      }

      this.#state = 'closed'
      this.#logger.info(
        {
          event: 'project_manager.close.completed',
          projectId: context.manifest.projectId,
          durationMs: Date.now() - startedAt
        },
        'Project close transition completed'
      )
      return this.snapshot()
    })
  }

  switch(selectedRoot: string): Promise<ProjectLifecycleSnapshot> {
    const closing = this.close()
    return this.#serialize(async () => {
      await closing
      this.#requireState('closed')
      this.#state = 'opening'
      this.#logger.info(
        { event: 'project_manager.open.started' },
        'Project open transition started'
      )
      try {
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(selectedRoot)
        await this.#openCanonicalRoot(canonicalRoot)
      } catch (err) {
        this.#logger.error(
          { event: 'project_manager.open.failed', err },
          'Project open transition failed'
        )
        this.#context = null
        this.#state = 'recovery-required'
        throw new Error('Failed to open project', { cause: err })
      }
      return this.snapshot()
    })
  }

  assertActiveSession(projectSessionId: string): ProjectContext {
    if (
      this.#state !== 'open' ||
      this.#context === null ||
      this.#context.projectSessionId !== projectSessionId
    ) {
      throw new ProjectSessionError()
    }
    return this.#context
  }

  async guardDelayedResult<T>(projectSessionId: string, result: Promise<T>): Promise<T> {
    this.assertActiveSession(projectSessionId)
    const value = await result
    this.assertActiveSession(projectSessionId)
    return value
  }

  recoverStaleLock(options: {
    selectedRoot: string
    observedOwnerToken: string
    staleBefore: Date
  }): Promise<boolean> {
    return this.#serialize(async () => {
      if (this.#state !== 'closed' && this.#state !== 'recovery-required') {
        throw new Error(`Cannot recover a project lock while state is ${this.#state}`)
      }
      try {
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(options.selectedRoot)
        const recovered = await this.#dependencies.recoverStaleLock(canonicalRoot, {
          ...this.#lockOptions,
          logger: this.#logger,
          expectedOwnerToken: options.observedOwnerToken,
          staleBefore: options.staleBefore
        })
        this.#state = 'closed'
        return recovered
      } catch (err) {
        this.#logger.error(
          { event: 'project_manager.stale_lock_recovery.failed', err },
          'Explicit stale lock recovery failed'
        )
        this.#state = 'recovery-required'
        throw new Error('Failed to recover stale project lock', { cause: err })
      }
    })
  }

  restoreDatabase(options: {
    selectedRoot: string
    candidateDatabase: string
  }): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      if (this.#state !== 'closed' && this.#state !== 'recovery-required') {
        throw new Error(`Cannot restore a project database while state is ${this.#state}`)
      }
      this.#state = 'opening'
      let writeLock: ProjectWriteLock | undefined
      let projectId: string | undefined
      try {
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(options.selectedRoot)
        const manifest = await this.#dependencies.readManifest(canonicalRoot)
        projectId = manifest.projectId
        writeLock = await this.#dependencies.acquireLock(canonicalRoot, {
          ...this.#lockOptions,
          logger: this.#logger
        })
        await restoreProjectDatabase({
          projectRoot: canonicalRoot,
          candidateDatabase: options.candidateDatabase,
          projectId: manifest.projectId,
          log: this.#logger
        })
        const restoredLock = writeLock
        writeLock = undefined
        await this.#openCanonicalRoot(canonicalRoot, restoredLock)
        return this.snapshot()
      } catch (err) {
        if (writeLock !== undefined) {
          try {
            await writeLock.release()
          } catch (cleanupErr) {
            this.#logger.error(
              { event: 'project_manager.restore.lock_cleanup_failed', err: cleanupErr, projectId },
              'Failed to release project lock after restore failure'
            )
          }
        }
        this.#context = null
        this.#state = 'recovery-required'
        this.#logger.error(
          { event: 'project_manager.restore.failed', err, projectId },
          'Project database restore transition failed'
        )
        throw new Error('Failed to restore and reopen project database', { cause: err })
      }
    })
  }

  async #openCanonicalRoot(canonicalRoot: string, acquiredLock?: ProjectWriteLock): Promise<void> {
    const manifest = await this.#dependencies.readManifest(canonicalRoot)
    let writeLock = acquiredLock
    let database: ProjectDatabase | undefined
    try {
      writeLock ??= await this.#dependencies.acquireLock(canonicalRoot, {
        ...this.#lockOptions,
        logger: this.#logger
      })
      database = await this.#dependencies.openDatabase({
        projectRoot: canonicalRoot,
        manifest,
        applicationVersion: this.#applicationVersion,
        log: this.#logger as Logger
      })
      const jobs = new JobStore({
        database,
        projectId: manifest.projectId,
        log: this.#logger
      })
      jobs.recoverExpiredLeases()
      const context: ProjectContext = {
        projectRoot: canonicalRoot,
        manifest,
        projectSessionId: this.#dependencies.randomUUID(),
        displayName: projectDisplayName(canonicalRoot),
        indexRebuildRequired: await isIndexRebuildRequired(canonicalRoot, this.#logger),
        database,
        jobs,
        writeLock
      }
      this.#context = context
      this.#state = 'open'
      try {
        await this.#recentProjects.upsert({
          projectId: manifest.projectId,
          projectPath: canonicalRoot,
          displayName: context.displayName,
          lastOpenedAt: this.#dependencies.now().toISOString()
        })
      } catch (err) {
        this.#logger.error(
          {
            event: 'project_manager.recent_project_update_failed',
            err,
            projectId: manifest.projectId
          },
          'Failed to update recent project metadata'
        )
      }
      this.#logger.info(
        {
          event: 'project_manager.open.completed',
          projectId: manifest.projectId,
          projectSessionId: context.projectSessionId
        },
        'Project open transition completed'
      )
    } catch (err) {
      if (database !== undefined) {
        try {
          database.close()
        } catch (cleanupErr) {
          this.#logger.error(
            {
              event: 'project_manager.open.database_cleanup_failed',
              err: cleanupErr,
              projectId: manifest.projectId
            },
            'Failed to close database after project open failure'
          )
        }
      }
      if (writeLock !== undefined) {
        try {
          await writeLock.release()
        } catch (cleanupErr) {
          this.#logger.error(
            {
              event: 'project_manager.open.lock_cleanup_failed',
              err: cleanupErr,
              projectId: manifest.projectId
            },
            'Failed to release lock after project open failure'
          )
        }
      }
      throw err
    }
  }

  #requireState(expected: ProjectLifecycleState): void {
    if (this.#state !== expected) {
      throw new Error(`Project manager must be ${expected}; current state is ${this.#state}`)
    }
  }

  #serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#transition.then(operation, operation)
    this.#transition = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

async function isIndexRebuildRequired(
  projectRoot: string,
  log: Pick<Logger, 'info' | 'warn' | 'error'>
): Promise<boolean> {
  const indexPath = resolveProjectPath(projectRoot, INDEX_DATABASE_RELATIVE_PATH)
  const exists = await access(indexPath).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return false
      throw err
    }
  )
  if (!exists) return true

  let database: Database.Database | undefined
  try {
    database = new Database(indexPath, { readonly: true, fileMustExist: true })
    const applicationId = database.pragma('application_id', { simple: true }) as number
    return applicationId !== INDEX_DATABASE_APPLICATION_ID
  } catch (err) {
    log.error(
      { event: 'project.index.compatibility_check_failed', err },
      'Project index compatibility check failed; rebuild is required'
    )
    return true
  } finally {
    database?.close()
  }
}

function projectDisplayName(projectRoot: string): string {
  const directoryName = basename(projectRoot)
  return directoryName.toLowerCase().endsWith('.writellm')
    ? directoryName.slice(0, -'.writellm'.length)
    : directoryName
}

async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
