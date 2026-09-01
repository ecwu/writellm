import type { DatabaseMigration } from '../../db/migrations'

interface SchemaObjectRow {
  name: string
  sql: string
}

export const migration0042: DatabaseMigration = {
  version: 42,
  name: '0042-agent-request-retry',
  checksum: 'sha256:ec930806c4133037fe5d181d794f2771753f509043089e766994d70c51bc44ca',
  up(database) {
    database.pragma('defer_foreign_keys = ON')
    database.pragma('legacy_alter_table = ON')

    const dependentTableNames = [
      'mutation_proposals',
      'review_issues',
      'review_issue_events',
      'manuscript_asset_variants'
    ] as const
    const dependentTables = database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
          WHERE type = 'table'
            AND name IN (
              'mutation_proposals', 'review_issues', 'review_issue_events',
              'manuscript_asset_variants'
            )
            AND sql IS NOT NULL`
      )
      .all() as SchemaObjectRow[]
    const tableDefinitions = new Map(dependentTables.map((table) => [table.name, table.sql]))
    if (dependentTableNames.some((name) => !tableDefinitions.has(name))) {
      throw new Error('Agent request retry migration found an unexpected project schema')
    }
    const indexes = database
      .prepare(
        `SELECT name, sql FROM sqlite_schema
          WHERE type = 'index' AND sql IS NOT NULL
            AND tbl_name IN (
              'agent_events', 'mutation_proposals', 'review_issues', 'review_issue_events',
              'manuscript_asset_variants'
            )
          ORDER BY name`
      )
      .all() as SchemaObjectRow[]

    for (const index of indexes) database.exec(`DROP INDEX "${index.name}"`)
    database.exec(`
      ALTER TABLE review_issue_events RENAME TO review_issue_events_v41;
      ALTER TABLE review_issues RENAME TO review_issues_v41;
      ALTER TABLE manuscript_asset_variants RENAME TO manuscript_asset_variants_v41;
      ALTER TABLE mutation_proposals RENAME TO mutation_proposals_v41;
      ALTER TABLE agent_events RENAME TO agent_events_v41;

      CREATE TABLE agent_events (
        agent_event_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        type TEXT NOT NULL CHECK (type IN (
          'user_message', 'assistant_message', 'model_retry', 'tool_attempted',
          'tool_preflight_failed', 'tool_call', 'tool_result', 'approval_decision',
          'run_interrupted', 'run_completed', 'compaction_started', 'compaction_summary',
          'compaction_failed'
        )),
        payload_json TEXT NOT NULL CHECK (
          length(CAST(payload_json AS BLOB)) <= 2097152
          AND json_valid(payload_json) AND json_type(payload_json) = 'object'
        ),
        model_request_id TEXT REFERENCES model_requests(model_request_id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        UNIQUE (agent_session_id, sequence)
      ) STRICT;

      INSERT INTO agent_events SELECT * FROM agent_events_v41;
    `)
    for (const table of dependentTableNames) {
      database.exec(tableDefinitions.get(table) as string)
      database.exec(`INSERT INTO "${table}" SELECT * FROM "${table}_v41"`)
    }
    database.exec(`
      DROP TABLE review_issue_events_v41;
      DROP TABLE review_issues_v41;
      DROP TABLE manuscript_asset_variants_v41;
      DROP TABLE mutation_proposals_v41;
      DROP TABLE agent_events_v41;
    `)
    for (const index of indexes) database.exec(index.sql)
    database.exec(`
      UPDATE agent_sessions
         SET event_schema_version = 4
       WHERE event_schema_version = 3
         AND pi_runtime_version = '0.80.10';
    `)
  }
}
