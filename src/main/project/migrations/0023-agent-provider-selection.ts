import type { DatabaseMigration } from '../../db/migrations'

export const migration0023: DatabaseMigration = {
  version: 23,
  name: '0023-agent-provider-selection',
  checksum: 'sha256:b49fd965c2ee2f0567c8fde576c203e6076895444e42fc17138c87ce2ce85592',
  up(database) {
    if (!hasColumn(database, 'agent_sessions', 'provider_preset_id')) {
      database.exec(`ALTER TABLE agent_sessions ADD COLUMN provider_preset_id TEXT
        CHECK (provider_preset_id IS NULL OR length(provider_preset_id) BETWEEN 1 AND 200);
      `)
    }
    if (!hasColumn(database, 'agent_sessions', 'selected_model_id')) {
      database.exec(`ALTER TABLE agent_sessions ADD COLUMN selected_model_id TEXT
        CHECK (selected_model_id IS NULL OR length(selected_model_id) BETWEEN 1 AND 500);
      `)
    }
    if (!hasColumn(database, 'agent_runs', 'provider_preset_id')) {
      database.exec(`ALTER TABLE agent_runs ADD COLUMN provider_preset_id TEXT
        CHECK (provider_preset_id IS NULL OR length(provider_preset_id) BETWEEN 1 AND 200);
      `)
    }
    if (!hasColumn(database, 'agent_runs', 'provider_label')) {
      database.exec(`ALTER TABLE agent_runs ADD COLUMN provider_label TEXT NOT NULL DEFAULT ''
        CHECK (length(provider_label) <= 200);
      `)
    }
    if (!hasColumn(database, 'agent_runs', 'model_label')) {
      database.exec(`ALTER TABLE agent_runs ADD COLUMN model_label TEXT NOT NULL DEFAULT ''
        CHECK (length(model_label) <= 500);
      `)
    }
    if (!hasColumn(database, 'agent_runs', 'api_id')) {
      database.exec(`ALTER TABLE agent_runs ADD COLUMN api_id TEXT NOT NULL DEFAULT 'openai-completions'
        CHECK (length(api_id) BETWEEN 1 AND 100);
      `)
    }
    database.exec(`
      UPDATE agent_runs
         SET provider_label = provider_id,
             model_label = model_id
       WHERE provider_label = '' OR model_label = '';
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
