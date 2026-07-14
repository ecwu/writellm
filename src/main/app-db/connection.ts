import type { OpenedDatabase } from '../db/open-database'
import { openDatabase } from '../db/open-database'
import type { AppDatabaseSchema } from './database-types'
import { appMigrations } from './migrations'

export const APP_DATABASE_APPLICATION_ID = 0x574c4150
export const APP_SCHEMA_VERSION = appMigrations.at(-1)?.version ?? 0

export type AppDatabase = OpenedDatabase<AppDatabaseSchema>

export function openAppDatabase(
  options: Omit<
    Parameters<typeof openDatabase<AppDatabaseSchema>>[0],
    'applicationId' | 'databaseRole' | 'migrations'
  >
): Promise<AppDatabase> {
  return openDatabase<AppDatabaseSchema>({
    ...options,
    applicationId: APP_DATABASE_APPLICATION_ID,
    databaseRole: 'app',
    migrations: appMigrations
  })
}
