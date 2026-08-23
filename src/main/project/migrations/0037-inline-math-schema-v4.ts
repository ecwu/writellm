import { randomUUID } from 'node:crypto'
import type { DatabaseMigration } from '../../db/migrations'

interface SchemaObjectRow {
  name: string
  sql: string
}

interface CurrentRevisionRow {
  section_id: string
  section_revision_id: string
  max_revision_number: number
  content_json: string
  content_schema_version: number
  content_hash: string
  word_count: number
  character_count: number
  count_algorithm_version: number
}

const DEPENDENT_TABLES = [
  'sections',
  'section_materializations',
  'mutation_proposals',
  'section_revision_assets',
  'review_issues',
  'review_issue_events',
  'manuscript_asset_variants',
  'manuscript_annotations'
] as const

const RENAME_ORDER = [
  'manuscript_annotations',
  'manuscript_asset_variants',
  'review_issue_events',
  'review_issues',
  'mutation_proposals',
  'section_revision_assets',
  'section_materializations',
  'sections'
] as const

const RECREATE_ORDER = [
  'sections',
  'section_materializations',
  'mutation_proposals',
  'section_revision_assets',
  'review_issues',
  'review_issue_events',
  'manuscript_asset_variants',
  'manuscript_annotations'
] as const

export const migration0037: DatabaseMigration = {
  version: 37,
  name: '0037-inline-math-schema-v4',
  checksum: 'sha256:763dd37377ab3244945a4703f106411303290288bad5d63136401dc8fcdf07e4',
  up(database) {
    database.pragma('defer_foreign_keys = ON')
    database.pragma('legacy_alter_table = ON')
    try {
      const tableDefinitions = new Map(
        (
          database
            .prepare(
              `SELECT name, sql FROM sqlite_schema
                WHERE type = 'table'
                  AND name IN (${DEPENDENT_TABLES.map(() => '?').join(', ')})`
            )
            .all(...DEPENDENT_TABLES) as SchemaObjectRow[]
        ).map((row) => [row.name, row.sql])
      )
      if (DEPENDENT_TABLES.some((name) => !tableDefinitions.has(name))) {
        throw new Error('Inline math migration found an unexpected project schema')
      }
      const indexDefinitions = database
        .prepare(
          `SELECT name, sql FROM sqlite_schema
            WHERE type = 'index' AND sql IS NOT NULL
              AND tbl_name IN ('sections', 'section_revisions', 'section_materializations',
                               'mutation_proposals', 'section_revision_assets', 'review_issues',
                               'review_issue_events', 'manuscript_asset_variants',
                               'manuscript_annotations')
            ORDER BY name`
        )
        .all() as SchemaObjectRow[]

      for (const index of indexDefinitions) database.exec(`DROP INDEX "${index.name}"`)
      for (const table of RENAME_ORDER) {
        database.exec(`ALTER TABLE "${table}" RENAME TO "${table}_v36"`)
      }
      database.exec('ALTER TABLE section_revisions RENAME TO section_revisions_v36')

      // `sections` and `section_revisions` form a deliberate foreign-key cycle. SQLite permits
      // creating a table whose parent is not present yet, so restore both table definitions before
      // copying either side of the cycle.
      database.exec(tableDefinitions.get('sections') as string)

      database.exec(`
        CREATE TABLE section_revisions (
          section_revision_id TEXT PRIMARY KEY NOT NULL,
          section_id TEXT NOT NULL,
          revision_number INTEGER NOT NULL CHECK (revision_number > 0),
          source TEXT NOT NULL CHECK (source IN ('bootstrap', 'manual', 'import', 'agent', 'undo')),
          content_json TEXT NOT NULL
            CHECK (json_valid(content_json) AND json_type(content_json) = 'array'),
          content_schema_version INTEGER NOT NULL CHECK (content_schema_version IN (1, 2, 3, 4)),
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

      database.exec('INSERT INTO section_revisions SELECT * FROM section_revisions_v36')
      database.exec('INSERT INTO sections SELECT * FROM sections_v36')
      for (const table of RECREATE_ORDER.filter((name) => name !== 'sections')) {
        database.exec(tableDefinitions.get(table) as string)
        database.exec(`INSERT INTO "${table}" SELECT * FROM "${table}_v36"`)
      }

      for (const table of RENAME_ORDER) database.exec(`DROP TABLE "${table}_v36"`)
      database.exec('DROP TABLE section_revisions_v36')
      for (const index of indexDefinitions) database.exec(index.sql)

      const current = database
        .prepare(
          `SELECT revision.section_id, revision.section_revision_id,
                  (SELECT MAX(candidate.revision_number)
                     FROM section_revisions candidate
                    WHERE candidate.section_id = revision.section_id) AS max_revision_number,
                  revision.content_json, revision.content_schema_version, revision.content_hash,
                  revision.word_count, revision.character_count, revision.count_algorithm_version
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
      const copyAssets = database.prepare(`
        INSERT INTO section_revision_assets (section_revision_id, asset_id)
        SELECT ?, asset_id FROM section_revision_assets WHERE section_revision_id = ?
      `)
      const advance = database.prepare(`
        UPDATE sections SET current_revision_id = ?, updated_at = ?
        WHERE section_id = ? AND current_revision_id = ?
      `)
      const invalidateMaterialization = database.prepare(
        'DELETE FROM section_materializations WHERE section_id = ?'
      )
      for (const revision of current) {
        if (revision.content_schema_version !== 3 || revision.count_algorithm_version !== 2) {
          throw new Error('Inline math migration found a stale active section revision')
        }
        const migratedRevisionId = randomUUID()
        insert.run(
          migratedRevisionId,
          revision.section_id,
          revision.max_revision_number + 1,
          revision.content_json,
          4,
          revision.content_hash,
          revision.section_revision_id,
          revision.word_count,
          revision.character_count,
          revision.count_algorithm_version,
          now
        )
        copyAssets.run(migratedRevisionId, revision.section_revision_id)
        const result = advance.run(
          migratedRevisionId,
          now,
          revision.section_id,
          revision.section_revision_id
        )
        if (result.changes !== 1) throw new Error('Inline math migration lost its revision CAS')
        invalidateMaterialization.run(revision.section_id)
      }

      const foreignKeyViolations = database.pragma('foreign_key_check') as unknown[]
      if (foreignKeyViolations.length > 0) {
        throw new Error(
          `Inline math migration foreign key check failed: ${JSON.stringify(foreignKeyViolations)}`
        )
      }
      const integrity = database.pragma('integrity_check', { simple: true })
      if (integrity !== 'ok') {
        throw new Error(`Inline math migration integrity check failed: ${String(integrity)}`)
      }
    } finally {
      database.pragma('legacy_alter_table = OFF')
    }
  }
}
