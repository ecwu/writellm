import { randomUUID } from 'node:crypto'
import { realpath, rename, rm } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { Logger } from 'pino'
import {
  projectLifecycleSnapshotSchema,
  projectNameSchema,
  type CheckpointEntry,
  type ProjectLifecycleSnapshot,
  type ProjectLifecycleState,
  type ProjectOpenRecoveryReason,
  type ProjectSessionId
} from '../../shared/contracts/projects'
import type { RecentProjectsRepository } from '../app-db/repositories/recent-projects'
import { canTransition, type StateTransitions } from '../db/state-transitions'
import { JobStore } from '../jobs/job-store'
import { KnowledgeImportService } from '../knowledge/knowledge-import-service'
import { ReferenceLibraryService } from '../references/reference-library-service'
import type { MineruWorkflowService } from '../knowledge/mineru-workflow-service'
import type { KnowledgeNormalizationService } from '../knowledge/knowledge-normalization-service'
import type { KnowledgeMappingService } from '../knowledge/knowledge-mapping-service'
import type { NotebookRegistry } from '../knowledge/notebook-registry'
import { ManuscriptService } from '../manuscript/manuscript-service'
import { EditorPersistenceService } from '../manuscript/editor-persistence-service'
import {
  type createProjectHandlerRegistry,
  ProjectRuntime,
  type ProjectRuntimeOptions
} from '../jobs/scheduler/project-runtime'
import { type ProjectContext, toActiveProject } from './project-context'
import {
  createProject,
  type CreateProjectOptions,
  type CreatedProject,
  ProjectCreateError
} from './project-lifecycle'
import { openProjectDatabase, type ProjectDatabase } from './project-database'
import { ProjectManifestError, readProjectManifest, type ProjectManifest } from './project-manifest'
import {
  createManifestRecoveryCopy,
  rebuildMissingProjectManifest
} from './project-manifest-recovery'
import {
  inspectProjectWriteLock,
  PROJECT_LOCK_STALE_AFTER_MS,
  ProjectLockContendedError,
  ProjectWriteLock,
  recoverStaleProjectWriteLock,
  type ProjectLockOptions
} from './project-lock'
import {
  MANUSCRIPT_IMPORT_STAGING_DIRECTORY,
  PROJECT_DATABASE_RELATIVE_PATH,
  PROJECT_TEMP_DIRECTORY,
  PROJECT_HISTORY_IGNORE_RELATIVE_PATH,
  PROJECT_HISTORY_RELATIVE_PATH,
  resolveProjectPath
} from './project-paths'
import {
  createProjectSnapshot,
  inventoryProjectFiles,
  restoreProjectDatabase,
  restoreProjectSnapshot,
  type ProjectSnapshotManifest,
  type SnapshotBarrier
} from './project-snapshot'
import type { ProjectIndexService } from '../search/index-service'
import type { RetrievalService } from '../search/retrieval-service'
import { ProjectOperationRegistry } from './project-operations'
import type { AgentSessionService } from '../agent/session-service'
import type { MutationProposalService } from '../agent/mutation-service'
import type { WritingTaskService } from '../agent/writing-task-service'
import type { ChangeSetBatchService } from '../agent/change-set-batch-service'
import { ManuscriptAssetService } from '../manuscript/asset-service'
import {
  createManuscriptExport,
  type PublishedManuscriptExport
} from '../manuscript/manuscript-export'
import type { ManuscriptExportKind } from '../../shared/contracts/manuscript-export'
import type { PublicationOptions } from '../../shared/contracts/publication'
import { IsomorphicGitProjectVersionStore, type ProjectVersionStore } from './project-version-store'
import { writeAtomicFile } from '../storage/atomic-file'
import { ProjectFilesystem } from './project-filesystem'
import type { PdfPublicationRenderer } from '../manuscript/pdf-publication'
import { createProjectClone } from './project-clone'
import type {
  ProjectTemplate,
  ProjectTemplateExtractionPreview
} from '../../shared/contracts/project-templates'
import {
  applyProjectTemplate,
  extractProjectTemplate,
  previewProjectTemplateExtraction
} from './project-template-service'
import {
  historyRestorePaths,
  recoverIncompleteHistoryRestore,
  type HistoryRestoreJournal
} from './history-restore-recovery'

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

type CloseResource = 'claims' | 'park' | 'workers' | 'database' | 'lock' | 'subscriptions'

type CloseStep = {
  resource: CloseResource
  failureEvent: string
  run: () => void | Promise<void>
}

type PartialOpenResources = {
  projectId?: string
  database?: ProjectDatabase
  writeLock: ProjectWriteLock
}

type CloseRecovery = {
  kind: 'close'
  projectId?: string
  writeLock: ProjectWriteLock
  steps: CloseStep[]
  completed: Set<CloseResource>
}

type OpenRecovery = {
  kind: 'open'
  selectedRoot: string
  reason: ProjectOpenRecoveryReason
}

class ProjectOpenIssue extends Error {
  constructor(
    readonly reason: ProjectOpenRecoveryReason,
    message: string,
    cause: unknown
  ) {
    super(message, { cause })
  }
}

function openRecoveryReason(error: unknown): ProjectOpenRecoveryReason {
  if (error instanceof ProjectLockContendedError) return 'lock-contended'
  if (error instanceof ProjectOpenIssue || error instanceof ProjectManifestError)
    return error.reason
  return 'open-failed'
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
  renderPdfPublication?: PdfPublicationRenderer
  finalFlushTimeoutMs?: number
  staleLockTimeoutMs?: number
  lockOptions?: Omit<ProjectLockOptions, 'logger'>
  dependencies?: Partial<ProjectManagerDependencies>
  createRuntime?: (options: ProjectRuntimeOptions) => ProjectRuntime
  createManuscriptService?: (
    options: ConstructorParameters<typeof ManuscriptService>[0]
  ) => ManuscriptService
  createKnowledgeRuntime: (options: {
    projectRoot: string
    filesystem: ProjectFilesystem
    projectId: string
    projectSessionId: string
    database: ProjectDatabase
    jobs: JobStore
    manuscript: ManuscriptService
    editorPersistence: EditorPersistenceService
    manuscriptAssets: ManuscriptAssetService
    knowledgeImports: KnowledgeImportService
    references: ReferenceLibraryService
    log: Pick<Logger, 'info' | 'warn' | 'error'>
  }) => {
    mineruWorkflow: MineruWorkflowService
    knowledgeNormalization: KnowledgeNormalizationService
    knowledgeMapping: KnowledgeMappingService
    projectIndex: ProjectIndexService
    retrieval: RetrievalService
    knowledgeChat: NotebookRegistry
    agentSessions: AgentSessionService
    agentMutations: MutationProposalService
    agentChangeSets: ChangeSetBatchService
    writingTasks: WritingTaskService
    registry: ReturnType<typeof createProjectHandlerRegistry>
    terminateWorkers: () => void | Promise<void>
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

/**
 * Legal lifecycle transitions. `#setState` rejects anything else. Every failure path
 * reaches `recovery-required`, and only explicit recovery actions leave it.
 */
const PROJECT_LIFECYCLE_TRANSITIONS: StateTransitions<ProjectLifecycleState> = {
  // closed -> closed and closed -> recovery-required come from explicit stale-lock recovery.
  closed: ['creating', 'opening', 'closed', 'recovery-required'],
  creating: ['opening', 'closed', 'recovery-required'],
  opening: ['open', 'recovery-required'],
  // open -> recovery-required covers a failure after the context became active during open.
  open: ['closing', 'recovery-required'],
  closing: ['closed', 'recovery-required'],
  'recovery-required': ['opening', 'closed', 'recovery-required']
}

export class ProjectManager {
  readonly #applicationVersion: string
  readonly #logger: ProjectManagerOptions['logger']
  readonly #recentProjects: ProjectManagerOptions['recentProjects']
  readonly #forbiddenApplicationDirectories: readonly string[]
  readonly #closeParticipants: ProjectCloseParticipants
  readonly #snapshotParticipants: ProjectSnapshotParticipants
  readonly #exportDiagnostics?: () => Promise<{ exported: boolean }>
  readonly #renderPdfPublication?: PdfPublicationRenderer
  readonly #lockOptions: Omit<ProjectLockOptions, 'logger'>
  readonly #dependencies: ProjectManagerDependencies
  readonly #finalFlushTimeoutMs: number
  readonly #staleLockTimeoutMs: number
  readonly #createRuntime: (options: ProjectRuntimeOptions) => ProjectRuntime
  readonly #createManuscriptService: (
    options: ConstructorParameters<typeof ManuscriptService>[0]
  ) => ManuscriptService
  readonly #createKnowledgeRuntime: ProjectManagerOptions['createKnowledgeRuntime']
  #state: ProjectLifecycleState = 'closed'
  #context: ProjectContext | null = null
  #transition: Promise<void> = Promise.resolve()
  #finalFlushAuthorization: ProjectFinalFlushAuthorization | null = null
  #finalFlushConsumed = false
  #snapshotFlushAuthorization: ProjectFinalFlushAuthorization | null = null
  #snapshotFlushConsumed = false
  #activeManuscriptExport: { projectSessionId: string; controller: AbortController } | null = null
  #activeClone: { projectSessionId: string; controller: AbortController } | null = null
  #restoringCheckpoint = false
  #recovery: OpenRecovery | { kind: 'create'; projectRoot: string } | CloseRecovery | null = null

  constructor(options: ProjectManagerOptions) {
    if (typeof options.createKnowledgeRuntime !== 'function') {
      throw new TypeError('Project manager requires a complete feature runtime factory')
    }
    this.#applicationVersion = options.applicationVersion
    this.#logger = options.logger
    this.#recentProjects = options.recentProjects
    this.#forbiddenApplicationDirectories = options.forbiddenApplicationDirectories ?? []
    this.#closeParticipants = { ...noOpCloseParticipants, ...options.closeParticipants }
    this.#snapshotParticipants = { ...noOpSnapshotParticipants, ...options.snapshotParticipants }
    this.#exportDiagnostics = options.exportDiagnostics
    this.#renderPdfPublication = options.renderPdfPublication
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
      this.#setState('creating')
      this.#recovery = { kind: 'create', projectRoot }
      this.#logger.info(
        { event: 'project_manager.create.started' },
        'Project create transition started'
      )
      let projectPublished = false
      let unopened: PartialOpenResources | undefined
      try {
        const created = await this.#dependencies.createProject({
          destination: projectRoot,
          forbiddenApplicationDirectories: this.#forbiddenApplicationDirectories,
          applicationVersion: this.#applicationVersion,
          log: this.#logger as Logger,
          initialTitle: name,
          lockOptions: this.#lockOptions
        })
        unopened = { projectId: created.manifest.projectId, writeLock: created.writeLock }
        projectPublished = true
        this.#setState('opening')
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(created.projectRoot)
        if (canonicalRoot !== created.projectRoot) {
          throw new Error('Created project root identity changed before open')
        }
        unopened = undefined
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
        if (unopened !== undefined) await this.#cleanupFailedOpen(unopened)
        this.#logger.error(
          { event: 'project_manager.create.failed', err },
          'Project create transition failed'
        )
        this.#context = null
        const failedState =
          !projectPublished && err instanceof ProjectCreateError && err.disposition === 'clean'
            ? 'closed'
            : 'recovery-required'
        this.#setState(failedState)
        if (failedState === 'closed') this.#recovery = null
        else if (projectPublished && this.#recovery?.kind === 'create') {
          this.#recovery = { kind: 'open', selectedRoot: projectRoot, reason: 'open-failed' }
        }
        throw new Error('Failed to create and open project', { cause: err })
      }
      return this.snapshot()
    })
  }

  open(selectedRoot: string): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(() => this.#openClosedProject(selectedRoot))
  }

  async #openClosedProject(
    selectedRoot: string,
    restoreLock?: ProjectWriteLock
  ): Promise<ProjectLifecycleSnapshot> {
    this.#requireState('closed')
    this.#setState('opening')
    const recovery: OpenRecovery = { kind: 'open', selectedRoot, reason: 'open-failed' }
    this.#recovery = recovery
    this.#logger.info({ event: 'project_manager.open.started' }, 'Project open transition started')
    try {
      const canonicalRoot = restoreLock?.projectRoot ?? (await this.#resolveOpenRoot(selectedRoot))
      await this.#openCanonicalRoot(canonicalRoot, restoreLock, restoreLock !== undefined)
      this.#recovery = null
    } catch (err) {
      this.#logger.error(
        { event: 'project_manager.open.failed', err },
        'Project open transition failed'
      )
      this.#context = null
      this.#setState('recovery-required')
      recovery.reason = openRecoveryReason(err)
      throw new Error('Failed to open project', { cause: err })
    }
    return this.snapshot()
  }

  async #resolveOpenRoot(selectedRoot: string): Promise<string> {
    const canonicalRoot = await this.#dependencies.canonicalizeRoot(selectedRoot).catch((err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    })
    await recoverIncompleteHistoryRestore(
      canonicalRoot ?? selectedRoot,
      this.#logger,
      this.#lockOptions
    )
    return (
      canonicalRoot ??
      this.#dependencies.canonicalizeRoot(selectedRoot).catch((err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new ProjectOpenIssue('folder-missing', 'Project folder does not exist', err)
        }
        throw err
      })
    )
  }

  close(): Promise<ProjectLifecycleSnapshot> {
    if (this.#restoringCheckpoint) {
      return Promise.reject(new Error('Cannot close a project during checkpoint restore'))
    }
    if (this.#state !== 'open' || this.#context === null) {
      return Promise.reject(new Error(`Cannot close project while state is ${this.#state}`))
    }
    const context = this.#context
    this.#beginClose()
    return this.#serialize(() => this.#finishClose(context))
  }

  #beginClose(): void {
    // Enter closing before queueing so session checks reject new work at once; queued
    // operations then fail their session assertion instead of running against a closing project.
    this.#setState('closing')
    this.#snapshotFlushAuthorization = null
    this.#snapshotFlushConsumed = false
  }

  async #finishClose(
    context: ProjectContext,
    retainWriteLock = false
  ): Promise<ProjectLifecycleSnapshot> {
    const startedAt = Date.now()
    this.#logger.info(
      { event: 'project_manager.close.started', projectId: context.manifest.projectId },
      'Project close transition started'
    )
    let firstError: unknown
    const recovery = this.#createCloseRecovery(context)
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
    const resourceFailure = await this.#closeResources(recovery, retainWriteLock)
    if (resourceFailure !== undefined) {
      firstError ??= resourceFailure.err ?? new Error('Project close resource failed')
    }

    this.#context = null
    this.#recovery = recovery
    if (firstError !== undefined) {
      this.#setState('recovery-required')
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

    this.#setState('closed')
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
  }

  switch(selectedRoot: string): Promise<ProjectLifecycleSnapshot> {
    if (this.#restoringCheckpoint) {
      return Promise.reject(new Error('Cannot switch projects during checkpoint restore'))
    }
    const closing = this.close()
    return this.#serialize(async () => {
      await closing
      return this.#openClosedProject(selectedRoot)
    })
  }

  isSessionActive(projectSessionId: string): boolean {
    return (
      this.#state === 'open' &&
      this.#context !== null &&
      this.#context.projectSessionId === projectSessionId
    )
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

  activeReferenceLibrary(projectId: string): ReferenceLibraryService | null {
    if (
      this.#state !== 'open' ||
      this.#context === null ||
      this.#context.manifest.projectId !== projectId
    ) {
      return null
    }
    return this.#context.references
  }

  activeKnowledgeImports(projectId: string): KnowledgeImportService | null {
    if (
      this.#state !== 'open' ||
      this.#context === null ||
      this.#context.manifest.projectId !== projectId
    ) {
      return null
    }
    return this.#context.knowledgeImports
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
      this.#assertNoPendingClose()
      try {
        const canonicalRoot = await this.#dependencies.canonicalizeRoot(options.selectedRoot)
        const recovered = await this.#dependencies.recoverStaleLock(canonicalRoot, {
          ...this.#lockOptions,
          logger: this.#logger,
          expectedOwnerToken: options.observedOwnerToken,
          staleBefore: options.staleBefore
        })
        this.#setState('closed')
        return recovered
      } catch (err) {
        this.#logger.error(
          { event: 'project_manager.stale_lock_recovery.failed', err },
          'Explicit stale lock recovery failed'
        )
        this.#setState('recovery-required')
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
      this.#setState('opening')
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
          await this.#cleanupFailedOpen({ projectId, writeLock })
        }
        this.#context = null
        this.#setState('recovery-required')
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
      return this.#retryOpen(this.#recovery)
    })
  }

  async #retryOpen(
    recovery: OpenRecovery,
    lock?: ProjectWriteLock
  ): Promise<ProjectLifecycleSnapshot> {
    this.#setState('opening')
    try {
      const canonicalRoot =
        lock?.projectRoot ?? (await this.#resolveOpenRoot(recovery.selectedRoot))
      await this.#openCanonicalRoot(canonicalRoot, lock)
      this.#recovery = null
      return this.snapshot()
    } catch (err) {
      this.#logger.error(
        { event: 'project_manager.retry_open.failed', err },
        'Project open retry failed'
      )
      this.#setState('recovery-required')
      recovery.reason = openRecoveryReason(err)
      throw new Error('Failed to retry opening the project', { cause: err })
    }
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
      this.#setState('opening')
      try {
        const canonicalRoot = await this.#resolveOpenRoot(recovery.selectedRoot).then(
          async (root) => {
            await this.#recoverObservedLock(root)
            return root
          },
          async (err: unknown) => {
            if (!(err instanceof ProjectLockContendedError) || err.projectRoot === undefined) {
              throw err
            }
            await this.#recoverObservedLock(err.projectRoot)
            return this.#resolveOpenRoot(recovery.selectedRoot)
          }
        )
        await this.#openCanonicalRoot(canonicalRoot)
        this.#recovery = null
        this.#logger.info(
          { event: 'project_manager.stale_lock_recovery_open.completed' },
          'Stale project lock recovery and open completed'
        )
        return this.snapshot()
      } catch (err) {
        this.#setState('recovery-required')
        const reason = openRecoveryReason(err)
        if (reason !== 'open-failed') recovery.reason = reason
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

  async #recoverObservedLock(projectRoot: string): Promise<void> {
    const options = { ...this.#lockOptions, logger: this.#logger }
    const metadata = await this.#dependencies.inspectLock(projectRoot, options)
    if (metadata === null) return
    await this.#dependencies.recoverStaleLock(projectRoot, {
      ...options,
      expectedOwnerToken: metadata.ownerToken,
      staleBefore: new Date(this.#dependencies.now().getTime() - this.#staleLockTimeoutMs)
    })
  }

  #createCloseRecovery(resources: ProjectContext | PartialOpenResources): CloseRecovery {
    const steps: CloseStep[] = []
    if ('projectSessionId' in resources) {
      const context = resources
      steps.push(
        {
          resource: 'claims',
          failureEvent: 'project_manager.close.stop_claims_failed',
          run: async () => {
            try {
              context.runtime.stopClaims()
              await this.#closeParticipants.stopJobClaims(context)
            } finally {
              context.operations?.abortAll(new Error('Project is closing'))
            }
          }
        },
        {
          resource: 'park',
          failureEvent: 'project_manager.close.park_workers_failed',
          run: async () => {
            await context.runtime.park()
            await this.#closeParticipants.parkWorkers(context)
          }
        },
        {
          resource: 'workers',
          failureEvent: 'project_manager.close.stop_workers_failed',
          run: async () => {
            await context.runtime.stop()
            await this.#closeParticipants.stopWorkersAndIndex(context)
          }
        }
      )
    }
    const { database, writeLock } = resources
    if (database !== undefined) {
      steps.push({
        resource: 'database',
        failureEvent: 'project_manager.close.database_failed',
        run: () => database.close()
      })
    }
    steps.push({
      resource: 'lock',
      failureEvent: 'project_manager.close.lock_release_failed',
      run: async () => {
        await writeLock.release()
      }
    })
    if ('projectSessionId' in resources) {
      steps.push({
        resource: 'subscriptions',
        failureEvent: 'project_manager.close.subscription_revoke_failed',
        run: () => this.#closeParticipants.revokeSubscriptions(resources.projectSessionId)
      })
    }
    return {
      kind: 'close',
      projectId: 'manifest' in resources ? resources.manifest.projectId : resources.projectId,
      writeLock,
      steps,
      completed: new Set()
    }
  }

  async #closeResources(
    recovery: CloseRecovery,
    retainWriteLock = false
  ): Promise<{ err: unknown } | undefined> {
    let failure: { err: unknown } | undefined
    for (const step of recovery.steps) {
      if (recovery.completed.has(step.resource)) continue
      if (retainWriteLock && step.resource === 'lock') continue
      // Session revocation does not depend on releasing the project resources.
      if (failure !== undefined && step.resource !== 'subscriptions') continue
      try {
        await step.run()
        recovery.completed.add(step.resource)
      } catch (err) {
        failure ??= { err }
        this.#logger.error(
          { event: step.failureEvent, err, projectId: recovery.projectId },
          'Project close step failed'
        )
      }
    }
    return failure
  }

  async #cleanupFailedOpen(
    resources: ProjectContext | PartialOpenResources,
    retainWriteLock = false
  ): Promise<void> {
    const openRecovery = this.#recovery
    const closeRecovery = this.#createCloseRecovery(resources)
    this.#context = null
    this.#recovery = closeRecovery
    this.#setState('recovery-required')
    if ((await this.#closeResources(closeRecovery, retainWriteLock)) === undefined) {
      this.#recovery = openRecovery
    }
  }

  retryClose(): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      if (this.#state !== 'recovery-required' || this.#recovery?.kind !== 'close') {
        throw new Error('No failed project close is available to retry')
      }
      const recovery = this.#recovery
      try {
        const failure = await this.#closeResources(recovery)
        if (failure !== undefined) throw failure.err
        this.#recovery = null
        this.#setState('closed')
        this.#logger.info(
          {
            event: 'project_manager.retry_close.completed',
            projectId: recovery.projectId
          },
          'Project close retry completed'
        )
        return this.snapshot()
      } catch (err) {
        this.#setState('recovery-required')
        this.#logger.error(
          {
            event: 'project_manager.retry_close.failed',
            err,
            projectId: recovery.projectId
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
        this.#setState('closed')
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
      this.#setState('opening')
      const recovery: OpenRecovery = { kind: 'open', selectedRoot, reason: 'open-failed' }
      this.#recovery = recovery
      try {
        const canonicalRoot = await this.#resolveOpenRoot(selectedRoot)
        await this.#openCanonicalRoot(canonicalRoot)
        this.#recovery = null
        return this.snapshot()
      } catch (err) {
        this.#setState('recovery-required')
        recovery.reason = openRecoveryReason(err)
        this.#logger.error(
          { event: 'project_manager.locate_moved.failed', err },
          'Moved project location recovery failed'
        )
        throw new Error('Failed to open the located project', { cause: err })
      }
    })
  }

  recoverMissingManifest(
    selectDestinationParent?: () => Promise<string | null>
  ): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      const recovery = this.#recovery
      if (
        this.#state !== 'recovery-required' ||
        recovery?.kind !== 'open' ||
        recovery.reason !== 'manifest-missing'
      ) {
        throw new Error('No missing project manifest is available to recover')
      }
      const destinationParent = await selectDestinationParent?.()
      if (destinationParent === null) return this.snapshot()
      const sourceRoot = await this.#dependencies.canonicalizeRoot(recovery.selectedRoot)
      const filesystem = new ProjectFilesystem(sourceRoot, this.#logger)
      await filesystem.assertExistingRegularFile(PROJECT_DATABASE_RELATIVE_PATH)
      let lock: ProjectWriteLock | undefined
      let destination: string | undefined
      try {
        lock = await this.#dependencies.acquireLock(sourceRoot, {
          ...this.#lockOptions,
          logger: this.#logger
        })
        if (destinationParent === undefined) {
          await rebuildMissingProjectManifest(filesystem, this.#logger)
        } else {
          destination = await createManifestRecoveryCopy({
            sourceRoot,
            destinationParent,
            log: this.#logger
          })
        }
      } catch (err) {
        this.#logger.error(
          { event: 'project_manager.rebuild_manifest.failed', err },
          'Missing manifest recovery failed'
        )
        if (err instanceof ProjectLockContendedError) recovery.reason = 'lock-contended'
        if (lock !== undefined) await this.#cleanupFailedOpen({ writeLock: lock })
        throw err
      }
      if (destination === undefined) return this.#retryOpen(recovery, lock)
      await lock.release()
      this.#recovery = null
      this.#setState('closed')
      return this.#openClosedProject(destination)
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
      this.#setState('closed')
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
      try {
        return await createProjectSnapshot({
          sourceRoot: context.projectRoot,
          manifest: context.manifest,
          sourceDatabase: context.database,
          destination,
          sourceAppVersion: this.#applicationVersion,
          inventoryFromBackup: () => inventoryProjectFiles(context.projectRoot),
          barrier: this.#snapshotBarrier(context),
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
    kind: ManuscriptExportKind,
    publicationOptions?: PublicationOptions
  ): Promise<PublishedManuscriptExport> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      const controller = new AbortController()
      this.#activeManuscriptExport = { projectSessionId, controller }
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
          barrier: this.#snapshotBarrier(context, { purpose: 'export' }),
          log: this.#logger,
          renderPdf: this.#renderPdfPublication,
          publicationOptions,
          signal: controller.signal
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
      } finally {
        if (this.#activeManuscriptExport?.controller === controller) {
          this.#activeManuscriptExport = null
        }
      }
    })
  }

  cancelManuscriptExport(projectSessionId: string): { cancelled: boolean } {
    this.assertActiveSession(projectSessionId)
    const active = this.#activeManuscriptExport
    if (active === null || active.projectSessionId !== projectSessionId) return { cancelled: false }
    active.controller.abort()
    return { cancelled: true }
  }

  async cloneProject(
    projectSessionId: string,
    destination: string
  ): Promise<ProjectLifecycleSnapshot> {
    const cloned = await this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      const controller = new AbortController()
      this.#activeClone = { projectSessionId, controller }
      try {
        return await createProjectClone({
          sourceRoot: context.projectRoot,
          sourceManifest: context.manifest,
          sourceDatabase: context.database,
          destination,
          sourceAppVersion: this.#applicationVersion,
          barrier: this.#snapshotBarrier(context, { purpose: 'snapshot' }),
          signal: controller.signal,
          createId: this.#dependencies.randomUUID,
          now: this.#dependencies.now,
          log: this.#logger
        })
      } finally {
        if (this.#activeClone?.controller === controller) this.#activeClone = null
      }
    })
    try {
      return await this.switch(cloned.projectRoot)
    } catch (err) {
      this.#logger.error(
        {
          event: 'project_manager.clone_switch_failed',
          err,
          projectId: cloned.projectId
        },
        'Project clone succeeded but switching to the clone failed'
      )
      throw err
    }
  }

  cancelProjectClone(projectSessionId: string): { cancelled: boolean } {
    this.assertActiveSession(projectSessionId)
    const active = this.#activeClone
    if (active === null || active.projectSessionId !== projectSessionId) {
      return { cancelled: false }
    }
    active.controller.abort(new Error('Project clone was cancelled'))
    return { cancelled: true }
  }

  applyTemplate(
    projectSessionId: string,
    template: ProjectTemplate
  ): Promise<ProjectLifecycleSnapshot> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      applyProjectTemplate({
        manuscript: context.manuscript,
        template,
        createId: this.#dependencies.randomUUID,
        log: this.#logger
      })
      await context.editorPersistence.repairAll()
      if (context.versionHistory !== undefined) {
        await this.#withVersionSnapshot(
          context,
          (snapshotRoot, history) => history.reinitialize(snapshotRoot),
          { skipEditorFlush: true }
        )
      }
      this.#logger.info(
        {
          event: 'project_manager.template_applied',
          projectId: context.manifest.projectId,
          templateId: template.templateId
        },
        'Project template applied through normal project authority'
      )
      return this.snapshot()
    })
  }

  previewTemplateExtraction(
    projectSessionId: string,
    publicationPresetId: string | null
  ): Promise<ProjectTemplateExtractionPreview> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      context.operations?.pauseMutations()
      try {
        await this.#snapshotParticipants.finalEditorFlush(context, 'snapshot')
        return previewProjectTemplateExtraction({
          manuscript: context.manuscript,
          publicationPresetId
        })
      } finally {
        context.operations?.resumeMutations()
      }
    })
  }

  extractTemplate(
    projectSessionId: string,
    input: {
      templateId: string
      name: string
      description: string
      publicationPresetId: string | null
    }
  ): Promise<ProjectTemplate> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      context.operations?.pauseMutations()
      try {
        await this.#snapshotParticipants.finalEditorFlush(context, 'snapshot')
        return extractProjectTemplate({
          manuscript: context.manuscript,
          ...input,
          log: this.#logger
        })
      } finally {
        context.operations?.resumeMutations()
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

  restoreCheckpoint(
    projectSessionId: string,
    oid: string
  ): Promise<{ snapshot: ProjectLifecycleSnapshot; checkpoint: CheckpointEntry }> {
    return this.#serialize(async () => {
      const context = this.assertActiveSession(projectSessionId)
      this.#restoringCheckpoint = true
      try {
        return await this.#restoreCheckpoint(context, oid)
      } finally {
        this.#restoringCheckpoint = false
      }
    })
  }

  async #restoreCheckpoint(
    context: ProjectContext,
    oid: string
  ): Promise<{ snapshot: ProjectLifecycleSnapshot; checkpoint: CheckpointEntry }> {
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
    const identity = {
      projectRootName: basename(context.projectRoot),
      projectId: context.manifest.projectId,
      token: this.#dependencies.randomUUID()
    }
    const paths = historyRestorePaths(dirname(context.projectRoot), identity)
    await history.materializeCheckpoint(target.oid, paths.materialized)
    await restoreProjectSnapshot({
      snapshotRoot: paths.materialized,
      destination: paths.candidate,
      log: this.#logger
    })
    const originalLock = context.writeLock
    const heldLocks = [originalLock]
    const writeJournal = async (phase: HistoryRestoreJournal['phase']): Promise<void> => {
      await writeAtomicFile(
        paths.journal,
        `${JSON.stringify({
          format: 'writellm-history-restore',
          formatVersion: 1,
          projectId: identity.projectId,
          projectRootName: identity.projectRootName,
          token: identity.token,
          phase,
          targetOid: target.oid
        })}\n`
      )
    }
    const reopen = async (): Promise<void> => {
      const lock = heldLocks.find((candidate) => candidate.projectRoot === paths.projectRoot)
      if (lock === undefined) throw new Error('Checkpoint restore lost the project lock')
      await this.#openClosedProject(paths.projectRoot, lock)
    }
    try {
      let candidateLock: ProjectWriteLock | undefined
      try {
        candidateLock = await this.#dependencies.acquireLock(paths.candidate, {
          ...this.#lockOptions,
          logger: this.#logger
        })
        heldLocks.push(candidateLock)
        this.#beginClose()
        await this.#finishClose(context, true)
      } catch (err) {
        this.#logger.error(
          {
            event: 'project_manager.history_restore_close_failed',
            err,
            projectId: identity.projectId
          },
          'Project checkpoint restore could not prepare the locked swap'
        )
        await candidateLock?.release()
        await rm(paths.materialized, { recursive: true, force: true })
        if (candidateLock !== undefined) await rm(paths.candidate, { recursive: true, force: true })
        throw new Error('Failed to prepare the project checkpoint swap', { cause: err })
      }
      let checkpoint: CheckpointEntry
      try {
        await writeJournal('prepared')
        await originalLock.moveProjectRoot(paths.rollback)
        await writeJournal('original-moved')
        await candidateLock.moveProjectRoot(paths.projectRoot)
        await writeJournal('candidate-installed')
        for (const entry of [PROJECT_HISTORY_RELATIVE_PATH, PROJECT_HISTORY_IGNORE_RELATIVE_PATH]) {
          await rename(
            resolveProjectPath(paths.rollback, entry),
            resolveProjectPath(paths.projectRoot, entry)
          )
        }
        await writeJournal('history-moved')
        await reopen()
        if (this.#context === null) throw new Error('Restored project did not reopen')
        checkpoint = await this.#requireVersionHistory(this.#context).createRestoreCommit(
          target.oid,
          parentOid
        )
        await writeJournal('committed')
      } catch (err) {
        this.#logger.error(
          {
            event: 'project_manager.history_restore_failed',
            err,
            projectId: identity.projectId,
            checkpointOid: target.oid
          },
          'Project checkpoint restore failed'
        )
        try {
          if (this.#context !== null) {
            const active = this.#context
            this.#beginClose()
            await this.#finishClose(active, true)
          }
          if (this.#state === 'recovery-required') {
            this.#assertNoPendingClose()
            this.#recovery = null
            this.#setState('closed')
          }
          if (
            !(await recoverIncompleteHistoryRestore(
              paths.projectRoot,
              this.#logger,
              this.#lockOptions,
              heldLocks
            ))
          ) {
            await candidateLock.release()
            await rm(paths.candidate, { recursive: true, force: true })
            await rm(paths.materialized, { recursive: true, force: true })
          }
          await reopen()
        } catch (rollbackErr) {
          this.#logger.error(
            {
              event: 'project_manager.history_restore_rollback_failed',
              err: rollbackErr,
              projectId: identity.projectId
            },
            'Project checkpoint restore rollback failed'
          )
        }
        throw new Error('Failed to restore the project checkpoint', { cause: err })
      }
      try {
        await originalLock.release()
        await rm(paths.rollback, { recursive: true, force: true })
        await rm(paths.materialized, { recursive: true, force: true })
        await rm(paths.journal, { force: true })
      } catch (err) {
        this.#logger.error(
          {
            event: 'project_manager.history_restore_cleanup_failed',
            err,
            projectId: identity.projectId
          },
          'Committed checkpoint restore will finish cleanup on the next open'
        )
      }
      this.#logger.info(
        {
          event: 'project_manager.history_restore_completed',
          projectId: identity.projectId,
          checkpointOid: target.oid,
          restoreCommitOid: checkpoint.oid
        },
        'Project checkpoint restore completed'
      )
      return { snapshot: this.snapshot(), checkpoint }
    } finally {
      for (const lock of heldLocks) {
        if (
          this.#context?.writeLock === lock ||
          (this.#recovery?.kind === 'close' && this.#recovery.writeLock === lock)
        ) {
          continue
        }
        try {
          await lock.release()
        } catch (err) {
          this.#logger.error(
            {
              event: 'project_manager.history_restore_lock_release_failed',
              err,
              projectId: identity.projectId
            },
            'Failed to release a checkpoint restore lock'
          )
        }
      }
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
      this.#setState('opening')
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
        this.#setState('recovery-required')
        this.#logger.error(
          { event: 'project_manager.snapshot_restore.failed', err },
          'Project snapshot restore failed'
        )
        throw new Error('Failed to restore the project snapshot', { cause: err })
      }
    })
  }

  async #openCanonicalRoot(
    canonicalRoot: string,
    acquiredLock?: ProjectWriteLock,
    retainWriteLockOnFailure = false
  ): Promise<void> {
    const startedAt = Date.now()
    let writeLock = acquiredLock
    let database: ProjectDatabase | undefined
    let projectId: string | undefined
    let context: ProjectContext | undefined
    try {
      const manifest = await this.#dependencies.readManifest(canonicalRoot)
      projectId = manifest.projectId
      const filesystem = new ProjectFilesystem(canonicalRoot, this.#logger)
      // Reject a static malicious internal root or database before the write lock
      // creates anything below `.writellm`.
      await filesystem.assertExistingRegularFile(PROJECT_DATABASE_RELATIVE_PATH).catch((err) => {
        throw new ProjectOpenIssue('database-unavailable', 'Project database is unavailable', err)
      })
      writeLock ??= await this.#dependencies.acquireLock(canonicalRoot, {
        ...this.#lockOptions,
        logger: this.#logger
      })
      database = await this.#dependencies
        .openDatabase({
          projectRoot: canonicalRoot,
          filesystem,
          manifest,
          applicationVersion: this.#applicationVersion,
          log: this.#logger as Logger
        })
        .catch((err) => {
          throw new ProjectOpenIssue(
            'database-open-failed',
            'Project database could not be opened',
            err
          )
        })
      await filesystem.removeTree(MANUSCRIPT_IMPORT_STAGING_DIRECTORY)
      this.#logger.info(
        {
          event: 'manuscript.import.crash_staging_cleaned',
          projectId: manifest.projectId
        },
        'Stale manuscript import staging removed during project open'
      )
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
      await manuscriptAssets.repairPendingDeletions()
      const editorPersistence = new EditorPersistenceService({
        projectRoot: canonicalRoot,
        projectId: manifest.projectId,
        database,
        manuscript,
        log: this.#logger
      })
      await editorPersistence.repairAll()
      let knowledgeRuntime: ReturnType<ProjectManagerOptions['createKnowledgeRuntime']> | undefined
      const references = new ReferenceLibraryService({ database, log: this.#logger })
      const knowledgeImports = new KnowledgeImportService({
        projectRoot: canonicalRoot,
        filesystem,
        projectId: manifest.projectId,
        database,
        log: this.#logger,
        onStored: async (item, importContext) => {
          if (importContext.ensureIncompleteReference) references.ensureIncompleteForKnowledge(item)
          if (knowledgeRuntime === undefined) return
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
        onDeleted: async (knowledgeItemId) =>
          knowledgeRuntime?.projectIndex.requestItemDelete(knowledgeItemId)
      })
      knowledgeRuntime = this.#createKnowledgeRuntime({
        projectRoot: canonicalRoot,
        filesystem,
        projectId: manifest.projectId,
        projectSessionId,
        database,
        jobs,
        manuscript,
        editorPersistence,
        manuscriptAssets,
        knowledgeImports,
        references,
        log: this.#logger
      })
      const projectIndex = knowledgeRuntime.projectIndex
      const runtime = this.#createRuntime({
        projectId: manifest.projectId,
        projectSessionId,
        jobs,
        registry: knowledgeRuntime.registry,
        log: this.#logger,
        terminateWorkers: knowledgeRuntime.terminateWorkers
      })
      context = {
        projectRoot: canonicalRoot,
        filesystem,
        manifest,
        projectSessionId,
        operations,
        displayName: projectDisplayName(canonicalRoot),
        database,
        jobs,
        manuscript,
        editorPersistence,
        manuscriptAssets,
        knowledgeImports,
        references,
        mineruWorkflow: knowledgeRuntime.mineruWorkflow,
        knowledgeNormalization: knowledgeRuntime.knowledgeNormalization,
        knowledgeMapping: knowledgeRuntime.knowledgeMapping,
        projectIndex,
        retrieval: knowledgeRuntime.retrieval,
        knowledgeChat: knowledgeRuntime.knowledgeChat,
        agentSessions: knowledgeRuntime.agentSessions,
        agentMutations: knowledgeRuntime.agentMutations,
        agentChangeSets: knowledgeRuntime.agentChangeSets,
        writingTasks: knowledgeRuntime.writingTasks,
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
      this.#setState('open')
      projectIndex.startInitialization()
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
          indexReadiness: projectIndex.readiness()
        },
        'Project open transition completed'
      )
    } catch (err) {
      if (context !== undefined) {
        await this.#cleanupFailedOpen(context, retainWriteLockOnFailure)
      } else if (writeLock !== undefined) {
        await this.#cleanupFailedOpen({ projectId, database, writeLock }, retainWriteLockOnFailure)
      }
      throw err
    }
  }

  #setState(next: ProjectLifecycleState): void {
    if (this.#state === 'recovery-required' && next !== 'recovery-required') {
      this.#assertNoPendingClose()
    }
    if (!canTransition(PROJECT_LIFECYCLE_TRANSITIONS, this.#state, next)) {
      throw new Error(`Project manager cannot move from ${this.#state} to ${next}`)
    }
    this.#state = next
  }

  #assertNoPendingClose(): void {
    if (this.#recovery?.kind === 'close') {
      throw new Error('Retry the pending project close first')
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

  #snapshotBarrier(
    context: ProjectContext,
    options: { purpose?: 'snapshot' | 'export'; skipEditorFlush?: boolean } = {}
  ): SnapshotBarrier {
    const operations = context.operations
    return {
      pauseMutations: async () => operations?.pauseMutations(),
      finalEditorFlush: () =>
        options.skipEditorFlush
          ? Promise.resolve()
          : this.#snapshotParticipants.finalEditorFlush(context, options.purpose),
      pauseFilePublishers: () => this.#snapshotParticipants.pauseFilePublishers(context),
      resumeFilePublishers: () => this.#snapshotParticipants.resumeFilePublishers(context),
      resumeMutations: async () => operations?.resumeMutations()
    }
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
    try {
      await createProjectSnapshot({
        sourceRoot: context.projectRoot,
        manifest: context.manifest,
        sourceDatabase: context.database,
        destination: snapshotRoot,
        sourceAppVersion: this.#applicationVersion,
        inventoryFromBackup: () => inventoryProjectFiles(context.projectRoot),
        barrier: this.#snapshotBarrier(context, options),
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
