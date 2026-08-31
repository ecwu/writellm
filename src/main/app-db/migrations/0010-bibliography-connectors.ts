import type { DatabaseMigration } from '../../db/migrations'

export const migration0010: DatabaseMigration = {
  version: 10,
  name: '0010-bibliography-connectors',
  checksum: 'sha256:06cb322b621f18b0f76f667ba580d55d2c9b913f11d774adb32615ab6ad99c1b',
  up(database) {
    database.exec(`
      CREATE TABLE bibliography_connectors (
        connector_id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL CHECK (length(project_id) BETWEEN 1 AND 128),
        source_path TEXT NOT NULL CHECK (length(source_path) BETWEEN 1 AND 32768),
        source_basename TEXT NOT NULL CHECK (length(source_basename) BETWEEN 1 AND 1024),
        source_format TEXT NOT NULL CHECK (source_format IN ('better-csl-json', 'bibtex')),
        state TEXT NOT NULL CHECK (state IN ('ready', 'refreshing', 'error', 'disconnected')),
        last_snapshot_sha256 TEXT CHECK (last_snapshot_sha256 IS NULL OR (
          length(last_snapshot_sha256) = 64
          AND last_snapshot_sha256 NOT GLOB '*[^0-9a-f]*'
        )),
        last_error_code TEXT CHECK (last_error_code IS NULL OR length(last_error_code) <= 100),
        last_refreshed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (project_id),
        UNIQUE (project_id, source_path)
      ) STRICT;

      CREATE INDEX bibliography_connectors_project_idx
        ON bibliography_connectors(project_id, updated_at DESC);
    `)
  }
}
