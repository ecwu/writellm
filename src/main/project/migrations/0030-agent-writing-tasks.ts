import type { DatabaseMigration } from '../../db/migrations'

export const migration0030: DatabaseMigration = {
  version: 30,
  name: '0030-agent-writing-tasks',
  checksum: 'sha256:70e362f4c7ddeafbd9a87a3ba11daef52404024082a7689e0e67b9a00dbad54c',
  up(database) {
    database.exec(`
      CREATE TABLE agent_writing_tasks (
        writing_task_id TEXT PRIMARY KEY NOT NULL,
        agent_session_id TEXT NOT NULL UNIQUE
          REFERENCES agent_sessions(agent_session_id) ON DELETE CASCADE,
        objective TEXT NOT NULL CHECK (length(objective) BETWEEN 1 AND 4096),
        plan_version INTEGER NOT NULL CHECK (plan_version > 0),
        plan_json TEXT NOT NULL CHECK (
          length(CAST(plan_json AS BLOB)) <= 65536
          AND json_valid(plan_json) AND json_type(plan_json) = 'object'
        ),
        created_by_agent_run_id TEXT
          REFERENCES agent_runs(agent_run_id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      ALTER TABLE mutation_proposals ADD COLUMN writing_task_id TEXT
        REFERENCES agent_writing_tasks(writing_task_id) ON DELETE SET NULL;
      ALTER TABLE mutation_proposals ADD COLUMN writing_task_step_id TEXT;

      CREATE INDEX agent_writing_tasks_session_idx
        ON agent_writing_tasks(agent_session_id);
      CREATE INDEX mutation_proposals_writing_task_idx
        ON mutation_proposals(writing_task_id, writing_task_step_id, created_at)
        WHERE writing_task_id IS NOT NULL;
    `)
  }
}
