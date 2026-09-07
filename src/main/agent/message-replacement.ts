import type Database from 'better-sqlite3'
import { agentUserMessagePayloadSchema } from '../../shared/contracts/agent'
import type { AgentMessageEditState } from '../../shared/contracts/agent-ipc'

export interface MessageReplacement {
  targetEventId: string
  expectedThroughSequence: number
}

export function messageEditState(
  database: Database.Database,
  agentSessionId: string,
  busy: boolean
): AgentMessageEditState {
  const target = database
    .prepare(`SELECT agent_event_id, sequence, payload_json
    FROM agent_effective_events WHERE agent_session_id = ? AND type = 'user_message'
    ORDER BY sequence DESC LIMIT 1`)
    .get(agentSessionId) as
    | { agent_event_id: string; sequence: number; payload_json: string }
    | undefined
  const head = database
    .prepare('SELECT COALESCE(MAX(sequence), 0) FROM agent_events WHERE agent_session_id = ?')
    .pluck()
    .get(agentSessionId) as number
  const state = {
    targetEventId: target?.agent_event_id ?? null,
    throughSequence: head,
    reason: null as string | null
  }
  if (target === undefined) return { ...state, reason: 'There is no sent message to edit.' }
  const parsed = agentUserMessagePayloadSchema.safeParse(JSON.parse(target.payload_json))
  if (!parsed.success)
    return { ...state, targetEventId: null, reason: 'This historical message cannot be edited.' }
  const payload = parsed.data
  if (payload.presentation !== undefined || payload.delivery === 'clarification') {
    return { ...state, targetEventId: null, reason: 'Generated messages cannot be edited.' }
  }
  if (busy) return { ...state, reason: 'Stop the Agent before editing this message.' }
  const effect = database
    .prepare(`SELECT 1 FROM agent_edit_effects
    WHERE agent_session_id = ? AND after_sequence >= ? LIMIT 1`)
    .get(agentSessionId, target.sequence)
  if (effect !== undefined)
    return {
      ...state,
      reason: 'The Agent changed project content after this message. It cannot be edited.'
    }
  // Collaboration plan writes also survive runs and must not be silently hidden by an edit.
  const taskWrite = database
    .prepare(`SELECT 1 FROM agent_effective_events
    WHERE agent_session_id = ? AND sequence >= ? AND type = 'tool_result'
      AND json_extract(payload_json, '$.toolName') IN ('create_writing_task', 'update_writing_task')
      AND json_extract(payload_json, '$.isError') = 0 LIMIT 1`)
    .get(agentSessionId, target.sequence)
  if (taskWrite !== undefined)
    return {
      ...state,
      reason: 'The Agent changed the writing plan after this message. It cannot be edited.'
    }
  const blocker = database
    .prepare(`SELECT p.status FROM mutation_proposals p
    JOIN agent_events e ON e.agent_event_id = p.tool_call_event_id
    WHERE p.agent_session_id = ? AND (p.status IN ('generating', 'approved')
      OR (p.status = 'pending' AND e.sequence < ?)) LIMIT 1`)
    .get(agentSessionId, target.sequence)
  if (blocker !== undefined)
    return { ...state, reason: 'Finish or cancel the pending change before editing this message.' }
  return state
}

export function assertMessageReplacement(
  database: Database.Database,
  agentSessionId: string,
  replacement: MessageReplacement
): number {
  const state = messageEditState(database, agentSessionId, false)
  if (
    state.targetEventId !== replacement.targetEventId ||
    state.throughSequence !== replacement.expectedThroughSequence
  ) {
    throw new Error('The conversation changed. Reload the latest message before editing.')
  }
  if (state.reason !== null) throw new Error(state.reason)
  return database
    .prepare('SELECT sequence FROM agent_events WHERE agent_event_id = ?')
    .pluck()
    .get(replacement.targetEventId) as number
}

export function commitMessageReplacement(
  database: Database.Database,
  input: MessageReplacement & {
    agentSessionId: string
    agentRunId: string
    fromSequence: number
    now: string
  }
): void {
  database
    .prepare(`INSERT INTO agent_message_replacements
    (replacement_run_id, agent_session_id, target_event_id, from_sequence, through_sequence, created_at)
    VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      input.agentRunId,
      input.agentSessionId,
      input.targetEventId,
      input.fromSequence,
      input.expectedThroughSequence,
      input.now
    )
  database
    .prepare(`UPDATE mutation_proposals SET status = 'rejected', decision_at = ?,
    rejected_reason = 'The originating message was edited.', updated_at = ?
    WHERE agent_session_id = ? AND status = 'pending' AND tool_call_event_id IN (
      SELECT agent_event_id FROM agent_events WHERE agent_session_id = ? AND sequence BETWEEN ? AND ?
    )`)
    .run(
      input.now,
      input.now,
      input.agentSessionId,
      input.agentSessionId,
      input.fromSequence,
      input.expectedThroughSequence
    )
}
