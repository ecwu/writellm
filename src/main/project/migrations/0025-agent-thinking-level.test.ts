import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migration0025 } from './0025-agent-thinking-level'

describe('migration 0025 Agent Thinking level', () => {
  it('preserves existing rows as off and enforces bounded levels', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE agent_sessions (agent_session_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE agent_runs (agent_run_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE model_requests (model_request_id TEXT PRIMARY KEY) STRICT;
      INSERT INTO agent_sessions VALUES ('session-1');
      INSERT INTO agent_runs VALUES ('run-1');
      INSERT INTO model_requests VALUES ('request-1');
    `)

    migration0025.up(database)

    expect(database.prepare('SELECT thinking_level FROM agent_sessions').pluck().get()).toBe('off')
    expect(database.prepare('SELECT thinking_level FROM agent_runs').pluck().get()).toBe('off')
    expect(database.prepare('SELECT thinking_level FROM model_requests').pluck().get()).toBeNull()
    database.prepare("UPDATE agent_sessions SET thinking_level = 'xhigh'").run()
    database.prepare("UPDATE model_requests SET thinking_level = 'minimal'").run()
    expect(() =>
      database.prepare("UPDATE agent_runs SET thinking_level = 'extreme'").run()
    ).toThrow('CHECK constraint failed')
    database.close()
  })
})
