import { access, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import type { Logger } from 'pino'
import { assertDatabaseIntegrity } from './integrity'
import { hasPendingMigrations, migrateDatabase, type DatabaseMigration } from './migrations'

export interface OpenDatabaseOptions {
  path: string
  applicationId: number
  applicationVersion: string
  databaseRole: 'app' | 'project'
  migrations: readonly DatabaseMigration[]
  log: Logger
  validate?: (database: Database.Database) => void
  beforeMigrate?: (database: Database.Database) => void | Promise<void>
}

export interface OpenedDatabase<Schema> {
  readonly kysely: Kysely<Schema>
  backup(
    destinationFile: string,
    options?: Database.BackupOptions
  ): Promise<Database.BackupMetadata>
  close(): void
}

export async function openDatabase<Schema>(
  options: OpenDatabaseOptions
): Promise<OpenedDatabase<Schema>> {
  const startedAt = Date.now()
  let nativeDatabase: Database.Database | undefined
  let inspectionDatabase: Database.Database | undefined
  options.log.info(
    { event: 'db.open.started', databaseRole: options.databaseRole },
    `Opening ${options.databaseRole} database`
  )

  try {
    await mkdir(dirname(options.path), { recursive: true })
    const existed = await access(options.path).then(
      () => true,
      (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return false
        throw err
      }
    )
    if (existed) {
      inspectionDatabase = new Database(options.path, { readonly: true, fileMustExist: true })
      inspectionDatabase.pragma('busy_timeout = 5000')
      const inspectionApplicationId = inspectionDatabase.pragma('application_id', {
        simple: true
      }) as number
      if (inspectionApplicationId !== 0 && inspectionApplicationId !== options.applicationId) {
        throw new Error('Database file belongs to a different application role')
      }
      if (hasPendingMigrations(inspectionDatabase, options.migrations)) {
        await options.beforeMigrate?.(inspectionDatabase)
      }
      inspectionDatabase.close()
      inspectionDatabase = undefined
    }

    nativeDatabase = new Database(options.path, { timeout: 5_000 })
    nativeDatabase.pragma('busy_timeout = 5000')
    const applicationId = nativeDatabase.pragma('application_id', { simple: true }) as number
    if (applicationId !== 0 && applicationId !== options.applicationId) {
      throw new Error('Database file belongs to a different application role')
    }
    nativeDatabase.pragma('journal_mode = WAL')
    nativeDatabase.pragma('synchronous = FULL')
    nativeDatabase.pragma('foreign_keys = ON')
    if (applicationId === 0) nativeDatabase.pragma(`application_id = ${options.applicationId}`)
    const schemaVersion = migrateDatabase(nativeDatabase, options)
    assertDatabaseIntegrity(nativeDatabase, options.databaseRole, 'quick', options.log)
    options.validate?.(nativeDatabase)
    const kysely = new Kysely<Schema>({
      dialect: new SqliteDialect({ database: nativeDatabase })
    })
    options.log.info(
      {
        event: 'db.open.completed',
        databaseRole: options.databaseRole,
        schemaVersion,
        durationMs: Date.now() - startedAt
      },
      `${options.databaseRole} database opened`
    )

    let closed = false
    return {
      kysely,
      backup(destinationFile, backupOptions) {
        return (
          nativeDatabase?.backup(destinationFile, backupOptions) ??
          Promise.reject(new Error('Database closed'))
        )
      },
      close() {
        if (closed) return
        try {
          nativeDatabase?.close()
          closed = true
          options.log.info(
            { event: 'db.close.completed', databaseRole: options.databaseRole },
            `${options.databaseRole} database closed`
          )
        } catch (err) {
          options.log.error(
            { event: 'db.close.failed', err, databaseRole: options.databaseRole },
            `Failed to close ${options.databaseRole} database`
          )
          throw new Error(`Failed to close ${options.databaseRole} database`, { cause: err })
        }
      }
    }
  } catch (err) {
    options.log.error(
      { event: 'db.open.failed', err, databaseRole: options.databaseRole },
      `Failed to open ${options.databaseRole} database`
    )
    if (inspectionDatabase?.open) inspectionDatabase.close()
    if (nativeDatabase?.open) nativeDatabase.close()
    throw new Error(`Failed to open ${options.databaseRole} database`, { cause: err })
  }
}
