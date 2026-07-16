import type { DatabaseMigration } from '../../db/migrations'

export const migration0010: DatabaseMigration = {
  version: 10,
  name: '0010-mineru-parse-workflow',
  checksum: 'sha256:997bf0cf918b439423b9348060dedde126ca7deca82e4a8bed339fbe599ad3cc',
  up(database) {
    database.exec(`
      CREATE TABLE parse_tasks (
        parse_task_id TEXT PRIMARY KEY NOT NULL,
        knowledge_item_id TEXT NOT NULL,
        source_file_record_id TEXT NOT NULL,
        provider_id TEXT NOT NULL CHECK (provider_id = 'mineru'),
        provider_fingerprint TEXT NOT NULL
          CHECK (length(provider_fingerprint) = 64 AND provider_fingerprint NOT GLOB '*[^0-9a-f]*'),
        model_version TEXT NOT NULL
          CHECK (model_version IN ('pipeline', 'vlm', 'MinerU-HTML')),
        state TEXT NOT NULL CHECK (state IN (
          'queued', 'allocating', 'awaiting_upload', 'polling', 'downloading',
          'extracting', 'publishing', 'succeeded', 'failed', 'cancelled'
        )),
        remote_task_id TEXT UNIQUE,
        upload_url_ciphertext TEXT,
        download_url_ciphertext TEXT,
        remote_state TEXT CHECK (remote_state IS NULL OR remote_state IN (
          'waiting-file', 'pending', 'running', 'converting', 'done', 'failed'
        )),
        trace_id TEXT,
        poll_count INTEGER NOT NULL DEFAULT 0 CHECK (poll_count >= 0),
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        error_code TEXT,
        submitted_at TEXT,
        uploaded_at TEXT,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (knowledge_item_id) REFERENCES knowledge_items(knowledge_item_id) ON DELETE CASCADE,
        FOREIGN KEY (source_file_record_id) REFERENCES file_records(file_record_id) ON DELETE RESTRICT,
        UNIQUE (knowledge_item_id, parse_task_id)
      ) STRICT;

      CREATE UNIQUE INDEX parse_tasks_one_active_per_item
        ON parse_tasks(knowledge_item_id)
        WHERE state NOT IN ('succeeded', 'failed', 'cancelled');
      CREATE INDEX parse_tasks_remote_state_idx ON parse_tasks(remote_state, updated_at);

      CREATE TABLE parse_revisions (
        parse_revision_id TEXT PRIMARY KEY NOT NULL,
        parse_task_id TEXT NOT NULL UNIQUE,
        knowledge_item_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL CHECK (revision_number >= 1),
        state TEXT NOT NULL CHECK (state IN ('staging', 'raw_published', 'failed')),
        source_sha256 TEXT NOT NULL
          CHECK (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'),
        provider_id TEXT NOT NULL CHECK (provider_id = 'mineru'),
        provider_api_version TEXT NOT NULL CHECK (provider_api_version = 'v4'),
        provider_fingerprint TEXT NOT NULL
          CHECK (length(provider_fingerprint) = 64 AND provider_fingerprint NOT GLOB '*[^0-9a-f]*'),
        model_version TEXT NOT NULL
          CHECK (model_version IN ('pipeline', 'vlm', 'MinerU-HTML')),
        remote_task_id TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        archive_sha256 TEXT
          CHECK (archive_sha256 IS NULL OR (length(archive_sha256) = 64 AND archive_sha256 NOT GLOB '*[^0-9a-f]*')),
        archive_byte_size INTEGER CHECK (archive_byte_size IS NULL OR archive_byte_size >= 0),
        expanded_byte_size INTEGER CHECK (expanded_byte_size IS NULL OR expanded_byte_size >= 0),
        file_count INTEGER CHECK (file_count IS NULL OR file_count >= 0),
        manifest_sha256 TEXT
          CHECK (manifest_sha256 IS NULL OR (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        published_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (knowledge_item_id, parse_task_id)
          REFERENCES parse_tasks(knowledge_item_id, parse_task_id) ON DELETE CASCADE,
        UNIQUE (knowledge_item_id, revision_number),
        UNIQUE (knowledge_item_id, parse_revision_id)
      ) STRICT;

      CREATE INDEX parse_revisions_item_idx
        ON parse_revisions(knowledge_item_id, revision_number DESC);

      CREATE TABLE parse_task_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        parse_task_id TEXT NOT NULL,
        from_state TEXT,
        to_state TEXT NOT NULL,
        event TEXT NOT NULL,
        remote_state TEXT,
        error_code TEXT,
        occurred_at TEXT NOT NULL,
        FOREIGN KEY (parse_task_id) REFERENCES parse_tasks(parse_task_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX parse_task_events_task_idx
        ON parse_task_events(parse_task_id, sequence);
    `)
  }
}
