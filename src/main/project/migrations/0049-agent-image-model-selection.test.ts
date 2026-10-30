import Database from 'better-sqlite3'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createService, FakeAgentRuntime } from '../../agent/session-service.test-support'
import {
  legacyProject,
  listMigrationBackups,
  migrationRecoveryFixtures,
  openMigrationDatabase
} from './migration-test-harness'

describe('migration 0049 Agent image model selection', () => {
  it('creates a verified pre-migration backup and leaves existing conversations on the default', async () => {
    const root = await legacyProject(migrationRecoveryFixtures.imageModelSelection)
    const database = await openMigrationDatabase(root)
    expect(database.immediate((db) => db.pragma('user_version', { simple: true }))).toBe(49)
    expect(database.immediate((db) => db.pragma('integrity_check', { simple: true }))).toBe('ok')
    expect(database.immediate((db) => db.pragma('foreign_key_check'))).toEqual([])
    const [session] = createService(database, new FakeAgentRuntime()).listSessions()
    expect(session.title).toBe('Preserved conversation')
    expect(session.imageModelSelection).toBeNull()
    const names = await listMigrationBackups(root)
    expect(names.length > 0).toBe(true)
    const backup = new Database(join(root, '.writellm', 'backups', names[0] ?? ''), {
      readonly: true
    })
    expect(backup.pragma('user_version', { simple: true })).toBe(48)
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
    backup.close()
    database.close()
  })

  it('retains an intact original and recoverable backup when migration fails', async () => {
    const root = await legacyProject(migrationRecoveryFixtures.imageModelSelection, true)
    await expect(openMigrationDatabase(root)).rejects.toThrow()
    const original = new Database(join(root, '.writellm', 'project.sqlite'), { readonly: true })
    expect(original.pragma('user_version', { simple: true })).toBe(48)
    expect(original.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(original.prepare('SELECT title FROM agent_sessions').pluck().get()).toBe(
      'Preserved conversation'
    )
    original.close()
    expect((await listMigrationBackups(root)).length > 0).toBe(true)
  })
})
