import type { DatabaseMigration } from '../../db/migrations'

export const migration0003: DatabaseMigration = {
  version: 3,
  name: '0003-persistent-jobs',
  checksum: 'sha256:84dd8784b85d4000bf75dc65736daca1f9af654c75258417700636a0da2dc84c',
  up(database) {
    database.exec(`
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
        attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
        max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 100),
        run_after TEXT NOT NULL,
        lease_owner TEXT,
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
            length(CAST(error_json AS BLOB)) <= 8192
            AND json_valid(error_json)
            AND json_type(error_json) = 'object'
          )
        ),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        CHECK (
          (state = 'running' AND lease_owner IS NOT NULL AND locked_until IS NOT NULL)
          OR (state <> 'running' AND lease_owner IS NULL AND locked_until IS NULL)
        ),
        CHECK (state <> 'running' OR attempts > 0),
        CHECK (
          (state IN ('succeeded', 'failed', 'cancelled') AND completed_at IS NOT NULL)
          OR (state NOT IN ('succeeded', 'failed', 'cancelled') AND completed_at IS NULL)
        )
      ) STRICT;

      CREATE INDEX jobs_claim_order
        ON jobs(state, run_after, priority DESC, created_at, job_id);

      CREATE INDEX jobs_expired_leases
        ON jobs(state, locked_until)
        WHERE state = 'running';

      CREATE UNIQUE INDEX jobs_active_deduplication
        ON jobs(type, deduplication_key)
        WHERE deduplication_key IS NOT NULL
          AND state IN ('queued', 'running', 'paused');
    `)
  }
}
