import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { migration0026 } from './0026-agent-session-skill-selection'

describe('migration 0026 Agent session Writing Skill selection', () => {
  it('defaults old sessions to Auto and enforces explicit ID consistency', () => {
    const database = new Database(':memory:')
    database.exec(`
      CREATE TABLE agent_sessions (agent_session_id TEXT PRIMARY KEY) STRICT;
      INSERT INTO agent_sessions VALUES ('session-1');
    `)

    migration0026.up(database)

    expect(database.prepare('SELECT skill_mode, skill_id FROM agent_sessions').get()).toEqual({
      skill_mode: 'auto',
      skill_id: null
    })
    database
      .prepare("UPDATE agent_sessions SET skill_mode = 'explicit', skill_id = 'nature-writing'")
      .run()
    expect(() => database.prepare("UPDATE agent_sessions SET skill_mode = 'auto'").run()).toThrow()
    expect(() => database.prepare('UPDATE agent_sessions SET skill_id = NULL').run()).toThrow()
    database.prepare("UPDATE agent_sessions SET skill_mode = 'none', skill_id = NULL").run()
    database.close()
  })
})
