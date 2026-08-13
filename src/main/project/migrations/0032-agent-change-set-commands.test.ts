import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0032 } from './0032-agent-change-set-commands'

describe('migration 0032 Agent change-set commands', () => {
  it('adds a bounded durable receipt without copying proposal authority', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 31),
      log: pino({ level: 'silent' })
    })
    const now = '2026-08-13T02:00:00.000Z'
    database
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version, created_at, updated_at
         ) VALUES ('session-1', 'Task', 'test', 3, ?, ?)`
      )
      .run(now, now)
    database
      .prepare(
        `INSERT INTO agent_writing_tasks (
           writing_task_id, agent_session_id, objective, plan_version, plan_json,
           created_at, updated_at
         ) VALUES ('task-1', 'session-1', 'Write', 1, ?, ?, ?)`
      )
      .run(
        JSON.stringify({
          schemaVersion: 1,
          steps: [{ stepId: 'step-1', title: 'Write', status: 'active', statusReason: null }]
        }),
        now,
        now
      )

    database.transaction(() => migration0032.up(database)).immediate()
    database
      .prepare(
        `INSERT INTO agent_change_set_commands (
           command_id, writing_task_id, agent_session_id, request_fingerprint, action,
           ordered_proposal_ids_json, reject_reason, checkpoint_status, checkpoint_requested,
           next_index, results_json, status, created_at, updated_at
         ) VALUES ('command-1', 'task-1', 'session-1', ?, 'apply', '[]', NULL,
                   'not_requested', 0, 0, '[]', 'prepared', ?, ?)`
      )
      .run('a'.repeat(64), now, now)

    expect(database.pragma('foreign_key_check')).toEqual([])
    expect(
      database
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE '%change_set%'")
        .pluck()
        .all()
    ).toEqual(['agent_change_set_commands'])
    expect(() =>
      database
        .prepare(
          `UPDATE agent_change_set_commands SET checkpoint_status = 'invented'
            WHERE command_id = 'command-1'`
        )
        .run()
    ).toThrow()
    database.close()
  })
})
