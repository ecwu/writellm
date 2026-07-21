import type { DatabaseMigration } from '../../db/migrations'

export const migration0016: DatabaseMigration = {
  version: 16,
  name: '0016-agent-sessions',
  checksum: 'sha256:613c40d6de801db5d5c320ff1e3f2f790026534874a91be88bb2fc47b6a78fda',
  up(database) {
    database.exec(`
      CREATE TABLE agent_sessions (
        agent_session_id TEXT PRIMARY KEY NOT NULL,
        title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
        pi_runtime_version TEXT NOT NULL CHECK (length(pi_runtime_version) BETWEEN 1 AND 64),
        event_schema_version INTEGER NOT NULL CHECK (event_schema_version BETWEEN 1 AND 2147483647),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT,
        CHECK ((status = 'archived') = (archived_at IS NOT NULL))
      ) STRICT;

      CREATE TABLE agent_runs (
        agent_run_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'interrupted', 'failed')),
        provider_id TEXT NOT NULL CHECK (length(provider_id) BETWEEN 1 AND 256),
        model_id TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 500),
        provider_fingerprint TEXT NOT NULL CHECK (length(provider_fingerprint) = 64),
        model_fingerprint TEXT NOT NULL CHECK (length(model_fingerprint) = 64),
        editor_context_json TEXT NOT NULL CHECK (
          length(CAST(editor_context_json AS BLOB)) <= 65536
          AND json_valid(editor_context_json)
          AND json_type(editor_context_json) = 'object'
        ),
        error_json TEXT CHECK (
          error_json IS NULL OR (
            length(CAST(error_json AS BLOB)) <= 8192
            AND json_valid(error_json)
            AND json_type(error_json) = 'object'
          )
        ),
        started_at TEXT NOT NULL,
        completed_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (
          (status = 'running' AND completed_at IS NULL)
          OR (status <> 'running' AND completed_at IS NOT NULL)
        )
      ) STRICT;

      CREATE TABLE agent_events (
        agent_event_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        type TEXT NOT NULL CHECK (type IN (
          'user_message', 'assistant_message', 'tool_call', 'tool_result',
          'run_interrupted', 'run_completed', 'compaction_summary'
        )),
        payload_json TEXT NOT NULL CHECK (
          length(CAST(payload_json AS BLOB)) <= 2097152
          AND json_valid(payload_json)
          AND json_type(payload_json) = 'object'
        ),
        model_request_id TEXT REFERENCES model_requests(model_request_id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        UNIQUE (agent_session_id, sequence)
      ) STRICT;

      CREATE TABLE mutation_proposals (
        mutation_proposal_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        agent_run_id TEXT NOT NULL REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
        tool_call_event_id TEXT NOT NULL REFERENCES agent_events(agent_event_id) ON DELETE RESTRICT,
        agent_tool_call_id TEXT NOT NULL CHECK (length(agent_tool_call_id) BETWEEN 1 AND 256),
        kind TEXT NOT NULL CHECK (kind IN ('brief_update', 'outline_patch', 'section_patch')),
        payload_json TEXT NOT NULL CHECK (
          length(CAST(payload_json AS BLOB)) <= 1048576
          AND json_valid(payload_json)
          AND json_type(payload_json) = 'object'
        ),
        base_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
        base_brief_version INTEGER CHECK (base_brief_version IS NULL OR base_brief_version > 0),
        base_outline_version INTEGER CHECK (base_outline_version IS NULL OR base_outline_version > 0),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'approved', 'rejected', 'applied', 'failed', 'undone')),
        decision_at TEXT,
        applied_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
        rejected_reason TEXT CHECK (rejected_reason IS NULL OR length(rejected_reason) <= 4096),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (base_revision_id IS NOT NULL OR base_brief_version IS NOT NULL OR base_outline_version IS NOT NULL),
        CHECK (status <> 'rejected' OR decision_at IS NOT NULL),
        CHECK (status NOT IN ('applied', 'undone') OR applied_revision_id IS NOT NULL)
      ) STRICT;

      CREATE INDEX agent_sessions_status_updated_idx ON agent_sessions(status, updated_at DESC);
      CREATE INDEX agent_runs_session_started_idx ON agent_runs(agent_session_id, started_at DESC);
      CREATE INDEX agent_runs_status_idx ON agent_runs(status, updated_at DESC);
      CREATE INDEX agent_events_session_sequence_idx ON agent_events(agent_session_id, sequence);
      CREATE INDEX agent_events_run_idx ON agent_events(agent_run_id, sequence)
        WHERE agent_run_id IS NOT NULL;
      CREATE INDEX agent_events_model_request_idx ON agent_events(model_request_id)
        WHERE model_request_id IS NOT NULL;
      CREATE INDEX mutation_proposals_run_idx ON mutation_proposals(agent_run_id, created_at);
      CREATE INDEX mutation_proposals_status_idx ON mutation_proposals(status, updated_at DESC);
    `)
  }
}
