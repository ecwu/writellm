import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0031 } from './0031-agent-writing-task-runs'

describe('migration 0031 Agent writing-task runs', () => {
  it('preserves existing runs and adds nullable exact task-step correlation', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 30),
      log: pino({ level: 'silent' })
    })
    const now = '2026-08-13T01:00:00.000Z'
    database
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version, created_at, updated_at
         ) VALUES ('session-1', 'Task', '0.80.10', 3, ?, ?)`
      )
      .run(now, now)
    database
      .prepare(
        `INSERT INTO agent_runs (
           agent_run_id, agent_session_id, status, provider_id, model_id,
           provider_fingerprint, model_fingerprint, editor_context_json,
           started_at, created_at, updated_at
         ) VALUES ('run-1', 'session-1', 'running', 'provider', 'model', ?, ?, '{}', ?, ?, ?)`
      )
      .run('a'.repeat(64), 'b'.repeat(64), now, now, now)

    database.transaction(() => migration0031.up(database)).immediate()

    expect(
      database
        .prepare(
          `SELECT agent_run_id, writing_task_id, writing_task_step_id FROM agent_runs WHERE agent_run_id = 'run-1'`
        )
        .get()
    ).toEqual({ agent_run_id: 'run-1', writing_task_id: null, writing_task_step_id: null })
    database
      .prepare(
        `INSERT INTO agent_writing_tasks (
           writing_task_id, agent_session_id, objective, plan_version, plan_json,
           created_by_agent_run_id, created_at, updated_at
         ) VALUES ('task-1', 'session-1', 'Write', 1, ?, 'run-1', ?, ?)`
      )
      .run(
        JSON.stringify({
          schemaVersion: 1,
          steps: [{ stepId: 'step-1', title: 'Write', status: 'active', statusReason: null }]
        }),
        now,
        now
      )
    database
      .prepare(
        `UPDATE agent_runs SET writing_task_id = 'task-1', writing_task_step_id = 'step-1'
          WHERE agent_run_id = 'run-1'`
      )
      .run()
    expect(database.pragma('foreign_key_check')).toEqual([])
    database.close()
  })
})
