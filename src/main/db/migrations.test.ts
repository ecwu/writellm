import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { migrateDatabase, type DatabaseMigration } from './migrations'

const temporaryDirectories: string[] = []

async function createDatabase(): Promise<Database.Database> {
  const directory = await mkdtemp(join(tmpdir(), 'writellm-migration-'))
  temporaryDirectories.push(directory)
  const database = new Database(join(directory, 'database.sqlite'))
  database.pragma('foreign_keys = ON')
  return database
}

const migration0001: DatabaseMigration = {
  version: 1,
  name: '0001-fixture',
  checksum: 'sha256:fixture-1',
  up(database) {
    database.exec('CREATE TABLE fixture (id INTEGER PRIMARY KEY) STRICT;')
  }
}

const migration0002: DatabaseMigration = {
  version: 2,
  name: '0002-second-fixture',
  checksum: 'sha256:fixture-2',
  up(database) {
    database.exec('ALTER TABLE fixture ADD COLUMN name TEXT;')
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('database migrator', () => {
  it('upgrades an older schema sequentially', async () => {
    const database = await createDatabase()
    const log = pino({ level: 'silent' })
    const options = { applicationVersion: '0.9.0', databaseRole: 'app' as const, log }

    expect(migrateDatabase(database, { ...options, migrations: [migration0001] })).toBe(1)
    expect(database.pragma('user_version', { simple: true })).toBe(1)
    expect(
      migrateDatabase(database, {
        ...options,
        applicationVersion: '1.0.0',
        migrations: [migration0001, migration0002]
      })
    ).toBe(2)
    expect(
      database.prepare('SELECT name FROM schema_migrations ORDER BY version').pluck().all()
    ).toEqual(['0001-fixture', '0002-second-fixture'])
    database.close()
  })

  it('rolls back schema and metadata and logs the original migration error', async () => {
    const database = await createDatabase()
    const error = vi.fn()
    const log = { info: vi.fn(), error } as unknown as Parameters<typeof migrateDatabase>[1]['log']
    migrateDatabase(database, {
      applicationVersion: '0.9.0',
      databaseRole: 'project',
      migrations: [migration0001],
      log
    })
    const failure = new Error('fixture migration failed')
    const failingMigration: DatabaseMigration = {
      version: 2,
      name: '0002-failing-fixture',
      checksum: 'sha256:failing-fixture',
      up(nativeDatabase) {
        nativeDatabase.exec('CREATE TABLE should_roll_back (id INTEGER PRIMARY KEY) STRICT;')
        throw failure
      }
    }

    expect(() =>
      migrateDatabase(database, {
        applicationVersion: '1.0.0',
        databaseRole: 'project',
        migrations: [migration0001, failingMigration],
        log
      })
    ).toThrow('project database migration 0002-failing-fixture failed')
    expect(database.pragma('user_version', { simple: true })).toBe(1)
    expect(database.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(1)
    expect(
      database
        .prepare(
          "SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'should_roll_back'"
        )
        .pluck()
        .get()
    ).toBe(0)
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'db.migration.failed',
        databaseRole: 'project',
        err: failure
      }),
      expect.any(String)
    )
    database.close()
  })

  it('rejects modified migration metadata', async () => {
    const database = await createDatabase()
    const log = pino({ level: 'silent' })
    const options = {
      applicationVersion: '1.0.0',
      databaseRole: 'app' as const,
      migrations: [migration0001],
      log
    }
    migrateDatabase(database, options)
    database.prepare('UPDATE schema_migrations SET checksum = ? WHERE version = 1').run('modified')

    expect(() => migrateDatabase(database, options)).toThrow('does not match the packaged manifest')
    database.close()
  })
})
