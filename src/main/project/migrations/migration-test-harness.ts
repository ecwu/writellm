import { dirname, join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { openProjectDatabase } from '../project-database'
import {
  createDatabase,
  createService,
  FakeAgentRuntime,
  log
} from '../../agent/session-service.test-support'

export const migrationTestManifest = {
  format: 'writellm-project' as const,
  formatVersion: 1 as const,
  projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
  createdAt: '2026-07-21T00:00:00.000Z'
}

export type MigrationRecoveryFixture = {
  fromVersion: number
  teardownSql: string
  conflictingTable: string
  /** Replaces the conflicting-table failure for migrations that only add columns. */
  failureSql?: string
}

const dropImageModelSelection = `ALTER TABLE agent_sessions DROP COLUMN image_model_id;
      ALTER TABLE agent_sessions DROP COLUMN image_source_id;`

export const migrationRecoveryFixtures = {
  messageReplacements: {
    fromVersion: 45,
    teardownSql: `${dropImageModelSelection}
      DROP TABLE agent_attachments;
      DROP VIEW agent_conversation_history;
      DROP TABLE agent_history_references;
      DROP TABLE agent_conversation_forks;
      DROP VIEW agent_effective_events;
      DROP TRIGGER agent_edit_proposal_effect;
      DROP TRIGGER agent_edit_comment_effect;
      DROP TABLE agent_message_replacements;
      DROP TABLE agent_edit_effects;`,
    conflictingTable: 'agent_message_replacements'
  },
  conversationFork: {
    fromVersion: 46,
    teardownSql: `${dropImageModelSelection}
      DROP TABLE agent_attachments;
      DROP VIEW agent_conversation_history;
      DROP TABLE agent_history_references;
      DROP TABLE agent_conversation_forks;`,
    conflictingTable: 'agent_conversation_forks'
  },
  imageAttachments: {
    fromVersion: 47,
    teardownSql: `${dropImageModelSelection}
      DROP TABLE agent_attachments;`,
    conflictingTable: 'agent_attachments'
  },
  imageModelSelection: {
    fromVersion: 48,
    teardownSql: dropImageModelSelection,
    conflictingTable: 'agent_sessions',
    failureSql: 'ALTER TABLE agent_sessions ADD COLUMN image_model_id TEXT;'
  }
} as const satisfies Record<string, MigrationRecoveryFixture>

export async function legacyProject(fixture: MigrationRecoveryFixture, fail = false) {
  const project = await createDatabase()
  createService(project, new FakeAgentRuntime()).createSession('Preserved conversation')
  const root = project.immediate((db) => {
    db.exec(`${fixture.teardownSql}
      DELETE FROM schema_migrations WHERE version >= ${fixture.fromVersion + 1};
      UPDATE schema_manifest SET schema_version = ${fixture.fromVersion};
      PRAGMA user_version = ${fixture.fromVersion};`)
    if (fail) {
      db.exec(fixture.failureSql ?? `CREATE TABLE ${fixture.conflictingTable} (fixture TEXT)`)
    }
    return dirname(dirname(db.name))
  })
  project.close()
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
