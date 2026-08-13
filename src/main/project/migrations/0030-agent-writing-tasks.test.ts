import Database from 'better-sqlite3'
import pino from 'pino'
import { describe, expect, it } from 'vitest'
import { migrateDatabase } from '../../db/migrations'
import { projectMigrations } from '.'
import { migration0030 } from './0030-agent-writing-tasks'

describe('migration 0030 Agent writing tasks', () => {
  it('preserves existing proposals and adds constrained task correlation', () => {
    const database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    migrateDatabase(database, {
      applicationVersion: 'test',
      databaseRole: 'project',
      migrations: projectMigrations.slice(0, 29),
      log: pino({ level: 'silent' })
    })
    const now = '2026-08-13T00:00:00.000Z'
    database
      .prepare(
        `INSERT INTO agent_sessions (
           agent_session_id, title, pi_runtime_version, event_schema_version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('session-1', 'Existing conversation', '0.80.10', 3, now, now)
    database
      .prepare(
        `INSERT INTO agent_runs (
           agent_run_id, agent_session_id, status, provider_id, model_id,
           provider_fingerprint, model_fingerprint, editor_context_json,
           started_at, created_at, updated_at
         ) VALUES (?, ?, 'running', ?, ?, ?, ?, '{}', ?, ?, ?)`
      )
      .run(
        'run-1',
        'session-1',
        'provider-1',
        'model-1',
        'a'.repeat(64),
        'b'.repeat(64),
        now,
        now,
        now
      )
    database
      .prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, agent_run_id, sequence, type, payload_json, created_at
         ) VALUES (?, ?, ?, 1, 'tool_call', '{}', ?)`
      )
      .run('event-1', 'session-1', 'run-1', now)
    database
      .prepare(
        `INSERT INTO mutation_proposals (
           mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
           agent_tool_call_id, kind, payload_json, base_outline_version,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'outline_patch', '{}', 1, 'pending', ?, ?)`
      )
      .run('proposal-1', 'session-1', 'run-1', 'event-1', 'call-1', now, now)

    database.transaction(() => migration0030.up(database)).immediate()

    expect(
      database
        .prepare(
          `SELECT mutation_proposal_id, writing_task_id, writing_task_step_id
             FROM mutation_proposals`
        )
        .get()
    ).toEqual({
      mutation_proposal_id: 'proposal-1',
      writing_task_id: null,
      writing_task_step_id: null
    })
    database
      .prepare(
        `INSERT INTO agent_writing_tasks (
           writing_task_id, agent_session_id, objective, plan_version, plan_json,
           created_by_agent_run_id, created_at, updated_at
         ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
      )
      .run(
        'task-1',
        'session-1',
        'Revise the manuscript.',
        JSON.stringify({
          steps: [
            { stepId: 'step-1', title: 'Inspect', status: 'active', statusReason: null },
            { stepId: 'step-2', title: 'Revise', status: 'pending', statusReason: null }
          ]
        }),
        'run-1',
        now,
        now
      )
    database
      .prepare(
        `UPDATE mutation_proposals
            SET writing_task_id = 'task-1', writing_task_step_id = 'step-1'
          WHERE mutation_proposal_id = 'proposal-1'`
      )
      .run()
    expect(
      database
        .prepare(
          `SELECT writing_task_id, writing_task_step_id
             FROM mutation_proposals WHERE mutation_proposal_id = 'proposal-1'`
        )
        .get()
    ).toEqual({ writing_task_id: 'task-1', writing_task_step_id: 'step-1' })
    expect(() =>
      database
        .prepare(
          `INSERT INTO agent_writing_tasks (
             writing_task_id, agent_session_id, objective, plan_version, plan_json,
             created_at, updated_at
           ) VALUES ('task-2', 'session-1', '', 1, '{}', ?, ?)`
        )
        .run(now, now)
    ).toThrow()
    expect(database.pragma('foreign_key_check')).toEqual([])
    database.close()
  })
})
