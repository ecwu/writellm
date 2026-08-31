import type { DatabaseMigration } from '../../db/migrations'

export const migration0040: DatabaseMigration = {
  version: 40,
  name: '0040-agent-request-traces',
  checksum: 'sha256:0e0d47bdcf4269110659b2817751d2d18f2c813787958325017199906357da79',
  up(database) {
    database.exec(`
      CREATE TABLE agent_trace_payloads (
        payload_sha256 TEXT PRIMARY KEY NOT NULL
          CHECK (length(payload_sha256) = 64 AND payload_sha256 NOT GLOB '*[^0-9a-f]*'),
        schema_version INTEGER NOT NULL CHECK (schema_version = 1),
        payload_json TEXT NOT NULL CHECK (
          json_valid(payload_json)
          AND length(CAST(payload_json AS BLOB)) <= 8388608
        ),
        byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 8388608),
        created_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE model_request_traces (
        model_request_id TEXT PRIMARY KEY NOT NULL
          REFERENCES model_requests(model_request_id) ON DELETE CASCADE,
        purpose TEXT NOT NULL CHECK (purpose IN (
          'agent_prompt', 'agent_steer', 'agent_follow_up', 'tool_continuation',
          'session_title', 'compaction', 'agent_image'
        )),
        api_id TEXT NOT NULL CHECK (length(api_id) BETWEEN 1 AND 100),
        trace_id TEXT NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 100),
        span_id TEXT NOT NULL CHECK (length(span_id) BETWEEN 1 AND 100),
        parent_span_id TEXT CHECK (parent_span_id IS NULL OR length(parent_span_id) BETWEEN 1 AND 100),
        capture_status TEXT NOT NULL CHECK (capture_status IN ('capturing', 'complete', 'failed')),
        physical_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (physical_attempt_count >= 0),
        http_status INTEGER CHECK (http_status IS NULL OR http_status BETWEEN 100 AND 599),
        ttft_ms INTEGER CHECK (ttft_ms IS NULL OR ttft_ms >= 0),
        total_duration_ms INTEGER CHECK (total_duration_ms IS NULL OR total_duration_ms >= 0),
        failure_code TEXT CHECK (failure_code IS NULL OR length(failure_code) BETWEEN 1 AND 100),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE agent_trace_records (
        agent_trace_record_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        agent_run_id TEXT REFERENCES agent_runs(agent_run_id) ON DELETE CASCADE,
        model_request_id TEXT NOT NULL REFERENCES model_requests(model_request_id) ON DELETE CASCADE,
        tool_call_id TEXT CHECK (tool_call_id IS NULL OR length(tool_call_id) BETWEEN 1 AND 256),
        compaction_id TEXT,
        physical_attempt INTEGER NOT NULL CHECK (physical_attempt >= 1),
        document_kind TEXT NOT NULL CHECK (document_kind IN (
          'harness_request', 'provider_request', 'provider_response',
          'tool_attempt', 'skill_content', 'compaction_source'
        )),
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        json_path TEXT NOT NULL CHECK (length(json_path) BETWEEN 1 AND 4096),
        payload_sha256 TEXT NOT NULL REFERENCES agent_trace_payloads(payload_sha256) ON DELETE RESTRICT,
        metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
          json_valid(metadata_json) AND json_type(metadata_json) = 'object'
          AND length(CAST(metadata_json AS BLOB)) <= 65536
        ),
        created_at TEXT NOT NULL,
        UNIQUE (model_request_id, physical_attempt, document_kind, ordinal)
      ) STRICT;

      CREATE INDEX agent_trace_records_run_idx
        ON agent_trace_records(agent_run_id, created_at, agent_trace_record_id)
        WHERE agent_run_id IS NOT NULL;
      CREATE INDEX agent_trace_records_session_idx
        ON agent_trace_records(agent_session_id, created_at, agent_trace_record_id)
        WHERE agent_session_id IS NOT NULL;
      CREATE INDEX agent_trace_records_tool_idx
        ON agent_trace_records(tool_call_id) WHERE tool_call_id IS NOT NULL;
      CREATE INDEX agent_trace_records_payload_idx ON agent_trace_records(payload_sha256);

      CREATE VIEW agent_trace_document_v AS
      WITH RECURSIVE rebuilt(
        model_request_id, physical_attempt, document_kind, ordinal, document_json
      ) AS (
        SELECT record.model_request_id, record.physical_attempt, record.document_kind,
               record.ordinal, payload.payload_json
          FROM agent_trace_records AS record
          JOIN agent_trace_payloads AS payload USING (payload_sha256)
         WHERE record.ordinal = 0
        UNION ALL
        SELECT next.model_request_id, next.physical_attempt, next.document_kind,
               next.ordinal,
               json_set(rebuilt.document_json, next.json_path, json(payload.payload_json))
          FROM rebuilt
          JOIN agent_trace_records AS next
            ON next.model_request_id = rebuilt.model_request_id
           AND next.physical_attempt = rebuilt.physical_attempt
           AND next.document_kind = rebuilt.document_kind
           AND next.ordinal = rebuilt.ordinal + 1
          JOIN agent_trace_payloads AS payload ON payload.payload_sha256 = next.payload_sha256
      )
      SELECT rebuilt.model_request_id, rebuilt.physical_attempt, rebuilt.document_kind,
             rebuilt.document_json
        FROM rebuilt
       WHERE rebuilt.ordinal = (
         SELECT MAX(last.ordinal)
           FROM agent_trace_records AS last
          WHERE last.model_request_id = rebuilt.model_request_id
            AND last.physical_attempt = rebuilt.physical_attempt
            AND last.document_kind = rebuilt.document_kind
       );

      CREATE VIEW agent_model_request_trace_v AS
      SELECT request.model_request_id,
             request.agent_run_id,
             trace.purpose,
             trace.api_id,
             trace.trace_id,
             trace.span_id,
             trace.parent_span_id,
             COALESCE(trace.capture_status, 'legacy_unavailable') AS capture_status,
             COALESCE(trace.physical_attempt_count, 0) AS physical_attempt_count,
             trace.http_status,
             trace.ttft_ms,
             trace.total_duration_ms,
             (
               SELECT document_json FROM agent_trace_document_v AS document
                WHERE document.model_request_id = request.model_request_id
                  AND document.document_kind = 'harness_request'
                ORDER BY document.physical_attempt LIMIT 1
             ) AS harness_request_json,
             (
               SELECT json_group_array(json(document_json))
                 FROM (
                   SELECT document_json FROM agent_trace_document_v AS document
                    WHERE document.model_request_id = request.model_request_id
                      AND document.document_kind = 'provider_request'
                    ORDER BY document.physical_attempt
                 )
             ) AS provider_requests_json,
             (
               SELECT document_json FROM agent_trace_document_v AS document
                WHERE document.model_request_id = request.model_request_id
                  AND document.document_kind = 'provider_response'
                ORDER BY document.physical_attempt DESC LIMIT 1
             ) AS provider_response_json
        FROM model_requests AS request
        LEFT JOIN model_request_traces AS trace USING (model_request_id)
       WHERE request.operation_kind IN ('agent', 'image');

      CREATE VIEW agent_run_trace_v AS
      SELECT record.agent_run_id,
             record.agent_session_id,
             record.model_request_id,
             record.tool_call_id,
             record.compaction_id,
             record.created_at,
             'trace.' || record.document_kind AS kind,
             record.physical_attempt,
             record.ordinal AS sequence,
             payload.payload_json
        FROM agent_trace_records AS record
        JOIN agent_trace_payloads AS payload USING (payload_sha256)
      UNION ALL
      SELECT event.agent_run_id,
             event.agent_session_id,
             event.model_request_id,
             json_extract(event.payload_json, '$.toolCallId') AS tool_call_id,
             json_extract(event.payload_json, '$.compactionId') AS compaction_id,
             event.created_at,
             'event.' || event.type AS kind,
             0 AS physical_attempt,
             event.sequence,
             event.payload_json
        FROM agent_events AS event
       WHERE event.agent_run_id IS NOT NULL;
    `)
  }
}
