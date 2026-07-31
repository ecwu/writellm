import { randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import type { Logger } from 'pino'
import { z } from 'zod'
import {
  projectLifecycleSnapshotSchema,
  projectNameSchema,
  type CheckpointEntry,
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
  inspectProjectWriteLock,
  PROJECT_LOCK_STALE_AFTER_MS,
  ProjectLockContendedError,
  ProjectWriteLock,
  recoverStaleProjectWriteLock,
  type ProjectLockOptions
} from './project-lock'
import {
  INDEX_DATABASE_RELATIVE_PATH,
  PROJECT_DATABASE_RELATIVE_PATH,
  PROJECT_TEMP_DIRECTORY,
  PROJECT_HISTORY_IGNORE_RELATIVE_PATH,
  PROJECT_HISTORY_RELATIVE_PATH,
  resolveProjectPath,
  WRITELLM_INTERNAL_DIRECTORY
} from './project-paths'
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
import type { AgentSessionService } from '../agent/session-service'
import type { MutationProposalService } from '../agent/mutation-service'
import { ManuscriptAssetService } from '../manuscript/asset-service'
import {
  createManuscriptExport,
  type PublishedManuscriptExport
} from '../manuscript/manuscript-export'
import type { ManuscriptExportKind } from '../../shared/contracts/manuscript-export'
import { IsomorphicGitProjectVersionStore, type ProjectVersionStore } from './project-version-store'
import { writeAtomicFile } from '../storage/atomic-file'
import { ProjectFilesystem } from './project-filesystem'

const historyRestoreJournalSchema = z
  .object({
    format: z.literal('writellm-history-restore'),
    formatVersion: z.literal(1),
    projectId: z.uuid(),
    projectRootName: z.string().min(1).max(255),
    token: z.uuid(),
    phase: z.enum([
      'prepared',
      'original-moved',
      'candidate-installed',
      'history-moved',
      'committed'
    ]),
    targetOid: z.string().regex(/^[a-f0-9]{40}$/)
  })
  .strict()

type HistoryRestoreJournal = z.infer<typeof historyRestoreJournalSchema>

function historyRestorePaths(parent: string, journal: HistoryRestoreJournal) {
  const prefix = `.${journal.projectRootName}.${journal.token}`
  return {
    projectRoot: join(parent, journal.projectRootName),
    materialized: join(parent, `${prefix}.git-restore`),
    candidate: join(parent, `${prefix}.candidate`),
    rollback: join(parent, `${prefix}.rollback`),
    failed: join(parent, `${prefix}.failed`),
    journal: join(parent, `.writellm-restore-${journal.projectId}.json`)
  }
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return false
      throw err
    }
  )
}

export async function recoverIncompleteHistoryRestore(
  selectedRoot: string,
  log: Pick<Logger, 'info' | 'error'>
): Promise<void> {
  const resolvedRoot = resolve(selectedRoot)
  const parent = dirname(resolvedRoot)
  const rootName = basename(resolvedRoot)
  let candidates: string[]
  try {
    candidates = (await readdir(parent)).filter(
      (name) => name.startsWith('.writellm-restore-') && name.endsWith('.json')
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  const matching: Array<{ journal: HistoryRestoreJournal; path: string }> = []
  for (const name of candidates) {
    const path = join(parent, name)
    try {
      const journal = historyRestoreJournalSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      if (journal.projectRootName === rootName) matching.push({ journal, path })
    } catch (err) {
      log.error(
        { event: 'project_history.restore_journal_invalid', err },
        'Invalid project history restore journal'
      )
    }
  }
  if (matching.length === 0) return
  if (matching.length > 1) throw new Error('Multiple project history restore journals were found')
  const record = matching[0]
  if (record === undefined) return
  const paths = historyRestorePaths(parent, record.journal)
  try {
    const rollbackExists = await pathExists(paths.rollback)
    if (record.journal.phase === 'committed') {
      if (!(await pathExists(paths.projectRoot))) {
        throw new Error('Committed history restore is missing the project root')
      }
      await rm(paths.rollback, { recursive: true, force: true })
    } else if (rollbackExists) {
      if (await pathExists(paths.projectRoot)) {
        await rename(paths.projectRoot, paths.failed)
        const failedHistory = resolveProjectPath(paths.failed, PROJECT_HISTORY_RELATIVE_PATH)
        const rollbackHistory = resolveProjectPath(paths.rollback, PROJECT_HISTORY_RELATIVE_PATH)
        const failedHistoryExists = await pathExists(failedHistory)
        const rollbackHistoryExists = await pathExists(rollbackHistory)
        if (failedHistoryExists && rollbackHistoryExists) {
          throw new Error('History restore recovery found two repository copies')
        }
        if (failedHistoryExists) {
          await rename(failedHistory, rollbackHistory)
        }
      }
      await rename(paths.rollback, paths.projectRoot)
      await rm(paths.failed, { recursive: true, force: true })
    } else if (!(await pathExists(paths.projectRoot))) {
      throw new Error('History restore journal cannot recover the missing project')
    }
    await rm(paths.candidate, { recursive: true, force: true })
    await rm(paths.materialized, { recursive: true, force: true })
    await rm(record.path, { force: true })
    log.info(
      {
        event: 'project_history.restore_journal_recovered',
        projectId: record.journal.projectId,
        phase: record.journal.phase
      },
      'Recovered an interrupted project history restore'
    )
  } catch (err) {
    log.error(
      {
        event: 'project_history.restore_journal_recovery_failed',
        err,
        projectId: record.journal.projectId,
        phase: record.journal.phase
      },
      'Interrupted project history restore recovery failed'
    )
    throw new Error('Failed to recover an interrupted project history restore', { cause: err })
  }
}

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
  finalEditorFlush(context: ProjectContext, purpose?: 'snapshot' | 'export'): Promise<void>
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
  inspectLock: typeof inspectProjectWriteLock
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
  inspectLock: inspectProjectWriteLock,
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
  staleLockTimeoutMs?: number
  lockOptions?: Omit<ProjectLockOptions, 'logger'>
  dependencies?: Partial<ProjectManagerDependencies>
  createRuntime?: (options: ProjectRuntimeOptions) => ProjectRuntime
  createManuscriptService?: (
    options: ConstructorParameters<typeof ManuscriptService>[0]
  ) => ManuscriptService
  createKnowledgeRuntime?: (options: {
    projectRoot: string
    filesystem: ProjectFilesystem
    projectId: string
    projectSessionId: string
    database: ProjectDatabase
    jobs: JobStore
    manuscript: ManuscriptService
    editorPersistence: EditorPersistenceService
    manuscriptAssets: ManuscriptAssetService
    log: Pick<Logger, 'info' | 'warn' | 'error'>
  }) => {
    mineruWorkflow: MineruWorkflowService
    knowledgeNormalization: KnowledgeNormalizationService
    knowledgeMapping?: KnowledgeMappingService
    projectIndex?: ProjectIndexService
    retrieval?: RetrievalService
    agentSessions?: AgentSessionService
    agentMutations?: MutationProposalService
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
  readonly #staleLockTimeoutMs: number
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
  #historyRestoreRecoverySuppressed = false
  #recovery:
    | {
        kind: 'open'
        selectedRoot: string
        reason: 'lock-contended' | 'open-failed'
      }
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
    this.#staleLockTimeoutMs = options.staleLockTimeoutMs ?? PROJECT_LOCK_STALE_AFTER_MS
    this.#lockOptions = options.lockOptions ?? {}
    this.#dependencies = { ...defaultDependencies, ...options.dependencies }
    this.#createRuntime =
      options.createRuntime ?? ((runtimeOptions) => new ProjectRuntime(runtimeOptions))
    this.#createManuscriptService =
      options.createManuscriptService ?? ((serviceOptions) => new ManuscriptService(serviceOptions))
    this.#createKnowledgeRuntime = options.createKnowledgeRuntime
  }

  snapshot(): ProjectLifecycleSnapshot {
    const recovery =
      this.#state === 'recovery-required' && this.#recovery !== null
        ? this.#recovery.kind === 'open'
          ? { kind: this.#recovery.kind, reason: this.#recovery.reason }
          : { kind: this.#recovery.kind }
        : undefined
    return projectLifecycleSnapshotSchema.parse({
      state: this.#state,
      activeProject: this.#context === null ? null : toActiveProject(this.#context),
      ...(recovery === undefined ? {} : { recovery })
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
        try {
          const context = this.#context
          if (context === null) throw new Error('Created project did not become active')
          await this.#withVersionSnapshot(
            context,
            (snapshotRoot, history) => history.enable(snapshotRoot),
            { skipEditorFlush: true }
          )
        } catch (err) {
          this.#logger.error(
            {
              event: 'project_manager.history_initialization_failed',
              err,
              projectId: created.manifest.projectId
            },
            'New project opened without version history'
          )
        }
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
      this.#recovery = { kind: 'open', selectedRoot, reason: 'open-failed' }
      this.#logger.info(
        { event: 'project_manager.open.started' },
        'Project open transition started'
      )
      try {
        if (!this.#historyRestoreRecoverySuppressed) {
          await recoverIncompleteHistoryRestore(selectedRoot, this.#logger)
        }
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(selectedRoot)
        await this.#openCanonicalRoot(canonicalRoot)
      } catch (err) {
        this.#logger.error(
          { event: 'project_manager.open.failed', err },
          'Project open transition failed'
        )
        this.#context = null
        this.#state = 'recovery-required'
        this.#recovery.reason =
          err instanceof ProjectLockContendedError ? 'lock-contended' : 'open-failed'
        throw new Error('Failed to open project', { cause: err })
      }
      return this.snapshot()
    })
  }

  async #openDuringHistoryRestore(selectedRoot: string): Promise<ProjectLifecycleSnapshot> {
    this.#historyRestoreRecoverySuppressed = true
    try {
      return await this.open(selectedRoot)
    } finally {
      this.#historyRestoreRecoverySuppressed = false
    }
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
      this.#recovery = { kind: 'open', selectedRoot, reason: 'open-failed' }
      this.#logger.info(
        { event: 'project_manager.open.started' },
        'Project open transition started'
      )
      try {
        await recoverIncompleteHistoryRestore(selectedRoot, this.#logger)
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(selectedRoot)
        await this.#openCanonicalRoot(canonicalRoot)
      } catch (err) {
        this.#logger.error(
          { event: 'project_manager.open.failed', err },
          'Project open transition failed'
        )
        this.#context = null
        this.#state = 'recovery-required'
        this.#recovery.reason =
          err instanceof ProjectLockContendedError ? 'lock-contended' : 'open-failed'
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
      const recovery = this.#recovery
      const selectedRoot = recovery.selectedRoot
      this.#state = 'opening'
      try {
        await recoverIncompleteHistoryRestore(selectedRoot, this.#logger)
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(selectedRoot)
        await this.#openCanonicalRoot(canonicalRoot)
        this.#recovery = null
        return this.snapshot()
      } catch (err) {
        this.#state = 'recovery-required'
        recovery.reason =
          err instanceof ProjectLockContendedError ? 'lock-contended' : 'open-failed'
        this.#logger.error(
          { event: 'project_manager.retry_open.failed', err },
          'Project open retry failed'
        )
        throw new Error('Failed to retry opening the project', { cause: err })
      }
    })
  }

  recoverStaleLockAndRetryOpen(): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      if (
        this.#state !== 'recovery-required' ||
        this.#recovery?.kind !== 'open' ||
        this.#recovery.reason !== 'lock-contended'
      ) {
        throw new Error('No contended project lock is available to recover')
      }
      const recovery = this.#recovery
      this.#state = 'opening'
      try {
        await recoverIncompleteHistoryRestore(recovery.selectedRoot, this.#logger)
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(recovery.selectedRoot)
        const metadata = await this.#dependencies.inspectLock(canonicalRoot, {
          ...this.#lockOptions,
          logger: this.#logger
        })
        if (metadata !== null) {
          await this.#dependencies.recoverStaleLock(canonicalRoot, {
            ...this.#lockOptions,
            logger: this.#logger,
            expectedOwnerToken: metadata.ownerToken,
            staleBefore: new Date(this.#dependencies.now().getTime() - this.#staleLockTimeoutMs)
          })
        }
        await this.#openCanonicalRoot(canonicalRoot)
        this.#recovery = null
        this.#logger.info(
          { event: 'project_manager.stale_lock_recovery_open.completed' },
          'Stale project lock recovery and open completed'
        )
        return this.snapshot()
      } catch (err) {
        this.#state = 'recovery-required'
        recovery.reason =
          err instanceof ProjectLockContendedError ? 'lock-contended' : recovery.reason
        this.#logger.error(
          { event: 'project_manager.stale_lock_recovery_open.failed', err },
          'Stale project lock recovery and open failed'
        )
        throw new Error('Failed to recover the stale project lock and open the project', {
          cause: err
        })
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
      const recovery: {
        kind: 'open'
        selectedRoot: string
        reason: 'lock-contended' | 'open-failed'
      } = { kind: 'open', selectedRoot, reason: 'open-failed' }
      this.#recovery = recovery
      try {
        await recoverIncompleteHistoryRestore(selectedRoot, this.#logger)
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(selectedRoot)
        await this.#openCanonicalRoot(canonicalRoot)
        this.#recovery = null
        return this.snapshot()
      } catch (err) {
        this.#state = 'recovery-required'
        recovery.reason =
          err instanceof ProjectLockContendedError ? 'lock-contended' : 'open-failed'
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
          includeVersionHistory: true,
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

  exportManuscript(
    projectSessionId: string,
    destination: string,
    kind: ManuscriptExportKind
  ): Promise<PublishedManuscriptExport> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      const operations = context.operations
      try {
        return await createManuscriptExport({
          projectRoot: context.projectRoot,
          projectId: context.manifest.projectId,
          sourceAppVersion: this.#applicationVersion,
          destination,
          kind,
          manuscript: context.manuscript,
          assets: context.manuscriptAssets,
          database: context.database,
          barrier: {
            pauseMutations: async () => operations?.pauseMutations(),
            finalEditorFlush: () => this.#snapshotParticipants.finalEditorFlush(context, 'export'),
            pauseFilePublishers: () => this.#snapshotParticipants.pauseFilePublishers(context),
            resumeFilePublishers: () => this.#snapshotParticipants.resumeFilePublishers(context),
            resumeMutations: async () => operations?.resumeMutations()
          },
          log: this.#logger
        })
      } catch (err) {
        this.#logger.error(
          {
            event: 'project_manager.manuscript_export.failed',
            err,
            projectId: context.manifest.projectId,
            exportKind: kind
          },
          'Project manuscript export failed'
        )
        throw new Error('Failed to export the project manuscript', { cause: err })
      }
    })
  }

  versionHistoryState(projectSessionId: string): Promise<'uninitialized' | 'ready' | 'damaged'> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      return this.#requireVersionHistory(context).inspect()
    })
  }

  enableVersionHistory(projectSessionId: string): Promise<CheckpointEntry> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      return this.#withVersionSnapshot(context, (snapshotRoot, history) =>
        history.enable(snapshotRoot)
      )
    })
  }

  reinitializeVersionHistory(projectSessionId: string): Promise<CheckpointEntry> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      return this.#withVersionSnapshot(context, (snapshotRoot, history) =>
        history.reinitialize(snapshotRoot)
      )
    })
  }

  createCheckpoint(
    projectSessionId: string,
    input: { name: string; note?: string }
  ): Promise<CheckpointEntry> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      return this.#withVersionSnapshot(context, (snapshotRoot, history) =>
        history.createCheckpoint(snapshotRoot, input)
      )
    })
  }

  listCheckpoints(
    projectSessionId: string,
    input: { cursor?: string; limit?: number }
  ): Promise<{ checkpoints: CheckpointEntry[]; nextCursor: string | null }> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      return this.#requireVersionHistory(context).list(input)
    })
  }

  compareCheckpointState(projectSessionId: string): Promise<{
    status: 'up-to-date' | 'uncheckpointed-changes'
    headOid: string
  }> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      return this.#withVersionSnapshot(context, (snapshotRoot, history) =>
        history.compareSnapshot(snapshotRoot)
      )
    })
  }

  async restoreCheckpoint(
    projectSessionId: string,
    oid: string
  ): Promise<{ snapshot: ProjectLifecycleSnapshot; checkpoint: CheckpointEntry }> {
    const prepared = await this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      const history = this.#requireVersionHistory(context)
      const target = (await history.list({ cursor: oid, limit: 1 })).checkpoints[0]
      if (target?.oid !== oid) throw new Error('Restore checkpoint is not reachable')
      const comparison = await this.#withVersionSnapshot(context, (snapshotRoot) =>
        history.compareSnapshot(snapshotRoot)
      )
      let parentOid = comparison.headOid
      if (comparison.status === 'uncheckpointed-changes') {
        const safety = await this.#withVersionSnapshot(context, (snapshotRoot) =>
          history.createCheckpoint(snapshotRoot, {
            name: `Before restoring ${target.name}`.slice(0, 100)
          })
        )
        parentOid = safety.oid
      }
      const parent = dirname(context.projectRoot)
      const token = this.#dependencies.randomUUID()
      const materialized = join(parent, `.${basename(context.projectRoot)}.${token}.git-restore`)
      const candidate = join(parent, `.${basename(context.projectRoot)}.${token}.candidate`)
      await history.materializeCheckpoint(target.oid, materialized)
      await restoreProjectSnapshot({
        snapshotRoot: materialized,
        destination: candidate,
        log: this.#logger
      })
      return {
        projectRoot: context.projectRoot,
        projectRootName: basename(context.projectRoot),
        projectId: context.manifest.projectId,
        token,
        target,
        parentOid,
        materialized,
        candidate,
        rollback: join(parent, `.${basename(context.projectRoot)}.${token}.rollback`),
        failed: join(parent, `.${basename(context.projectRoot)}.${token}.failed`),
        journal: join(parent, `.writellm-restore-${context.manifest.projectId}.json`)
      }
    })

    try {
      await this.close()
    } catch (err) {
      await rm(prepared.materialized, { recursive: true, force: true })
      await rm(prepared.candidate, { recursive: true, force: true })
      this.#logger.error(
        {
          event: 'project_manager.history_restore_close_failed',
          err,
          projectId: prepared.projectId
        },
        'Project checkpoint restore could not close the active project'
      )
      throw new Error('Failed to close the project before checkpoint restore', { cause: err })
    }
    const writeJournal = async (phase: HistoryRestoreJournal['phase']): Promise<void> => {
      await writeAtomicFile(
        prepared.journal,
        `${JSON.stringify({
          format: 'writellm-history-restore',
          formatVersion: 1,
          projectId: prepared.projectId,
          projectRootName: prepared.projectRootName,
          token: prepared.token,
          phase,
          targetOid: prepared.target.oid
        })}\n`
      )
    }
    await writeJournal('prepared')
    let swapped = false
    try {
      await rename(prepared.projectRoot, prepared.rollback)
      await writeJournal('original-moved')
      await rename(prepared.candidate, prepared.projectRoot)
      await writeJournal('candidate-installed')
      swapped = true
      await mkdir(resolveProjectPath(prepared.projectRoot, '.writellm'), {
        recursive: true,
        mode: 0o700
      })
      await rename(
        resolveProjectPath(prepared.rollback, PROJECT_HISTORY_RELATIVE_PATH),
        resolveProjectPath(prepared.projectRoot, PROJECT_HISTORY_RELATIVE_PATH)
      )
      await rename(
        resolveProjectPath(prepared.rollback, PROJECT_HISTORY_IGNORE_RELATIVE_PATH),
        resolveProjectPath(prepared.projectRoot, PROJECT_HISTORY_IGNORE_RELATIVE_PATH)
      )
      await writeJournal('history-moved')
      const opened = await this.#openDuringHistoryRestore(prepared.projectRoot)
      const activeSession = opened.activeProject?.projectSessionId
      if (activeSession === undefined) throw new Error('Restored project did not reopen')
      const checkpoint = await this.#serialize(async () => {
        const context = this.assertActiveSession(activeSession)
        return this.#requireVersionHistory(context).createRestoreCommit(
          prepared.target.oid,
          prepared.parentOid
        )
      })
      await writeJournal('committed')
      await rm(prepared.rollback, { recursive: true, force: true })
      await rm(prepared.materialized, { recursive: true, force: true })
      await rm(prepared.journal, { force: true })
      this.#logger.info(
        {
          event: 'project_manager.history_restore_completed',
          projectId: prepared.projectId,
          checkpointOid: prepared.target.oid,
          restoreCommitOid: checkpoint.oid
        },
        'Project checkpoint restore completed'
      )
      return { snapshot: this.snapshot(), checkpoint }
    } catch (err) {
      this.#logger.error(
        {
          event: 'project_manager.history_restore_failed',
          err,
          projectId: prepared.projectId,
          checkpointOid: prepared.target.oid
        },
        'Project checkpoint restore failed'
      )
      try {
        if (this.#state === 'open') await this.close()
        if (this.#state === 'recovery-required') await this.returnToClosed()
        if (swapped) {
          await rename(prepared.projectRoot, prepared.failed)
          const failedHistory = resolveProjectPath(prepared.failed, PROJECT_HISTORY_RELATIVE_PATH)
          try {
            await rename(
              failedHistory,
              resolveProjectPath(prepared.rollback, PROJECT_HISTORY_RELATIVE_PATH)
            )
          } catch (moveErr) {
            if ((moveErr as NodeJS.ErrnoException).code !== 'ENOENT') throw moveErr
          }
          await rename(prepared.rollback, prepared.projectRoot)
          await rm(prepared.failed, { recursive: true, force: true })
        }
        await this.#openDuringHistoryRestore(prepared.projectRoot)
        await rm(prepared.journal, { force: true })
      } catch (rollbackErr) {
        this.#logger.error(
          {
            event: 'project_manager.history_restore_rollback_failed',
            err: rollbackErr,
            projectId: prepared.projectId
          },
          'Project checkpoint restore rollback failed'
        )
      }
      await rm(prepared.materialized, { recursive: true, force: true })
      await rm(prepared.candidate, { recursive: true, force: true })
      throw new Error('Failed to restore the project checkpoint', { cause: err })
    }
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
    const startedAt = Date.now()
    const manifest = await this.#dependencies.readManifest(canonicalRoot)
    const filesystem = new ProjectFilesystem(canonicalRoot, this.#logger)
    let writeLock = acquiredLock
    let database: ProjectDatabase | undefined
    let runtime: ProjectRuntime | undefined
    try {
      // Reject a static malicious internal root or database before the write lock
      // creates anything below `.writellm`.
      await filesystem.assertExistingDirectory(WRITELLM_INTERNAL_DIRECTORY)
      await filesystem.assertExistingRegularFile(PROJECT_DATABASE_RELATIVE_PATH)
      writeLock ??= await this.#dependencies.acquireLock(canonicalRoot, {
        ...this.#lockOptions,
        logger: this.#logger
      })
      database = await this.#dependencies.openDatabase({
        projectRoot: canonicalRoot,
        filesystem,
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
      const manuscriptAssets = new ManuscriptAssetService({
        projectRoot: canonicalRoot,
        projectId: manifest.projectId,
        database,
        jobs,
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
        filesystem,
        projectId: manifest.projectId,
        projectSessionId,
        database,
        jobs,
        manuscript,
        editorPersistence,
        manuscriptAssets,
        log: this.#logger
      })
      const projectIndex = knowledgeRuntime?.projectIndex
      const knowledgeImports = new KnowledgeImportService({
        projectRoot: canonicalRoot,
        filesystem,
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
        filesystem,
        manifest,
        projectSessionId,
        operations,
        displayName: projectDisplayName(canonicalRoot),
        indexRebuildRequired: await isIndexRebuildRequired(canonicalRoot, this.#logger),
        database,
        jobs,
        manuscript,
        editorPersistence,
        manuscriptAssets,
        knowledgeImports,
        mineruWorkflow: knowledgeRuntime?.mineruWorkflow ?? null,
        knowledgeNormalization: knowledgeRuntime?.knowledgeNormalization ?? null,
        knowledgeMapping: knowledgeRuntime?.knowledgeMapping ?? null,
        projectIndex: projectIndex ?? null,
        retrieval: knowledgeRuntime?.retrieval ?? null,
        agentSessions: knowledgeRuntime?.agentSessions ?? null,
        agentMutations: knowledgeRuntime?.agentMutations ?? null,
        runtime,
        writeLock,
        versionHistory: new IsomorphicGitProjectVersionStore({
          projectRoot: canonicalRoot,
          projectId: manifest.projectId,
          applicationVersion: this.#applicationVersion,
          log: this.#logger
        })
      }
      runtime.start()
      this.#context = context
      this.#state = 'open'
      projectIndex?.startInitialization()
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
          projectSessionId: context.projectSessionId,
          durationMs: Date.now() - startedAt,
          indexReadiness: projectIndex?.readiness() ?? 'unavailable'
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

  #requireVersionHistory(context: ProjectContext): ProjectVersionStore {
    if (context.versionHistory === undefined) {
      throw new Error('Project version history service is unavailable')
    }
    return context.versionHistory
  }

  async #withVersionSnapshot<T>(
    context: ProjectContext,
    operation: (snapshotRoot: string, history: ProjectVersionStore) => Promise<T>,
    options: { skipEditorFlush?: boolean } = {}
  ): Promise<T> {
    const snapshotRoot = resolveProjectPath(
      context.projectRoot,
      `${PROJECT_TEMP_DIRECTORY}/checkpoint-${this.#dependencies.randomUUID()}`
    )
    const operations = context.operations
    const barrier = {
      pauseMutations: async () => operations?.pauseMutations(),
      finalEditorFlush: () =>
        options.skipEditorFlush
          ? Promise.resolve()
          : this.#snapshotParticipants.finalEditorFlush(context),
      pauseFilePublishers: () => this.#snapshotParticipants.pauseFilePublishers(context),
      resumeFilePublishers: () => this.#snapshotParticipants.resumeFilePublishers(context),
      resumeMutations: async () => operations?.resumeMutations()
    }
    try {
      await createProjectSnapshot({
        sourceRoot: context.projectRoot,
        manifest: context.manifest,
        sourceDatabase: context.database,
        destination: snapshotRoot,
        sourceAppVersion: this.#applicationVersion,
        inventoryFromBackup: () => inventoryProjectFiles(context.projectRoot),
        barrier,
        log: this.#logger
      })
      return await operation(snapshotRoot, this.#requireVersionHistory(context))
    } finally {
      await rm(snapshotRoot, { recursive: true, force: true }).catch((err) =>
        this.#logger.error(
          {
            event: 'project_manager.history_snapshot_cleanup_failed',
            err,
            projectId: context.manifest.projectId
          },
          'Failed to clean project history snapshot'
        )
      )
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
  const startedAt = Date.now()
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
    if (
      applicationId !== INDEX_DATABASE_APPLICATION_ID ||
      userVersion < 1 ||
      userVersion > INDEX_SCHEMA_VERSION
    ) {
      return true
    }
    const active = database
      .prepare("SELECT count(*) FROM index_generations WHERE state = 'active'")
      .pluck()
      .get() as number
    log.info(
      {
        event: 'project.index.header_check_completed',
        applicationId,
        schemaVersion: userVersion,
        activeGenerationCount: active,
        durationMs: Date.now() - startedAt
      },
      'Project index header check completed'
    )
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
