import { randomUUID, createHash } from 'node:crypto'
import { mkdir, rename, rm, writeFile, access, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import Database from 'better-sqlite3'
import type { Logger } from 'pino'
import { z } from 'zod'
import {
  copyVerifiedFile,
  createVerifiedDatabaseBackup,
  createVerifiedOpenedDatabaseBackup,
  sha256File,
  verifyDatabaseFile
} from '../db/backup'
import { assertDatabaseIntegrity } from '../db/integrity'
import { projectMigrations } from './migrations'
import { readMigrationState, validateMigrationState } from '../db/migrations'
import type { ProjectDatabase } from './project-database'
import { PROJECT_DATABASE_APPLICATION_ID } from './project-database'
import { readProjectManifest, writeProjectManifest, type ProjectManifest } from './project-manifest'
import {
  PROJECT_BACKUPS_DIRECTORY,
  PROJECT_DATABASE_RELATIVE_PATH,
  PROJECT_MANIFEST_FILE,
  PROJECT_RECOVERY_DIRECTORY,
  resolveProjectPath,
  normalizeProjectRelativePath
} from './project-paths'
import { projectIdSchema } from '../../shared/contracts/projects'

export const PROJECT_SNAPSHOT_FORMAT = 'writellm-project-snapshot'
export const PROJECT_SNAPSHOT_FORMAT_VERSION = 1
export const PROJECT_SNAPSHOT_MANIFEST_FILE = 'writellm.snapshot.json'

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/)
const snapshotFileSchema = z
  .object({
    relativePath: z.string().min(1),
    role: z.string().min(1).max(100),
    sha256: sha256Schema,
    size: z.number().int().nonnegative()
  })
  .strict()

const snapshotManifestSchema = z
  .object({
    snapshotFormat: z.literal(PROJECT_SNAPSHOT_FORMAT),
    snapshotFormatVersion: z.literal(PROJECT_SNAPSHOT_FORMAT_VERSION),
    projectId: projectIdSchema,
    projectFormatVersion: z.number().int().positive(),
    projectDatabaseSchemaVersion: z.number().int().nonnegative(),
    schemaMigrationsSha256: sha256Schema,
    createdAt: z.iso.datetime(),
    sourceAppVersion: z.string().min(1).max(100),
    indexIncluded: z.boolean(),
    indexRebuildRequired: z.boolean(),
    database: z
      .object({
        path: z.literal(PROJECT_DATABASE_RELATIVE_PATH),
        sha256: sha256Schema,
        size: z.number().int().nonnegative()
      })
      .strict(),
    files: z.array(snapshotFileSchema)
  })
  .strict()

export type ProjectSnapshotManifest = z.infer<typeof snapshotManifestSchema>
export type ProjectSnapshotFile = z.infer<typeof snapshotFileSchema>

export function parseProjectSnapshotManifest(value: unknown): ProjectSnapshotManifest {
  const manifest = snapshotManifestSchema.parse(value)
  validateSnapshotFilePaths(manifest.files)
  if (manifest.indexIncluded === manifest.indexRebuildRequired) {
    throw new Error('Snapshot index flags are inconsistent')
  }
  return manifest
}

export async function readProjectSnapshotManifest(
  snapshotRoot: string
): Promise<ProjectSnapshotManifest> {
  try {
    const text = await readFile(join(snapshotRoot, PROJECT_SNAPSHOT_MANIFEST_FILE), 'utf8')
    return parseProjectSnapshotManifest(JSON.parse(text) as unknown)
  } catch (err) {
    throw new Error('Failed to read project snapshot manifest', { cause: err })
  }
}

function schemaMigrationsHash(database: Database.Database): string {
  const rows = database
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all()
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

function validateProjectDatabaseIdentity(database: Database.Database, projectId: string): void {
  const actual = database
    .prepare('SELECT project_id FROM project_meta WHERE singleton_id = 1')
    .pluck()
    .get() as string | undefined
  if (actual !== projectId) throw new Error('Snapshot database project ID does not match manifest')
}

function validateSnapshotFilePaths(files: readonly ProjectSnapshotFile[]): void {
  const seen = new Set<string>()
  for (const file of files) {
    const normalized = normalizeProjectRelativePath(file.relativePath)
    if (normalized !== file.relativePath) throw new Error('Snapshot path is not normalized')
    const caseFolded = normalized.toLocaleLowerCase('en-US')
    if (seen.has(caseFolded)) throw new Error('Snapshot contains duplicate or case-colliding paths')
    seen.add(caseFolded)
    if (
      normalized === PROJECT_DATABASE_RELATIVE_PATH ||
      normalized === `${PROJECT_DATABASE_RELATIVE_PATH}-wal` ||
      normalized === `${PROJECT_DATABASE_RELATIVE_PATH}-shm` ||
      normalized === '.writellm/index.sqlite' ||
      normalized === '.writellm/index.sqlite-wal' ||
      normalized === '.writellm/index.sqlite-shm' ||
      normalized === PROJECT_MANIFEST_FILE ||
      normalized === PROJECT_SNAPSHOT_MANIFEST_FILE ||
      normalized.startsWith('.writellm/temp/') ||
      normalized.startsWith('.writellm/backups/') ||
      normalized.startsWith('.writellm/recovery/')
    ) {
      throw new Error('Snapshot inventory contains an excluded path')
    }
    if (normalized.endsWith('.partial'))
      throw new Error('Snapshot inventory contains a partial file')
  }
}

async function writeAtomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.partial`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx'
    })
    await rename(temporary, path)
  } catch (err) {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw new Error('Failed to atomically write snapshot manifest', { cause: err })
  }
}

async function ensureDestinationAbsent(path: string): Promise<void> {
  await access(path).then(
    () => {
      throw new Error('Snapshot destination already exists')
    },
    (err: NodeJS.ErrnoException) => {
      if (err.code !== 'ENOENT') throw err
    }
  )
}

export interface SnapshotBarrier {
  pauseMutations(): Promise<void>
  finalEditorFlush(): Promise<void>
  pauseFilePublishers(): Promise<void>
  resumeFilePublishers(): Promise<void>
  resumeMutations(): Promise<void>
}

const noOpBarrier: SnapshotBarrier = {
  pauseMutations: async () => undefined,
  finalEditorFlush: async () => undefined,
  pauseFilePublishers: async () => undefined,
  resumeFilePublishers: async () => undefined,
  resumeMutations: async () => undefined
}

export async function createProjectSnapshot(options: {
  sourceRoot: string
  manifest: ProjectManifest
  sourceDatabase: Pick<ProjectDatabase, 'backup'>
  destination: string
  sourceAppVersion: string
  inventoryFromBackup: (
    database: Database.Database
  ) => Promise<readonly ProjectSnapshotFile[]> | readonly ProjectSnapshotFile[]
  barrier?: Partial<SnapshotBarrier>
  indexIncluded?: false
  log: Pick<Logger, 'info' | 'error'>
}): Promise<ProjectSnapshotManifest> {
  const barrier = { ...noOpBarrier, ...options.barrier }
  const parent = dirname(options.destination)
  const stage = join(parent, `.${options.manifest.projectId}.${randomUUID()}.snapshot.partial`)
  let mutationsPaused = false
  let publishersPaused = false
  try {
    await ensureDestinationAbsent(options.destination)
    await mkdir(stage, { recursive: true, mode: 0o700 })
    await barrier.pauseMutations()
    mutationsPaused = true
    await barrier.finalEditorFlush()
    await barrier.pauseFilePublishers()
    publishersPaused = true

    const stagedDatabasePath = resolveProjectPath(stage, PROJECT_DATABASE_RELATIVE_PATH)
    await mkdir(dirname(stagedDatabasePath), { recursive: true })
    await createVerifiedOpenedDatabaseBackup({
      source: options.sourceDatabase,
      destination: stagedDatabasePath,
      databaseRole: 'project',
      applicationId: PROJECT_DATABASE_APPLICATION_ID,
      log: options.log,
      validate: (database) => validateProjectDatabaseIdentity(database, options.manifest.projectId)
    })

    const backupDatabase = new Database(stagedDatabasePath, { readonly: true, fileMustExist: true })
    let inventory: readonly ProjectSnapshotFile[]
    try {
      backupDatabase.pragma('foreign_keys = ON')
      assertDatabaseIntegrity(backupDatabase, 'snapshot', 'full', options.log)
      validateProjectDatabaseIdentity(backupDatabase, options.manifest.projectId)
      validateMigrationState(backupDatabase, {
        databaseRole: 'project',
        migrations: projectMigrations
      })
      inventory = await options.inventoryFromBackup(backupDatabase)
    } finally {
      backupDatabase.close()
    }
    const files = inventory.map((file) => snapshotFileSchema.parse(file))
    validateSnapshotFilePaths(files)

    for (const file of files) {
      const source = resolveProjectPath(options.sourceRoot, file.relativePath)
      const destination = resolveProjectPath(stage, file.relativePath)
      await copyVerifiedFile({
        source,
        destination,
        expectedSha256: file.sha256,
        expectedSize: file.size
      })
    }
    await writeProjectManifest(stage, options.manifest)
    const databaseDigest = await sha256File(stagedDatabasePath)
    const backupForMetadata = new Database(stagedDatabasePath, {
      readonly: true,
      fileMustExist: true
    })
    let schemaVersion: number
    let migrationHash: string
    try {
      schemaVersion = readMigrationState(backupForMetadata).schemaVersion
      migrationHash = schemaMigrationsHash(backupForMetadata)
    } finally {
      backupForMetadata.close()
    }
    const snapshotManifest = parseProjectSnapshotManifest({
      snapshotFormat: PROJECT_SNAPSHOT_FORMAT,
      snapshotFormatVersion: PROJECT_SNAPSHOT_FORMAT_VERSION,
      projectId: options.manifest.projectId,
      projectFormatVersion: options.manifest.formatVersion,
      projectDatabaseSchemaVersion: schemaVersion,
      schemaMigrationsSha256: migrationHash,
      createdAt: new Date().toISOString(),
      sourceAppVersion: options.sourceAppVersion,
      indexIncluded: options.indexIncluded ?? false,
      indexRebuildRequired: !(options.indexIncluded ?? false),
      database: { path: PROJECT_DATABASE_RELATIVE_PATH, ...databaseDigest },
      files
    })
    await writeAtomicJson(join(stage, PROJECT_SNAPSHOT_MANIFEST_FILE), snapshotManifest)
    await ensureDestinationAbsent(options.destination)
    await rename(stage, options.destination)
    options.log.info(
      {
        event: 'project.snapshot.completed',
        projectId: options.manifest.projectId,
        fileCount: files.length,
        indexIncluded: snapshotManifest.indexIncluded
      },
      'Project snapshot published'
    )
    return snapshotManifest
  } catch (err) {
    options.log.error(
      { event: 'project.snapshot.failed', err, projectId: options.manifest.projectId },
      'Project snapshot failed'
    )
    throw new Error('Project snapshot failed', { cause: err })
  } finally {
    if (publishersPaused) {
      await barrier.resumeFilePublishers().catch((err) =>
        options.log.error(
          {
            event: 'project.snapshot.resume_publishers_failed',
            err,
            projectId: options.manifest.projectId
          },
          'Failed to resume snapshot file publishers'
        )
      )
    }
    if (mutationsPaused) {
      await barrier.resumeMutations().catch((err) =>
        options.log.error(
          {
            event: 'project.snapshot.resume_mutations_failed',
            err,
            projectId: options.manifest.projectId
          },
          'Failed to resume snapshot mutations'
        )
      )
    }
    await rm(stage, { recursive: true, force: true }).catch((err) =>
      options.log.error(
        {
          event: 'project.snapshot.stage_cleanup_failed',
          err,
          projectId: options.manifest.projectId
        },
        'Failed to clean snapshot staging directory'
      )
    )
  }
}

export async function restoreProjectSnapshot(options: {
  snapshotRoot: string
  destination: string
  log: Pick<Logger, 'info' | 'error'>
}): Promise<{ projectId: string; destination: string; indexRebuildRequired: boolean }> {
  const stage = join(dirname(options.destination), `.${randomUUID()}.restore.partial`)
  try {
    const snapshot = await readProjectSnapshotManifest(options.snapshotRoot)
    const projectManifest = await readProjectManifest(options.snapshotRoot)
    if (projectManifest.projectId !== snapshot.projectId) {
      throw new Error('Snapshot and project manifest project IDs do not match')
    }
    await ensureDestinationAbsent(options.destination)
    await mkdir(stage, { recursive: true, mode: 0o700 })
    await writeProjectManifest(stage, projectManifest)
    await writeAtomicJson(join(stage, PROJECT_SNAPSHOT_MANIFEST_FILE), snapshot)

    const sourceDatabase = join(options.snapshotRoot, snapshot.database.path)
    const stagedDatabase = resolveProjectPath(stage, snapshot.database.path)
    await copyVerifiedFile({
      source: sourceDatabase,
      destination: stagedDatabase,
      expectedSha256: snapshot.database.sha256,
      expectedSize: snapshot.database.size
    })
    await verifyDatabaseFile(stagedDatabase, {
      databaseRole: 'snapshot',
      applicationId: PROJECT_DATABASE_APPLICATION_ID,
      integrity: 'full',
      log: options.log,
      validate: (database) => {
        validateProjectDatabaseIdentity(database, snapshot.projectId)
        validateMigrationState(database, { databaseRole: 'project', migrations: projectMigrations })
        if (schemaMigrationsHash(database) !== snapshot.schemaMigrationsSha256) {
          throw new Error('Snapshot database migration checksum does not match manifest')
        }
      }
    })
    for (const file of snapshot.files) {
      await copyVerifiedFile({
        source: join(options.snapshotRoot, file.relativePath),
        destination: resolveProjectPath(stage, file.relativePath),
        expectedSha256: file.sha256,
        expectedSize: file.size
      })
    }
    await ensureDestinationAbsent(options.destination)
    await rename(stage, options.destination)
    options.log.info(
      {
        event: 'project.snapshot.restore.completed',
        projectId: snapshot.projectId,
        indexRebuildRequired: snapshot.indexRebuildRequired
      },
      'Project snapshot restored'
    )
    return {
      projectId: snapshot.projectId,
      destination: options.destination,
      indexRebuildRequired: snapshot.indexRebuildRequired
    }
  } catch (err) {
    options.log.error(
      { event: 'project.snapshot.restore.failed', err },
      'Project snapshot restore failed'
    )
    throw new Error('Project snapshot restore failed', { cause: err })
  } finally {
    await rm(stage, { recursive: true, force: true }).catch((err) =>
      options.log.error(
        { event: 'project.snapshot.restore.cleanup_failed', err },
        'Failed to clean restore staging'
      )
    )
  }
}

export async function restoreProjectDatabase(options: {
  projectRoot: string
  candidateDatabase: string
  projectId: string
  log: Pick<Logger, 'info' | 'error'>
}): Promise<{ preRestoreBackup: string; quarantine: string }> {
  projectIdSchema.parse(options.projectId)
  const databasePath = resolveProjectPath(options.projectRoot, PROJECT_DATABASE_RELATIVE_PATH)
  const backups = resolveProjectPath(options.projectRoot, PROJECT_BACKUPS_DIRECTORY)
  const recovery = resolveProjectPath(options.projectRoot, PROJECT_RECOVERY_DIRECTORY)
  await mkdir(backups, { recursive: true })
  await mkdir(recovery, { recursive: true })
  const preRestoreBackup = join(backups, `pre-restore-${randomUUID()}.sqlite`)
  const quarantine = join(recovery, `project.sqlite.${randomUUID()}.quarantine`)
  let current: Database.Database | undefined
  try {
    current = new Database(databasePath, { fileMustExist: true })
    await createVerifiedDatabaseBackup({
      source: current,
      destination: preRestoreBackup,
      databaseRole: 'project',
      applicationId: PROJECT_DATABASE_APPLICATION_ID,
      log: options.log,
      validate: (database) => validateProjectDatabaseIdentity(database, options.projectId)
    })
    current.close()
    current = undefined
    await verifyDatabaseFile(options.candidateDatabase, {
      databaseRole: 'snapshot',
      applicationId: PROJECT_DATABASE_APPLICATION_ID,
      integrity: 'full',
      log: options.log,
      validate: (database) => validateProjectDatabaseIdentity(database, options.projectId)
    })
    const staged = `${databasePath}.${randomUUID()}.restore.partial`
    try {
      await copyVerifiedFile({ source: options.candidateDatabase, destination: staged })
      await verifyDatabaseFile(staged, {
        databaseRole: 'snapshot',
        applicationId: PROJECT_DATABASE_APPLICATION_ID,
        integrity: 'full',
        log: options.log,
        validate: (database) => {
          validateProjectDatabaseIdentity(database, options.projectId)
          validateMigrationState(database, {
            databaseRole: 'project',
            migrations: projectMigrations
          })
        }
      })
      await rename(databasePath, quarantine)
      try {
        await rename(staged, databasePath)
      } catch (err) {
        await rename(quarantine, databasePath).catch((rollbackErr) => {
          options.log.error(
            { event: 'project.database.restore.rollback_failed', err: rollbackErr },
            'Database restore rollback failed'
          )
        })
        throw err
      }
      await rm(`${databasePath}-wal`, { force: true })
      await rm(`${databasePath}-shm`, { force: true })
      options.log.info(
        { event: 'project.database.restore.completed', projectId: options.projectId },
        'Project database restored'
      )
      return { preRestoreBackup, quarantine }
    } finally {
      await rm(staged, { force: true }).catch((err) =>
        options.log.error(
          {
            event: 'project.database.restore.stage_cleanup_failed',
            err,
            projectId: options.projectId
          },
          'Failed to clean staged project database restore'
        )
      )
    }
  } catch (err) {
    options.log.error(
      { event: 'project.database.restore.failed', err, projectId: options.projectId },
      'Project database restore failed'
    )
    throw new Error('Project database restore failed', { cause: err })
  } finally {
    try {
      current?.close()
    } catch (err) {
      options.log.error(
        { event: 'project.database.restore.close_failed', err, projectId: options.projectId },
        'Failed to close database during restore'
      )
    }
  }
}
