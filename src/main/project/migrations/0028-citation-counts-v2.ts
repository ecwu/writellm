import type { DatabaseMigration } from '../../db/migrations'
import { prepareSectionContent } from '../../manuscript/content'

interface LegacyRevisionRow {
  section_revision_id: string
  section_id: string
  revision_number: number
  source: string
  content_json: string
  content_schema_version: number
  content_hash: string
  prior_revision_id: string | null
  word_count: number
  character_count: number
  count_algorithm_version: number
  agent_run_id: string | null
  agent_tool_call_id: string | null
  agent_proposal_id: string | null
  created_at: string
  content_body_retained: number
  source_class: string
}

interface SchemaObjectRow {
  name: string
  sql: string
}

const DEPENDENT_TABLES = [
  'sections',
  'section_materializations',
  'mutation_proposals',
  'section_revision_assets'
] as const

export const migration0028: DatabaseMigration = {
  version: 28,
  name: '0028-citation-counts-v2',
  checksum: 'sha256:0a4de3de7750ed1ef9364a0af0f142e7d61cfa9a05d62fe85bd954fe767bb82e',
  up(database) {
    database.pragma('defer_foreign_keys = ON')
    const revisions = database
      .prepare('SELECT * FROM section_revisions ORDER BY section_id, revision_number')
      .all() as LegacyRevisionRow[]

    const tableDefinitions = new Map(
      (
        database
          .prepare(
            `SELECT name, sql FROM sqlite_schema
              WHERE type = 'table'
                AND name IN ('sections', 'section_materializations', 'mutation_proposals',
                             'section_revision_assets')`
          )
          .all() as SchemaObjectRow[]
      ).map((row) => [row.name, row.sql])
    )
    if (DEPENDENT_TABLES.some((name) => !tableDefinitions.has(name))) {
      throw new Error('Citation count migration found an unexpected project schema')
    }
    const indexDefinitions = database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
          WHERE type = 'index' AND sql IS NOT NULL
            AND tbl_name IN ('sections', 'section_revisions', 'section_materializations',
                             'mutation_proposals', 'section_revision_assets')
          ORDER BY name`
      )
      .all() as SchemaObjectRow[]

    for (const index of indexDefinitions) database.exec(`DROP INDEX "${index.name}"`)
    database.exec(`
      ALTER TABLE mutation_proposals RENAME TO mutation_proposals_v27;
      ALTER TABLE section_revision_assets RENAME TO section_revision_assets_v27;
      ALTER TABLE section_materializations RENAME TO section_materializations_v27;
      ALTER TABLE sections RENAME TO sections_v27;
      ALTER TABLE section_revisions RENAME TO section_revisions_v27;

      CREATE TABLE section_revisions (
        section_revision_id TEXT PRIMARY KEY NOT NULL,
        section_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL CHECK (revision_number > 0),
        source TEXT NOT NULL CHECK (source IN ('bootstrap', 'manual', 'import', 'agent', 'undo')),
        content_json TEXT NOT NULL
          CHECK (json_valid(content_json) AND json_type(content_json) = 'array'),
        content_schema_version INTEGER NOT NULL CHECK (content_schema_version IN (1, 2)),
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

    const insert = database.prepare(`
      INSERT INTO section_revisions (
        section_revision_id, section_id, revision_number, source, content_json,
        content_schema_version, content_hash, prior_revision_id, word_count, character_count,
        count_algorithm_version, agent_run_id, agent_tool_call_id, agent_proposal_id, created_at,
        content_body_retained, source_class
      ) VALUES (
        @section_revision_id, @section_id, @revision_number, @source, @content_json,
        @content_schema_version, @content_hash, @prior_revision_id, @word_count, @character_count,
        @count_algorithm_version, @agent_run_id, @agent_tool_call_id, @agent_proposal_id, @created_at,
        @content_body_retained, @source_class
      )
    `)
    for (const revision of revisions) {
      if (revision.content_body_retained === 0) {
        insert.run(revision)
        continue
      }
      const prepared = prepareSectionContent(JSON.parse(revision.content_json) as unknown[])
      insert.run({
        ...revision,
        word_count: prepared.wordCount,
        character_count: prepared.characterCount,
        count_algorithm_version: prepared.countAlgorithmVersion
      })
    }

    database.exec('INSERT INTO sections SELECT * FROM sections_v27')
    for (const table of DEPENDENT_TABLES.slice(1)) {
      database.exec(tableDefinitions.get(table) as string)
      database.exec(`INSERT INTO "${table}" SELECT * FROM "${table}_v27"`)
    }

    database.exec(`
      DROP TABLE mutation_proposals_v27;
      DROP TABLE section_revision_assets_v27;
      DROP TABLE section_materializations_v27;
      DROP TABLE section_revisions_v27;
      DROP TABLE sections_v27;
    `)
    for (const index of indexDefinitions) database.exec(index.sql)
    const foreignKeyViolations = database.pragma('foreign_key_check') as unknown[]
    if (foreignKeyViolations.length > 0) {
      throw new Error(
        `Citation count migration foreign key check failed: ${JSON.stringify(foreignKeyViolations)}`
      )
    }
  }
}
