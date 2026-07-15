import type { DatabaseMigration } from '../../db/migrations'

export const migration0007: DatabaseMigration = {
  version: 7,
  name: '0007-editor-materialization',
  checksum: 'sha256:8dc5e6ec34b4f17d8cab9b6840a1360a6be9250e0f250fd139c89e2fd56e542a',
  up(database) {
    database.exec(`
      ALTER TABLE section_revisions
        ADD COLUMN content_body_retained INTEGER NOT NULL DEFAULT 1
        CHECK (content_body_retained IN (0, 1));

      CREATE TABLE section_materializations (
        section_id TEXT PRIMARY KEY NOT NULL,
        section_revision_id TEXT NOT NULL,
        content_hash TEXT NOT NULL
          CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
        relative_path TEXT NOT NULL UNIQUE,
        file_sha256 TEXT NOT NULL
          CHECK (length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        envelope_schema_version INTEGER NOT NULL CHECK (envelope_schema_version = 1),
        materialized_at TEXT NOT NULL,
        FOREIGN KEY (section_id, section_revision_id)
          REFERENCES section_revisions(section_id, section_revision_id) ON DELETE CASCADE
      ) STRICT;
    `)
  }
}
