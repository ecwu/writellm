import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import type { OpenedDatabase } from '../db/open-database'
import { openDatabase } from '../db/open-database'
import type { ProjectDatabaseSchema } from './database-types'
import { projectMigrations } from './migrations'
import type { ProjectManifest } from './project-manifest'
import { PROJECT_DATABASE_RELATIVE_PATH, resolveProjectPath } from './project-paths'

export const PROJECT_DATABASE_APPLICATION_ID = 0x574c5052
export const PROJECT_SCHEMA_VERSION = projectMigrations.at(-1)?.version ?? 0

export type ProjectDatabase = OpenedDatabase<ProjectDatabaseSchema>

function validateProjectIdentity(database: Database.Database, manifest: ProjectManifest): void {
  const projectId = database
    .prepare('SELECT project_id FROM project_meta WHERE singleton_id = 1')
    .pluck()
    .get() as string | undefined

  if (projectId === undefined) {
    throw new Error('Project database identity is not initialized')
  }
  if (projectId !== manifest.projectId) {
    throw new Error('Project manifest and database identity do not match')
  }
}

export async function initializeProjectDatabase(options: {
  projectRoot: string
  manifest: ProjectManifest
  applicationVersion: string
  log: Logger
}): Promise<ProjectDatabase> {
  const database = await openDatabase<ProjectDatabaseSchema>({
    path: resolveProjectPath(options.projectRoot, PROJECT_DATABASE_RELATIVE_PATH),
    applicationId: PROJECT_DATABASE_APPLICATION_ID,
    applicationVersion: options.applicationVersion,
    databaseRole: 'project',
    migrations: projectMigrations,
    log: options.log
  })

  try {
    const now = new Date().toISOString()
    const manuscriptId = randomUUID()
    const manuscriptBriefId = randomUUID()
    const sectionId = randomUUID()

    await database.kysely.transaction().execute(async (transaction) => {
      await transaction
        .insertInto('project_meta')
        .values({
          singleton_id: 1,
          project_id: options.manifest.projectId,
          created_at: options.manifest.createdAt,
          updated_at: now
        })
        .execute()
      await transaction
        .insertInto('manuscripts')
        .values({
          manuscript_id: manuscriptId,
          project_id: options.manifest.projectId,
          is_primary: 1,
          created_at: now,
          updated_at: now
        })
        .execute()
      await transaction
        .insertInto('manuscript_briefs')
        .values({
          manuscript_brief_id: manuscriptBriefId,
          manuscript_id: manuscriptId,
          version: 1,
          title: 'Untitled Manuscript',
          description: '',
          topic: '',
          target_audience: '',
          language: '',
          style_tone: '',
          scope_exclusions: '',
          target_length: '',
          citation_requirements: '',
          additional_instructions: '',
          extensible_json: '{}',
          created_at: now,
          updated_at: now
        })
        .execute()
      await transaction
        .insertInto('sections')
        .values({
          section_id: sectionId,
          manuscript_id: manuscriptId,
          parent_section_id: null,
          position: 0,
          level: 1,
          title: 'Untitled Section',
          objective: null,
          status: 'planned',
          current_revision_id: null,
          created_at: now,
          updated_at: now
        })
        .execute()
    })
    options.log.info(
      {
        event: 'project.database_bootstrap.completed',
        projectId: options.manifest.projectId,
        manuscriptId,
        sectionId
      },
      'Initialized project database records'
    )
    return database
  } catch (err) {
    options.log.error(
      {
        event: 'project.database_identity.initialize_failed',
        err,
        projectId: options.manifest.projectId
      },
      'Failed to initialize project database identity'
    )
    database.close()
    throw new Error('Failed to initialize project database identity', { cause: err })
  }
}

export function openProjectDatabase(options: {
  projectRoot: string
  manifest: ProjectManifest
  applicationVersion: string
  log: Logger
}): Promise<ProjectDatabase> {
  return openDatabase<ProjectDatabaseSchema>({
    path: resolveProjectPath(options.projectRoot, PROJECT_DATABASE_RELATIVE_PATH),
    applicationId: PROJECT_DATABASE_APPLICATION_ID,
    applicationVersion: options.applicationVersion,
    databaseRole: 'project',
    migrations: projectMigrations,
    log: options.log,
    validate: (database) => validateProjectIdentity(database, options.manifest)
  })
}
