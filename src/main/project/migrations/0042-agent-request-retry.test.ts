import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0042 } from './0042-agent-request-retry'

describe('migration 0042 Agent request retry', () => {
  it('upgrades compatible sessions and accepts retry provenance without losing proposals', () => {
    const database = new Database(':memory:')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 41),
      log: pino({ level: 'silent' })
    })
    const now = '2026-09-01T00:00:00.000Z'
    database
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('session-1', 'Retry conversation', '0.80.10', 3, now, now)

    migration0042.up(database)

    expect(database.prepare('SELECT event_schema_version FROM agent_sessions').pluck().get()).toBe(
      4
    )
    database
      .prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, sequence, type, payload_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('event-retry', 'session-1', 1, 'model_retry', '{}', now)
    expect(database.prepare('SELECT type FROM agent_events').pluck().get()).toBe('model_retry')
    expect(
      database.prepare(`SELECT COUNT(*) FROM sqlite_schema WHERE sql LIKE '%_v41%'`).pluck().get()
    ).toBe(0)
    expect(database.pragma('foreign_key_check')).toEqual([])
    database.close()
  })
})
