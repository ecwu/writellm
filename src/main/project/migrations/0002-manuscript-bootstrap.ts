import type { DatabaseMigration } from '../../db/migrations'

export const migration0002: DatabaseMigration = {
  version: 2,
  name: '0002-manuscript-bootstrap',
  checksum: 'sha256:66b0d257bdaf45d8b1ecfa927b21b52de70e6f53c9b9af46a2f7b1b2c4c59390',
  up(database) {
    database.exec(`
      CREATE TABLE manuscripts (
        manuscript_id TEXT PRIMARY KEY NOT NULL,
        project_id TEXT NOT NULL,
        is_primary INTEGER NOT NULL DEFAULT 1 CHECK (is_primary IN (0, 1)),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES project_meta(project_id) ON DELETE CASCADE,
        UNIQUE (project_id, manuscript_id)
      ) STRICT;

      CREATE UNIQUE INDEX manuscripts_one_primary_per_project
        ON manuscripts(project_id)
        WHERE is_primary = 1;

      CREATE TABLE manuscript_briefs (
        manuscript_brief_id TEXT PRIMARY KEY NOT NULL,
        manuscript_id TEXT NOT NULL,
        version INTEGER NOT NULL CHECK (version > 0),
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        topic TEXT NOT NULL DEFAULT '',
        target_audience TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT '',
        style_tone TEXT NOT NULL DEFAULT '',
        scope_exclusions TEXT NOT NULL DEFAULT '',
        target_length TEXT NOT NULL DEFAULT '',
        citation_requirements TEXT NOT NULL DEFAULT '',
        additional_instructions TEXT NOT NULL DEFAULT '',
        extensible_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(extensible_json) AND json_type(extensible_json) = 'object'),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (manuscript_id) REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
        UNIQUE (manuscript_id, version)
      ) STRICT;

      CREATE TABLE sections (
        section_id TEXT PRIMARY KEY NOT NULL,
        manuscript_id TEXT NOT NULL,
        parent_section_id TEXT,
        position INTEGER NOT NULL CHECK (position >= 0),
        level INTEGER NOT NULL CHECK (level >= 1),
        title TEXT NOT NULL,
        objective TEXT,
        status TEXT NOT NULL DEFAULT 'planned'
          CHECK (status IN ('planned', 'drafting', 'completed')),
        current_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (manuscript_id) REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
        FOREIGN KEY (manuscript_id, parent_section_id)
          REFERENCES sections(manuscript_id, section_id) ON DELETE RESTRICT,
        UNIQUE (manuscript_id, section_id)
      ) STRICT;

      CREATE UNIQUE INDEX sections_unique_root_position
        ON sections(manuscript_id, position)
        WHERE parent_section_id IS NULL;

      CREATE UNIQUE INDEX sections_unique_child_position
        ON sections(manuscript_id, parent_section_id, position)
        WHERE parent_section_id IS NOT NULL;

      CREATE INDEX sections_outline_order
        ON sections(manuscript_id, parent_section_id, position);
    `)
  }
}
