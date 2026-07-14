import type Database from 'better-sqlite3'
import type { Logger } from 'pino'

export interface DatabaseMigration {
  readonly version: number
  readonly name: string
  readonly checksum: string
  up(database: Database.Database): void
}

interface MigrationRow {
  version: number
  name: string
  checksum: string
}

export interface MigrationOptions {
  applicationVersion: string
  databaseRole: 'app' | 'project'
  migrations: readonly DatabaseMigration[]
  log: Logger
}

function initializeMigrationMetadata(
  database: Database.Database,
  applicationVersion: string
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE IF NOT EXISTS schema_manifest (
      id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
      application_version TEXT NOT NULL,
      schema_version INTEGER NOT NULL CHECK (schema_version >= 0),
      updated_at TEXT NOT NULL
    ) STRICT;
  `)

  database
    .prepare(
      `INSERT OR IGNORE INTO schema_manifest
        (id, application_version, schema_version, updated_at)
       VALUES (1, ?, 0, ?)`
    )
    .run(applicationVersion, new Date().toISOString())
}

export function migrateDatabase(database: Database.Database, options: MigrationOptions): number {
  options.migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `${options.databaseRole} migrations must be contiguous from version 1; found ${migration.version}`
      )
    }
  })

  database
    .transaction(() => initializeMigrationMetadata(database, options.applicationVersion))
    .immediate()

  const applied = database
    .prepare('SELECT version, name, checksum FROM schema_migrations ORDER BY version')
    .all() as MigrationRow[]
  const manifestVersion = database
    .prepare('SELECT schema_version FROM schema_manifest WHERE id = 1')
    .pluck()
    .get() as number
  const userVersion = database.pragma('user_version', { simple: true }) as number

  if (manifestVersion !== applied.length || userVersion !== manifestVersion) {
    throw new Error(`${options.databaseRole} database schema version metadata is inconsistent`)
  }
  if (manifestVersion > options.migrations.length) {
    throw new Error(
      `${options.databaseRole} database schema version ${manifestVersion} is newer than supported`
    )
  }

  for (const row of applied) {
    const migration = options.migrations[row.version - 1]
    if (migration?.name !== row.name || migration.checksum !== row.checksum) {
      throw new Error(
        `${options.databaseRole} migration ${row.version} does not match the packaged manifest`
      )
    }
  }

  for (const migration of options.migrations.slice(manifestVersion)) {
    const startedAt = Date.now()
    options.log.info(
      {
        event: 'db.migration.started',
        databaseRole: options.databaseRole,
        migration: migration.name
      },
      `${options.databaseRole} database migration started`
    )
    try {
      database
        .transaction(() => {
          migration.up(database)
          const appliedAt = new Date().toISOString()
          database
            .prepare(
              'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)'
            )
            .run(migration.version, migration.name, migration.checksum, appliedAt)
          database
            .prepare(
              `UPDATE schema_manifest
               SET application_version = ?, schema_version = ?, updated_at = ?
               WHERE id = 1`
            )
            .run(options.applicationVersion, migration.version, appliedAt)
          database.pragma(`user_version = ${migration.version}`)
        })
        .immediate()
    } catch (err) {
      options.log.error(
        {
          event: 'db.migration.failed',
          err,
          databaseRole: options.databaseRole,
          migration: migration.name
        },
        `${options.databaseRole} database migration failed`
      )
      throw new Error(`${options.databaseRole} database migration ${migration.name} failed`, {
        cause: err
      })
    }
    options.log.info(
      {
        event: 'db.migration.completed',
        databaseRole: options.databaseRole,
        migration: migration.name,
        durationMs: Date.now() - startedAt
      },
      `${options.databaseRole} database migration completed`
    )
  }

  database
    .prepare('UPDATE schema_manifest SET application_version = ?, updated_at = ? WHERE id = 1')
    .run(options.applicationVersion, new Date().toISOString())
  return options.migrations.length
}
