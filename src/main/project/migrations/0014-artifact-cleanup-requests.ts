import type { DatabaseMigration } from '../../db/migrations'

export const migration0014: DatabaseMigration = {
  version: 14,
  name: '0014-artifact-cleanup-requests',
  checksum: 'sha256:6f01e56ab2a9f1fd2dc74f7f9a87b4efb1e79ed8da3c3a0f3ce18b3ee1d5d1b2',
  up(database) {
    database.exec(`
      CREATE TABLE artifact_cleanup_requests (
        cleanup_id TEXT PRIMARY KEY NOT NULL,
        knowledge_item_id TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (reason IN ('cancelled', 'deleted')),
        parse_task_ids_json TEXT NOT NULL CHECK (
          json_valid(parse_task_ids_json) AND json_type(parse_task_ids_json) = 'array'
        ),
        parse_revision_ids_json TEXT NOT NULL CHECK (
          json_valid(parse_revision_ids_json) AND json_type(parse_revision_ids_json) = 'array'
        ),
        normalization_run_ids_json TEXT NOT NULL CHECK (
          json_valid(normalization_run_ids_json) AND json_type(normalization_run_ids_json) = 'array'
        ),
        staging_relative_paths_json TEXT NOT NULL CHECK (
          json_valid(staging_relative_paths_json) AND json_type(staging_relative_paths_json) = 'array'
        ),
        state TEXT NOT NULL DEFAULT 'queued'
          CHECK (state IN ('queued', 'running', 'succeeded')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      ) STRICT;

      CREATE INDEX artifact_cleanup_requests_state_idx
        ON artifact_cleanup_requests(state, updated_at, cleanup_id);
    `)
  }
}
