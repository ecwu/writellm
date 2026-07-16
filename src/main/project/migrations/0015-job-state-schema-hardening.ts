import type { DatabaseMigration } from '../../db/migrations'

export const migration0015: DatabaseMigration = {
  version: 15,
  name: '0015-job-state-schema-hardening',
  checksum: 'sha256:3d6f5af2b64c5ec9ac7b25f1fa2d6dcd2a90e9f9a2d8107da3b0c7c2d2a8e50f',
  up(database) {
    database.exec(`
      ALTER TABLE job_transitions RENAME TO job_transitions_v13;
      ALTER TABLE jobs RENAME TO jobs_v13;

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
          CHECK (state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
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
        resume_same_attempt INTEGER NOT NULL DEFAULT 0
          CHECK (resume_same_attempt IN (0, 1)),
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
        started_at, completed_at, resume_same_attempt
      )
      SELECT
        job_id, type, payload_json,
        CASE WHEN state = 'paused' THEN 'queued' ELSE state END,
        priority, MIN(attempts, max_attempts), max_attempts, run_after,
        lease_owner, lease_token, locked_until, heartbeat_at, progress_json,
        deduplication_key, cancellation_requested, error_json, created_at, updated_at,
        started_at, completed_at, resume_same_attempt
      FROM jobs_v13;

      CREATE TABLE job_transitions (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL REFERENCES jobs(job_id) ON DELETE CASCADE,
        from_state TEXT CHECK (
          from_state IS NULL OR from_state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
        ),
        to_state TEXT NOT NULL
          CHECK (to_state IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
        event TEXT NOT NULL CHECK (length(event) BETWEEN 1 AND 128),
        attempt INTEGER NOT NULL CHECK (attempt >= 0),
        worker_id TEXT CHECK (worker_id IS NULL OR length(worker_id) BETWEEN 1 AND 256),
        error_code TEXT CHECK (error_code IS NULL OR length(error_code) BETWEEN 1 AND 128),
        occurred_at TEXT NOT NULL
      ) STRICT;

      INSERT INTO job_transitions (
        sequence, job_id, from_state, to_state, event, attempt, worker_id, error_code, occurred_at
      )
      SELECT
        sequence, job_id,
        CASE WHEN from_state = 'paused' THEN 'queued' ELSE from_state END,
        CASE WHEN to_state = 'paused' THEN 'queued' ELSE to_state END,
        event, attempt, worker_id, error_code, occurred_at
      FROM job_transitions_v13;

      DROP TABLE job_transitions_v13;
      DROP TABLE jobs_v13;

      CREATE INDEX jobs_claim_order
        ON jobs(state, run_after, priority DESC, created_at, job_id);
      CREATE INDEX jobs_expired_leases
        ON jobs(state, locked_until)
        WHERE state = 'running';
      CREATE UNIQUE INDEX jobs_active_deduplication
        ON jobs(type, deduplication_key)
        WHERE deduplication_key IS NOT NULL
          AND state IN ('queued', 'running');
      CREATE INDEX jobs_runtime_status
        ON jobs(updated_at DESC, job_id DESC);
      CREATE INDEX job_transitions_job_sequence ON job_transitions(job_id, sequence);
    `)
  }
}
