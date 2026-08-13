import { randomUUID } from 'node:crypto'
import { access, rename, rm, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { Logger } from 'pino'
import { assertDatabaseIntegrity } from '../db/integrity'
import { validateMigrationState } from '../db/migrations'
import { sha256File } from '../db/backup'
import {
  assertJobPersistenceBoundary,
  assertNoPersistedMineruCapabilities
} from './mineru-persistence-invariant'
import { projectMigrations } from './migrations'
import { PROJECT_DATABASE_APPLICATION_ID, type ProjectDatabase } from './project-database'
import { ProjectFilesystem } from './project-filesystem'
import {
  createProjectManifest,
  writeProjectManifest,
  type ProjectManifest
} from './project-manifest'
import {
  MANUSCRIPT_EXPORTS_DIRECTORY,
  PROJECT_DATABASE_RELATIVE_PATH,
  PROJECT_HISTORY_RELATIVE_PATH,
  PROJECT_MANIFEST_FILE,
  resolveProjectPath
} from './project-paths'
import {
  createProjectSnapshot,
  inventoryProjectFiles,
  PROJECT_SNAPSHOT_MANIFEST_FILE,
  type ProjectSnapshotFile,
  type SnapshotBarrier
} from './project-snapshot'

const PROJECT_IDENTITY_COLUMNS = new Set(['manuscripts.project_id', 'project_meta.project_id'])

export interface ProjectCloneResult {
  projectId: string
  projectRoot: string
  fileCount: number
}

export async function createProjectClone(options: {
  sourceRoot: string
  sourceManifest: ProjectManifest
  sourceDatabase: Pick<ProjectDatabase, 'backup'>
  destination: string
  sourceAppVersion: string
  barrier: SnapshotBarrier
  log: Pick<Logger, 'info' | 'error' | 'warn'>
  signal?: AbortSignal
  createId?: () => string
  now?: () => Date
}): Promise<ProjectCloneResult> {
  const startedAt = Date.now()
  const token = (options.createId ?? randomUUID)()
  const parent = dirname(options.destination)
  const capture = join(parent, `.writellm-clone-capture-${token}`)
  const stage = join(parent, `.writellm-clone-${token}.partial`)
  const cloneManifest = createProjectManifest({
    projectId: (options.createId ?? randomUUID)(),
    createdAt: (options.now ?? (() => new Date()))().toISOString()
  })
  options.log.info(
    {
      event: 'project.clone.started',
      sourceProjectId: options.sourceManifest.projectId,
      projectId: cloneManifest.projectId
    },
    'Independent project clone started'
  )
  try {
    throwIfAborted(options.signal)
    await ensureAbsent(options.destination)
    const snapshot = await createProjectSnapshot({
      sourceRoot: options.sourceRoot,
      manifest: options.sourceManifest,
      sourceDatabase: options.sourceDatabase,
      destination: capture,
      sourceAppVersion: options.sourceAppVersion,
      inventoryFromBackup: () => inventoryCloneFiles(options.sourceRoot),
      barrier: abortableBarrier(options.barrier, options.signal),
      includeVersionHistory: false,
      log: options.log
    })
    throwIfAborted(options.signal)
    await rename(capture, stage)
    await Promise.all([
      unlink(join(stage, PROJECT_MANIFEST_FILE)),
      unlink(join(stage, PROJECT_SNAPSHOT_MANIFEST_FILE))
    ])

    const filesystem = new ProjectFilesystem(stage, options.log)
    const databasePath = await filesystem.assertExistingRegularFile(PROJECT_DATABASE_RELATIVE_PATH)
    rewriteProjectIdentity(databasePath, options.sourceManifest.projectId, cloneManifest.projectId)
    await validateCloneDatabase(databasePath, cloneManifest.projectId, options.log)
    await validateCloneInventory(stage, snapshot.files)
    await assertPathAbsent(resolveProjectPath(stage, PROJECT_HISTORY_RELATIVE_PATH))
    await writeProjectManifest(stage, cloneManifest)
    throwIfAborted(options.signal)
    await ensureAbsent(options.destination)
    await rename(stage, options.destination)
    options.log.info(
      {
        event: 'project.clone.completed',
        sourceProjectId: options.sourceManifest.projectId,
        projectId: cloneManifest.projectId,
        fileCount: snapshot.files.length,
        durationMs: Date.now() - startedAt
      },
      'Independent project clone published'
    )
    return {
      projectId: cloneManifest.projectId,
      projectRoot: options.destination,
      fileCount: snapshot.files.length
    }
  } catch (err) {
    options.log.error(
      {
        event: 'project.clone.failed',
        err,
        sourceProjectId: options.sourceManifest.projectId,
        projectId: cloneManifest.projectId,
        durationMs: Date.now() - startedAt
      },
      'Independent project clone failed'
    )
    throw new Error('Project clone failed', { cause: err })
  } finally {
    await Promise.all([
      rm(capture, { recursive: true, force: true }),
      rm(stage, { recursive: true, force: true })
    ])
  }
}

async function inventoryCloneFiles(projectRoot: string): Promise<readonly ProjectSnapshotFile[]> {
  return (await inventoryProjectFiles(projectRoot)).filter(
    (file) =>
      file.relativePath !== MANUSCRIPT_EXPORTS_DIRECTORY &&
      !file.relativePath.startsWith(`${MANUSCRIPT_EXPORTS_DIRECTORY}/`)
  )
}

function rewriteProjectIdentity(
  databasePath: string,
  sourceProjectId: string,
  cloneProjectId: string
): void {
  const database = new Database(databasePath, { fileMustExist: true })
  try {
    database.pragma('foreign_keys = ON')
    assertIdentityRewriteList(database)
    database.transaction(() => {
      database.pragma('defer_foreign_keys = ON')
      const project = database
        .prepare('UPDATE project_meta SET project_id = ? WHERE singleton_id = 1 AND project_id = ?')
        .run(cloneProjectId, sourceProjectId)
      const manuscripts = database
        .prepare('UPDATE manuscripts SET project_id = ? WHERE project_id = ?')
        .run(cloneProjectId, sourceProjectId)
      if (project.changes !== 1 || manuscripts.changes < 1) {
        throw new Error('Clone database identity did not match its source manifest')
      }
    })()
  } finally {
    database.close()
  }
}

function assertIdentityRewriteList(database: Database.Database): void {
  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .pluck()
    .all() as string[]
  const actual = new Set<string>()
  for (const table of tables) {
    const columns = database.pragma(`table_info(${JSON.stringify(table)})`) as Array<{
      name: string
    }>
    for (const column of columns) {
      if (column.name === 'project_id') actual.add(`${table}.${column.name}`)
    }
  }
  if (
    actual.size !== PROJECT_IDENTITY_COLUMNS.size ||
    [...actual].some((column) => !PROJECT_IDENTITY_COLUMNS.has(column))
  ) {
    throw new Error('Project database identity rewrite list is incomplete')
  }
}

async function validateCloneDatabase(
  databasePath: string,
  projectId: string,
  log: Pick<Logger, 'info' | 'error'>
): Promise<void> {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    database.pragma('foreign_keys = ON')
    if (database.pragma('application_id', { simple: true }) !== PROJECT_DATABASE_APPLICATION_ID) {
      throw new Error('Clone project database application ID is invalid')
    }
    const actualProjectId = database
      .prepare('SELECT project_id FROM project_meta WHERE singleton_id = 1')
      .pluck()
      .get()
    if (actualProjectId !== projectId) throw new Error('Clone database identity is invalid')
    const manuscriptProjectIds = database
      .prepare('SELECT DISTINCT project_id FROM manuscripts')
      .pluck()
      .all()
    if (manuscriptProjectIds.length !== 1 || manuscriptProjectIds[0] !== projectId) {
      throw new Error('Clone manuscript identity is invalid')
    }
    assertDatabaseIntegrity(database, 'snapshot', 'full', log)
    validateMigrationState(database, { databaseRole: 'project', migrations: projectMigrations })
    assertNoPersistedMineruCapabilities(database)
    assertJobPersistenceBoundary(database)
  } finally {
    database.close()
  }
}

async function validateCloneInventory(
  stage: string,
  expectedFiles: readonly ProjectSnapshotFile[]
): Promise<void> {
  const actualFiles = await inventoryCloneFiles(stage)
  if (actualFiles.length !== expectedFiles.length) throw new Error('Clone inventory size changed')
  for (const expected of expectedFiles) {
    const actual = actualFiles.find((file) => file.relativePath === expected.relativePath)
    if (
      actual === undefined ||
      actual.role !== expected.role ||
      actual.size !== expected.size ||
      actual.sha256 !== expected.sha256
    ) {
      throw new Error('Clone inventory does not match the captured source')
    }
    const digest = await sha256File(resolveProjectPath(stage, expected.relativePath))
    if (digest.sha256 !== expected.sha256 || digest.size !== expected.size) {
      throw new Error('Clone file failed final hash validation')
    }
  }
}

function abortableBarrier(barrier: SnapshotBarrier, signal?: AbortSignal): SnapshotBarrier {
  return {
    pauseMutations: async () => {
      throwIfAborted(signal)
      await barrier.pauseMutations()
    },
    finalEditorFlush: async () => {
      throwIfAborted(signal)
      await barrier.finalEditorFlush()
    },
    pauseFilePublishers: async () => {
      throwIfAborted(signal)
      await barrier.pauseFilePublishers()
    },
    resumeFilePublishers: () => barrier.resumeFilePublishers(),
    resumeMutations: () => barrier.resumeMutations()
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new Error('Project clone was cancelled')
}

async function ensureAbsent(path: string): Promise<void> {
  await access(path).then(
    () => {
      throw new Error('Clone destination already exists')
    },
    (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    }
  )
}

async function assertPathAbsent(path: string): Promise<void> {
  await access(path).then(
    () => {
      throw new Error('Clone contains excluded version history')
    },
    (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    }
  )
}
