import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectDatabaseSchema } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { migration0040 } from '../project/migrations/0040-agent-request-traces'
import { AgentTraceCaptureError, AgentTraceRepository } from './trace-repository'

describe('AgentTraceRepository', () => {
  let database: Database.Database | undefined
  afterEach(() => database?.close())

  it('deduplicates repeated message chunks and reconstructs semantic request JSON', () => {
    database = baseDatabase()
    const project = projectDatabase(database)
    const repository = new AgentTraceRepository(project, logger(), () => new Date(0), randomUUID)
    const repeated = { role: 'user', content: 'x'.repeat(20_000) }
    const harness = { systemPrompt: 'policy', messages: [repeated, repeated], tools: [] }

    repository.capture({
      modelRequestId: 'model-1',
      purpose: 'agent_prompt',
      apiId: 'openai-responses',
      traceId: 'run-1',
      agentSessionId: 'session-1',
      agentRunId: 'run-1',
      physicalAttempt: 1,
      documents: [
        { kind: 'harness_request', value: harness },
        { kind: 'provider_request', value: { input: [repeated, repeated], stream: true } }
      ]
    })
    repository.capture({
      modelRequestId: 'model-1',
      purpose: 'agent_prompt',
      apiId: 'openai-responses',
      traceId: 'run-1',
      agentSessionId: 'session-1',
      agentRunId: 'run-1',
      physicalAttempt: 1,
      documents: [
        {
          kind: 'provider_response',
          value: { id: 'response-1', output: [] },
          metadata: { httpStatus: 200, ttftMs: 7, totalDurationMs: 19 }
        }
      ]
    })
    repository.complete({ modelRequestId: 'model-1', physicalAttemptCount: 1, httpStatus: 200 })

    const row = database
      .prepare(`SELECT * FROM agent_model_request_trace_v WHERE model_request_id = 'model-1'`)
      .get() as Record<string, unknown>
    expect(JSON.parse(row.harness_request_json as string)).toEqual(harness)
    expect(JSON.parse(row.provider_requests_json as string)).toEqual([
      { input: [repeated, repeated], stream: true }
    ])
    expect(JSON.parse(row.provider_response_json as string)).toEqual({
      id: 'response-1',
      output: []
    })
    expect(row.capture_status).toBe('complete')
    expect(row).toMatchObject({ http_status: 200, ttft_ms: 7, total_duration_ms: 19 })
    const payloadCount = database.prepare('SELECT COUNT(*) FROM agent_trace_payloads').pluck().get()
    const recordCount = database.prepare('SELECT COUNT(*) FROM agent_trace_records').pluck().get()
    expect(Number(payloadCount)).toBeLessThan(Number(recordCount))
  })

  it('fails before persistence when one document exceeds 8 MiB', () => {
    database = baseDatabase()
    const repository = new AgentTraceRepository(projectDatabase(database), logger())
    expect(() =>
      repository.capture({
        modelRequestId: 'model-1',
        purpose: 'agent_prompt',
        apiId: 'openai-responses',
        traceId: 'run-1',
        physicalAttempt: 1,
        documents: [{ kind: 'provider_request', value: { prompt: 'x'.repeat(8 * 1024 * 1024) } }]
      })
    ).toThrowError(AgentTraceCaptureError)
    expect(database.prepare('SELECT COUNT(*) FROM agent_trace_payloads').pluck().get()).toBe(0)
  })

  it('keeps private bodies out of structured logs and rejects attempts above 32 MiB', () => {
    database = baseDatabase()
    const traceLogger = logger()
    const repository = new AgentTraceRepository(projectDatabase(database), traceLogger)
    repository.capture({
      modelRequestId: 'model-1',
      purpose: 'agent_prompt',
      apiId: 'openai-responses',
      traceId: 'run-1',
      physicalAttempt: 1,
      documents: [{ kind: 'provider_request', value: { prompt: 'TOP_SECRET_PRIVATE_PROMPT' } }]
    })
    expect(JSON.stringify(traceLogger.info.mock.calls)).not.toContain('TOP_SECRET_PRIVATE_PROMPT')

    const large = { value: 'x'.repeat(7 * 1024 * 1024) }
    expect(() =>
      repository.capture({
        modelRequestId: 'model-1',
        purpose: 'agent_prompt',
        apiId: 'openai-responses',
        traceId: 'run-1',
        physicalAttempt: 2,
        documents: [
          { kind: 'harness_request', value: large },
          { kind: 'provider_request', value: large },
          { kind: 'provider_response', value: large },
          { kind: 'tool_attempt', value: large },
          { kind: 'skill_content', value: large }
        ]
      })
    ).toThrowError(AgentTraceCaptureError)
  })

  it('enforces the 32 MiB attempt limit across separate persistence acknowledgements', () => {
    database = baseDatabase()
    const repository = new AgentTraceRepository(projectDatabase(database), logger())
    const large = { value: 'x'.repeat(7 * 1024 * 1024) }
    repository.capture({
      modelRequestId: 'model-1',
      purpose: 'agent_prompt',
      apiId: 'openai-responses',
      traceId: 'run-1',
      physicalAttempt: 1,
      documents: [
        { kind: 'harness_request', value: large },
        { kind: 'provider_request', value: large }
      ]
    })
    repository.capture({
      modelRequestId: 'model-1',
      purpose: 'agent_prompt',
      apiId: 'openai-responses',
      traceId: 'run-1',
      physicalAttempt: 1,
      documents: [{ kind: 'provider_response', value: large }]
    })

    expect(() =>
      repository.capture({
        modelRequestId: 'model-1',
        purpose: 'agent_prompt',
        apiId: 'openai-responses',
        traceId: 'run-1',
        physicalAttempt: 1,
        documents: [
          { kind: 'tool_attempt', value: { value: 'x'.repeat(7 * 1024 * 1024) } },
          { kind: 'skill_content', value: { value: 'x'.repeat(7 * 1024 * 1024) } }
        ]
      })
    ).toThrowError(AgentTraceCaptureError)
  })

  it('deduplicates long repeated histories and rebuilds every request through SQL', () => {
    database = baseDatabase()
    const repository = new AgentTraceRepository(projectDatabase(database), logger())
    const toolSchema = {
      name: 'read_document',
      description: 'Read a project document by its stable identifier.',
      parameters: {
        type: 'object',
        properties: { documentId: { type: 'string' } },
        required: ['documentId']
      }
    }
    const history = Array.from({ length: 80 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `${index}:${'context '.repeat(512)}`
    }))
    const harness = { systemPrompt: 'stable policy', messages: history, tools: [toolSchema] }
    const provider = { model: 'test-model', input: history, tools: [toolSchema], stream: true }
    const rawBytesPerRequest =
      Buffer.byteLength(JSON.stringify(harness)) + Buffer.byteLength(JSON.stringify(provider))

    for (let request = 1; request <= 12; request += 1) {
      const modelRequestId = `capacity-${request}`
      database
        .prepare('INSERT INTO model_requests VALUES (?, ?, ?, ?, ?, ?)')
        .run(modelRequestId, 'agent', 'openai', 'gpt', 'running', 'run-1')
      repository.capture({
        modelRequestId,
        purpose: 'agent_prompt',
        apiId: 'openai-responses',
        traceId: 'run-1',
        agentSessionId: 'session-1',
        agentRunId: 'run-1',
        physicalAttempt: 1,
        documents: [
          { kind: 'harness_request', value: harness },
          { kind: 'provider_request', value: provider }
        ]
      })
    }

    const rawBytes = rawBytesPerRequest * 12
    const deduplicatedBytes = Number(
      database.prepare('SELECT COALESCE(SUM(byte_size), 0) FROM agent_trace_payloads').pluck().get()
    )
    const reconstructionStartedAt = performance.now()
    const rows = database
      .prepare(
        "SELECT harness_request_json, provider_requests_json FROM agent_model_request_trace_v WHERE model_request_id LIKE 'capacity-%'"
      )
      .all() as Array<{ harness_request_json: string; provider_requests_json: string }>
    const reconstructionMs = performance.now() - reconstructionStartedAt

    expect(rows).toHaveLength(12)
    for (const row of rows) {
      expect(JSON.parse(row.harness_request_json)).toEqual(harness)
      expect(JSON.parse(row.provider_requests_json)).toEqual([provider])
    }
    expect(deduplicatedBytes).toBeLessThan(rawBytes * 0.2)
    expect(reconstructionMs).toBeLessThan(10_000)
  }, 20_000)
})

function logger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function projectDatabase(native: Database.Database): ProjectDatabase {
  return {
    kysely: new Kysely<ProjectDatabaseSchema>({ dialect: new SqliteDialect({ database: native }) }),
    immediate: (operation) => native.transaction(operation).immediate(native),
    backup: (destination, options) => native.backup(destination, options),
    close: () => native.close()
  }
}

function baseDatabase(): Database.Database {
  const database = new Database(':memory:')
  database.pragma('foreign_keys = ON')
  database.exec(`
    CREATE TABLE agent_sessions (agent_session_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE agent_runs (agent_run_id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE model_requests (
      model_request_id TEXT PRIMARY KEY,
      operation_kind TEXT NOT NULL,
      provider_id TEXT NOT NULL,
      model_id TEXT NOT NULL,
      status TEXT NOT NULL,
      agent_run_id TEXT
    ) STRICT;
    CREATE TABLE agent_events (
      agent_event_id TEXT PRIMARY KEY,
      agent_session_id TEXT NOT NULL,
      agent_run_id TEXT,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      model_request_id TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO agent_sessions VALUES ('session-1');
    INSERT INTO agent_runs VALUES ('run-1');
    INSERT INTO model_requests VALUES ('model-1', 'agent', 'openai', 'gpt', 'running', 'run-1');
  `)
  migration0040.up(database)
  return database
}
