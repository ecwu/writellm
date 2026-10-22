import type Database from 'better-sqlite3'

const caches = new WeakMap<Database.Database, Map<string, Database.Statement>>()

/**
 * Reuse one prepared statement per connection, SQL text, and result mode.
 *
 * Use this for statements executed repeatedly, such as inside a loop in one transaction. Callers
 * must use `run`, `get`, or `all`; an `iterate` cursor would keep a shared statement busy. Result
 * modes are part of the cache key because `pluck()` changes the statement object itself.
 */
export function cachedStatement(
  database: Database.Database,
  sql: string,
  options: { pluck?: boolean } = {}
): Database.Statement {
  let cache = caches.get(database)
  if (cache === undefined) {
    cache = new Map()
    caches.set(database, cache)
  }
  const key = `${options.pluck === true ? 'pluck' : 'rows'}\n${sql}`
  let statement = cache.get(key)
  if (statement === undefined) {
    statement = database.prepare(sql)
    if (options.pluck === true) statement.pluck()
    cache.set(key, statement)
  }
  return statement
}
