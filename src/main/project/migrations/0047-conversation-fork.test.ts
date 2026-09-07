import Database from 'better-sqlite3'
import { dirname, join } from 'node:path'
import { readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { openProjectDatabase } from '../project-database'
import {
  createDatabase,
  createService,
  FakeAgentRuntime,
  log
} from '../../agent/session-service.test-support'

const manifest = {
  format: 'writellm-project' as const,
  formatVersion: 1 as const,
  projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
  createdAt: '2026-07-21T00:00:00.000Z'
}

async function legacyProject(fail = false) {
  const project = await createDatabase()
  createService(project, new FakeAgentRuntime()).createSession('Preserved conversation')
  const root = project.immediate((db) => {
    db.exec(`DROP VIEW agent_conversation_history;
      DROP TABLE agent_history_references;
      DROP TABLE agent_conversation_forks;
      DELETE FROM schema_migrations WHERE version = 47;
      UPDATE schema_manifest SET schema_version = 46;
      PRAGMA user_version = 46;`)
    if (fail) db.exec('CREATE TABLE agent_conversation_forks (fixture TEXT)')
    return dirname(dirname(db.name))
  })
  project.close()
  return root
}

describe('migration 0047 conversation fork', () => {
  it('creates a verified pre-migration backup and keeps existing conversation evidence', async () => {
    const root = await legacyProject()
    const database = await openProjectDatabase({
      projectRoot: root,
      manifest,
      applicationVersion: 'test',
      log
    })
    expect(database.immediate((db) => db.pragma('user_version', { simple: true }))).toBe(47)
    expect(database.immediate((db) => db.pragma('integrity_check', { simple: true }))).toBe('ok')
    expect(database.immediate((db) => db.pragma('foreign_key_check'))).toEqual([])
    expect(createService(database, new FakeAgentRuntime()).listSessions()[0].title).toBe(
      'Preserved conversation'
    )
    const names = await readdir(join(root, '.writellm', 'backups'))
    const backupName = names.find(
      (name) => name.startsWith('migration-') && name.endsWith('.sqlite')
    )
    expect(backupName).toBeDefined()
    const backup = new Database(join(root, '.writellm', 'backups', backupName ?? ''), {
      readonly: true
    })
    expect(backup.pragma('user_version', { simple: true })).toBe(46)
    expect(backup.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(backup.prepare('SELECT title FROM agent_sessions').pluck().get()).toBe(
      'Preserved conversation'
    )
    backup.close()
    database.close()
  })

  it('retains an intact original and recoverable backup when migration fails', async () => {
    const root = await legacyProject(true)
    await expect(
      openProjectDatabase({ projectRoot: root, manifest, applicationVersion: 'test', log })
    ).rejects.toThrow()
    const original = new Database(join(root, '.writellm', 'project.sqlite'), { readonly: true })
    expect(original.pragma('user_version', { simple: true })).toBe(46)
    expect(original.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(original.prepare('SELECT title FROM agent_sessions').pluck().get()).toBe(
      'Preserved conversation'
    )
    original.close()
    expect(
      (await readdir(join(root, '.writellm', 'backups'))).some((name) =>
        name.startsWith('migration-')
      )
    ).toBe(true)
  })
})
