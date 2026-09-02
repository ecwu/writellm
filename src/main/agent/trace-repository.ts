import { createHash, randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import type { Api } from '@earendil-works/pi-ai'
import type { ProjectDatabase } from '../project/project-database'
import type { ModelRequestTraceTable } from '../project/database-types'

const MAX_TRACE_DOCUMENT_BYTES = 8 * 1024 * 1024
const MAX_TRACE_ATTEMPT_BYTES = 32 * 1024 * 1024
const CHUNK_ARRAYS_AT_OR_ABOVE_BYTES = 16 * 1024

export type AgentTracePurpose = ModelRequestTraceTable['purpose']
export type AgentTraceDocumentKind =
  | 'harness_request'
  | 'provider_request'
  | 'provider_response'
  | 'tool_attempt'
  | 'skill_content'
  | 'compaction_source'

export interface CaptureAgentTraceInput {
  modelRequestId: string
  purpose: AgentTracePurpose
  apiId: Api | string
  traceId: string
  spanId?: string
  parentSpanId?: string | null
  agentSessionId?: string | null
  agentRunId?: string | null
  toolCallId?: string | null
  compactionId?: string | null
  physicalAttempt: number
  documents: ReadonlyArray<{
    kind: AgentTraceDocumentKind
    value: unknown
    metadata?: Record<string, unknown>
  }>
}

export class AgentTraceRepository {
  constructor(
    private readonly database: ProjectDatabase,
    private readonly log: Pick<Logger, 'info' | 'warn' | 'error'>,
    private readonly now: () => Date = () => new Date(),
    private readonly createId: () => string = randomUUID
  ) {}

  capture(input: CaptureAgentTraceInput): {
    payloadBytes: number
    payloadCount: number
    recordCount: number
  } {
    try {
      return this.capturePayloads(input)
    } catch (err) {
      this.log.error(
        { event: 'agent.trace.capture_failed', err, modelRequestId: input.modelRequestId },
        'Agent request continues with a diagnostic trace gap'
      )
      try {
        const now = this.now().toISOString()
        this.database.immediate((database) =>
          database
            .prepare(`INSERT INTO model_request_traces (
            model_request_id, purpose, api_id, trace_id, span_id, parent_span_id,
            capture_status, physical_attempt_count, failure_code, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'failed', ?, 'diagnostic_gap', ?, ?)
          ON CONFLICT(model_request_id) DO UPDATE SET
            capture_status = 'failed', failure_code = 'diagnostic_gap', updated_at = excluded.updated_at`)
            .run(
              input.modelRequestId,
              input.purpose,
              input.apiId,
              input.traceId,
              input.spanId ?? input.modelRequestId,
              input.parentSpanId ?? null,
              input.physicalAttempt,
              now,
              now
            )
        )
      } catch (err) {
        this.log.error(
          { event: 'agent.trace.gap_record_failed', err, modelRequestId: input.modelRequestId },
          'Unable to persist diagnostic trace gap metadata'
        )
      }
      return { payloadBytes: 0, payloadCount: 0, recordCount: 0 }
    }
  }

  private capturePayloads(input: CaptureAgentTraceInput): {
    payloadBytes: number
    payloadCount: number
    recordCount: number
  } {
    if (!Number.isInteger(input.physicalAttempt) || input.physicalAttempt < 1) {
      throw new Error('Trace physical attempt must be a positive integer')
    }
    const prepared = input.documents.map((document) =>
      prepareDocument(document.kind, document.value)
    )
    const providerAttempt = input.documents.some((document) =>
      ['harness_request', 'provider_request', 'provider_response'].includes(document.kind)
    )
      ? input.physicalAttempt
      : 0
    const payloadBytes = prepared.reduce((sum, document) => sum + document.documentBytes, 0)
    if (payloadBytes > MAX_TRACE_ATTEMPT_BYTES) {
      throw new AgentTraceCaptureError('trace_payload_too_large', 'Trace attempt exceeds 32 MiB')
    }
    const now = this.now().toISOString()
    const responseTiming = traceResponseTiming(input.documents)
    const result = this.database.immediate((database) => {
      const existingAttemptBytes = Number(
        database
          .prepare(
            `SELECT COALESCE(SUM(document_bytes), 0)
               FROM (
                 SELECT MAX(CAST(json_extract(metadata_json, '$._traceDocumentBytes') AS INTEGER))
                          AS document_bytes
                   FROM agent_trace_records
                  WHERE model_request_id = ? AND physical_attempt = ?
                  GROUP BY document_kind
               )`
          )
          .pluck()
          .get(input.modelRequestId, input.physicalAttempt)
      )
      if (existingAttemptBytes + payloadBytes > MAX_TRACE_ATTEMPT_BYTES) {
        throw new AgentTraceCaptureError('trace_payload_too_large', 'Trace attempt exceeds 32 MiB')
      }
      database
        .prepare(
          `INSERT INTO model_request_traces (
             model_request_id, purpose, api_id, trace_id, span_id, parent_span_id,
             capture_status, physical_attempt_count, http_status, ttft_ms,
             total_duration_ms, failure_code, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'capturing', ?, NULL, NULL, NULL, NULL, ?, ?)
           ON CONFLICT(model_request_id) DO UPDATE SET
             physical_attempt_count = MAX(physical_attempt_count, excluded.physical_attempt_count),
             updated_at = excluded.updated_at`
        )
        .run(
          input.modelRequestId,
          input.purpose,
          input.apiId,
          input.traceId,
          input.spanId ?? input.modelRequestId,
          input.parentSpanId ?? null,
          providerAttempt,
          now,
          now
        )
      const insertPayload = database.prepare(
        `INSERT INTO agent_trace_payloads (
           payload_sha256, schema_version, payload_json, byte_size, created_at
         ) VALUES (?, 1, ?, ?, ?)
         ON CONFLICT(payload_sha256) DO NOTHING`
      )
      const insertRecord = database.prepare(
        `INSERT INTO agent_trace_records (
           agent_trace_record_id, agent_session_id, agent_run_id, model_request_id,
           tool_call_id, compaction_id, physical_attempt, document_kind, ordinal,
           json_path, payload_sha256, metadata_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      let payloadCount = 0
      let recordCount = 0
      for (const [documentIndex, document] of prepared.entries()) {
        const metadata = input.documents[documentIndex]?.metadata ?? {}
        const metadataJson = canonicalJson({
          ...metadata,
          _traceDocumentBytes: document.documentBytes
        })
        if (Buffer.byteLength(metadataJson) > 65_536) {
          throw new AgentTraceCaptureError(
            'trace_metadata_too_large',
            'Trace record metadata exceeds 64 KiB'
          )
        }
        for (const chunk of document.chunks) {
          const inserted = insertPayload.run(chunk.sha256, chunk.json, chunk.bytes, now).changes
          payloadCount += inserted
          insertRecord.run(
            this.createId(),
            input.agentSessionId ?? null,
            input.agentRunId ?? null,
            input.modelRequestId,
            input.toolCallId ?? null,
            input.compactionId ?? null,
            input.physicalAttempt,
            document.kind,
            chunk.ordinal,
            chunk.path,
            chunk.sha256,
            metadataJson,
            now
          )
          recordCount += 1
        }
      }
      if (responseTiming !== undefined) {
        database
          .prepare(
            `UPDATE model_request_traces
                SET http_status = COALESCE(?, http_status),
                    ttft_ms = COALESCE(?, ttft_ms),
                    total_duration_ms = COALESCE(?, total_duration_ms),
                    updated_at = ?
              WHERE model_request_id = ?`
          )
          .run(
            responseTiming.httpStatus ?? null,
            responseTiming.ttftMs ?? null,
            responseTiming.totalDurationMs ?? null,
            now,
            input.modelRequestId
          )
      }
      return { payloadCount, recordCount }
    })
    this.log.info(
      {
        event: 'agent.trace.captured',
        traceId: input.traceId,
        agentSessionId: input.agentSessionId,
        agentRunId: input.agentRunId,
        modelRequestId: input.modelRequestId,
        toolCallId: input.toolCallId,
        compactionId: input.compactionId,
        physicalAttempt: input.physicalAttempt,
        documentKinds: input.documents.map((document) => document.kind),
        payloadBytes,
        payloadCount: result.payloadCount,
        recordCount: result.recordCount
      },
      'Captured Agent diagnostic trace payloads'
    )
    return { payloadBytes, ...result }
  }

  exists(modelRequestId: string): boolean {
    try {
      return this.database.immediate(
        (database) =>
          database
            .prepare('SELECT 1 FROM model_request_traces WHERE model_request_id = ?')
            .pluck()
            .get(modelRequestId) === 1
      )
    } catch (err) {
      this.log.error(
        { event: 'agent.trace.lookup_failed', err, modelRequestId },
        'Trace lookup failed'
      )
      return false
    }
  }

  nextDocumentOccurrence(modelRequestId: string, kind: AgentTraceDocumentKind): number {
    try {
      return this.database.immediate((database) => {
        const value = database
          .prepare(
            `SELECT COALESCE(MAX(physical_attempt), 0) + 1
             FROM agent_trace_records
            WHERE model_request_id = ? AND document_kind = ?`
          )
          .pluck()
          .get(modelRequestId, kind)
        return Number(value)
      })
    } catch (err) {
      this.log.error(
        { event: 'agent.trace.lookup_failed', err, modelRequestId },
        'Trace occurrence lookup failed'
      )
      return 1
    }
  }

  complete(input: {
    modelRequestId: string
    physicalAttemptCount: number
    httpStatus?: number
    ttftMs?: number
    totalDurationMs?: number
  }): void {
    this.finish({ ...input, status: 'complete' })
  }

  fail(input: {
    modelRequestId: string
    physicalAttemptCount: number
    httpStatus?: number
    totalDurationMs?: number
    failureCode: string
  }): void {
    this.finish({ ...input, status: 'failed' })
  }

  private finish(input: {
    modelRequestId: string
    physicalAttemptCount: number
    status: 'complete' | 'failed'
    httpStatus?: number
    ttftMs?: number
    totalDurationMs?: number
    failureCode?: string
  }): void {
    try {
      this.finishCapture(input)
    } catch (err) {
      this.log.error(
        { event: 'agent.trace.finish_failed', err, modelRequestId: input.modelRequestId },
        'Agent request continues without trace completion metadata'
      )
    }
  }

  private finishCapture(input: {
    modelRequestId: string
    physicalAttemptCount: number
    status: 'complete' | 'failed'
    httpStatus?: number
    ttftMs?: number
    totalDurationMs?: number
    failureCode?: string
  }): void {
    const now = this.now().toISOString()
    const changes = this.database.immediate(
      (database) =>
        database
          .prepare(
            `UPDATE model_request_traces
                SET capture_status = CASE WHEN failure_code = 'diagnostic_gap' THEN 'failed' ELSE ? END,
                    physical_attempt_count = MAX(physical_attempt_count, ?),
                    http_status = COALESCE(?, http_status),
                    ttft_ms = COALESCE(?, ttft_ms),
                    total_duration_ms = COALESCE(?, total_duration_ms),
                    failure_code = CASE WHEN failure_code = 'diagnostic_gap' THEN failure_code ELSE ? END,
                    updated_at = ?
              WHERE model_request_id = ?`
          )
          .run(
            input.status,
            input.physicalAttemptCount,
            input.httpStatus ?? null,
            input.ttftMs ?? null,
            input.totalDurationMs ?? null,
            input.failureCode ?? null,
            now,
            input.modelRequestId
          ).changes
    )
    if (changes !== 1) {
      throw new AgentTraceCaptureError('trace_missing', 'Model request trace does not exist')
    }
    const correlation = this.database.immediate(
      (database) =>
        database
          .prepare(
            `SELECT trace.trace_id,
                    (SELECT agent_session_id FROM agent_trace_records
                      WHERE model_request_id = trace.model_request_id
                        AND agent_session_id IS NOT NULL LIMIT 1) AS agent_session_id,
                    (SELECT agent_run_id FROM agent_trace_records
                      WHERE model_request_id = trace.model_request_id
                        AND agent_run_id IS NOT NULL LIMIT 1) AS agent_run_id,
                    (SELECT compaction_id FROM agent_trace_records
                      WHERE model_request_id = trace.model_request_id
                        AND compaction_id IS NOT NULL LIMIT 1) AS compaction_id
               FROM model_request_traces AS trace WHERE trace.model_request_id = ?`
          )
          .get(input.modelRequestId) as
          | {
              trace_id: string
              agent_session_id: string | null
              agent_run_id: string | null
              compaction_id: string | null
            }
          | undefined
    )
    this.log.info(
      {
        event: 'agent.trace.finished',
        traceId: correlation?.trace_id,
        agentSessionId: correlation?.agent_session_id,
        agentRunId: correlation?.agent_run_id,
        modelRequestId: input.modelRequestId,
        compactionId: correlation?.compaction_id,
        phase: 'capture',
        outcome: input.status,
        physicalAttemptCount: input.physicalAttemptCount,
        httpStatus: input.httpStatus,
        ttftMs: input.ttftMs,
        durationMs: input.totalDurationMs,
        failureCode: input.failureCode
      },
      'Finished Agent diagnostic trace capture'
    )
  }
}

function traceResponseTiming(
  documents: CaptureAgentTraceInput['documents']
): { httpStatus?: number; ttftMs?: number; totalDurationMs?: number } | undefined {
  const metadata = [...documents]
    .reverse()
    .find((document) => document.kind === 'provider_response')?.metadata
  if (metadata === undefined) return undefined
  return {
    ...(isBoundedInteger(metadata.httpStatus, 100, 599) ? { httpStatus: metadata.httpStatus } : {}),
    ...(isBoundedInteger(metadata.ttftMs, 0, Number.MAX_SAFE_INTEGER)
      ? { ttftMs: metadata.ttftMs }
      : {}),
    ...(isBoundedInteger(metadata.totalDurationMs, 0, Number.MAX_SAFE_INTEGER)
      ? { totalDurationMs: metadata.totalDurationMs }
      : {})
  }
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
}

export class AgentTraceCaptureError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'AgentTraceCaptureError'
  }
}

interface PreparedChunk {
  ordinal: number
  path: string
  json: string
  bytes: number
  sha256: string
}

function prepareDocument(
  kind: AgentTraceDocumentKind,
  value: unknown
): {
  kind: AgentTraceDocumentKind
  documentBytes: number
  chunks: PreparedChunk[]
} {
  const normalized = canonicalize(value, new Set())
  const complete = JSON.stringify(normalized)
  const documentBytes = Buffer.byteLength(complete)
  if (documentBytes > MAX_TRACE_DOCUMENT_BYTES) {
    throw new AgentTraceCaptureError(
      'trace_payload_too_large',
      `${kind} trace document exceeds 8 MiB`
    )
  }
  const pieces = splitDocument(normalized)
  return {
    kind,
    documentBytes,
    chunks: pieces.map((piece, ordinal) => {
      const json = JSON.stringify(piece.value)
      const bytes = Buffer.byteLength(json)
      return {
        ordinal,
        path: piece.path,
        json,
        bytes,
        sha256: createHash('sha256').update(json).digest('hex')
      }
    })
  }
}

function splitDocument(value: unknown): Array<{ path: string; value: unknown }> {
  if (Array.isArray(value)) {
    return [
      { path: '$', value: [] },
      ...value.map((item, index) => ({ path: `$[${index}]`, value: item }))
    ]
  }
  if (value === null || typeof value !== 'object') return [{ path: '$', value }]
  const pieces: Array<{ path: string; value: unknown }> = [{ path: '$', value: {} }]
  for (const [key, member] of Object.entries(value)) {
    const path = `$${jsonPathMember(key)}`
    const memberJson = JSON.stringify(member)
    if (Array.isArray(member) && Buffer.byteLength(memberJson) >= CHUNK_ARRAYS_AT_OR_ABOVE_BYTES) {
      pieces.push({ path, value: [] })
      for (const [index, item] of member.entries()) {
        pieces.push({ path: `${path}[${index}]`, value: item })
      }
    } else {
      pieces.push({ path, value: member })
    }
  }
  return pieces
}

function jsonPathMember(key: string): string {
  return `."${key.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()))
}

function canonicalize(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') {
      throw new AgentTraceCaptureError('trace_not_serializable', 'Trace payload is not JSON data')
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new AgentTraceCaptureError(
        'trace_not_serializable',
        'Trace payload has a non-finite number'
      )
    }
    return value
  }
  if (seen.has(value)) {
    throw new AgentTraceCaptureError('trace_not_serializable', 'Trace payload contains a cycle')
  }
  seen.add(value)
  try {
    if (Array.isArray(value)) return value.map((member) => canonicalize(member, seen))
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const member = (value as Record<string, unknown>)[key]
      if (member !== undefined) result[key] = canonicalize(member, seen)
    }
    return result
  } finally {
    seen.delete(value)
  }
}
