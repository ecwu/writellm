import type { DatabaseMigration } from '../../db/migrations'

export const migration0009: DatabaseMigration = {
  version: 9,
  name: '0009-model-requests',
  checksum: 'sha256:89b95c839fd8ce7994afac6789eb67ce370d57e4ebd0200d3182c4b15ab67d9e',
  up(database) {
    database.exec(`
      CREATE TABLE model_requests (
        model_request_id TEXT PRIMARY KEY NOT NULL,
        operation_kind TEXT NOT NULL
          CHECK (operation_kind IN ('agent', 'embedding', 'rerank')),
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        provider_fingerprint TEXT NOT NULL
          CHECK (length(provider_fingerprint) = 64 AND provider_fingerprint NOT GLOB '*[^0-9a-f]*'),
        request_fingerprint TEXT NOT NULL
          CHECK (length(request_fingerprint) = 64 AND request_fingerprint NOT GLOB '*[^0-9a-f]*'),
        status TEXT NOT NULL
          CHECK (status IN ('running', 'succeeded', 'failed', 'aborted')),
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

      CREATE INDEX model_requests_operation_started_idx
        ON model_requests(operation_kind, started_at DESC);
      CREATE INDEX model_requests_job_idx
        ON model_requests(job_id) WHERE job_id IS NOT NULL;
      CREATE INDEX model_requests_agent_run_idx
        ON model_requests(agent_run_id) WHERE agent_run_id IS NOT NULL;
    `)
  }
}
