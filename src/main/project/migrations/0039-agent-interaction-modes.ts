import type { DatabaseMigration } from '../../db/migrations'
import { hasColumn } from './helpers'

const INTERACTION_MODE_CHECK = "CHECK (interaction_mode IN ('ask', 'plan', 'write'))"

export const migration0039: DatabaseMigration = {
  version: 39,
  name: '0039-agent-interaction-modes',
  checksum: 'sha256:589d83f8aa5d27c85cf5d1f536e179c1ac6c7ee2d048da4fa4160c1403dc93b5',
  up(database) {
    if (!hasColumn(database, 'agent_sessions', 'interaction_mode')) {
      database.exec(
        `ALTER TABLE agent_sessions ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT 'write' ${INTERACTION_MODE_CHECK}`
      )
    }
    if (!hasColumn(database, 'agent_runs', 'interaction_mode')) {
      database.exec(
        `ALTER TABLE agent_runs ADD COLUMN interaction_mode TEXT NOT NULL DEFAULT 'write' ${INTERACTION_MODE_CHECK}`
      )
    }
  }
}
