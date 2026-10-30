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

describe('migration 0046 message replacements', () => {
  it('creates a verified pre-migration backup and keeps existing conversation evidence', async () => {
    const root = await legacyProject(migrationRecoveryFixtures.messageReplacements)
    const database = await openMigrationDatabase(root)
    expect(database.immediate((db) => db.pragma('user_version', { simple: true }))).toBe(49)
    expect(database.immediate((db) => db.pragma('integrity_check', { simple: true }))).toBe('ok')
    expect(database.immediate((db) => db.pragma('foreign_key_check'))).toEqual([])
    expect(createService(database, new FakeAgentRuntime()).listSessions()[0].title).toBe(
      'Preserved conversation'
    )
    const names = await listMigrationBackups(root)
    const backupName = names.find(
      (name) => name.startsWith('migration-') && name.endsWith('.sqlite')
    )
    expect(backupName).toBeDefined()
    const backup = new Database(join(root, '.writellm', 'backups', backupName ?? ''), {
      readonly: true
    })
    expect(backup.pragma('user_version', { simple: true })).toBe(45)
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(backup.prepare('SELECT title FROM agent_sessions').pluck().get()).toBe(
      'Preserved conversation'
    )
    backup.close()
    database.close()
  })

  it('retains an intact original and recoverable backup when migration fails', async () => {
    const root = await legacyProject(migrationRecoveryFixtures.messageReplacements, true)
    await expect(openMigrationDatabase(root)).rejects.toThrow()
    const original = new Database(join(root, '.writellm', 'project.sqlite'), { readonly: true })
    expect(original.pragma('user_version', { simple: true })).toBe(45)
    expect(original.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(original.prepare('SELECT title FROM agent_sessions').pluck().get()).toBe(
      'Preserved conversation'
    )
    original.close()
    expect((await listMigrationBackups(root)).length > 0).toBe(true)
  })
})
