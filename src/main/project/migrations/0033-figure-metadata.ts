import { randomUUID } from 'node:crypto'
import type { DatabaseMigration } from '../../db/migrations'
import { prepareSectionContent } from '../../manuscript/content'

interface SchemaObjectRow {
  name: string
  sql: string
}

interface CurrentRevisionRow {
  section_id: string
  section_revision_id: string
  max_revision_number: number
  content_json: string
}

const DEPENDENT_TABLES = [
  'sections',
  'section_materializations',
  'mutation_proposals',
  'section_revision_assets',
  'review_issues',
  'review_issue_events'
] as const

export const migration0033: DatabaseMigration = {
  version: 33,
  name: '0033-figure-metadata',
  checksum: 'sha256:92a1960f87ac60eec8f65f27ae1a3f7d5b99f71bedee3f9eb9cc79d7e624cd0b',
  up(database) {
    database.pragma('defer_foreign_keys = ON')
    database.pragma('legacy_alter_table = ON')
    const tableDefinitions = new Map(
      (
        database
          .prepare(
            `SELECT name, sql FROM sqlite_schema
              WHERE type = 'table'
                AND name IN ('sections', 'section_materializations', 'mutation_proposals',
                             'section_revision_assets', 'review_issues', 'review_issue_events')`
          )
          .all() as SchemaObjectRow[]
      ).map((row) => [row.name, row.sql])
    )
    if (DEPENDENT_TABLES.some((name) => !tableDefinitions.has(name))) {
      throw new Error('Figure metadata migration found an unexpected project schema')
    }
    const indexDefinitions = database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
          WHERE type = 'index' AND sql IS NOT NULL
            AND tbl_name IN ('sections', 'section_revisions', 'section_materializations',
                             'mutation_proposals', 'section_revision_assets', 'review_issues',
                             'review_issue_events')
          ORDER BY name`
      )
      .all() as SchemaObjectRow[]

    for (const index of indexDefinitions) database.exec(`DROP INDEX "${index.name}"`)
    database.exec(`
      ALTER TABLE review_issue_events RENAME TO review_issue_events_v32;
      ALTER TABLE review_issues RENAME TO review_issues_v32;
      ALTER TABLE mutation_proposals RENAME TO mutation_proposals_v32;
      ALTER TABLE section_revision_assets RENAME TO section_revision_assets_v32;
      ALTER TABLE section_materializations RENAME TO section_materializations_v32;
      ALTER TABLE sections RENAME TO sections_v32;
      ALTER TABLE section_revisions RENAME TO section_revisions_v32;

      CREATE TABLE section_revisions (
        section_revision_id TEXT PRIMARY KEY NOT NULL,
        section_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL CHECK (revision_number > 0),
        source TEXT NOT NULL CHECK (source IN ('bootstrap', 'manual', 'import', 'agent', 'undo')),
        content_json TEXT NOT NULL
          CHECK (json_valid(content_json) AND json_type(content_json) = 'array'),
        content_schema_version INTEGER NOT NULL CHECK (content_schema_version IN (1, 2, 3)),
        content_hash TEXT NOT NULL
          CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
        prior_revision_id TEXT,
        word_count INTEGER NOT NULL CHECK (word_count >= 0),
        character_count INTEGER NOT NULL CHECK (character_count >= 0),
        count_algorithm_version INTEGER NOT NULL CHECK (count_algorithm_version IN (1, 2)),
        agent_run_id TEXT,
        agent_tool_call_id TEXT,
        agent_proposal_id TEXT,
        created_at TEXT NOT NULL,
        content_body_retained INTEGER NOT NULL DEFAULT 1
          CHECK (content_body_retained IN (0, 1)),
        source_class TEXT NOT NULL DEFAULT 'manual_autosave'
          CHECK (source_class IN ('manual_autosave', 'manual_checkpoint', 'agent_accepted', 'import')),
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
    `)

    database.exec(tableDefinitions.get('sections') as string)
    database.exec('INSERT INTO section_revisions SELECT * FROM section_revisions_v32')
    database.exec('INSERT INTO sections SELECT * FROM sections_v32')
    for (const table of [
      'section_materializations',
      'mutation_proposals',
      'section_revision_assets',
      'review_issues',
      'review_issue_events'
    ] as const) {
      database.exec(tableDefinitions.get(table) as string)
      database.exec(`INSERT INTO "${table}" SELECT * FROM "${table}_v32"`)
    }

    database.exec(`
      DROP TABLE review_issue_events_v32;
      DROP TABLE review_issues_v32;
      DROP TABLE mutation_proposals_v32;
      DROP TABLE section_revision_assets_v32;
      DROP TABLE section_materializations_v32;
      DROP TABLE section_revisions_v32;
      DROP TABLE sections_v32;
    `)
    for (const index of indexDefinitions) database.exec(index.sql)

    const current = database
      .prepare(
        `SELECT revision.section_id, revision.section_revision_id,
                (SELECT MAX(candidate.revision_number)
                   FROM section_revisions candidate
                  WHERE candidate.section_id = revision.section_id) AS max_revision_number,
                revision.content_json
           FROM sections section
           JOIN section_revisions revision
             ON revision.section_revision_id = section.current_revision_id
          WHERE section.deleted_at IS NULL
          ORDER BY revision.section_id`
      )
      .all() as CurrentRevisionRow[]
    const now = new Date().toISOString()
    const insert = database.prepare(`
      INSERT INTO section_revisions (
        section_revision_id, section_id, revision_number, source, source_class, content_json,
        content_schema_version, content_hash, prior_revision_id, word_count, character_count,
        count_algorithm_version, agent_run_id, agent_tool_call_id, agent_proposal_id, created_at
      ) VALUES (?, ?, ?, 'import', 'import', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)
    `)
    for (const revision of current) {
      const prepared = prepareSectionContent(
        JSON.parse(revision.content_json) as unknown[],
        revision.section_id
      )
      const migratedRevisionId = randomUUID()
      insert.run(
        migratedRevisionId,
        revision.section_id,
        revision.max_revision_number + 1,
        prepared.contentJson,
        prepared.contentSchemaVersion,
        prepared.contentHash,
        revision.section_revision_id,
        prepared.wordCount,
        prepared.characterCount,
        prepared.countAlgorithmVersion,
        now
      )
      database
        .prepare(
          `INSERT INTO section_revision_assets (section_revision_id, asset_id)
           SELECT ?, asset_id FROM section_revision_assets WHERE section_revision_id = ?`
        )
        .run(migratedRevisionId, revision.section_revision_id)
      database
        .prepare(
          `UPDATE sections SET current_revision_id = ?, updated_at = ?
            WHERE section_id = ? AND current_revision_id = ?`
        )
        .run(migratedRevisionId, now, revision.section_id, revision.section_revision_id)
      database
        .prepare('DELETE FROM section_materializations WHERE section_id = ?')
        .run(revision.section_id)
    }

    const foreignKeyViolations = database.pragma('foreign_key_check') as unknown[]
    if (foreignKeyViolations.length > 0) {
      throw new Error(
        `Figure metadata migration foreign key check failed: ${JSON.stringify(foreignKeyViolations)}`
      )
    }
    database.pragma('legacy_alter_table = OFF')
  }
}
