import type { DatabaseMigration } from '../../db/migrations'

const THINKING_LEVEL_CHECK =
  "CHECK (thinking_level IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'))"

export const migration0025: DatabaseMigration = {
  version: 25,
  name: '0025-agent-thinking-level',
  checksum: 'sha256:5fe5fc395df3066cdf8c0115ed7fb10ad282a288bd83a612e0232181242fa7dd',
  up(database) {
    if (!hasColumn(database, 'agent_sessions', 'thinking_level')) {
      database.exec(
        `ALTER TABLE agent_sessions ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'off' ${THINKING_LEVEL_CHECK}`
      )
    }
    if (!hasColumn(database, 'agent_runs', 'thinking_level')) {
      database.exec(
        `ALTER TABLE agent_runs ADD COLUMN thinking_level TEXT NOT NULL DEFAULT 'off' ${THINKING_LEVEL_CHECK}`
      )
    }
    if (!hasColumn(database, 'model_requests', 'thinking_level')) {
      database.exec(
        `ALTER TABLE model_requests ADD COLUMN thinking_level TEXT
          CHECK (thinking_level IS NULL OR thinking_level IN ('off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'))`
      )
    }
  }
}

function hasColumn(
  database: Parameters<DatabaseMigration['up']>[0],
  table: string,
  column: string
): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (entry) => entry.name === column
  )
}
