import type { DatabaseMigration } from '../../db/migrations'

export const migration0036: DatabaseMigration = {
  version: 36,
  name: '0036-manuscript-annotations',
  checksum: 'sha256:61cfab23d490779d349a61b363274e69810302760b4017d79460fd85e0fa129a',
  up(database) {
    database.exec(`
      CREATE TABLE manuscript_annotations (
        annotation_id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('note', 'todo')),
        status TEXT NOT NULL CHECK (status IN ('open', 'resolved')),
        body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 8192),
        section_id TEXT NOT NULL REFERENCES sections(section_id) ON DELETE RESTRICT,
        block_id TEXT NOT NULL CHECK (length(block_id) BETWEEN 1 AND 256),
        anchor_revision_id TEXT NOT NULL
          REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
        text_anchor TEXT CHECK (text_anchor IS NULL OR length(text_anchor) BETWEEN 1 AND 512),
        text_anchor_fingerprint TEXT CHECK (
          text_anchor_fingerprint IS NULL OR
          (length(text_anchor_fingerprint) = 64 AND text_anchor_fingerprint GLOB '[0-9a-f]*')
        ),
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT,
        CHECK ((text_anchor IS NULL) = (text_anchor_fingerprint IS NULL)),
        CHECK ((status = 'resolved') = (resolved_at IS NOT NULL))
      ) STRICT;

      CREATE INDEX manuscript_annotations_status_idx
        ON manuscript_annotations(status, updated_at DESC, annotation_id);
      CREATE INDEX manuscript_annotations_section_idx
        ON manuscript_annotations(section_id, status, updated_at DESC, annotation_id);
      CREATE INDEX manuscript_annotations_anchor_idx
        ON manuscript_annotations(section_id, block_id);
    `)
    const violations = database.pragma('foreign_key_check') as unknown[]
    if (violations.length > 0) {
      throw new Error(
        `Manuscript annotations migration foreign key check failed: ${JSON.stringify(violations)}`
      )
    }
  }
}
