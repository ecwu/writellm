import type { DatabaseMigration } from '../../db/migrations'

export const migration0022: DatabaseMigration = {
  version: 22,
  name: '0022-rich-media-and-image-generation',
  checksum: 'sha256:82d9d6fe1abe485752c965cd89b1b705aaf7c0c927725f556dcf01266c6426eb',
  up(database) {
    database.pragma('defer_foreign_keys = ON')
    database.exec(`
      DROP TABLE IF EXISTS section_revision_assets;
      DROP TABLE IF EXISTS manuscript_assets;

      DROP INDEX mutation_proposals_run_idx;
      DROP INDEX mutation_proposals_status_idx;
      DROP INDEX agent_events_session_sequence_idx;
      DROP INDEX agent_events_run_idx;
      DROP INDEX agent_events_model_request_idx;
      DROP INDEX model_requests_operation_started_idx;
      DROP INDEX model_requests_job_idx;
      DROP INDEX model_requests_agent_run_idx;
      DROP INDEX sections_unique_root_position;
      DROP INDEX sections_unique_child_position;
      DROP INDEX sections_outline_order;
      DROP INDEX section_revisions_history;

      ALTER TABLE mutation_proposals RENAME TO mutation_proposals_v21;
      ALTER TABLE agent_events RENAME TO agent_events_v21;
      ALTER TABLE model_requests RENAME TO model_requests_v21;
      ALTER TABLE section_materializations RENAME TO section_materializations_v21;
      ALTER TABLE sections RENAME TO sections_v21;
      ALTER TABLE section_revisions RENAME TO section_revisions_v21;

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
        deleted_at TEXT CHECK (deleted_at IS NULL OR length(deleted_at) BETWEEN 20 AND 64),
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
        content_schema_version INTEGER NOT NULL CHECK (content_schema_version IN (1, 2)),
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

      INSERT INTO sections SELECT * FROM sections_v21;
      INSERT INTO section_revisions SELECT * FROM section_revisions_v21;

      CREATE TABLE section_materializations (
        section_id TEXT PRIMARY KEY NOT NULL,
        section_revision_id TEXT NOT NULL,
        content_hash TEXT NOT NULL
          CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
        relative_path TEXT NOT NULL UNIQUE,
        file_sha256 TEXT NOT NULL
          CHECK (length(file_sha256) = 64 AND file_sha256 NOT GLOB '*[^0-9a-f]*'),
        byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
        envelope_schema_version INTEGER NOT NULL CHECK (envelope_schema_version = 1),
        materialized_at TEXT NOT NULL,
        FOREIGN KEY (section_id, section_revision_id)
          REFERENCES section_revisions(section_id, section_revision_id) ON DELETE CASCADE
      ) STRICT;

      INSERT INTO section_materializations SELECT * FROM section_materializations_v21;

      CREATE TABLE model_requests (
        model_request_id TEXT PRIMARY KEY NOT NULL,
        operation_kind TEXT NOT NULL
          CHECK (operation_kind IN ('agent', 'embedding', 'rerank', 'image')),
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        provider_fingerprint TEXT NOT NULL
          CHECK (length(provider_fingerprint) = 64 AND provider_fingerprint NOT GLOB '*[^0-9a-f]*'),
        request_fingerprint TEXT NOT NULL
          CHECK (length(request_fingerprint) = 64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
        status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'aborted')),
        attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count >= 1),
        retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
        input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
        output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
        cache_read_tokens INTEGER CHECK (cache_read_tokens IS NULL OR cache_read_tokens >= 0),
        cache_write_tokens INTEGER CHECK (cache_write_tokens IS NULL OR cache_write_tokens >= 0),
        input_items INTEGER NOT NULL CHECK (input_items >= 0),
        output_items INTEGER CHECK (output_items IS NULL OR output_items >= 0),
        estimated_cost_usd_micros INTEGER
          CHECK (estimated_cost_usd_micros IS NULL OR estimated_cost_usd_micros >= 0),
        usage_json TEXT NOT NULL DEFAULT '{}'
          CHECK (json_valid(usage_json) AND json_type(usage_json) = 'object'),
        response_ids_json TEXT NOT NULL DEFAULT '[]'
          CHECK (json_valid(response_ids_json) AND json_type(response_ids_json) = 'array'),
        error_json TEXT
          CHECK (error_json IS NULL OR (json_valid(error_json) AND json_type(error_json) = 'object')),
        operation_id TEXT,
        job_id TEXT,
        agent_run_id TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO model_requests (
        model_request_id, operation_kind, provider_id, model_id, provider_fingerprint,
        request_fingerprint, status, attempt_count, retry_count, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, input_items, output_items,
        estimated_cost_usd_micros, usage_json, response_ids_json, error_json, operation_id,
        job_id, agent_run_id, started_at, completed_at, duration_ms, created_at, updated_at
      )
      SELECT
        model_request_id, operation_kind, provider_id, model_id, provider_fingerprint,
        request_fingerprint, status, attempt_count, retry_count, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, input_items, output_items,
        estimated_cost_usd_micros, usage_json, response_ids_json, error_json, operation_id,
        job_id, agent_run_id, started_at, completed_at, duration_ms, created_at, updated_at
      FROM model_requests_v21;

      CREATE TABLE agent_events (
        agent_event_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        type TEXT NOT NULL CHECK (type IN (
          'user_message', 'assistant_message', 'tool_attempted', 'tool_preflight_failed',
          'tool_call', 'tool_result', 'approval_decision', 'run_interrupted',
          'run_completed', 'compaction_summary'
        )),
        payload_json TEXT NOT NULL CHECK (
          length(CAST(payload_json AS BLOB)) <= 2097152
          AND json_valid(payload_json) AND json_type(payload_json) = 'object'
        ),
        model_request_id TEXT REFERENCES model_requests(model_request_id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        UNIQUE (agent_session_id, sequence)
      ) STRICT;

      INSERT INTO agent_events SELECT * FROM agent_events_v21;

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

      INSERT INTO mutation_proposals SELECT * FROM mutation_proposals_v21;

      DROP TABLE mutation_proposals_v21;
      DROP TABLE agent_events_v21;
      DROP TABLE model_requests_v21;
      DROP TABLE section_materializations_v21;
      DROP TABLE section_revisions_v21;
      DROP TABLE sections_v21;

      CREATE TABLE manuscript_assets (
        asset_id TEXT PRIMARY KEY NOT NULL,
        sha256 TEXT NOT NULL UNIQUE
          CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 20971520),
        mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
        extension TEXT NOT NULL CHECK (extension IN ('.png', '.jpg', '.webp')),
        relative_path TEXT NOT NULL UNIQUE,
        source_type TEXT NOT NULL CHECK (source_type IN ('upload', 'generated')),
        original_name TEXT CHECK (original_name IS NULL OR length(original_name) <= 500),
        generation_request_json TEXT CHECK (
          generation_request_json IS NULL OR (
            length(CAST(generation_request_json AS BLOB)) <= 131072
            AND json_valid(generation_request_json)
            AND json_type(generation_request_json) = 'object'
          )
        ),
        model_request_id TEXT REFERENCES model_requests(model_request_id) ON DELETE SET NULL,
        agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE SET NULL,
        agent_tool_call_id TEXT CHECK (
          agent_tool_call_id IS NULL OR length(agent_tool_call_id) BETWEEN 1 AND 256
        ),
        created_at TEXT NOT NULL,
        last_referenced_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE section_revision_assets (
        section_revision_id TEXT NOT NULL
          REFERENCES section_revisions(section_revision_id) ON DELETE CASCADE,
        asset_id TEXT NOT NULL REFERENCES manuscript_assets(asset_id) ON DELETE RESTRICT,
        PRIMARY KEY (section_revision_id, asset_id)
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX model_requests_operation_started_idx
        ON model_requests(operation_kind, started_at DESC);
      CREATE INDEX model_requests_job_idx ON model_requests(job_id) WHERE job_id IS NOT NULL;
      CREATE INDEX model_requests_agent_run_idx
        ON model_requests(agent_run_id) WHERE agent_run_id IS NOT NULL;
      CREATE INDEX agent_events_session_sequence_idx ON agent_events(agent_session_id, sequence);
      CREATE INDEX agent_events_run_idx ON agent_events(agent_run_id, sequence)
        WHERE agent_run_id IS NOT NULL;
      CREATE INDEX agent_events_model_request_idx ON agent_events(model_request_id)
        WHERE model_request_id IS NOT NULL;
      CREATE INDEX mutation_proposals_run_idx ON mutation_proposals(agent_run_id, created_at);
      CREATE INDEX mutation_proposals_status_idx ON mutation_proposals(status, updated_at DESC);
      CREATE UNIQUE INDEX sections_unique_root_position
        ON sections(manuscript_id, position)
        WHERE parent_section_id IS NULL AND deleted_at IS NULL;
      CREATE UNIQUE INDEX sections_unique_child_position
        ON sections(manuscript_id, parent_section_id, position)
        WHERE parent_section_id IS NOT NULL AND deleted_at IS NULL;
      CREATE INDEX sections_outline_order
        ON sections(manuscript_id, parent_section_id, position)
        WHERE deleted_at IS NULL;
      CREATE INDEX section_revisions_history
        ON section_revisions(section_id, revision_number);
      CREATE INDEX manuscript_assets_unreferenced_idx
        ON manuscript_assets(last_referenced_at, created_at);

    `)
  }
}
