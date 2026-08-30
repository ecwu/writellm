import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migration0039 } from './0039-agent-interaction-modes'

describe('migration 0039 Agent interaction modes', () => {
  it('preserves existing Writing sessions and runs as Write and constrains future values', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE agent_sessions (agent_session_id TEXT PRIMARY KEY) STRICT;
      CREATE TABLE agent_runs (agent_run_id TEXT PRIMARY KEY) STRICT;
      INSERT INTO agent_sessions VALUES ('session-1');
      INSERT INTO agent_runs VALUES ('run-1');
    `)

    migration0039.up(database)

    expect(database.prepare('SELECT interaction_mode FROM agent_sessions').pluck().get()).toBe(
      'write'
    )
    expect(database.prepare('SELECT interaction_mode FROM agent_runs').pluck().get()).toBe('write')
    database.prepare("UPDATE agent_sessions SET interaction_mode = 'ask'").run()
    database.prepare("UPDATE agent_runs SET interaction_mode = 'plan'").run()
    expect(() =>
      database.prepare("UPDATE agent_runs SET interaction_mode = 'execute'").run()
    ).toThrow('CHECK constraint failed')
    database.close()
  })

  it('is idempotent when both columns already exist', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE agent_sessions (
        agent_session_id TEXT PRIMARY KEY,
        interaction_mode TEXT NOT NULL DEFAULT 'write'
      ) STRICT;
      CREATE TABLE agent_runs (
        agent_run_id TEXT PRIMARY KEY,
        interaction_mode TEXT NOT NULL DEFAULT 'write'
      ) STRICT;
    `)

    migration0039.up(database)
    expect(database.prepare('PRAGMA table_info(agent_sessions)').all()).toHaveLength(2)
    expect(database.prepare('PRAGMA table_info(agent_runs)').all()).toHaveLength(2)
    database.close()
  })
})
