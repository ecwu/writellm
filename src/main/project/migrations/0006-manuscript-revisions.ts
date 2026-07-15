import type { DatabaseMigration } from '../../db/migrations'

const EMPTY_CONTENT_HASH = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945'

export const migration0006: DatabaseMigration = {
  version: 6,
  name: '0006-manuscript-revisions',
  checksum: 'sha256:83ac73d96cd5caeb1ee810b7233c62bac3b9fbf3f7f10941888e2295d744b55b',
  up(database) {
    const unexplainedPointers = database
      .prepare('SELECT COUNT(*) FROM sections WHERE current_revision_id IS NOT NULL')
      .pluck()
      .get() as number
    if (unexplainedPointers !== 0) {
      throw new Error('Cannot migrate sections with unexplained current revision pointers')
    }

    database.exec(`
      ALTER TABLE manuscripts
        ADD COLUMN outline_version INTEGER NOT NULL DEFAULT 1 CHECK (outline_version > 0);

      ALTER TABLE manuscript_briefs
        ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version = 1);

      DROP INDEX sections_unique_root_position;
      DROP INDEX sections_unique_child_position;
      DROP INDEX sections_outline_order;
      ALTER TABLE sections RENAME TO sections_v5;

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
        current_revision_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (manuscript_id) REFERENCES manuscripts(manuscript_id) ON DELETE CASCADE,
        FOREIGN KEY (manuscript_id, parent_section_id)
          REFERENCES sections(manuscript_id, section_id) ON DELETE RESTRICT,
        FOREIGN KEY (section_id, current_revision_id)
          REFERENCES section_revisions(section_id, section_revision_id)
          DEFERRABLE INITIALLY DEFERRED,
        UNIQUE (manuscript_id, section_id)
      ) STRICT;

      CREATE TABLE section_revisions (
        section_revision_id TEXT PRIMARY KEY NOT NULL,
        section_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL CHECK (revision_number > 0),
        source TEXT NOT NULL CHECK (source IN ('bootstrap', 'manual', 'import', 'agent', 'undo')),
        content_json TEXT NOT NULL
          CHECK (json_valid(content_json) AND json_type(content_json) = 'array'),
        content_schema_version INTEGER NOT NULL CHECK (content_schema_version = 1),
        content_hash TEXT NOT NULL
          CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
        prior_revision_id TEXT,
        word_count INTEGER NOT NULL CHECK (word_count >= 0),
        character_count INTEGER NOT NULL CHECK (character_count >= 0),
        count_algorithm_version INTEGER NOT NULL CHECK (count_algorithm_version = 1),
        agent_run_id TEXT,
        agent_tool_call_id TEXT,
        agent_proposal_id TEXT,
        created_at TEXT NOT NULL,
        CHECK (
          (source = 'agent' AND agent_run_id IS NOT NULL AND agent_tool_call_id IS NOT NULL
            AND agent_proposal_id IS NOT NULL)
          OR
          (source <> 'agent' AND agent_run_id IS NULL AND agent_tool_call_id IS NULL
            AND agent_proposal_id IS NULL)
        ),
        FOREIGN KEY (section_id) REFERENCES sections(section_id) ON DELETE CASCADE,
        FOREIGN KEY (section_id, prior_revision_id)
          REFERENCES section_revisions(section_id, section_revision_id) ON DELETE RESTRICT,
        UNIQUE (section_id, section_revision_id),
        UNIQUE (section_id, revision_number)
      ) STRICT;

      INSERT INTO sections (
        section_id, manuscript_id, parent_section_id, position, level, title, objective,
        status, current_revision_id, created_at, updated_at
      )
      SELECT
        section_id, manuscript_id, parent_section_id, position, level, title, objective,
        status, section_id || ':revision:1', created_at, updated_at
      FROM sections_v5;

      INSERT INTO section_revisions (
        section_revision_id, section_id, revision_number, source, content_json,
        content_schema_version, content_hash, prior_revision_id, word_count, character_count,
        count_algorithm_version, agent_run_id, agent_tool_call_id, agent_proposal_id, created_at
      )
      SELECT
        section_id || ':revision:1', section_id, 1, 'bootstrap', '[]', 1,
        '${EMPTY_CONTENT_HASH}', NULL, 0, 0, 1, NULL, NULL, NULL, created_at
      FROM sections_v5;

      DROP TABLE sections_v5;

      CREATE UNIQUE INDEX sections_unique_root_position
        ON sections(manuscript_id, position)
        WHERE parent_section_id IS NULL;

      CREATE UNIQUE INDEX sections_unique_child_position
        ON sections(manuscript_id, parent_section_id, position)
        WHERE parent_section_id IS NOT NULL;

      CREATE INDEX sections_outline_order
        ON sections(manuscript_id, parent_section_id, position);

      CREATE INDEX section_revisions_history
        ON section_revisions(section_id, revision_number);
    `)
  }
}
