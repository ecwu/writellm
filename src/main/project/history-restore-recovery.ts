import { access, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import { PROJECT_HISTORY_RELATIVE_PATH, resolveProjectPath } from './project-paths'

export const historyRestoreJournalSchema = z
  .object({
    format: z.literal('writellm-history-restore'),
    formatVersion: z.literal(1),
    projectId: z.uuid(),
    projectRootName: z.string().min(1).max(255),
    token: z.uuid(),
    phase: z.enum([
      'prepared',
      'original-moved',
      'candidate-installed',
      'history-moved',
      'committed'
    ]),
    targetOid: z.string().regex(/^[a-f0-9]{40}$/)
  })
  .strict()

export type HistoryRestoreJournal = z.infer<typeof historyRestoreJournalSchema>

export function historyRestorePaths(parent: string, journal: HistoryRestoreJournal) {
  const prefix = `.${journal.projectRootName}.${journal.token}`
  return {
    projectRoot: join(parent, journal.projectRootName),
    materialized: join(parent, `${prefix}.git-restore`),
    candidate: join(parent, `${prefix}.candidate`),
    rollback: join(parent, `${prefix}.rollback`),
    failed: join(parent, `${prefix}.failed`),
    journal: join(parent, `.writellm-restore-${journal.projectId}.json`)
  }
}

async function pathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return false
      throw err
    }
  )
}

export async function recoverIncompleteHistoryRestore(
  selectedRoot: string,
  log: Pick<Logger, 'info' | 'error'>
): Promise<void> {
  const resolvedRoot = resolve(selectedRoot)
  const parent = dirname(resolvedRoot)
  const rootName = basename(resolvedRoot)
  let candidates: string[]
  try {
    candidates = (await readdir(parent)).filter(
      (name) => name.startsWith('.writellm-restore-') && name.endsWith('.json')
    )
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  const matching: Array<{ journal: HistoryRestoreJournal; path: string }> = []
  for (const name of candidates) {
    const path = join(parent, name)
    try {
      const journal = historyRestoreJournalSchema.parse(JSON.parse(await readFile(path, 'utf8')))
      if (journal.projectRootName === rootName) matching.push({ journal, path })
    } catch (err) {
      log.error(
        { event: 'project_history.restore_journal_invalid', err },
        'Invalid project history restore journal'
      )
    }
  }
  if (matching.length === 0) return
  if (matching.length > 1) throw new Error('Multiple project history restore journals were found')
  const record = matching[0]
  if (record === undefined) return
  const paths = historyRestorePaths(parent, record.journal)
  try {
    const rollbackExists = await pathExists(paths.rollback)
    if (record.journal.phase === 'committed') {
      if (!(await pathExists(paths.projectRoot))) {
        throw new Error('Committed history restore is missing the project root')
      }
      await rm(paths.rollback, { recursive: true, force: true })
    } else if (rollbackExists) {
      if (await pathExists(paths.projectRoot)) {
        await rename(paths.projectRoot, paths.failed)
        const failedHistory = resolveProjectPath(paths.failed, PROJECT_HISTORY_RELATIVE_PATH)
        const rollbackHistory = resolveProjectPath(paths.rollback, PROJECT_HISTORY_RELATIVE_PATH)
        const failedHistoryExists = await pathExists(failedHistory)
        const rollbackHistoryExists = await pathExists(rollbackHistory)
        if (failedHistoryExists && rollbackHistoryExists) {
          throw new Error('History restore recovery found two repository copies')
        }
        if (failedHistoryExists) {
          await rename(failedHistory, rollbackHistory)
        }
      }
      await rename(paths.rollback, paths.projectRoot)
      await rm(paths.failed, { recursive: true, force: true })
    } else if (!(await pathExists(paths.projectRoot))) {
      throw new Error('History restore journal cannot recover the missing project')
    }
    await rm(paths.candidate, { recursive: true, force: true })
    await rm(paths.materialized, { recursive: true, force: true })
    await rm(record.path, { force: true })
    log.info(
      {
        event: 'project_history.restore_journal_recovered',
        projectId: record.journal.projectId,
        phase: record.journal.phase
      },
      'Recovered an interrupted project history restore'
    )
  } catch (err) {
    log.error(
      {
        event: 'project_history.restore_journal_recovery_failed',
        err,
        projectId: record.journal.projectId,
        phase: record.journal.phase
      },
      'Interrupted project history restore recovery failed'
    )
    throw new Error('Failed to recover an interrupted project history restore', { cause: err })
  }
}
