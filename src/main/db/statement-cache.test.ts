import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { cachedStatement } from './statement-cache'

describe('cached prepared statements', () => {
  it('reuses one statement per connection and keeps pluck mode separate', () => {
    const first = new Database(':memory:')
    const second = new Database(':memory:')
    try {
      for (const database of [first, second]) {
        database.exec('CREATE TABLE items (id TEXT PRIMARY KEY, label TEXT NOT NULL)')
        database.prepare("INSERT INTO items VALUES ('a', 'Alpha')").run()
      }
      const sql = 'SELECT label FROM items WHERE id = ?'

      const rows = cachedStatement(first, sql)
      expect(cachedStatement(first, sql)).toBe(rows)
      expect(cachedStatement(second, sql)).not.toBe(rows)

      const plucked = cachedStatement(first, sql, { pluck: true })
      expect(plucked).not.toBe(rows)
      expect(plucked.get('a')).toBe('Alpha')
      expect(rows.get('a')).toEqual({ label: 'Alpha' })
    } finally {
      first.close()
      second.close()
    }
  })
})
