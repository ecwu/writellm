import type { DatabaseMigration } from '../../db/migrations'

/** ADR 093: an Agent conversation can override the application default image model. */
export const migration0049: DatabaseMigration = {
  version: 49,
  name: '0049-agent-image-model-selection',
  checksum: 'sha256:04a53b4dde60a7235e04d080e797f2a9c4831adf687f482e3a10943e84c255a1',
  up(database) {
    database.exec(`
      ALTER TABLE agent_sessions ADD COLUMN image_source_id TEXT
        CHECK (image_source_id IS NULL OR length(image_source_id) BETWEEN 1 AND 80);
      ALTER TABLE agent_sessions ADD COLUMN image_model_id TEXT
        CHECK (image_model_id IS NULL OR length(image_model_id) BETWEEN 1 AND 200);
    `)
  }
}
