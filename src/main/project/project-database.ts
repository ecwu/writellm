import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { Logger } from 'pino'
import { SECTION_CONTENT_SCHEMA_VERSION } from '../../shared/contracts/manuscript'
import { createVerifiedDatabaseBackup, cleanupMigrationBackups } from '../db/backup'
import type { OpenedDatabase } from '../db/open-database'
import { openDatabase } from '../db/open-database'
import { hasPendingMigrations, readMigrationState, validateMigrationState } from '../db/migrations'
import type { ProjectDatabaseSchema } from './database-types'
import { projectMigrations } from './migrations'
import type { ProjectManifest } from './project-manifest'
import {
  assertJobPersistenceBoundary,
  assertNoPersistedMineruCapabilities
} from './mineru-persistence-invariant'
import { PROJECT_BACKUPS_DIRECTORY, PROJECT_DATABASE_RELATIVE_PATH } from './project-paths'
import { ProjectFilesystem } from './project-filesystem'

export const PROJECT_DATABASE_APPLICATION_ID = 0x574c5052
export const PROJECT_SCHEMA_VERSION = projectMigrations.at(-1)?.version ?? 0

export type ProjectDatabase = OpenedDatabase<ProjectDatabaseSchema>

function validateProjectIdentity(database: Database.Database, manifest: ProjectManifest): void {
  const applicationId = database.pragma('application_id', { simple: true }) as number
  if (applicationId !== PROJECT_DATABASE_APPLICATION_ID) {
    throw new Error('Project database application identity is invalid')
  }
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
  filesystem?: ProjectFilesystem
  manifest: ProjectManifest
  applicationVersion: string
  log: Logger
  initialTitle?: string
}): Promise<ProjectDatabase> {
  const filesystem = options.filesystem ?? new ProjectFilesystem(options.projectRoot, options.log)
  await filesystem.ensureDirectory('.writellm')
  const createdDatabase = await filesystem.createExclusiveFile(PROJECT_DATABASE_RELATIVE_PATH)
  await createdDatabase.handle.close()
  const databasePath = createdDatabase.path
  const database = await openDatabase<ProjectDatabaseSchema>({
    path: databasePath,
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
    const sectionRevisionId = randomUUID()

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
          outline_version: 1,
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
          schema_version: 1,
          title: options.initialTitle ?? 'Untitled Manuscript',
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
          current_revision_id: sectionRevisionId,
          deleted_at: null,
          created_at: now,
          updated_at: now
        })
        .execute()
      await transaction
        .insertInto('section_revisions')
        .values({
          section_revision_id: sectionRevisionId,
          section_id: sectionId,
          revision_number: 1,
          source: 'bootstrap',
          source_class: 'manual_checkpoint',
          content_json: '[]',
          content_schema_version: SECTION_CONTENT_SCHEMA_VERSION,
          content_hash: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
          prior_revision_id: null,
          word_count: 0,
          character_count: 0,
          count_algorithm_version: 2,
          agent_run_id: null,
          agent_tool_call_id: null,
          agent_proposal_id: null,
          created_at: now
        })
        .execute()
    })
    options.log.info(
      {
        event: 'project.database_bootstrap.completed',
        projectId: options.manifest.projectId,
        manuscriptId,
        sectionId,
        sectionRevisionId
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

export async function openProjectDatabase(options: {
  projectRoot: string
  filesystem?: ProjectFilesystem
  manifest: ProjectManifest
  applicationVersion: string
  log: Logger
}): Promise<ProjectDatabase> {
  const filesystem = options.filesystem ?? new ProjectFilesystem(options.projectRoot, options.log)
  const databasePath = await filesystem.assertExistingRegularFile(PROJECT_DATABASE_RELATIVE_PATH)
  try {
    const database = await openDatabase<ProjectDatabaseSchema>({
      path: databasePath,
      applicationId: PROJECT_DATABASE_APPLICATION_ID,
      applicationVersion: options.applicationVersion,
      databaseRole: 'project',
      migrations: projectMigrations,
      log: options.log,
      preflight: (database) => {
        validateProjectIdentity(database, options.manifest)
      },
      beforeMigrate: async (nativeDatabase) => {
        if (!hasPendingMigrations(nativeDatabase, projectMigrations)) return
        const state = readMigrationState(nativeDatabase)
        const destinationRelativePath = `${PROJECT_BACKUPS_DIRECTORY}/migration-v${state.schemaVersion}-to-v${PROJECT_SCHEMA_VERSION}-${randomUUID()}.sqlite`
        await filesystem.ensureDirectory(PROJECT_BACKUPS_DIRECTORY)
        const destination = await filesystem.resolveForCreation(destinationRelativePath)
        await createVerifiedDatabaseBackup({
          source: nativeDatabase,
          destination,
          databaseRole: 'project',
          applicationId: PROJECT_DATABASE_APPLICATION_ID,
          log: options.log,
          validate: (backup) => {
            validateMigrationState(backup, {
              databaseRole: 'project',
              migrations: projectMigrations
            })
            validateProjectIdentity(backup, options.manifest)
          }
        })
      },
      validate: (database) => {
        validateMigrationState(database, { databaseRole: 'project', migrations: projectMigrations })
        validateProjectIdentity(database, options.manifest)
        assertNoPersistedMineruCapabilities(database)
        assertJobPersistenceBoundary(database)
      }
    })
    try {
      await cleanupMigrationBackups(await filesystem.ensureDirectory(PROJECT_BACKUPS_DIRECTORY), {
        keep: 3,
        log: options.log
      })
    } catch (err) {
      database.close()
      throw err
    }
    return database
  } catch (err) {
    options.log.error(
      {
        event: 'project.database.open_with_backup.failed',
        err,
        projectId: options.manifest.projectId
      },
      'Failed to open project database with migration backup'
    )
    throw new Error('Failed to open project database with migration backup', { cause: err })
  }
}
