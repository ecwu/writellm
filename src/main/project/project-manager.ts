import { randomUUID } from 'node:crypto'
import { access, realpath, rm } from 'node:fs/promises'
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
import { KnowledgeImportService } from '../knowledge/knowledge-import-service'
import type { MineruWorkflowService } from '../knowledge/mineru-workflow-service'
import type { KnowledgeNormalizationService } from '../knowledge/knowledge-normalization-service'
import type { KnowledgeMappingService } from '../knowledge/knowledge-mapping-service'
import { ManuscriptService } from '../manuscript/manuscript-service'
import { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import {
  createProjectHandlerRegistry,
  ProjectRuntime,
  type ProjectRuntimeOptions
} from '../jobs/scheduler/project-runtime'
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
import {
  createProjectSnapshot,
  inventoryProjectFiles,
  restoreProjectDatabase,
  restoreProjectSnapshot,
  type ProjectSnapshotManifest
} from './project-snapshot'
import type { ProjectIndexService } from '../search/index-service'
import type { RetrievalService } from '../search/retrieval-service'
import { INDEX_SCHEMA_VERSION } from '../../shared/contracts/indexing'
import { ProjectOperationRegistry } from './project-operations'

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

export interface ProjectSnapshotParticipants {
  finalEditorFlush(context: ProjectContext): Promise<void>
  pauseFilePublishers(context: ProjectContext): Promise<void>
  resumeFilePublishers(context: ProjectContext): Promise<void>
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

const noOpSnapshotParticipants: ProjectSnapshotParticipants = {
  finalEditorFlush: async () => undefined,
  pauseFilePublishers: async () => undefined,
  resumeFilePublishers: async () => undefined
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
  snapshotParticipants?: Partial<ProjectSnapshotParticipants>
  exportDiagnostics?: () => Promise<{ exported: boolean }>
  finalFlushTimeoutMs?: number
  lockOptions?: Omit<ProjectLockOptions, 'logger'>
  dependencies?: Partial<ProjectManagerDependencies>
  createRuntime?: (options: ProjectRuntimeOptions) => ProjectRuntime
  createManuscriptService?: (
    options: ConstructorParameters<typeof ManuscriptService>[0]
  ) => ManuscriptService
  createKnowledgeRuntime?: (options: {
    projectRoot: string
    projectId: string
    projectSessionId: string
    database: ProjectDatabase
    jobs: JobStore
    log: Pick<Logger, 'info' | 'warn' | 'error'>
  }) => {
    mineruWorkflow: MineruWorkflowService
    knowledgeNormalization: KnowledgeNormalizationService
    knowledgeMapping?: KnowledgeMappingService
    projectIndex?: ProjectIndexService
    retrieval?: RetrievalService
    registry: ReturnType<typeof createProjectHandlerRegistry>
    terminateWorkers?: () => void | Promise<void>
  }
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
  readonly #snapshotParticipants: ProjectSnapshotParticipants
  readonly #exportDiagnostics?: () => Promise<{ exported: boolean }>
  readonly #lockOptions: Omit<ProjectLockOptions, 'logger'>
  readonly #dependencies: ProjectManagerDependencies
  readonly #finalFlushTimeoutMs: number
  readonly #createRuntime: (options: ProjectRuntimeOptions) => ProjectRuntime
  readonly #createManuscriptService: (
    options: ConstructorParameters<typeof ManuscriptService>[0]
  ) => ManuscriptService
  readonly #createKnowledgeRuntime?: ProjectManagerOptions['createKnowledgeRuntime']
  #state: ProjectLifecycleState = 'closed'
  #context: ProjectContext | null = null
  #transition: Promise<void> = Promise.resolve()
  #finalFlushAuthorization: ProjectFinalFlushAuthorization | null = null
  #finalFlushConsumed = false
  #snapshotFlushAuthorization: ProjectFinalFlushAuthorization | null = null
  #snapshotFlushConsumed = false
  #recovery:
    | { kind: 'open'; selectedRoot: string }
    | { kind: 'create'; projectRoot: string }
    | {
        kind: 'close'
        context: ProjectContext
        completed: Set<'claims' | 'park' | 'workers' | 'database' | 'lock' | 'subscriptions'>
      }
    | null = null

  constructor(options: ProjectManagerOptions) {
    this.#applicationVersion = options.applicationVersion
    this.#logger = options.logger
    this.#recentProjects = options.recentProjects
    this.#forbiddenApplicationDirectories = options.forbiddenApplicationDirectories ?? []
    this.#closeParticipants = { ...noOpCloseParticipants, ...options.closeParticipants }
    this.#snapshotParticipants = { ...noOpSnapshotParticipants, ...options.snapshotParticipants }
    this.#exportDiagnostics = options.exportDiagnostics
    this.#finalFlushTimeoutMs = options.finalFlushTimeoutMs ?? 10_000
    this.#lockOptions = options.lockOptions ?? {}
    this.#dependencies = { ...defaultDependencies, ...options.dependencies }
    this.#createRuntime =
      options.createRuntime ?? ((runtimeOptions) => new ProjectRuntime(runtimeOptions))
    this.#createManuscriptService =
      options.createManuscriptService ?? ((serviceOptions) => new ManuscriptService(serviceOptions))
    this.#createKnowledgeRuntime = options.createKnowledgeRuntime
  }

  snapshot(): ProjectLifecycleSnapshot {
    return projectLifecycleSnapshotSchema.parse({
      state: this.#state,
      activeProject: this.#context === null ? null : toActiveProject(this.#context)
    })
  }

  setCloseParticipants(participants: Partial<ProjectCloseParticipants>): void {
    Object.assign(this.#closeParticipants, participants)
  }

  setSnapshotParticipants(participants: Partial<ProjectSnapshotParticipants>): void {
    Object.assign(this.#snapshotParticipants, participants)
  }

  create(options: CreateManagedProjectOptions): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      const name = projectNameSchema.parse(options.name)
      const projectRoot = join(options.parentDirectory, `${name}.writellm`)
      this.#requireState('closed')
      this.#state = 'creating'
      this.#recovery = { kind: 'create', projectRoot }
      this.#logger.info(
        { event: 'project_manager.create.started' },
        'Project create transition started'
      )
      let projectPublished = false
      let created: CreatedProject | undefined
      try {
        created = await this.#dependencies.createProject({
          destination: projectRoot,
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
        this.#recovery = null
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
        if (this.#state === 'closed') this.#recovery = null
        throw new Error('Failed to create and open project', { cause: err })
      }
      return this.snapshot()
    })
  }

  open(selectedRoot: string): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      this.#requireState('closed')
      this.#state = 'opening'
      this.#recovery = { kind: 'open', selectedRoot }
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
    this.#snapshotFlushAuthorization = null
    this.#snapshotFlushConsumed = false

    return this.#serialize(async () => {
      const startedAt = Date.now()
      this.#logger.info(
        { event: 'project_manager.close.started', projectId: context.manifest.projectId },
        'Project close transition started'
      )
      let firstError: unknown
      const completed = new Set<
        'claims' | 'park' | 'workers' | 'database' | 'lock' | 'subscriptions'
      >()
      const attempt = async (
        event: string,
        operation: () => void | Promise<void>
      ): Promise<boolean> => {
        try {
          await operation()
          return true
        } catch (err) {
          firstError ??= err
          this.#logger.error(
            { event, err, projectId: context.manifest.projectId },
            'Project close step failed'
          )
          return false
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
      this.#finalFlushAuthorization = finalFlushAuthorization
      this.#finalFlushConsumed = false
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
      this.#finalFlushAuthorization = null
      if (
        await attempt('project_manager.close.stop_claims_failed', () =>
          Promise.resolve(context.runtime.stopClaims()).then(() =>
            this.#closeParticipants.stopJobClaims(context)
          )
        )
      )
        completed.add('claims')
      context.operations?.abortAll(new Error('Project is closing'))
      if (
        await attempt('project_manager.close.park_workers_failed', () =>
          context.runtime.park().then(() => this.#closeParticipants.parkWorkers(context))
        )
      )
        completed.add('park')
      if (
        await attempt('project_manager.close.stop_workers_failed', () =>
          context.runtime.stop().then(() => this.#closeParticipants.stopWorkersAndIndex(context))
        )
      )
        completed.add('workers')
      if (await attempt('project_manager.close.database_failed', () => context.database.close())) {
        completed.add('database')
      }
      if (
        await attempt('project_manager.close.lock_release_failed', async () => {
          await context.writeLock.release()
        })
      )
        completed.add('lock')
      if (
        await attempt('project_manager.close.subscription_revoke_failed', () =>
          this.#closeParticipants.revokeSubscriptions(context.projectSessionId)
        )
      )
        completed.add('subscriptions')

      this.#context = null
      this.#recovery = { kind: 'close', context, completed }
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
      this.#recovery = null
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
      this.#recovery = { kind: 'open', selectedRoot }
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

  assertMutationSession(projectSessionId: string): ProjectContext {
    const context = this.assertActiveSession(projectSessionId)
    context.operations?.assertMutationsAllowed()
    return context
  }

  authorizeFinalFlush(projectSessionId: string, closingToken: string): ProjectContext {
    if (
      this.#state !== 'closing' ||
      this.#context === null ||
      this.#finalFlushAuthorization === null ||
      this.#finalFlushAuthorization.projectSessionId !== projectSessionId ||
      this.#finalFlushAuthorization.closingToken !== closingToken ||
      this.#finalFlushConsumed
    ) {
      throw new ProjectSessionError('Final editor flush is not authorized')
    }
    this.#finalFlushConsumed = true
    return this.#context
  }

  beginSnapshotFlush(projectSessionId: string): ProjectFinalFlushAuthorization {
    const context = this.assertActiveSession(projectSessionId)
    const authorization: ProjectFinalFlushAuthorization = {
      projectSessionId: context.projectSessionId,
      currentRevision: null,
      closingToken: this.#dependencies.randomUUID()
    }
    this.#snapshotFlushAuthorization = authorization
    this.#snapshotFlushConsumed = false
    return authorization
  }

  authorizeSnapshotFlush(projectSessionId: string, closingToken: string): ProjectContext {
    if (
      this.#state !== 'open' ||
      this.#context === null ||
      this.#snapshotFlushAuthorization === null ||
      this.#snapshotFlushAuthorization.projectSessionId !== projectSessionId ||
      this.#snapshotFlushAuthorization.closingToken !== closingToken ||
      this.#snapshotFlushConsumed
    ) {
      throw new ProjectSessionError('Snapshot editor flush is not authorized')
    }
    this.#snapshotFlushConsumed = true
    return this.#context
  }

  completeSnapshotFlush(closingToken: string): void {
    if (this.#snapshotFlushAuthorization?.closingToken === closingToken) {
      this.#snapshotFlushAuthorization = null
      this.#snapshotFlushConsumed = false
    }
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
        this.#recovery = null
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

  retryOpen(): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      if (this.#state !== 'recovery-required' || this.#recovery?.kind !== 'open') {
        throw new Error('No failed project open is available to retry')
      }
      const selectedRoot = this.#recovery.selectedRoot
      this.#state = 'opening'
      try {
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(selectedRoot)
        await this.#openCanonicalRoot(canonicalRoot)
        this.#recovery = null
        return this.snapshot()
      } catch (err) {
        this.#state = 'recovery-required'
        this.#logger.error(
          { event: 'project_manager.retry_open.failed', err },
          'Project open retry failed'
        )
        throw new Error('Failed to retry opening the project', { cause: err })
      }
    })
  }

  retryClose(): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      if (this.#state !== 'recovery-required' || this.#recovery?.kind !== 'close') {
        throw new Error('No failed project close is available to retry')
      }
      const recovery = this.#recovery
      try {
        if (!recovery.completed.has('workers')) {
          await recovery.context.runtime.stop()
          await this.#closeParticipants.stopWorkersAndIndex(recovery.context)
          recovery.completed.add('workers')
        }
        if (!recovery.completed.has('database')) {
          recovery.context.database.close()
          recovery.completed.add('database')
        }
        if (!recovery.completed.has('lock')) {
          await recovery.context.writeLock.release()
          recovery.completed.add('lock')
        }
        if (!recovery.completed.has('subscriptions')) {
          await this.#closeParticipants.revokeSubscriptions(recovery.context.projectSessionId)
          recovery.completed.add('subscriptions')
        }
        this.#recovery = null
        this.#state = 'closed'
        this.#logger.info(
          {
            event: 'project_manager.retry_close.completed',
            projectId: recovery.context.manifest.projectId
          },
          'Project close retry completed'
        )
        return this.snapshot()
      } catch (err) {
        this.#state = 'recovery-required'
        this.#logger.error(
          {
            event: 'project_manager.retry_close.failed',
            err,
            projectId: recovery.context.manifest.projectId
          },
          'Project close retry failed'
        )
        throw new Error('Failed to retry closing the project', { cause: err })
      }
    })
  }

  discardIncompleteCreate(): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      if (this.#state !== 'recovery-required' || this.#recovery?.kind !== 'create') {
        throw new Error('No incomplete project creation is available to discard')
      }
      const projectRoot = this.#recovery.projectRoot
      try {
        try {
          await this.#dependencies.readManifest(projectRoot)
          throw new Error('The failed creation target contains a published project manifest')
        } catch (err) {
          if (err instanceof Error && err.message.includes('published project manifest')) throw err
        }
        await rm(projectRoot, { recursive: true, force: true })
        this.#recovery = null
        this.#state = 'closed'
        this.#logger.info(
          { event: 'project_manager.create.discarded' },
          'Incomplete project discarded'
        )
        return this.snapshot()
      } catch (err) {
        this.#logger.error(
          { event: 'project_manager.create.discard_failed', err },
          'Failed to discard incomplete project'
        )
        throw new Error('Failed to discard the incomplete project', { cause: err })
      }
    })
  }

  locateMovedProject(selectedRoot: string): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      if (this.#state !== 'recovery-required')
        throw new Error('Project location recovery is unavailable')
      this.#state = 'opening'
      this.#recovery = { kind: 'open', selectedRoot }
      try {
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(selectedRoot)
        await this.#openCanonicalRoot(canonicalRoot)
        this.#recovery = null
        return this.snapshot()
      } catch (err) {
        this.#state = 'recovery-required'
        this.#logger.error(
          { event: 'project_manager.locate_moved.failed', err },
          'Moved project location recovery failed'
        )
        throw new Error('Failed to open the located project', { cause: err })
      }
    })
  }

  async exportDiagnostics(): Promise<{ exported: boolean }> {
    if (this.#state !== 'recovery-required')
      throw new Error('Diagnostics export is only available during recovery')
    try {
      const result = await this.#exportDiagnostics?.()
      this.#logger.info(
        {
          event: 'project_manager.recovery_diagnostics.exported',
          exported: result?.exported ?? false
        },
        'Recovery diagnostics export completed'
      )
      return result ?? { exported: false }
    } catch (err) {
      this.#logger.error(
        { event: 'project_manager.recovery_diagnostics.export_failed', err },
        'Recovery diagnostics export failed'
      )
      throw new Error('Failed to export recovery diagnostics', { cause: err })
    }
  }

  returnToClosed(): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      if (this.#state !== 'recovery-required')
        throw new Error('Project manager is not awaiting recovery')
      if (this.#recovery?.kind === 'create' || this.#recovery?.kind === 'close') {
        throw new Error('Complete the pending project recovery action before returning to closed')
      }
      this.#recovery = null
      this.#context = null
      this.#state = 'closed'
      this.#logger.info(
        { event: 'project_manager.recovery.returned_to_closed' },
        'Recovery state returned to closed'
      )
      return this.snapshot()
    })
  }

  createSnapshot(projectSessionId: string, destination: string): Promise<ProjectSnapshotManifest> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      const operations = context.operations
      const barrier = {
        pauseMutations: async () => {
          operations?.pauseMutations()
        },
        finalEditorFlush: () => this.#snapshotParticipants.finalEditorFlush(context),
        pauseFilePublishers: () => this.#snapshotParticipants.pauseFilePublishers(context),
        resumeFilePublishers: () => this.#snapshotParticipants.resumeFilePublishers(context),
        resumeMutations: async () => {
          operations?.resumeMutations()
        }
      }
      try {
        return await createProjectSnapshot({
          sourceRoot: context.projectRoot,
          manifest: context.manifest,
          sourceDatabase: context.database,
          destination,
          sourceAppVersion: this.#applicationVersion,
          inventoryFromBackup: () => inventoryProjectFiles(context.projectRoot),
          barrier,
          log: this.#logger
        })
      } catch (err) {
        this.#logger.error(
          {
            event: 'project_manager.snapshot_create.failed',
            err,
            projectId: context.manifest.projectId
          },
          'Project snapshot creation failed'
        )
        throw new Error('Failed to create project snapshot', { cause: err })
      }
    })
  }

  restoreSnapshot(options: {
    snapshotRoot: string
    destination: string
  }): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      if (this.#state !== 'closed' && this.#state !== 'recovery-required') {
        throw new Error(`Cannot restore a snapshot while state is ${this.#state}`)
      }
      this.#state = 'opening'
      try {
        const restored = await restoreProjectSnapshot({
          snapshotRoot: options.snapshotRoot,
          destination: options.destination,
          log: this.#logger
        })
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(restored.destination)
        await this.#openCanonicalRoot(canonicalRoot)
        this.#recovery = null
        return this.snapshot()
      } catch (err) {
        this.#state = 'recovery-required'
        this.#logger.error(
          { event: 'project_manager.snapshot_restore.failed', err },
          'Project snapshot restore failed'
        )
        throw new Error('Failed to restore the project snapshot', { cause: err })
      }
    })
  }

  async #openCanonicalRoot(canonicalRoot: string, acquiredLock?: ProjectWriteLock): Promise<void> {
    const manifest = await this.#dependencies.readManifest(canonicalRoot)
    let writeLock = acquiredLock
    let database: ProjectDatabase | undefined
    let runtime: ProjectRuntime | undefined
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
      const projectSessionId = this.#dependencies.randomUUID()
      const operations = new ProjectOperationRegistry()
      const manuscript = this.#createManuscriptService({
        database,
        projectId: manifest.projectId,
        log: this.#logger
      })
      const editorPersistence = new EditorPersistenceService({
        projectRoot: canonicalRoot,
        projectId: manifest.projectId,
        database,
        manuscript,
        log: this.#logger
      })
      await editorPersistence.repairAll()
      const knowledgeRuntime = this.#createKnowledgeRuntime?.({
        projectRoot: canonicalRoot,
        projectId: manifest.projectId,
        projectSessionId,
        database,
        jobs,
        log: this.#logger
      })
      const projectIndex = knowledgeRuntime?.projectIndex
      const knowledgeImports = new KnowledgeImportService({
        projectRoot: canonicalRoot,
        projectId: manifest.projectId,
        database,
        log: this.#logger,
        onStored:
          knowledgeRuntime === undefined
            ? undefined
            : async (item) => {
                try {
                  await knowledgeRuntime.mineruWorkflow.start(item.knowledgeItemId)
                } catch (err) {
                  this.#logger.error(
                    {
                      event: 'mineru.parse.auto_queue_failed',
                      err,
                      projectId: manifest.projectId,
                      knowledgeItemId: item.knowledgeItemId
                    },
                    'Failed to queue MinerU parse after knowledge import'
                  )
                }
              },
        onDeleted:
          projectIndex === undefined
            ? undefined
            : async (knowledgeItemId) => projectIndex.requestItemDelete(knowledgeItemId)
      })
      runtime = this.#createRuntime({
        projectId: manifest.projectId,
        projectSessionId,
        jobs,
        registry: knowledgeRuntime?.registry ?? createProjectHandlerRegistry(),
        log: this.#logger,
        terminateWorkers: knowledgeRuntime?.terminateWorkers
      })
      const context: ProjectContext = {
        projectRoot: canonicalRoot,
        manifest,
        projectSessionId,
        operations,
        displayName: projectDisplayName(canonicalRoot),
        indexRebuildRequired: await isIndexRebuildRequired(canonicalRoot, this.#logger),
        database,
        jobs,
        manuscript,
        editorPersistence,
        knowledgeImports,
        mineruWorkflow: knowledgeRuntime?.mineruWorkflow ?? null,
        knowledgeNormalization: knowledgeRuntime?.knowledgeNormalization ?? null,
        knowledgeMapping: knowledgeRuntime?.knowledgeMapping ?? null,
        projectIndex: projectIndex ?? null,
        retrieval: knowledgeRuntime?.retrieval ?? null,
        runtime,
        writeLock
      }
      await projectIndex?.initialize()
      runtime.start()
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
      if (runtime !== undefined) {
        try {
          await runtime.stop()
        } catch (cleanupErr) {
          this.#logger.error(
            {
              event: 'project_manager.open.runtime_cleanup_failed',
              err: cleanupErr,
              projectId: manifest.projectId
            },
            'Failed to stop runtime after project open failure'
          )
        }
      }
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
    const userVersion = database.pragma('user_version', { simple: true }) as number
    const quickCheck = database.pragma('quick_check', { simple: true }) as string
    if (
      applicationId !== INDEX_DATABASE_APPLICATION_ID ||
      userVersion !== INDEX_SCHEMA_VERSION ||
      quickCheck !== 'ok'
    ) {
      return true
    }
    const active = database
      .prepare("SELECT count(*) FROM index_generations WHERE state = 'active'")
      .pluck()
      .get() as number
    return active !== 1
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
