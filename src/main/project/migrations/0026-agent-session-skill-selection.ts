import type { DatabaseMigration } from '../../db/migrations'

export const migration0026: DatabaseMigration = {
  version: 26,
  name: '0026-agent-session-skill-selection',
  checksum: 'sha256:4ed7f87ac686c9ab3117474af3e4f65e82305877b282d6ee01a2e21504a480af',
  up(database) {
    if (!hasColumn(database, 'agent_sessions', 'skill_mode')) {
      database.exec(
        "ALTER TABLE agent_sessions ADD COLUMN skill_mode TEXT NOT NULL DEFAULT 'auto' CHECK (skill_mode IN ('auto', 'explicit', 'none'))"
      )
    }
    if (!hasColumn(database, 'agent_sessions', 'skill_id')) {
      database.exec(
        "ALTER TABLE agent_sessions ADD COLUMN skill_id TEXT CHECK ((skill_mode = 'explicit') = (skill_id IS NOT NULL))"
      )
    }
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS agent_sessions_skill_selection_insert
      BEFORE INSERT ON agent_sessions
      WHEN (NEW.skill_mode = 'explicit') != (NEW.skill_id IS NOT NULL)
      BEGIN
        SELECT RAISE(ABORT, 'invalid agent session skill selection');
      END;
      CREATE TRIGGER IF NOT EXISTS agent_sessions_skill_selection_update
      BEFORE UPDATE OF skill_mode, skill_id ON agent_sessions
      WHEN (NEW.skill_mode = 'explicit') != (NEW.skill_id IS NOT NULL)
      BEGIN
        SELECT RAISE(ABORT, 'invalid agent session skill selection');
      END;
    `)
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
