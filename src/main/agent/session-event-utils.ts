import {
  agentDiagnosticErrorSchema,
  type AgentDiagnosticError
} from '../../shared/agent-diagnostic-error'
import { sha256 } from '../../shared/hash'
import type { AgentAssistantMessagePayload, AgentEventType } from '../../shared/contracts/agent'
import type { AgentEventRecord } from '../../shared/contracts/agent-ipc'
import { skillRunSnapshotSchema, type SkillRunSnapshot } from '../../shared/contracts/skills'

export function pendingSkillSnapshot(): SkillRunSnapshot {
  return skillRunSnapshotSchema.parse({
    schemaVersion: 4,
    mode: 'auto',
    routingStatus: 'pending',
    requestedSkills: [],
    skills: [],
    dependencies: [],
    resources: [],
    safeError: null
  })
}

export function insertEvent(
  database: import('better-sqlite3').Database,
  input: {
    eventId: string
    sessionId: string
    runId: string | null
    type: AgentEventType
    payload: Record<string, unknown>
    modelRequestId: string | null
    createdAt: string
  }
): AgentEventRecord {
  const sequence = Number(
    database
      .prepare(`SELECT MAX(
        COALESCE((SELECT MAX(sequence) FROM agent_events WHERE agent_session_id = ?), 0),
        COALESCE((SELECT through_sequence FROM agent_conversation_forks WHERE agent_session_id = ?), 0)
      ) + 1`)
      .pluck()
      .get(input.sessionId, input.sessionId)
  )
  const payloadJson = JSON.stringify(input.payload)
  if (new TextEncoder().encode(payloadJson).byteLength > 2_097_152) {
    throw new Error('Agent event payload exceeds the durable bound')
  }
  database
    .prepare(
      `INSERT INTO agent_events (
         agent_event_id, agent_session_id, agent_run_id, sequence, type,
         payload_json, model_request_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.eventId,
      input.sessionId,
      input.runId,
      sequence,
      input.type,
      payloadJson,
      input.modelRequestId,
      input.createdAt
    )
  return {
    agentEventId: input.eventId,
    agentSessionId: input.sessionId,
    agentRunId: input.runId,
    sequence,
    type: input.type,
    payload: input.payload,
    modelRequestId: input.modelRequestId,
    createdAt: input.createdAt
  }
}

export function fingerprint(value: unknown): string {
  return sha256(JSON.stringify(value))
}

export function readRunError(value: string | null): {
  errorCode: string | null
  errorDetails: AgentDiagnosticError | null
} {
  if (value === null) return { errorCode: null, errorDetails: null }
  const parsed = JSON.parse(value) as unknown
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new TypeError('Stored Agent run error must be a JSON object')
  }
  const fields = parsed as { code?: unknown; diagnostic?: unknown }
  const diagnostic = agentDiagnosticErrorSchema.safeParse(fields.diagnostic)
  return {
    errorCode: typeof fields.code === 'string' ? fields.code.slice(0, 200) : 'agent_run_failed',
    errorDetails: diagnostic.success ? diagnostic.data : null
  }
}

export function emptyMetadata(model: string): AgentAssistantMessagePayload['metadata'] {
  return {
    usage: {
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      estimatedCostUsdMicros: null
    },
    responseIds: [],
    retryCount: 0,
    providerModelId: model
  }
}
