import type { DatabaseMigration } from '../../db/migrations'

export const migration0001: DatabaseMigration = {
  version: 1,
  name: '0001-application-state',
  checksum: 'sha256:37e365b4db645def0b8db115c61aa2c705f5e0b4ec3a8ad31d5c7abb40c139b1',
  up(database) {
    database.exec(`
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY NOT NULL,
        value_json TEXT NOT NULL CHECK (json_valid(value_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE recent_projects (
        project_id TEXT PRIMARY KEY NOT NULL,
        project_path TEXT NOT NULL,
        display_name TEXT NOT NULL,
        last_opened_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE provider_configs (
        id TEXT PRIMARY KEY NOT NULL,
        provider TEXT NOT NULL,
        config_json TEXT NOT NULL CHECK (json_valid(config_json)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE encrypted_credentials (
        id TEXT PRIMARY KEY NOT NULL,
        provider_config_id TEXT NOT NULL REFERENCES provider_configs(id) ON DELETE CASCADE,
        ciphertext TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX encrypted_credentials_provider_config_id_idx
        ON encrypted_credentials(provider_config_id);
    `)
  }
}
