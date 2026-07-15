import type { DatabaseMigration } from '../../db/migrations'

export const migration0004: DatabaseMigration = {
  version: 4,
  name: '0004-job-state-hardening',
  checksum: 'sha256:4c44f167a56762f2122ee683f97860e7f51d0cc47cb33b02710ff33c765f0522',
  up(database) {
    database.exec(`
      ALTER TABLE jobs RENAME TO jobs_v3;

      CREATE TABLE jobs (
        job_id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL CHECK (
          length(type) BETWEEN 1 AND 128
          AND type NOT GLOB '*[^a-z0-9._-]*'
        ),
        payload_json TEXT NOT NULL CHECK (
          length(CAST(payload_json AS BLOB)) <= 16384
          AND json_valid(payload_json)
          AND json_type(payload_json) = 'object'
        ),
        state TEXT NOT NULL DEFAULT 'queued'
          CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused')),
        priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN -1000 AND 1000),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= max_attempts),
        max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 100),
        run_after TEXT NOT NULL,
        lease_owner TEXT CHECK (lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 256),
        lease_token TEXT CHECK (lease_token IS NULL OR length(lease_token) BETWEEN 1 AND 256),
        locked_until TEXT,
        heartbeat_at TEXT,
        progress_json TEXT CHECK (
          progress_json IS NULL OR (
            length(CAST(progress_json AS BLOB)) <= 4096
            AND json_valid(progress_json)
            AND json_type(progress_json) = 'object'
          )
        ),
        deduplication_key TEXT CHECK (
          deduplication_key IS NULL OR length(deduplication_key) BETWEEN 1 AND 256
        ),
        cancellation_requested INTEGER NOT NULL DEFAULT 0
          CHECK (cancellation_requested IN (0, 1)),
        error_json TEXT CHECK (
          error_json IS NULL OR (
            length(CAST(error_json AS BLOB)) < 8192
            AND json_valid(error_json)
            AND json_type(error_json) = 'object'
          )
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        CHECK (
          (state = 'running' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND locked_until IS NOT NULL)
          OR (state <> 'running' AND lease_owner IS NULL AND lease_token IS NULL AND locked_until IS NULL)
        ),
        CHECK (state <> 'running' OR attempts > 0),
        CHECK (
          (state IN ('succeeded', 'failed', 'cancelled') AND completed_at IS NOT NULL)
          OR (state NOT IN ('succeeded', 'failed', 'cancelled') AND completed_at IS NULL)
        )
      ) STRICT;

      INSERT INTO jobs (
        job_id, type, payload_json, state, priority, attempts, max_attempts, run_after,
        lease_owner, lease_token, locked_until, heartbeat_at, progress_json,
        deduplication_key, cancellation_requested, error_json, created_at, updated_at,
        started_at, completed_at
      )
      SELECT
        job_id,
        type,
        payload_json,
        CASE
          WHEN state = 'running' AND cancellation_requested = 1 THEN 'cancelled'
          WHEN state = 'running' AND attempts >= max_attempts THEN 'failed'
          WHEN state = 'running' THEN 'queued'
          ELSE state
        END,
        priority,
        MIN(attempts, max_attempts),
        max_attempts,
        run_after,
        NULL,
        NULL,
        NULL,
        heartbeat_at,
        progress_json,
        deduplication_key,
        cancellation_requested,
        CASE
          WHEN state = 'running' THEN json_object(
            'code', 'migration_lease_recovered',
            'message', 'Interrupted job recovered during database migration',
            'retryable', json('false'),
            'attempt', MAX(1, MIN(attempts, max_attempts)),
            'recordedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
          WHEN error_json IS NOT NULL THEN json_object(
            'code', 'job_execution_failed',
            'message', 'Job execution failed',
            'retryable', json('false'),
            'attempt', MAX(1, MIN(attempts, max_attempts)),
            'recordedAt', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
          )
          ELSE NULL
        END,
        created_at,
        updated_at,
        started_at,
        CASE
          WHEN state = 'running' AND cancellation_requested = 1 THEN updated_at
          WHEN state = 'running' AND attempts >= max_attempts THEN updated_at
          WHEN state = 'running' THEN NULL
          ELSE completed_at
        END
      FROM jobs_v3;

      DROP TABLE jobs_v3;

      CREATE INDEX jobs_claim_order
        ON jobs(state, run_after, priority DESC, created_at, job_id);

      CREATE INDEX jobs_expired_leases
        ON jobs(state, locked_until)
        WHERE state = 'running';

      CREATE UNIQUE INDEX jobs_active_deduplication
        ON jobs(type, deduplication_key)
        WHERE deduplication_key IS NOT NULL
          AND state IN ('queued', 'running', 'paused');

      CREATE TABLE job_transitions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        from_state TEXT CHECK (
          from_state IS NULL OR from_state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused')
        ),
        to_state TEXT NOT NULL
          CHECK (to_state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'paused')),
        event TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 128),
        attempt INTEGER NOT NULL CHECK (attempt >= 0),
        worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 256),
        error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 128),
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX job_transitions_job_sequence ON job_transitions(job_id, sequence);

      INSERT INTO job_transitions (
        job_id, from_state, to_state, event, attempt, worker_id, error_code, occurred_at
      )
      SELECT
        job_id, NULL, state, 'migration_snapshot', attempts, NULL,
        CASE WHEN error_json IS NULL THEN NULL ELSE json_extract(error_json, '$.code') END,
        updated_at
      FROM jobs;
    `)
  }
}
