import type { DatabaseMigration } from '../../db/migrations'

const LEGACY_LIMITS = JSON.stringify({
  contextWindowTokens: 131072,
  inputLimitTokens: null,
  outputLimitTokens: null,
  source: 'legacy_fallback',
  catalogModelKey: null,
  resolvedAt: null
})

export const migration0020: DatabaseMigration = {
  version: 20,
  name: '0020-agent-approval-and-limits',
  checksum: 'sha256:6843c0a295d46e8b2536a6c7e15f3d5ed93c109a222e52886fc3f0478e7e2704',
  up(database) {
    if (!hasColumn(database, 'agent_sessions', 'approval_mode')) {
      database.exec(`ALTER TABLE agent_sessions ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'manual'
        CHECK (approval_mode IN ('manual', 'section_auto', 'yolo'))`)
    }
    if (!hasColumn(database, 'agent_runs', 'approval_mode')) {
      database.exec(`ALTER TABLE agent_runs ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'manual'
        CHECK (approval_mode IN ('manual', 'section_auto', 'yolo'))`)
    }
    if (!hasColumn(database, 'agent_runs', 'model_limits_json')) {
      database.exec(`ALTER TABLE agent_runs ADD COLUMN model_limits_json TEXT NOT NULL DEFAULT '${LEGACY_LIMITS}'
        CHECK (
          length(CAST(model_limits_json AS BLOB)) <= 4096
          AND json_valid(model_limits_json)
          AND json_type(model_limits_json) = 'object'
        )`)
    }
  }
}

function hasColumn(
  database: Parameters<DatabaseMigration['up']>[0],
  table: string,
  column: string
): boolean {
  return (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(
    (row) => row.name === column
  )
}
