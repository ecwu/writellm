import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0027 } from './0027-agent-event-schema-v3'

describe('migration 0027 Agent event schema v3', () => {
  it('preserves legacy summaries, upgrades compatible sessions, and accepts compaction lifecycle events', () => {
    const database = new Database(':memory:')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 26),
      log: pino({ level: 'silent' })
    })
    const now = '2026-08-12T00:00:00.000Z'
    database
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('session-1', 'Legacy conversation', '0.80.10', 2, now, now)
    database
      .prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, sequence, type, payload_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        'event-legacy-summary',
        'session-1',
        1,
        'compaction_summary',
        JSON.stringify({
          summary: 'Legacy checkpoint',
          coveredThroughSequence: 1,
          estimatedInputTokens: 100,
          timestamp: Date.parse(now)
        }),
        now
      )

    migration0027.up(database)

    expect(database.prepare('SELECT event_schema_version FROM agent_sessions').pluck().get()).toBe(
      3
    )
    expect(
      database.prepare('SELECT payload_json FROM agent_events WHERE sequence = 1').pluck().get()
    ).toContain('Legacy checkpoint')
    const insert = database.prepare(
      `INSERT INTO agent_events (
         agent_event_id, agent_session_id, sequence, type, payload_json, created_at
       ) VALUES (?, 'session-1', ?, ?, '{}', ?)`
    )
    insert.run('event-started', 2, 'compaction_started', now)
    insert.run('event-failed', 3, 'compaction_failed', now)
    expect(
      database.prepare('SELECT type FROM agent_events ORDER BY sequence').pluck().all()
    ).toEqual(['compaction_summary', 'compaction_started', 'compaction_failed'])
    expect(() => insert.run('event-invalid', 4, 'reasoning', now)).toThrow(
      'CHECK constraint failed'
    )
    expect(database.pragma('foreign_key_check')).toEqual([])
    database.close()
  })
})
