import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { cleanupMigrationBackups, createVerifiedDatabaseBackup } from '../db/backup'
import { readMigrationState, validateMigrationState } from '../db/migrations'
import type { OpenedDatabase } from '../db/open-database'
import { openDatabase } from '../db/open-database'
import type { AppDatabaseSchema } from './database-types'
import { appMigrations } from './migrations'

export const APP_DATABASE_APPLICATION_ID = 0x574c4150
export const APP_SCHEMA_VERSION = appMigrations.at(-1)?.version ?? 0

export type AppDatabase = OpenedDatabase<AppDatabaseSchema>

export async function openAppDatabase(
  options: Omit<
    Parameters<typeof openDatabase<AppDatabaseSchema>>[0],
    'applicationId' | 'databaseRole' | 'migrations' | 'beforeMigrate'
  >
): Promise<AppDatabase> {
  return openDatabase<AppDatabaseSchema>({
    ...options,
    applicationId: APP_DATABASE_APPLICATION_ID,
    databaseRole: 'app',
    migrations: appMigrations,
    beforeMigrate: async (nativeDatabase) => {
      const state = readMigrationState(nativeDatabase)
      const destination = join(
        dirname(options.path),
        'backups',
        `migration-v${state.schemaVersion}-to-v${appMigrations.at(-1)?.version ?? 0}-${randomUUID()}.sqlite`
      )
      await createVerifiedDatabaseBackup({
        source: nativeDatabase,
        destination,
        databaseRole: 'app',
        applicationId: APP_DATABASE_APPLICATION_ID,
        log: options.log,
        validate: (backup) =>
          validateMigrationState(backup, { databaseRole: 'app', migrations: appMigrations })
      })
    }
  }).then(async (database) => {
    try {
      await cleanupMigrationBackups(join(dirname(options.path), 'backups'), {
        keep: 3,
        log: options.log
      })
      return database
    } catch (err) {
      database.close()
      throw err
    }
  })
}
