import type { DatabaseMigration } from '../../db/migrations'

export const migration0032: DatabaseMigration = {
  version: 32,
  name: '0032-agent-change-set-commands',
  checksum: 'sha256:ea0eac3308869df5872cf85104eb7449c5af4cbeb18ee92371049f819a7e4996',
  up(database) {
    database.exec(`
      CREATE TABLE agent_change_set_commands (
        command_id TEXT PRIMARY KEY NOT NULL,
        writing_task_id TEXT NOT NULL
          REFERENCES agent_writing_tasks(writing_task_id) ON DELETE CASCADE,
        agent_session_id TEXT NOT NULL
          REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        request_fingerprint TEXT NOT NULL CHECK (length(request_fingerprint) = 64),
        action TEXT NOT NULL CHECK (action IN ('apply', 'reject')),
        ordered_proposal_ids_json TEXT NOT NULL CHECK (
          length(CAST(ordered_proposal_ids_json AS BLOB)) <= 16384
          AND json_valid(ordered_proposal_ids_json)
          AND json_type(ordered_proposal_ids_json) = 'array'
        ),
        reject_reason TEXT CHECK (reject_reason IS NULL OR length(reject_reason) BETWEEN 1 AND 4096),
        checkpoint_status TEXT NOT NULL CHECK (checkpoint_status IN (
          'not_requested', 'pending', 'created', 'unavailable', 'failed'
        )),
        checkpoint_requested INTEGER NOT NULL CHECK (checkpoint_requested IN (0, 1)),
        next_index INTEGER NOT NULL DEFAULT 0 CHECK (next_index >= 0),
        results_json TEXT NOT NULL DEFAULT '[]' CHECK (
          length(CAST(results_json AS BLOB)) <= 131072
          AND json_valid(results_json)
          AND json_type(results_json) = 'array'
        ),
        status TEXT NOT NULL CHECK (status IN ('prepared', 'running', 'completed', 'stopped')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX agent_change_set_commands_task_idx
        ON agent_change_set_commands(writing_task_id, created_at);
    `)
  }
}
