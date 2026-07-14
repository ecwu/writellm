import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import type { Logger } from 'pino'
import { migrateDatabase, type DatabaseMigration } from './migrations'

export interface OpenDatabaseOptions {
  path: string
  applicationId: number
  applicationVersion: string
  databaseRole: 'app' | 'project'
  migrations: readonly DatabaseMigration[]
  log: Logger
  validate?: (database: Database.Database) => void
}

export interface OpenedDatabase<Schema> {
  readonly kysely: Kysely<Schema>
  close(): void
}

function checkIntegrity(
  database: Database.Database,
  databaseRole: 'app' | 'project',
  log: Logger
): void {
  const startedAt = Date.now()
  try {
    const quickCheck = database.pragma('quick_check') as { quick_check: string }[]
    const foreignKeyErrors = database.pragma('foreign_key_check') as unknown[]
    if (
      quickCheck.length !== 1 ||
      quickCheck[0]?.quick_check !== 'ok' ||
      foreignKeyErrors.length > 0
    ) {
      throw new Error(`${databaseRole} database integrity check failed`)
    }
    log.info(
      {
        event: 'db.integrity.completed',
        databaseRole,
        durationMs: Date.now() - startedAt,
        foreignKeyErrorCount: foreignKeyErrors.length
      },
      `${databaseRole} database integrity check completed`
    )
  } catch (err) {
    log.error(
      { event: 'db.integrity.failed', err, databaseRole },
      `${databaseRole} database integrity check failed`
    )
    throw new Error(`${databaseRole} database integrity check failed`, { cause: err })
  }
}

export async function openDatabase<Schema>(
  options: OpenDatabaseOptions
): Promise<OpenedDatabase<Schema>> {
  const startedAt = Date.now()
  let nativeDatabase: Database.Database | undefined
  options.log.info(
    { event: 'db.open.started', databaseRole: options.databaseRole },
    `Opening ${options.databaseRole} database`
  )

  try {
    await mkdir(dirname(options.path), { recursive: true })
    nativeDatabase = new Database(options.path, { timeout: 5_000 })
    nativeDatabase.pragma('journal_mode = WAL')
    nativeDatabase.pragma('synchronous = FULL')
    nativeDatabase.pragma('foreign_keys = ON')
    nativeDatabase.pragma('busy_timeout = 5000')

    const applicationId = nativeDatabase.pragma('application_id', { simple: true }) as number
    if (applicationId !== 0 && applicationId !== options.applicationId) {
      throw new Error('Database file belongs to a different application role')
    }
    if (applicationId === 0) nativeDatabase.pragma(`application_id = ${options.applicationId}`)

    const schemaVersion = migrateDatabase(nativeDatabase, options)
    checkIntegrity(nativeDatabase, options.databaseRole, options.log)
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
    if (nativeDatabase?.open) nativeDatabase.close()
    throw new Error(`Failed to open ${options.databaseRole} database`, { cause: err })
  }
}
