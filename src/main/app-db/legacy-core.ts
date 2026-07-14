import { access, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from 'pino'

const LEGACY_CORE_DATABASE_FILES = ['core.sqlite', 'core.sqlite-wal', 'core.sqlite-shm'] as const

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
}

export async function quarantineLegacyCoreDatabase(
  userDataPath: string,
  log: Logger
): Promise<void> {
  const legacyPath = join(userDataPath, LEGACY_CORE_DATABASE_FILES[0])
  try {
    if (!(await exists(legacyPath))) return

    log.warn(
      { event: 'db.legacy_core.quarantine_started', databaseRole: 'legacy-core' },
      'Quarantining legacy development core database'
    )
    for (const fileName of LEGACY_CORE_DATABASE_FILES) {
      const source = join(userDataPath, fileName)
      if (await exists(source)) await rename(source, `${source}.development-reset`)
    }
    log.warn(
      { event: 'db.legacy_core.quarantine_completed', databaseRole: 'legacy-core' },
      'Legacy development core database quarantined'
    )
  } catch (err) {
    log.error(
      { event: 'db.legacy_core.quarantine_failed', err, databaseRole: 'legacy-core' },
      'Failed to quarantine legacy development core database'
    )
    throw new Error('Failed to quarantine legacy development core database', { cause: err })
  }
}
