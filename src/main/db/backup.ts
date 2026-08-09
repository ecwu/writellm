import { randomUUID, createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, readdir, rm, stat, lstat, link } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import type { Logger } from 'pino'
import { syncDirectory, syncFile } from '../storage/durable-sync'
import { assertDatabaseIntegrity, type IntegrityCheckLevel } from './integrity'
import type { OpenedDatabase } from './open-database'

export interface VerifiedDatabaseBackup {
  path: string
  sha256: string
  size: number
}

export interface VerifyDatabaseFileOptions {
  databaseRole: 'app' | 'project' | 'snapshot' | 'backup'
  applicationId?: number
  integrity?: IntegrityCheckLevel
  log?: Pick<Logger, 'info' | 'error'>
  validate?: (database: Database.Database) => void
}

export async function sha256File(path: string): Promise<{ sha256: string; size: number }> {
  const hash = createHash('sha256')
  let size = 0
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk: string | Buffer) => {
      hash.update(chunk)
      size += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
    })
    stream.once('end', resolve)
    stream.once('error', reject)
  })
  return { sha256: hash.digest('hex'), size }
}

async function publishFileWithoutReplacement(source: string, destination: string): Promise<void> {
  await link(source, destination)
  try {
    await syncDirectory(dirname(destination))
  } catch (err) {
    await rm(destination, { force: true })
    throw err
  }
}

function backupOptions(signal?: AbortSignal): Database.BackupOptions | undefined {
  if (signal === undefined) return undefined
  signal.throwIfAborted()
  return {
    progress: () => {
      signal.throwIfAborted()
      return 100
    }
  }
}

async function normalizeBackupFile(path: string): Promise<void> {
  let database: Database.Database | undefined
  try {
    database = new Database(path, { fileMustExist: true })
    database.pragma('journal_mode = DELETE')
  } finally {
    database?.close()
  }
  await rm(`${path}-wal`, { force: true })
  await rm(`${path}-shm`, { force: true })
}

export async function verifyDatabaseFile(
  path: string,
  options: VerifyDatabaseFileOptions
): Promise<VerifiedDatabaseBackup> {
  const startedAt = Date.now()
  let database: Database.Database | undefined
  try {
    database = new Database(path, { readonly: true, fileMustExist: true })
    database.pragma('foreign_keys = ON')
    if (options.applicationId !== undefined) {
      const applicationId = database.pragma('application_id', { simple: true }) as number
      if (applicationId !== options.applicationId) {
        throw new Error('Database file belongs to a different application role')
      }
    }
    assertDatabaseIntegrity(
      database,
      options.databaseRole,
      options.integrity ?? 'quick',
      options.log
    )
    options.validate?.(database)
    const digest = await sha256File(path)
    options.log?.info(
      {
        event: 'db.backup.verification.completed',
        databaseRole: options.databaseRole,
        durationMs: Date.now() - startedAt,
        size: digest.size,
        sha256: digest.sha256
      },
      `${options.databaseRole} database backup verified`
    )
    return { path, ...digest }
  } catch (err) {
    options.log?.error(
      { event: 'db.backup.verification.failed', err, databaseRole: options.databaseRole },
      `${options.databaseRole} database backup verification failed`
    )
    throw new Error(`${options.databaseRole} database backup verification failed`, { cause: err })
  } finally {
    try {
      database?.close()
    } catch (err) {
      options.log?.error(
        { event: 'db.backup.verification.close_failed', err, databaseRole: options.databaseRole },
        `${options.databaseRole} backup verification close failed`
      )
    }
  }
}

export async function createVerifiedDatabaseBackup(options: {
  source: Database.Database
  destination: string
  databaseRole: 'app' | 'project'
  applicationId?: number
  signal?: AbortSignal
  log?: Pick<Logger, 'info' | 'error'>
  validate?: (database: Database.Database) => void
}): Promise<VerifiedDatabaseBackup> {
  const partial = `${options.destination}.${randomUUID()}.partial`
  await mkdir(dirname(options.destination), { recursive: true })
  try {
    options.log?.info(
      { event: 'db.backup.started', databaseRole: options.databaseRole },
      `Starting ${options.databaseRole} database backup`
    )
    await options.source.backup(partial, backupOptions(options.signal))
    await normalizeBackupFile(partial)
    const verified = await verifyDatabaseFile(partial, {
      databaseRole: 'backup',
      applicationId: options.applicationId,
      integrity: 'quick',
      log: options.log,
      validate: options.validate
    })
    await syncFile(partial)
    await publishFileWithoutReplacement(partial, options.destination)
    options.log?.info(
      {
        event: 'db.backup.completed',
        databaseRole: options.databaseRole,
        size: verified.size,
        sha256: verified.sha256
      },
      `${options.databaseRole} database backup completed`
    )
    return { ...verified, path: options.destination }
  } catch (err) {
    options.log?.error(
      { event: 'db.backup.failed', err, databaseRole: options.databaseRole },
      `${options.databaseRole} database backup failed`
    )
    throw new Error(`${options.databaseRole} database backup failed`, { cause: err })
  } finally {
    try {
      await rm(partial, { force: true })
    } catch (err) {
      options.log?.error(
        { event: 'db.backup.partial_cleanup_failed', err, databaseRole: options.databaseRole },
        `${options.databaseRole} database backup partial cleanup failed`
      )
    }
  }
}

export async function createVerifiedOpenedDatabaseBackup(options: {
  source: Pick<OpenedDatabase<unknown>, 'backup'>
  destination: string
  databaseRole: 'app' | 'project'
  applicationId?: number
  signal?: AbortSignal
  log?: Pick<Logger, 'info' | 'error'>
  validate?: (database: Database.Database) => void
}): Promise<VerifiedDatabaseBackup> {
  const partial = `${options.destination}.${randomUUID()}.partial`
  await mkdir(dirname(options.destination), { recursive: true })
  try {
    options.log?.info(
      { event: 'db.backup.started', databaseRole: options.databaseRole },
      `Starting ${options.databaseRole} database backup`
    )
    await options.source.backup(partial, backupOptions(options.signal))
    await normalizeBackupFile(partial)
    const verified = await verifyDatabaseFile(partial, {
      databaseRole: 'backup',
      applicationId: options.applicationId,
      integrity: 'quick',
      log: options.log,
      validate: options.validate
    })
    await syncFile(partial)
    await publishFileWithoutReplacement(partial, options.destination)
    options.log?.info(
      {
        event: 'db.backup.completed',
        databaseRole: options.databaseRole,
        size: verified.size,
        sha256: verified.sha256
      },
      `${options.databaseRole} database backup completed`
    )
    return { ...verified, path: options.destination }
  } catch (err) {
    options.log?.error(
      { event: 'db.backup.failed', err, databaseRole: options.databaseRole },
      `${options.databaseRole} database backup failed`
    )
    throw new Error(`${options.databaseRole} database backup failed`, { cause: err })
  } finally {
    try {
      await rm(partial, { force: true })
    } catch (err) {
      options.log?.error(
        { event: 'db.backup.partial_cleanup_failed', err, databaseRole: options.databaseRole },
        `${options.databaseRole} database backup partial cleanup failed`
      )
    }
  }
}

export async function verifyAndPublishDatabaseBackup(options: {
  partialPath: string
  destination: string
  databaseRole: 'app' | 'project' | 'snapshot' | 'backup'
  applicationId?: number
  integrity?: IntegrityCheckLevel
  log?: Pick<Logger, 'info' | 'error'>
  validate?: (database: Database.Database) => void
}): Promise<VerifiedDatabaseBackup> {
  try {
    await normalizeBackupFile(options.partialPath)
    const verified = await verifyDatabaseFile(options.partialPath, {
      databaseRole: options.databaseRole,
      applicationId: options.applicationId,
      integrity: options.integrity,
      log: options.log,
      validate: options.validate
    })
    await syncFile(options.partialPath)
    await publishFileWithoutReplacement(options.partialPath, options.destination)
    try {
      await rm(options.partialPath)
    } catch (err) {
      options.log?.error(
        { event: 'db.backup.partial_cleanup_failed', err, databaseRole: options.databaseRole },
        `${options.databaseRole} backup partial cleanup failed`
      )
    }
    return { ...verified, path: options.destination }
  } catch (err) {
    options.log?.error(
      { event: 'db.backup.publish.failed', err, databaseRole: options.databaseRole },
      `${options.databaseRole} backup publication failed`
    )
    throw new Error(`${options.databaseRole} backup publication failed`, { cause: err })
  }
}

export async function cleanupMigrationBackups(
  directory: string,
  options: { keep: number; log?: Pick<Logger, 'info' | 'error'> }
): Promise<void> {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    const backups = [] as { name: string; mtimeMs: number }[]
    for (const entry of entries) {
      if (
        !entry.isFile() ||
        !entry.name.startsWith('migration-') ||
        !entry.name.endsWith('.sqlite')
      ) {
        continue
      }
      const entryStat = await stat(join(directory, entry.name))
      backups.push({ name: entry.name, mtimeMs: entryStat.mtimeMs })
    }
    backups.sort((left, right) => right.mtimeMs - left.mtimeMs)
    for (const backup of backups.slice(Math.max(0, options.keep))) {
      await rm(join(directory, backup.name), { force: true })
    }
    options.log?.info(
      {
        event: 'db.backup.retention.completed',
        retainedCount: Math.min(options.keep, backups.length)
      },
      'Migration backup retention completed'
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    options.log?.error(
      { event: 'db.backup.retention.failed', err },
      'Migration backup retention failed'
    )
    throw new Error('Migration backup retention failed', { cause: err })
  }
}

export async function copyVerifiedFile(options: {
  source: string
  destination: string
  expectedSha256?: string
  expectedSize?: number
  copy?: (source: string, destination: string) => Promise<unknown>
}): Promise<{ sha256: string; size: number }> {
  const sourceStat = await lstat(options.source)
  if (!sourceStat.isFile()) throw new Error('Snapshot source must be a regular file')
  await mkdir(dirname(options.destination), { recursive: true })
  await (options.copy ?? copyFile)(options.source, options.destination)
  const digest = await sha256File(options.destination)
  if (
    (options.expectedSha256 !== undefined && digest.sha256 !== options.expectedSha256) ||
    (options.expectedSize !== undefined && digest.size !== options.expectedSize)
  ) {
    throw new Error('Copied snapshot file does not match its inventory record')
  }
  const sourceDigest = await sha256File(options.source)
  if (sourceDigest.sha256 !== digest.sha256 || sourceDigest.size !== digest.size) {
    throw new Error('Snapshot source changed while it was being copied')
  }
  await syncFile(options.destination)
  return digest
}
