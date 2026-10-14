import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { openDatabase } from './open-database'

describe('OpenedDatabase reads', () => {
  it('reads without a transaction while another connection holds the write reservation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-db-read-'))
    const path = join(root, 'database.sqlite')
    const database = await openDatabase({
      path,
      applicationId: 123,
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: [],
      log: pino({ level: 'silent' })
    })
    const writer = new Database(path)
    try {
      database.immediate((native) =>
        native.exec('CREATE TABLE fixture (value INTEGER); INSERT INTO fixture VALUES (1)')
      )
      writer.exec('BEGIN IMMEDIATE; UPDATE fixture SET value = 2')
      expect(
        database.read((native) => {
          expect(native.inTransaction).toBe(false)
          const first = native.prepare('SELECT value FROM fixture').pluck().get()
          const second = native.prepare('SELECT value FROM fixture').pluck().get()
          return [first, second]
        })
      ).toEqual([1, 1])
      writer.exec('COMMIT')
      expect(
        database.read((native) => native.prepare('SELECT value FROM fixture').pluck().get())
      ).toBe(2)
      database.close()
      expect(() => database.read(() => undefined)).toThrow('Database closed')
      expect(() => database.immediate(() => undefined)).toThrow('Database closed')
    } finally {
      if (writer.inTransaction) writer.exec('ROLLBACK')
      writer.close()
      database.close()
      await rm(root, { recursive: true })
    }
  })

  it('keeps reads inside an existing write transaction and rolls back the complete operation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'writellm-db-read-'))
    const database = await openDatabase({
      path: join(root, 'database.sqlite'),
      applicationId: 123,
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: [],
      log: pino({ level: 'silent' })
    })
    try {
      database.immediate((native) => native.exec('CREATE TABLE fixture (value INTEGER)'))
      expect(() =>
        database.immediate((native) => {
          native.prepare('INSERT INTO fixture VALUES (1)').run()
          database.read((current) => {
            expect(current).toBe(native)
            expect(current.inTransaction).toBe(true)
            expect(current.prepare('SELECT value FROM fixture').pluck().get()).toBe(1)
          })
          throw new Error('rollback fixture')
        })
      ).toThrow('rollback fixture')
      expect(
        database.read((native) => native.prepare('SELECT COUNT(*) FROM fixture').pluck().get())
      ).toBe(0)
    } finally {
      database.close()
      await rm(root, { recursive: true })
    }
  })
})
