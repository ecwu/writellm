import type { DatabaseMigration } from '../../db/migrations'

export const migration0002: DatabaseMigration = {
  version: 2,
  name: '0002-agent-model-catalogs',
  checksum: 'sha256:48988ad2e9d1b6fe81fa24ed9656af633a77e8cd06b9eeef321ef341625d572d',
  up(database) {
    database.exec(`
      CREATE TABLE agent_model_catalogs (
        provider_config_id TEXT PRIMARY KEY NOT NULL
          REFERENCES provider_configs(id) ON DELETE CASCADE,
        models_json TEXT NOT NULL CHECK (json_valid(models_json)),
        checked_at TEXT,
        last_attempted_at TEXT,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (checked_at IS NULL OR datetime(checked_at) IS NOT NULL),
        CHECK (last_attempted_at IS NULL OR datetime(last_attempted_at) IS NOT NULL),
        CHECK (last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 100)
      ) STRICT;
    `)
  }
}
