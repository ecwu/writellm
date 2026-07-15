import type Database from 'better-sqlite3'
import type { Logger } from 'pino'

export type IntegrityCheckLevel = 'quick' | 'full'

interface QuickCheckRow {
  quick_check: string
}

interface IntegrityCheckRow {
  integrity_check: string
}

export function inspectDatabaseIntegrity(
  database: Database.Database,
  level: IntegrityCheckLevel
): { quickCheck: string[]; foreignKeyErrors: unknown[]; integrityErrors: string[] } {
  const quickCheck = (database.pragma('quick_check') as QuickCheckRow[]).map(
    (row) => row.quick_check
  )
  const foreignKeyErrors = database.pragma('foreign_key_check') as unknown[]
  const integrityErrors =
    level === 'full'
      ? (database.pragma('integrity_check') as IntegrityCheckRow[]).map(
          (row) => row.integrity_check
        )
      : []

  return { quickCheck, foreignKeyErrors, integrityErrors }
}

export function assertDatabaseIntegrity(
  database: Database.Database,
  databaseRole: 'app' | 'project' | 'snapshot' | 'backup',
  level: IntegrityCheckLevel,
  log?: Pick<Logger, 'info' | 'error'>
): void {
  const startedAt = Date.now()
  try {
    const result = inspectDatabaseIntegrity(database, level)
    const quickPassed = result.quickCheck.length === 1 && result.quickCheck[0] === 'ok'
    const fullPassed =
      level !== 'full' ||
      (result.integrityErrors.length === 1 && result.integrityErrors[0] === 'ok')
    if (!quickPassed || result.foreignKeyErrors.length > 0 || !fullPassed) {
      throw new Error(`${databaseRole} database integrity check returned errors`)
    }
    log?.info(
      {
        event: 'db.integrity.completed',
        databaseRole,
        level,
        durationMs: Date.now() - startedAt,
        foreignKeyErrorCount: result.foreignKeyErrors.length
      },
      `${databaseRole} database integrity check completed`
    )
  } catch (err) {
    log?.error(
      { event: 'db.integrity.failed', err, databaseRole, level },
      `${databaseRole} database integrity check failed`
    )
    throw new Error(`${databaseRole} database integrity check failed`, { cause: err })
  }
}
