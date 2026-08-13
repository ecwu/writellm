import type { DatabaseMigration } from '../../db/migrations'

export const migration0031: DatabaseMigration = {
  version: 31,
  name: '0031-agent-writing-task-runs',
  checksum: 'sha256:d114c1e0b35a191f5e5b87f5ab8a96ee33882c4c7ec62fc7a9959f23948cd20c',
  up(database) {
    database.exec(`
      ALTER TABLE agent_runs ADD COLUMN writing_task_id TEXT
        REFERENCES agent_writing_tasks(writing_task_id) ON DELETE SET NULL;
      ALTER TABLE agent_runs ADD COLUMN writing_task_step_id TEXT;

      CREATE INDEX agent_runs_writing_task_idx
        ON agent_runs(writing_task_id, writing_task_step_id, started_at)
        WHERE writing_task_id IS NOT NULL;
    `)
  }
}
