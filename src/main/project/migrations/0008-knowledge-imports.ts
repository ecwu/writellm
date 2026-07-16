import type { DatabaseMigration } from '../../db/migrations'

export const migration0008: DatabaseMigration = {
  version: 8,
  name: '0008-knowledge-imports',
  checksum: 'sha256:6eb4d1ae3d72c11b53bd0706c21af5c63f08a0fb6f07cf39b89a8e0de8587aed',
  up(database) {
    database.exec(`
      CREATE TABLE file_records (
        file_record_id TEXT PRIMARY KEY NOT NULL,
        sha256 TEXT NOT NULL UNIQUE
          CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
        byte_size INTEGER NOT NULL CHECK (byte_size > 0),
        mime_type TEXT NOT NULL,
        extension TEXT NOT NULL,
        relative_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE knowledge_items (
        knowledge_item_id TEXT PRIMARY KEY NOT NULL,
        file_record_id TEXT UNIQUE,
        original_name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        state TEXT NOT NULL
          CHECK (state IN ('importing', 'stored', 'failed', 'cancelled')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (file_record_id) REFERENCES file_records(file_record_id) ON DELETE RESTRICT
      ) STRICT;

      CREATE TABLE imports (
        import_id TEXT PRIMARY KEY NOT NULL,
        knowledge_item_id TEXT NOT NULL,
        state TEXT NOT NULL
          CHECK (state IN ('copying', 'stored', 'failed', 'cancelled')),
        bytes_copied INTEGER NOT NULL DEFAULT 0 CHECK (bytes_copied >= 0),
        cancellation_requested INTEGER NOT NULL DEFAULT 0
          CHECK (cancellation_requested IN (0, 1)),
        error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (knowledge_item_id) REFERENCES knowledge_items(knowledge_item_id) ON DELETE CASCADE
      ) STRICT;

      CREATE INDEX imports_knowledge_item_idx ON imports(knowledge_item_id, created_at DESC);
      CREATE INDEX knowledge_items_state_idx ON knowledge_items(state, updated_at DESC);
    `)
  }
}
