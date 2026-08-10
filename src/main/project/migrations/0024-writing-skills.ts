import type { DatabaseMigration } from '../../db/migrations'

export const migration0024: DatabaseMigration = {
  version: 24,
  name: '0024-writing-skills',
  checksum: 'sha256:096250855a9d8d8cb6b7a65a263e32d036f06cc0b7cd968d39013c08cda1f467',
  up(database) {
    if (!hasColumn(database, 'agent_runs', 'skill_snapshot_json')) {
      database.exec(`ALTER TABLE agent_runs ADD COLUMN skill_snapshot_json TEXT NOT NULL
        DEFAULT '{"mode":"none","routingStatus":"legacy","primary":null,"dependencies":[],"resources":[],"safeError":null}'
        CHECK (json_valid(skill_snapshot_json));
      `)
    }
    if (!hasColumn(database, 'agent_runs', 'skill_route_model_request_id')) {
      database.exec('ALTER TABLE agent_runs ADD COLUMN skill_route_model_request_id TEXT;')
    }
    if (!hasColumn(database, 'model_requests', 'delivery')) {
      database.exec(`ALTER TABLE model_requests ADD COLUMN delivery TEXT
        CHECK (delivery IS NULL OR delivery = 'skill_route');
      `)
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
