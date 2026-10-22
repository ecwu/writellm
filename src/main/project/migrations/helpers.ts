/**
 * Frozen helpers for shipped forward-only migrations. Released migrations import these, so a
 * behavior change here would silently change historical migrations. Add a new helper instead of
 * editing an existing one; `helpers.test.ts` pins the current behavior.
 */
import type { DatabaseMigration } from '../../db/migrations'

type MigrationDatabase = Parameters<DatabaseMigration['up']>[0]

const SQLITE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Return whether a table already contains a column during a forward migration. */
export function hasColumn(database: MigrationDatabase, table: string, column: string): boolean {
  if (!SQLITE_IDENTIFIER.test(table) || !SQLITE_IDENTIFIER.test(column)) {
    throw new Error('Migration identifiers must be simple SQLite identifiers')
  }

  return (database.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some(
    (entry) => entry.name === column
  )
}
