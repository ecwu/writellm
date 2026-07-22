import type { DatabaseMigration } from '../../db/migrations'

export const migration0019: DatabaseMigration = {
  version: 19,
  name: '0019-section-proposal-refresh',
  checksum: 'sha256:12e7266e59c4a2aac156d90d88f6d3c7f2b0d72d177b33d518489a0243db0c71',
  up(database) {
    database.exec(`
      DROP INDEX mutation_proposals_run_idx;
      DROP INDEX mutation_proposals_status_idx;
      ALTER TABLE mutation_proposals RENAME TO mutation_proposals_v18;

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
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
          'pending', 'approved', 'rejected', 'applied', 'failed', 'undone',
          'superseded', 'conflicted', 'satisfied'
        )),
        decision_at TEXT,
        applied_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
        applied_brief_version INTEGER CHECK (
          applied_brief_version IS NULL OR applied_brief_version > 0
        ),
        applied_outline_version INTEGER CHECK (
          applied_outline_version IS NULL OR applied_outline_version > 0
        ),
        undo_revision_id TEXT REFERENCES section_revisions(section_revision_id) ON DELETE RESTRICT,
        replaces_proposal_id TEXT UNIQUE
          REFERENCES mutation_proposals(mutation_proposal_id) ON DELETE CASCADE,
        rejected_reason TEXT CHECK (rejected_reason IS NULL OR length(rejected_reason) <= 4096),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        CHECK (replaces_proposal_id IS NULL OR replaces_proposal_id <> mutation_proposal_id),
        CHECK (
          (kind = 'brief_update' AND base_revision_id IS NULL
            AND base_brief_version IS NOT NULL AND base_outline_version IS NULL)
          OR
          (kind = 'outline_patch' AND base_revision_id IS NULL
            AND base_brief_version IS NULL AND base_outline_version IS NOT NULL)
          OR
          (kind = 'section_patch' AND base_revision_id IS NOT NULL
            AND base_brief_version IS NULL AND base_outline_version IS NULL)
        ),
        CHECK (
          (status = 'pending' AND decision_at IS NULL)
          OR (status <> 'pending' AND decision_at IS NOT NULL)
        ),
        CHECK (
          (status IN (
            'pending', 'approved', 'rejected', 'failed', 'superseded', 'conflicted', 'satisfied'
          )
            AND applied_revision_id IS NULL
            AND applied_brief_version IS NULL
            AND applied_outline_version IS NULL
            AND undo_revision_id IS NULL)
          OR
          (status = 'applied' AND undo_revision_id IS NULL AND (
            (kind = 'brief_update' AND applied_revision_id IS NULL
              AND applied_brief_version = base_brief_version + 1
              AND applied_outline_version IS NULL)
            OR
            (kind = 'outline_patch' AND applied_revision_id IS NULL
              AND applied_brief_version IS NULL
              AND applied_outline_version = base_outline_version + 1)
            OR
            (kind = 'section_patch' AND applied_revision_id IS NOT NULL
              AND applied_brief_version IS NULL AND applied_outline_version IS NULL)
          ))
          OR
          (status = 'undone' AND kind = 'section_patch'
            AND applied_revision_id IS NOT NULL AND undo_revision_id IS NOT NULL
            AND applied_revision_id <> undo_revision_id
            AND applied_brief_version IS NULL AND applied_outline_version IS NULL)
        ),
        CHECK (
          (status IN ('rejected', 'failed', 'superseded', 'conflicted', 'satisfied')
            AND rejected_reason IS NOT NULL)
          OR
          (status NOT IN ('rejected', 'failed', 'superseded', 'conflicted', 'satisfied')
            AND rejected_reason IS NULL)
        )
      ) STRICT;

      INSERT INTO mutation_proposals (
        mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
        agent_tool_call_id, kind, payload_json, base_revision_id, base_brief_version,
        base_outline_version, status, decision_at, applied_revision_id,
        applied_brief_version, applied_outline_version, undo_revision_id,
        replaces_proposal_id, rejected_reason, created_at, updated_at
      )
      SELECT
        mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
        agent_tool_call_id, kind, payload_json, base_revision_id, base_brief_version,
        base_outline_version, status, decision_at, applied_revision_id,
        applied_brief_version, applied_outline_version, undo_revision_id,
        NULL, rejected_reason, created_at, updated_at
      FROM mutation_proposals_v18;

      DROP TABLE mutation_proposals_v18;

      CREATE INDEX mutation_proposals_run_idx
        ON mutation_proposals(agent_run_id, created_at);
      CREATE INDEX mutation_proposals_status_idx
        ON mutation_proposals(status, updated_at DESC);
    `)
  }
}
