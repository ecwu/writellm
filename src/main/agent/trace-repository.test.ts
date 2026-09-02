import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { traceBenchmarkTestTimeoutMs } from '../../../scripts/test-timeouts.mjs'
import type { ProjectDatabaseSchema } from '../project/database-types'
import type { ProjectDatabase } from '../project/project-database'
import { migration0040 } from '../project/migrations/0040-agent-request-traces'
import { AgentTraceRepository } from './trace-repository'

describe('AgentTraceRepository', () => {
  let database: Database.Database | undefined
  const traceBenchmark = process.env['WRITELLM_TRACE_BENCHMARK'] === '1'
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

  it('records a diagnostic gap without throwing when one document exceeds 8 MiB', () => {
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
    ).not.toThrow()
    expect(database.prepare('SELECT COUNT(*) FROM agent_trace_payloads').pluck().get()).toBe(0)
    expect(
      database.prepare('SELECT capture_status, failure_code FROM model_request_traces').get()
    ).toEqual({ capture_status: 'failed', failure_code: 'diagnostic_gap' })
    repository.complete({ modelRequestId: 'model-1', physicalAttemptCount: 1 })
    expect(database.prepare('SELECT failure_code FROM model_request_traces').pluck().get()).toBe(
      'diagnostic_gap'
    )
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
    ).not.toThrow()
  })

  it('retains the 32 MiB storage boundary across independent captures without failing the caller', () => {
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
    ).not.toThrow()
  })

  it(
    'deduplicates long repeated histories and rebuilds every request through SQL',
    () => {
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
      const history = Array.from({ length: traceBenchmark ? 80 : 8 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `${index}:${'context '.repeat(512)}`
      }))
      const requestCount = traceBenchmark ? 12 : 3
      const harness = { systemPrompt: 'stable policy', messages: history, tools: [toolSchema] }
      const provider = { model: 'test-model', input: history, tools: [toolSchema], stream: true }
      const rawBytesPerRequest =
        Buffer.byteLength(JSON.stringify(harness)) + Buffer.byteLength(JSON.stringify(provider))

      for (let request = 1; request <= requestCount; request += 1) {
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

      const rawBytes = rawBytesPerRequest * requestCount
      const deduplicatedBytes = Number(
        database
          .prepare('SELECT COALESCE(SUM(byte_size), 0) FROM agent_trace_payloads')
          .pluck()
          .get()
      )
      const rows = database
        .prepare(
          "SELECT harness_request_json, provider_requests_json FROM agent_model_request_trace_v WHERE model_request_id LIKE 'capacity-%'"
        )
        .all() as Array<{ harness_request_json: string; provider_requests_json: string }>

      expect(rows).toHaveLength(requestCount)
      for (const row of rows) {
        expect(JSON.parse(row.harness_request_json)).toEqual(harness)
        expect(JSON.parse(row.provider_requests_json)).toEqual([provider])
      }
      expect(deduplicatedBytes).toBeLessThan(rawBytes)
    },
    traceBenchmarkTestTimeoutMs
  )

  it('survives serialization and SQLite faults, logging the original errors', () => {
    database = baseDatabase()
    const log = logger()
    const project = projectDatabase(database)
    const repository = new AgentTraceRepository(project, log)
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    const capture = (value: unknown) =>
      repository.capture({
        modelRequestId: 'model-1',
        purpose: 'agent_prompt',
        apiId: 'openai-responses',
        traceId: 'run-1',
        physicalAttempt: 1,
        documents: [{ kind: 'provider_request', value }]
      })
    expect(() => capture(cyclic)).not.toThrow()
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.any(String)
    )
    const sqliteError = new Error('SQLITE_FULL: database or disk is full')
    vi.spyOn(project, 'immediate').mockImplementation(() => {
      throw sqliteError
    })
    expect(() => capture({ messages: [] })).not.toThrow()
    expect(() =>
      repository.complete({ modelRequestId: 'model-1', physicalAttemptCount: 1 })
    ).not.toThrow()
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: sqliteError }),
      expect.any(String)
    )
  })
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
