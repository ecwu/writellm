import type { DatabaseMigration } from '../../db/migrations'

export const migration0011: DatabaseMigration = {
  version: 11,
  name: '0011-knowledge-normalization',
  checksum: 'sha256:5fbf9d75ce70edbd8e890bbc9bc78585fe2cb2b5c18f87804c9f85fcf8cb6338',
  up(database) {
    database.exec(`
      CREATE TABLE normalization_runs (
        normalization_run_id TEXT PRIMARY KEY NOT NULL,
        parse_revision_id TEXT NOT NULL,
        knowledge_item_id TEXT NOT NULL,
        normalizer_version INTEGER NOT NULL CHECK (normalizer_version >= 1),
        state TEXT NOT NULL CHECK (state IN ('staging', 'published', 'failed')),
        relative_path TEXT NOT NULL UNIQUE,
        source_manifest_sha256 TEXT NOT NULL
          CHECK (length(source_manifest_sha256) = 64 AND source_manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
        blocks_sha256 TEXT
          CHECK (blocks_sha256 IS NULL OR (length(blocks_sha256) = 64 AND blocks_sha256 NOT GLOB '*[^0-9a-f]*')),
        document_sha256 TEXT
          CHECK (document_sha256 IS NULL OR (length(document_sha256) = 64 AND document_sha256 NOT GLOB '*[^0-9a-f]*')),
        manifest_sha256 TEXT
          CHECK (manifest_sha256 IS NULL OR (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*')),
        block_count INTEGER CHECK (block_count IS NULL OR block_count >= 0),
        asset_count INTEGER CHECK (asset_count IS NULL OR asset_count >= 0),
        error_code TEXT,
        created_at TEXT NOT NULL,
        published_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (knowledge_item_id, parse_revision_id)
          REFERENCES parse_revisions(knowledge_item_id, parse_revision_id) ON DELETE CASCADE,
        UNIQUE (parse_revision_id, normalizer_version),
        UNIQUE (knowledge_item_id, normalization_run_id)
      ) STRICT;

      CREATE INDEX normalization_runs_revision_idx
        ON normalization_runs(parse_revision_id, normalizer_version DESC);

      CREATE TABLE active_parse_revisions (
        knowledge_item_id TEXT PRIMARY KEY NOT NULL,
        parse_revision_id TEXT NOT NULL UNIQUE,
        normalization_run_id TEXT NOT NULL UNIQUE,
        activated_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (knowledge_item_id, parse_revision_id)
          REFERENCES parse_revisions(knowledge_item_id, parse_revision_id) ON DELETE CASCADE,
        FOREIGN KEY (knowledge_item_id, normalization_run_id)
          REFERENCES normalization_runs(knowledge_item_id, normalization_run_id) ON DELETE CASCADE
      ) STRICT;
    `)
  }
}
