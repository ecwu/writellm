import type { DatabaseMigration } from '../../db/migrations'

export const migration0027: DatabaseMigration = {
  version: 27,
  name: '0027-agent-event-schema-v3',
  checksum: 'sha256:af42e174ae378fb766b3a28316f5737c7f72c8d599563c5e011e9e218fbb9c5f',
  up(database) {
    database.pragma('defer_foreign_keys = ON')
    database.exec(`
      DROP INDEX mutation_proposals_run_idx;
      DROP INDEX mutation_proposals_status_idx;
      DROP INDEX agent_events_session_sequence_idx;
      DROP INDEX agent_events_run_idx;
      DROP INDEX agent_events_model_request_idx;

      ALTER TABLE mutation_proposals RENAME TO mutation_proposals_v26;
      ALTER TABLE agent_events RENAME TO agent_events_v26;

      CREATE TABLE agent_events (
        agent_event_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        type TEXT NOT NULL CHECK (type IN (
          'user_message', 'assistant_message', 'tool_attempted', 'tool_preflight_failed',
          'tool_call', 'tool_result', 'approval_decision', 'run_interrupted', 'run_completed',
          'compaction_started', 'compaction_summary', 'compaction_failed'
        )),
        payload_json TEXT NOT NULL CHECK (
          length(CAST(payload_json AS BLOB)) <= 2097152
          AND json_valid(payload_json) AND json_type(payload_json) = 'object'
        ),
        model_request_id TEXT REFERENCES model_requests(model_request_id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        UNIQUE (agent_session_id, sequence)
      ) STRICT;

      INSERT INTO agent_events SELECT * FROM agent_events_v26;

      CREATE TABLE mutation_proposals (
        mutation_proposal_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        agent_run_id TEXT NOT NULL REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
        tool_call_event_id TEXT NOT NULL REFERENCES agent_events(agent_event_id) ON DELETE RESTRICT,
        agent_tool_call_id TEXT NOT NULL CHECK (length(agent_tool_call_id) BETWEEN 1 AND 256),
        kind TEXT NOT NULL CHECK (kind IN (
          'brief_update', 'outline_patch', 'section_patch', 'generated_image_insert'
        )),
        payload_json TEXT NOT NULL CHECK (
          length(CAST(payload_json AS BLOB)) <= 1048576
          AND json_valid(payload_json) AND json_type(payload_json) = 'object'
        ),
        base_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
        base_brief_version INTEGER CHECK (base_brief_version IS NULL OR base_brief_version > 0),
        base_outline_version INTEGER CHECK (base_outline_version IS NULL OR base_outline_version > 0),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
          'pending', 'generating', 'approved', 'rejected', 'applied', 'failed', 'undone',
          'superseded', 'conflicted', 'satisfied'
        )),
        decision_at TEXT,
        applied_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
        applied_brief_version INTEGER CHECK (applied_brief_version IS NULL OR applied_brief_version > 0),
        applied_outline_version INTEGER CHECK (applied_outline_version IS NULL OR applied_outline_version > 0),
        undo_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
        replaces_proposal_id TEXT UNIQUE REFERENCES mutation_proposals(mutation_proposal_id) ON DELETE CASCADE,
        rejected_reason TEXT CHECK (rejected_reason IS NULL OR length(rejected_reason) <= 4096),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (replaces_proposal_id IS NULL OR replaces_proposal_id <> mutation_proposal_id),
        CHECK (
          (kind = 'brief_update' AND base_revision_id IS NULL
            AND base_brief_version IS NOT NULL AND base_outline_version IS NULL)
          OR (kind = 'outline_patch' AND base_revision_id IS NULL
            AND base_brief_version IS NULL AND base_outline_version IS NOT NULL)
          OR (kind IN ('section_patch', 'generated_image_insert') AND base_revision_id IS NOT NULL
            AND base_brief_version IS NULL AND base_outline_version IS NULL)
        ),
        CHECK (
          (status = 'pending' AND decision_at IS NULL)
          OR (status <> 'pending' AND decision_at IS NOT NULL)
        ),
        CHECK (
          (status IN (
            'pending', 'generating', 'approved', 'rejected', 'failed', 'superseded',
            'conflicted', 'satisfied'
          ) AND applied_revision_id IS NULL AND applied_brief_version IS NULL
            AND applied_outline_version IS NULL AND undo_revision_id IS NULL)
          OR (status = 'applied' AND undo_revision_id IS NULL AND (
            (kind = 'brief_update' AND applied_revision_id IS NULL
              AND applied_brief_version = base_brief_version + 1
              AND applied_outline_version IS NULL)
            OR (kind = 'outline_patch' AND applied_revision_id IS NULL
              AND applied_brief_version IS NULL
              AND applied_outline_version = base_outline_version + 1)
            OR (kind IN ('section_patch', 'generated_image_insert')
              AND applied_revision_id IS NOT NULL
              AND applied_brief_version IS NULL AND applied_outline_version IS NULL)
          ))
          OR (status = 'undone' AND kind IN ('section_patch', 'generated_image_insert')
            AND applied_revision_id IS NOT NULL AND undo_revision_id IS NOT NULL
            AND applied_revision_id <> undo_revision_id
            AND applied_brief_version IS NULL AND applied_outline_version IS NULL)
        ),
        CHECK (
          (status IN ('rejected', 'failed', 'superseded', 'conflicted', 'satisfied')
            AND rejected_reason IS NOT NULL)
          OR (status NOT IN ('rejected', 'failed', 'superseded', 'conflicted', 'satisfied')
            AND rejected_reason IS NULL)
        )
      ) STRICT;

      INSERT INTO mutation_proposals SELECT * FROM mutation_proposals_v26;

      DROP TABLE mutation_proposals_v26;
      DROP TABLE agent_events_v26;

      CREATE INDEX agent_events_session_sequence_idx ON agent_events(agent_session_id, sequence);
      CREATE INDEX agent_events_run_idx ON agent_events(agent_run_id, sequence)
        WHERE agent_run_id IS NOT NULL;
      CREATE INDEX agent_events_model_request_idx ON agent_events(model_request_id)
        WHERE model_request_id IS NOT NULL;
      CREATE INDEX mutation_proposals_run_idx ON mutation_proposals(agent_run_id, created_at);
      CREATE INDEX mutation_proposals_status_idx ON mutation_proposals(status, updated_at DESC);

      UPDATE agent_sessions
         SET event_schema_version = 3
       WHERE event_schema_version = 2
         AND pi_runtime_version = '0.80.10';
    `)
  }
}
