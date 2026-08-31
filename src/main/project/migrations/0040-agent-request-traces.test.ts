import { createHash } from 'node:crypto'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migration0040 } from './0040-agent-request-traces'

describe('migration 0040 Agent request traces', () => {
  it('creates permanent trace tables and exposes legacy requests without invented payloads', () => {
    const database = baseDatabase()
    database
      .prepare(
        `INSERT INTO model_requests (
          model_request_id, operation_kind, provider_id, model_id, status, agent_run_id
        ) VALUES ('model-legacy', 'agent', 'openai', 'gpt', 'succeeded', 'run-1')`
      )
      .run()

    migration0040.up(database)

    expect(
      database
        .prepare(
          `SELECT capture_status, harness_request_json, provider_requests_json
             FROM agent_model_request_trace_v WHERE model_request_id = 'model-legacy'`
        )
        .get()
    ).toEqual({
      capture_status: 'legacy_unavailable',
      harness_request_json: null,
      provider_requests_json: '[]'
    })
    expect(() =>
      database
        .prepare(
          `INSERT INTO agent_trace_payloads VALUES ('bad', 1, '{}', 2, '2026-08-31T00:00:00.000Z')`
        )
        .run()
    ).toThrow('CHECK constraint failed')
    database.close()
  })

  it('rebuilds ordered JSON chunks and joins raw Agent events into the run view', () => {
    const database = baseDatabase()
    database.exec(`
      INSERT INTO model_requests (
        model_request_id, operation_kind, provider_id, model_id, status, agent_run_id
      ) VALUES ('model-1', 'agent', 'openai', 'gpt', 'running', 'run-1');
    `)
    migration0040.up(database)
    const parts = ['{}', '"policy"', '[]', '{"role":"user","content":"hello"}']
    for (const part of parts) {
      database
        .prepare(`INSERT INTO agent_trace_payloads VALUES (?, 1, ?, ?, ?)`)
        .run(sha(part), part, Buffer.byteLength(part), '2026-08-31T00:00:00.000Z')
    }
    database
      .prepare(
        `INSERT INTO model_request_traces VALUES (
          'model-1', 'agent_prompt', 'openai-responses', 'run-1', 'model-1', NULL,
          'capturing', 1, NULL, NULL, NULL, NULL, ?, ?
        )`
      )
      .run('2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')
    const insert = database.prepare(
      `INSERT INTO agent_trace_records VALUES (
        ?, 'session-1', 'run-1', 'model-1', NULL, NULL, 1,
        'harness_request', ?, ?, ?, '{}', ?
      )`
    )
    insert.run('record-0', 0, '$', sha(parts[0] ?? ''), '2026-08-31T00:00:00.000Z')
    insert.run('record-1', 1, '$."systemPrompt"', sha(parts[1] ?? ''), '2026-08-31T00:00:00.001Z')
    insert.run('record-2', 2, '$."messages"', sha(parts[2] ?? ''), '2026-08-31T00:00:00.002Z')
    insert.run('record-3', 3, '$."messages"[0]', sha(parts[3] ?? ''), '2026-08-31T00:00:00.003Z')

    const row = database
      .prepare(
        `SELECT harness_request_json FROM agent_model_request_trace_v
          WHERE model_request_id = 'model-1'`
      )
      .get() as { harness_request_json: string }
    expect(JSON.parse(row.harness_request_json)).toEqual({
      systemPrompt: 'policy',
      messages: [{ role: 'user', content: 'hello' }]
    })
    expect(
      database
        .prepare(`SELECT COUNT(*) FROM agent_run_trace_v WHERE agent_run_id = 'run-1'`)
        .pluck()
        .get()
    ).toBe(4)
    database.close()
  })
})

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function baseDatabase(): Database.Database {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(`
    CREATE TABLE agent_sessions (agent_session_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE agent_runs (
      agent_run_id TEXT PRIMARY KEY,
      agent_session_id TEXT REFERENCES agent_sessions(agent_session_id)
    ) STRICT;
    CREATE TABLE model_requests (
      model_request_id TEXT PRIMARY KEY,
      operation_kind TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL,
      agent_run_id TEXT REFERENCES agent_runs(agent_run_id)
    ) STRICT;
    CREATE TABLE agent_events (
      agent_event_id TEXT PRIMARY KEY,
      agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id),
      agent_run_id TEXT REFERENCES agent_runs(agent_run_id),
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      model_request_id TEXT REFERENCES model_requests(model_request_id),
      created_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO agent_sessions VALUES ('session-1');
    INSERT INTO agent_runs VALUES ('run-1', 'session-1');
  `)
  return database
}
