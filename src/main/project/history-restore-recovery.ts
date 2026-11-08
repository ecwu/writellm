import { access, lstat, readFile, readdir, rename, rm } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { Logger } from 'pino'
import { z } from 'zod'
import { ProjectFilesystem } from './project-filesystem'
import {
  ProjectLockContendedError,
  ProjectWriteLock,
  type ProjectLockOptions
} from './project-lock'
import { readProjectManifest } from './project-manifest'
import {
  PROJECT_HISTORY_IGNORE_RELATIVE_PATH,
  PROJECT_HISTORY_RELATIVE_PATH,
  PROJECT_MANIFEST_FILE,
  resolveProjectPath,
  WRITELLM_INTERNAL_DIRECTORY
} from './project-paths'

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

export function historyRestorePaths(
  parent: string,
  journal: Pick<HistoryRestoreJournal, 'projectRootName' | 'projectId' | 'token'>
) {
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

async function restoreProjectExists(root: string, projectId: string): Promise<boolean> {
  const stats = await lstat(root).catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  if (stats === null) return false
  if (!stats.isDirectory()) throw new Error('History restore path is not a project directory')
  const filesystem = new ProjectFilesystem(root)
  await filesystem.assertExistingRegularFile(PROJECT_MANIFEST_FILE)
  await filesystem.assertExistingDirectory(WRITELLM_INTERNAL_DIRECTORY)
  const manifest = await readProjectManifest(root)
  if (manifest.projectId !== projectId) {
    throw new Error('History restore journal does not own this project directory')
  }
  return true
}

export async function recoverIncompleteHistoryRestore(
  selectedRoot: string,
  log: Pick<Logger, 'info' | 'warn' | 'error'>,
  lockOptions: Omit<ProjectLockOptions, 'logger'> = {},
  heldLocks: readonly ProjectWriteLock[] = []
): Promise<boolean> {
  const resolvedRoot = resolve(selectedRoot)
  const parent = dirname(resolvedRoot)
  const rootName = basename(resolvedRoot)
  let candidates: string[]
  try {
    candidates = (await readdir(parent, { withFileTypes: true }))
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith('.writellm-restore-') &&
          entry.name.endsWith('.json')
      )
      .map((entry) => entry.name)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw err
  }
  const matching: Array<{ journal: HistoryRestoreJournal; path: string; text: string }> = []
  for (const name of candidates) {
    const path = join(parent, name)
    try {
      const text = await readFile(path, 'utf8')
      const journal = historyRestoreJournalSchema.parse(JSON.parse(text))
      if (journal.projectRootName === rootName) matching.push({ journal, path, text })
    } catch (err) {
      log.error(
        { event: 'project_history.restore_journal_invalid', err },
        'Invalid project history restore journal'
      )
    }
  }
  if (matching.length > 1) throw new Error('Multiple project history restore journals were found')
  const record = matching[0]
  if (record === undefined) return false
  const { projectId, phase } = record.journal
  const paths = historyRestorePaths(parent, record.journal)
  const locks: ProjectWriteLock[] = []
  const acquire = async (root: string): Promise<ProjectWriteLock> => {
    const held = heldLocks.find((lock) => lock.projectRoot === root)
    if (held !== undefined) return held
    const lock = await ProjectWriteLock.acquire(root, { ...lockOptions, logger: log })
    locks.push(lock)
    return lock
  }
  try {
    if (record.path !== paths.journal) {
      throw new Error('History restore journal does not match its filename')
    }
    const projectExists = await restoreProjectExists(paths.projectRoot, projectId)
    const projectLock = projectExists ? await acquire(paths.projectRoot) : null
    const rollbackLock =
      phase !== 'committed' && (await restoreProjectExists(paths.rollback, projectId))
        ? await acquire(paths.rollback)
        : null
    const failedLock =
      rollbackLock !== null && (await restoreProjectExists(paths.failed, projectId))
        ? await acquire(paths.failed)
        : null
    // Lock acquisition can overlap another replay. Recheck the journal and any absent root.
    if (
      (await readFile(record.path, 'utf8')) !== record.text ||
      (projectLock === null && (await pathExists(paths.projectRoot)))
    ) {
      throw new Error('History restore changed before recovery acquired its locks')
    }
    if (phase === 'committed') {
      if (projectLock === null) {
        throw new Error('Committed history restore is missing the project root')
      }
      await heldLocks.find((lock) => lock.projectRoot === paths.rollback)?.release()
      await rm(paths.rollback, { recursive: true, force: true })
    } else if (rollbackLock !== null) {
      if (projectLock !== null) {
        if (failedLock !== null) {
          throw new Error('History restore recovery found two candidate directories')
        }
        await projectLock.moveProjectRoot(paths.failed)
      }
      for (const entry of [PROJECT_HISTORY_RELATIVE_PATH, PROJECT_HISTORY_IGNORE_RELATIVE_PATH]) {
        const from = resolveProjectPath(paths.failed, entry)
        if (await pathExists(from)) {
          const to = resolveProjectPath(paths.rollback, entry)
          if (await pathExists(to))
            throw new Error('History restore recovery found two history copies')
          await rename(from, to)
        }
      }
      await rollbackLock.moveProjectRoot(paths.projectRoot)
      await (projectLock ?? failedLock)?.release()
    } else if (projectLock === null) {
      throw new Error('History restore journal cannot recover the missing project')
    }
    await heldLocks.find((lock) => lock.projectRoot === paths.candidate)?.release()
    await rm(paths.candidate, { recursive: true, force: true })
    await rm(paths.failed, { recursive: true, force: true })
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
    return true
  } catch (err) {
    if (err instanceof ProjectLockContendedError) throw err
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
  } finally {
    for (const lock of locks.reverse()) {
      try {
        await lock.release()
      } catch (err) {
        log.error(
          { event: 'project_history.restore_lock_release_failed', err, projectId },
          'Failed to release a checkpoint recovery lock'
        )
      }
    }
  }
}
