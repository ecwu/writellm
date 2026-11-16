import { lstat, mkdtemp, realpath, rename, rm } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import Database from 'better-sqlite3'
import type { Logger } from 'pino'
import { copyVerifiedFile, createVerifiedDatabaseBackup } from '../db/backup'
import { assertDatabaseIntegrity } from '../db/integrity'
import { validateMigrationState } from '../db/migrations'
import {
  assertJobPersistenceBoundary,
  assertNoPersistedMineruCapabilities
} from './mineru-persistence-invariant'
import { projectMigrations } from './migrations'
import { PROJECT_DATABASE_APPLICATION_ID } from './project-database'
import { ProjectFilesystem } from './project-filesystem'
import { createProjectManifest, writeProjectManifest } from './project-manifest'
import {
  PROJECT_DATABASE_RELATIVE_PATH,
  PROJECT_MANIFEST_FILE,
  resolveProjectPath
} from './project-paths'
import { inventoryProjectFiles } from './project-snapshot'

type RecoveryLogger = Pick<Logger, 'error' | 'info' | 'warn'>

// The caller holds the project write lock until the manifest is published.
export async function rebuildMissingProjectManifest(
  filesystem: ProjectFilesystem,
  log: RecoveryLogger
): Promise<void> {
  const sourcePath = await manifestSourcePath(filesystem)
  const database = new Database(sourcePath, { readonly: true, fileMustExist: true })
  let manifest: ReturnType<typeof createProjectManifest>
  try {
    manifest = verifiedProjectManifest(database, log)
  } finally {
    database.close()
  }
  await writeProjectManifest(filesystem.canonicalRoot, manifest, {
    publishWithoutReplacement: true
  })
  log.info(
    { event: 'project.manifest_recovery.rebuilt', projectId: manifest.projectId },
    'Missing project manifest rebuilt'
  )
}

// The caller holds the source project lock throughout capture.
export async function createManifestRecoveryCopy(options: {
  sourceRoot: string
  destinationParent: string
  log: RecoveryLogger
}): Promise<string> {
  const { sourceRoot, log } = options
  const parent = await realpath(options.destinationParent)
  const fromSource = relative(sourceRoot, parent)
  if (
    fromSource === '' ||
    (!isAbsolute(fromSource) && fromSource !== '..' && !fromSource.startsWith(`..${sep}`))
  ) {
    throw new Error('Choose a recovery location outside the original project')
  }
  const filesystem = new ProjectFilesystem(sourceRoot, log)
  const sourcePath = await manifestSourcePath(filesystem)

  const recoveryDirectory = await mkdtemp(join(parent, 'WriteLLM recovery-'))
  const stage = join(recoveryDirectory, '.partial')
  try {
    const source = new Database(sourcePath, { readonly: true, fileMustExist: true })
    let manifest: ReturnType<typeof createProjectManifest> | undefined
    try {
      await createVerifiedDatabaseBackup({
        source,
        destination: resolveProjectPath(stage, PROJECT_DATABASE_RELATIVE_PATH),
        databaseRole: 'project',
        applicationId: PROJECT_DATABASE_APPLICATION_ID,
        log,
        validate: (database) => {
          manifest = verifiedProjectManifest(database, log)
        }
      })
    } finally {
      source.close()
    }
    if (!manifest) throw new Error('Verified project backup has no manifest')
    for (const file of await inventoryProjectFiles(sourceRoot)) {
      await copyVerifiedFile({
        source: await filesystem.assertExistingRegularFile(file.relativePath),
        destination: resolveProjectPath(stage, file.relativePath),
        expectedSha256: file.sha256,
        expectedSize: file.size
      })
    }
    await writeProjectManifest(stage, manifest)
    const destination = join(recoveryDirectory, basename(sourceRoot))
    await rename(stage, destination)
    log.info(
      { event: 'project.manifest_recovery.completed', projectId: manifest.projectId },
      'Project recovery copy created'
    )
    return destination
  } catch (err) {
    log.error({ event: 'project.manifest_recovery.failed', err }, 'Project recovery copy failed')
    await rm(recoveryDirectory, { recursive: true, force: true }).catch((cleanupError) =>
      log.error(
        { event: 'project.manifest_recovery.cleanup_failed', err: cleanupError },
        'Failed to remove recovery staging'
      )
    )
    throw err
  }
}

async function manifestSourcePath(filesystem: ProjectFilesystem): Promise<string> {
  if (await optionalEntry(join(filesystem.canonicalRoot, PROJECT_MANIFEST_FILE))) {
    throw new Error('The source already has a project manifest')
  }
  const path = await filesystem.assertExistingRegularFile(PROJECT_DATABASE_RELATIVE_PATH)
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const entry = await optionalEntry(path + suffix)
    if (entry && !entry.isFile()) throw new Error('Invalid SQLite companion file in project')
  }
  return path
}

function verifiedProjectManifest(database: Database.Database, log: RecoveryLogger) {
  if (database.pragma('application_id', { simple: true }) !== PROJECT_DATABASE_APPLICATION_ID) {
    throw new Error('Project database application identity is invalid')
  }
  assertDatabaseIntegrity(database, 'project', 'full', log)
  validateMigrationState(database, { databaseRole: 'project', migrations: projectMigrations })
  assertNoPersistedMineruCapabilities(database)
  assertJobPersistenceBoundary(database)
  const identity = database
    .prepare(
      'SELECT project_id AS projectId, created_at AS createdAt FROM project_meta WHERE singleton_id = 1'
    )
    .get() as { projectId: string; createdAt: string } | undefined
  if (!identity) throw new Error('Project database has no project identity')
  return createProjectManifest(identity)
}

async function optionalEntry(path: string) {
  return lstat(path).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return undefined
    throw err
  })
}
