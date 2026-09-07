import type Database from 'better-sqlite3'
import type { AgentSessionRecord } from '../../shared/contracts/agent-ipc'

export function readForkMetadata(
  database: Database.Database,
  sessionId: string
): AgentSessionRecord['fork'] {
  const row = database
    .prepare(`SELECT f.source_session_id AS sourceSessionId,
    f.target_event_id AS targetEventId, f.through_sequence AS throughSequence, s.title AS sourceTitle,
    EXISTS (SELECT 1 FROM agent_conversation_history h WHERE h.agent_session_id = f.source_session_id
      AND h.agent_event_id = f.target_event_id) AS sourceAvailable
    FROM agent_conversation_forks f JOIN agent_sessions s ON s.agent_session_id = f.source_session_id
    WHERE f.agent_session_id = ?`)
    .get(sessionId) as
    | (Omit<NonNullable<AgentSessionRecord['fork']>, 'sourceAvailable'> & {
        sourceAvailable: number
      })
    | undefined
  return row === undefined ? null : { ...row, sourceAvailable: row.sourceAvailable === 1 }
}
