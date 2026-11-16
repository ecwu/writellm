import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import {
  agentCompactionFailedPayloadSchema,
  type AgentCompactionTrigger
} from '../../shared/contracts/agent'
import { cachedStatement } from '../db/statement-cache'
import type { ProjectDatabase } from '../project/project-database'
import { insertEvent } from './session-event-utils'

/** Close persisted work left active when the previous project runtime ended. */
export function recoverInterruptedAgentWork(
  database: ProjectDatabase,
  log: Pick<Logger, 'warn'>
): number {
  const now = new Date().toISOString()
  const recovered = database.immediate((database) => {
    const rows = database
      .prepare(`SELECT agent_run_id, agent_session_id FROM agent_runs WHERE status = 'running'`)
      .all() as Array<{ agent_run_id: string; agent_session_id: string }>
    for (const row of rows) {
      cachedStatement(
        database,
        `UPDATE agent_runs
              SET status = 'interrupted', error_json = ?, completed_at = ?, updated_at = ?
            WHERE agent_run_id = ? AND status = 'running'`
      ).run(JSON.stringify({ code: 'process_restarted' }), now, now, row.agent_run_id)
      insertEvent(database, {
        eventId: randomUUID(),
        sessionId: row.agent_session_id,
        runId: row.agent_run_id,
        type: 'run_interrupted',
        payload: { code: 'process_restarted' },
        modelRequestId: null,
        createdAt: now
      })
    }
    return rows.length
  })
  if (recovered > 0) {
    log.warn(
      { event: 'agent.run.recovered', count: recovered },
      'Recovered Agent runs left active by a terminated process'
    )
  }
  recoverInterruptedCompactions(database, log)
  return recovered
}

function recoverInterruptedCompactions(database: ProjectDatabase, log: Pick<Logger, 'warn'>): void {
  const now = new Date()
  const rows = database.immediate(
    (database) =>
      database
        .prepare(
          `SELECT started.agent_session_id, started.agent_run_id,
                  json_extract(started.payload_json, '$.compactionId') AS compaction_id,
                  json_extract(started.payload_json, '$.trigger') AS trigger
             FROM agent_events AS started
            WHERE started.type = 'compaction_started'
              AND NOT EXISTS (
                SELECT 1 FROM agent_events AS terminal
                 WHERE terminal.agent_session_id = started.agent_session_id
                   AND (
                     terminal.type = 'compaction_failed'
                     OR (
                       terminal.type = 'compaction_summary'
                       AND json_extract(terminal.payload_json, '$.finalStep') = 1
                     )
                   )
                   AND json_extract(terminal.payload_json, '$.compactionId') =
                       json_extract(started.payload_json, '$.compactionId')
              )`
        )
        .all() as Array<{
        agent_session_id: string
        agent_run_id: string | null
        compaction_id: string
        trigger: AgentCompactionTrigger
      }>
  )
  for (const row of rows) {
    database.immediate((database) => {
      insertEvent(database, {
        eventId: randomUUID(),
        sessionId: row.agent_session_id,
        runId: row.agent_run_id,
        type: 'compaction_failed',
        payload: agentCompactionFailedPayloadSchema.parse({
          schemaVersion: 2,
          compactionId: row.compaction_id,
          trigger: row.trigger,
          code: 'process_restarted',
          retryable: true,
          aborted: true,
          timestamp: now.getTime()
        }),
        modelRequestId: null,
        createdAt: now.toISOString()
      })
    })
  }
  if (rows.length > 0) {
    log.warn(
      { event: 'agent.compaction.recovered', count: rows.length },
      'Recovered interrupted Agent context compactions'
    )
  }
}
