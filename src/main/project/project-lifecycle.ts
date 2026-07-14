import { mkdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import type { Logger } from 'pino'
import {
  createProjectManifest,
  writeProjectManifest,
  type ProjectManifest
} from './project-manifest'
import { initializeProjectDatabase } from './project-database'
import { ProjectWriteLock, type ProjectLockOptions } from './project-lock'
import {
  INDEX_DATABASE_RELATIVE_PATH,
  KNOWLEDGE_ORIGINALS_DIRECTORY,
  KNOWLEDGE_PARSED_DIRECTORY,
  MANUSCRIPT_ASSETS_DIRECTORY,
  MANUSCRIPT_EXPORTS_DIRECTORY,
  MANUSCRIPT_SECTIONS_DIRECTORY,
  PROJECT_BACKUPS_DIRECTORY,
  PROJECT_RECOVERY_DIRECTORY,
  PROJECT_TEMP_DIRECTORY,
  resolveProjectPath,
  WRITELLM_INTERNAL_DIRECTORY
} from './project-paths'

const PROJECT_DIRECTORIES = [
  MANUSCRIPT_SECTIONS_DIRECTORY,
  MANUSCRIPT_ASSETS_DIRECTORY,
  MANUSCRIPT_EXPORTS_DIRECTORY,
  `${KNOWLEDGE_ORIGINALS_DIRECTORY}/sha256`,
  KNOWLEDGE_PARSED_DIRECTORY,
  PROJECT_TEMP_DIRECTORY,
  PROJECT_BACKUPS_DIRECTORY,
  PROJECT_RECOVERY_DIRECTORY
] as const

// This marks the file's role without creating any search schema. The index worker owns that schema.
export const INDEX_DATABASE_APPLICATION_ID = 0x574c4958

export interface CreatedProject {
  projectRoot: string
  manifest: ProjectManifest
  writeLock: ProjectWriteLock
  manuscriptId: string
  manuscriptBriefId: string
  initialSectionId: string
}

export interface CreateProjectOptions {
  destination: string
  forbiddenApplicationDirectories: readonly string[]
  applicationVersion: string
  log: Logger
  initialTitle?: string
  lockOptions?: Omit<ProjectLockOptions, 'logger'>
  /** Test seam for manifest publication failures. */
  publishManifest?: (projectRoot: string, manifest: ProjectManifest) => Promise<void>
}

export type ProjectCreateFailureDisposition = 'clean' | 'recovery-required'

export class ProjectCreateError extends Error {
  readonly disposition: ProjectCreateFailureDisposition

  constructor(cause: unknown, disposition: ProjectCreateFailureDisposition) {
    super('Failed to create project', { cause })
    this.name = 'ProjectCreateError'
    this.disposition = disposition
  }
}

function isContainedBy(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate)
  return (
    fromParent === '' ||
    (fromParent !== '..' && !fromParent.startsWith(`..${sep}`) && !isAbsolute(fromParent))
  )
}

async function validateDestination(
  destination: string,
  forbiddenApplicationDirectories: readonly string[]
): Promise<string> {
  const resolvedDestination = resolve(destination)
  const destinationParent = await realpath(dirname(resolvedDestination))
  const canonicalDestination = resolve(destinationParent, basename(resolvedDestination))

  for (const forbiddenDirectory of forbiddenApplicationDirectories) {
    const canonicalForbidden = await realpath(forbiddenDirectory)
    if (isContainedBy(canonicalForbidden, canonicalDestination)) {
      throw new Error('Project destination is inside a forbidden application directory')
    }
  }

  try {
    await stat(canonicalDestination)
    throw new Error('Project destination already exists')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  return canonicalDestination
}

function initializeIndexDatabase(projectRoot: string): void {
  const database = new Database(resolveProjectPath(projectRoot, INDEX_DATABASE_RELATIVE_PATH))
  try {
    database.pragma('journal_mode = WAL')
    database.pragma('synchronous = NORMAL')
    database.pragma('foreign_keys = ON')
    database.pragma('busy_timeout = 5000')
    database.pragma(`application_id = ${INDEX_DATABASE_APPLICATION_ID}`)
  } finally {
    database.close()
  }
}

async function readInitialRecords(options: {
  projectDatabase: Awaited<ReturnType<typeof initializeProjectDatabase>>
  initialTitle?: string
}): Promise<{ manuscriptId: string; manuscriptBriefId: string; initialSectionId: string }> {
  const manuscript = await options.projectDatabase.kysely
    .selectFrom('manuscripts')
    .select('manuscript_id')
    .where('is_primary', '=', 1)
    .executeTakeFirstOrThrow()
  const brief = await options.projectDatabase.kysely
    .selectFrom('manuscript_briefs')
    .select('manuscript_brief_id')
    .where('manuscript_id', '=', manuscript.manuscript_id)
    .executeTakeFirstOrThrow()
  const section = await options.projectDatabase.kysely
    .selectFrom('sections')
    .select('section_id')
    .where('manuscript_id', '=', manuscript.manuscript_id)
    .where('position', '=', 0)
    .executeTakeFirstOrThrow()

  if (options.initialTitle !== undefined) {
    await options.projectDatabase.kysely
      .updateTable('manuscript_briefs')
      .set({ title: options.initialTitle, updated_at: new Date().toISOString() })
      .where('manuscript_brief_id', '=', brief.manuscript_brief_id)
      .execute()
  }

  return {
    manuscriptId: manuscript.manuscript_id,
    manuscriptBriefId: brief.manuscript_brief_id,
    initialSectionId: section.section_id
  }
}

export async function createProject(options: CreateProjectOptions): Promise<CreatedProject> {
  const startedAt = Date.now()
  let destination: string | undefined
  let destinationCreated = false
  let projectDatabase: Awaited<ReturnType<typeof initializeProjectDatabase>> | undefined
  let writeLock: ProjectWriteLock | undefined
  let projectId: string | undefined

  options.log.info({ event: 'project.create.started' }, 'Creating project')
  try {
    destination = await validateDestination(
      options.destination,
      options.forbiddenApplicationDirectories
    )
    await mkdir(destination, { mode: 0o700 })
    destinationCreated = true
    await Promise.all(
      PROJECT_DIRECTORIES.map((relativeDirectory) =>
        mkdir(resolveProjectPath(destination as string, relativeDirectory), {
          recursive: true
        })
      )
    )
    // Ensure the internal root exists even if the directory constants change later.
    await mkdir(resolveProjectPath(destination, WRITELLM_INTERNAL_DIRECTORY), {
      recursive: true
    })
    writeLock = await ProjectWriteLock.acquire(destination, {
      ...options.lockOptions,
      logger: options.log
    })

    const manifest = createProjectManifest()
    projectId = manifest.projectId

    projectDatabase = await initializeProjectDatabase({
      projectRoot: destination,
      manifest,
      applicationVersion: options.applicationVersion,
      log: options.log
    })
    const { manuscriptId, manuscriptBriefId, initialSectionId } = await readInitialRecords({
      projectDatabase,
      initialTitle: options.initialTitle
    })
    initializeIndexDatabase(destination)
    projectDatabase.close()
    projectDatabase = undefined

    await (options.publishManifest ?? writeProjectManifest)(destination, manifest)

    options.log.info(
      {
        event: 'project.create.completed',
        projectId,
        durationMs: Date.now() - startedAt
      },
      'Project created'
    )
    return {
      projectRoot: destination,
      manifest,
      writeLock,
      manuscriptId,
      manuscriptBriefId,
      initialSectionId
    }
  } catch (err) {
    options.log.error(
      { event: 'project.create.failed', err, projectId, durationMs: Date.now() - startedAt },
      'Failed to create project'
    )
    let cleanupComplete = true
    try {
      projectDatabase?.close()
    } catch (closeErr) {
      cleanupComplete = false
      options.log.error(
        { event: 'project.create.database_close_failed', err: closeErr, projectId },
        'Failed to close project database after create failure'
      )
    }

    if (writeLock !== undefined) {
      try {
        await writeLock.release()
        writeLock = undefined
      } catch (cleanupErr) {
        cleanupComplete = false
        options.log.error(
          { event: 'project.create.lock_cleanup_failed', err: cleanupErr, projectId },
          'Failed to release project lock after create failure'
        )
      }
    }
    if (destination !== undefined && destinationCreated && cleanupComplete) {
      try {
        await rm(destination, { recursive: true })
        destinationCreated = false
      } catch (cleanupErr) {
        cleanupComplete = false
        options.log.error(
          { event: 'project.create.destination_cleanup_failed', err: cleanupErr, projectId },
          'Failed to clean unpublished project directory'
        )
      }
    }
    throw new ProjectCreateError(err, cleanupComplete ? 'clean' : 'recovery-required')
  }
}
