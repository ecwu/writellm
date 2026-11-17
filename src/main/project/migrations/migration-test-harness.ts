import { join } from 'node:path'
import { mkdtemp, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { PROJECT_DATABASE_APPLICATION_ID, openProjectDatabase } from '../project-database'
import {
  createService,
  FakeAgentRuntime,
  log,
  temporaryDirectories
} from '../../agent/session-service.test-support'
import { openDatabase } from '../../db/open-database'
import type { ProjectDatabaseSchema } from '../database-types'
import { projectMigrations } from './index'

export const migrationTestManifest = {
  format: 'writellm-project' as const,
  formatVersion: 1 as const,
  projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
  createdAt: '2026-07-21T00:00:00.000Z'
}

export type MigrationRecoveryFixture = {
  fromVersion: number
  failureSql: string
}

export const migrationRecoveryFixtures = {
  messageReplacements: {
    fromVersion: 45,
    failureSql: 'CREATE TABLE agent_message_replacements (fixture TEXT)'
  },
  conversationFork: {
    fromVersion: 46,
    failureSql: 'CREATE TABLE agent_conversation_forks (fixture TEXT)'
  },
  imageAttachments: {
    fromVersion: 47,
    failureSql: 'CREATE TABLE agent_attachments (fixture TEXT)'
  },
  imageModelSelection: {
    fromVersion: 48,
    failureSql: 'ALTER TABLE agent_sessions ADD COLUMN image_model_id TEXT'
  }
} as const satisfies Record<string, MigrationRecoveryFixture>

export async function legacyProject(fixture: MigrationRecoveryFixture, fail = false) {
  const root = await mkdtemp(join(tmpdir(), 'writellm-project-migration-'))
  temporaryDirectories.push(root)
  const project = await openDatabase<ProjectDatabaseSchema>({
    path: join(root, '.writellm', 'project.sqlite'),
    applicationId: PROJECT_DATABASE_APPLICATION_ID,
    applicationVersion: 'test',
    databaseRole: 'project',
    migrations: projectMigrations.filter((migration) => migration.version <= fixture.fromVersion),
    log
  })
  try {
    await project.kysely
      .insertInto('project_meta')
      .values({
        singleton_id: 1,
        project_id: migrationTestManifest.projectId,
        created_at: migrationTestManifest.createdAt,
        updated_at: migrationTestManifest.createdAt
      })
      .execute()
    await project.kysely
      .insertInto('manuscripts')
      .values({
        manuscript_id: '019c6a5c-8d34-7a8e-a602-3d37a52dc422',
        project_id: migrationTestManifest.projectId,
        is_primary: 1,
        outline_version: 1,
        created_at: migrationTestManifest.createdAt,
        updated_at: migrationTestManifest.createdAt
      })
      .execute()
    createService(project, new FakeAgentRuntime()).createSession('Preserved conversation')
    if (fail) project.immediate((db) => db.exec(fixture.failureSql))
  } finally {
    project.close()
  }
  return root
}

export async function listMigrationBackups(root: string): Promise<string[]> {
  const names = await readdir(join(root, '.writellm', 'backups'))
  return names.filter((name) => name.startsWith('migration-') && name.endsWith('.sqlite'))
}

export async function openMigrationDatabase(root: string) {
  return openProjectDatabase({
    projectRoot: root,
    manifest: migrationTestManifest,
    applicationVersion: 'test',
    log
  })
}
