import type { DatabaseMigration } from '../../db/migrations'

export const migration0003: DatabaseMigration = {
  version: 3,
  name: '0003-agent-model-preferences',
  checksum: 'sha256:cb965ceac57eb96cf62f67d1dde4fe69fd47024c817163669ce0a8736f2a69f4',
  up(database) {
    database.exec(`
      CREATE TABLE agent_provider_preferences (
        provider_config_id TEXT PRIMARY KEY NOT NULL
          REFERENCES provider_configs(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE agent_model_preferences (
        provider_config_id TEXT NOT NULL
          REFERENCES provider_configs(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 500),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
        manual_model_json TEXT
          CHECK (manual_model_json IS NULL OR json_valid(manual_model_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (provider_config_id, model_id)
      ) STRICT;
    `)
  }
}
