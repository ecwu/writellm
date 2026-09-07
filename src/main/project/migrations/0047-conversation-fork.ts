import type { DatabaseMigration } from '../../db/migrations'

export const migration0047: DatabaseMigration = {
  version: 47,
  name: '0047-conversation-fork',
  checksum: 'sha256:15ebc6bc524077e0e7ed91bfb1df5754e1dc0e031399799c3b6d1ff465e03010',
  up(database) {
    database.exec(`
      CREATE TABLE agent_conversation_forks (
        agent_session_id TEXT PRIMARY KEY NOT NULL REFERENCES agent_sessions(agent_session_id),
        source_session_id TEXT NOT NULL REFERENCES agent_sessions(agent_session_id),
        target_event_id TEXT NOT NULL,
        through_sequence INTEGER NOT NULL CHECK (through_sequence > 0),
        request_id TEXT NOT NULL UNIQUE
      ) STRICT;
      CREATE TABLE agent_history_references (
        history_entry_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL REFERENCES agent_conversation_forks(agent_session_id),
        source_event_id TEXT NOT NULL REFERENCES agent_events(agent_event_id),
        sequence INTEGER NOT NULL CHECK (sequence > 0),
        UNIQUE(agent_session_id, sequence)
      ) STRICT;
      CREATE VIEW agent_conversation_history AS
      SELECT e.agent_event_id, e.agent_session_id, e.agent_run_id, e.sequence, e.type,
        e.payload_json, e.model_request_id, e.created_at,
        NULL AS source_event_id, NULL AS source_session_id,
        CASE WHEN e.type = 'assistant_message'
          AND json_extract(e.payload_json, '$.stopReason') = 'stop'
          AND json_extract(e.payload_json, '$.interrupted') = 0
          AND EXISTS (SELECT 1 FROM agent_runs r WHERE r.agent_run_id = e.agent_run_id
            AND r.status = 'completed') THEN 1 ELSE 0 END AS forkable
      FROM agent_effective_events e
      UNION ALL
      SELECT h.history_entry_id, h.agent_session_id, e.agent_run_id, h.sequence, e.type,
        e.payload_json, e.model_request_id, e.created_at,
        e.agent_event_id, e.agent_session_id,
        CASE WHEN e.type = 'assistant_message'
          AND json_extract(e.payload_json, '$.stopReason') = 'stop'
          AND json_extract(e.payload_json, '$.interrupted') = 0
          AND EXISTS (SELECT 1 FROM agent_runs r WHERE r.agent_run_id = e.agent_run_id
            AND r.status = 'completed') THEN 1 ELSE 0 END
      FROM agent_history_references h JOIN agent_events e ON e.agent_event_id = h.source_event_id;
    `)
  }
}
