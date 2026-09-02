import { createHash } from 'node:crypto'
import {
  agentDiagnosticErrorSchema,
  type AgentDiagnosticError
} from '../../shared/agent-diagnostic-error'
import type {
  AgentAssistantMessagePayload,
  AgentEventType,
  AgentModelLimits
} from '../../shared/contracts/agent'
import type { AgentEventRecord } from '../../shared/contracts/agent-ipc'
import { skillRunSnapshotSchema, type SkillRunSnapshot } from '../../shared/contracts/skills'

export function legacyModelLimits(): AgentModelLimits {
  return {
    contextWindowTokens: 131_072,
    inputLimitTokens: null,
    outputLimitTokens: null,
    source: 'legacy_fallback',
    catalogModelKey: null,
    resolvedAt: null
  }
}

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
      .prepare('SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_events WHERE agent_session_id = ?')
      .pluck()
      .get(input.sessionId)
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
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function safeErrorCode(value: string | null): string | null {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code.slice(0, 200) : 'agent_run_failed'
  } catch {
    return 'agent_run_failed'
  }
}

export function readErrorDetails(value: string | null): AgentDiagnosticError | null {
  if (value === null) return null
  try {
    const parsed = JSON.parse(value) as { diagnostic?: unknown }
    const diagnostic = agentDiagnosticErrorSchema.safeParse(parsed.diagnostic)
    return diagnostic.success ? diagnostic.data : null
  } catch {
    // Historical error_json records only carried a code and may not contain a diagnostic.
    return null
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
