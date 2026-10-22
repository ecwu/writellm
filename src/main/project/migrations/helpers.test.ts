import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { hasColumn } from './helpers'

describe('frozen migration helpers', () => {
  it('reports existing and missing columns without creating either table', () => {
    const database = new Database(':memory:')
    try {
      database.exec('CREATE TABLE agent_sessions (agent_session_id TEXT PRIMARY KEY, title TEXT)')
      expect(hasColumn(database as never, 'agent_sessions', 'title')).toBe(true)
      expect(hasColumn(database as never, 'agent_sessions', 'thinking_level')).toBe(false)
      expect(hasColumn(database as never, 'missing_table', 'title')).toBe(false)
      expect(
        database.prepare("SELECT count(*) FROM sqlite_master WHERE type = 'table'").pluck().get()
      ).toBe(1)
    } finally {
      database.close()
    }
  })

  it('rejects identifiers that are not simple SQLite names', () => {
    const database = new Database(':memory:')
    try {
      expect(() => hasColumn(database as never, 'agent_sessions); DROP TABLE x;--', 'id')).toThrow(
        'Migration identifiers must be simple SQLite identifiers'
      )
      expect(() => hasColumn(database as never, 'agent_sessions', 'title"')).toThrow(
        'Migration identifiers must be simple SQLite identifiers'
      )
    } finally {
      database.close()
    }
  })
})
