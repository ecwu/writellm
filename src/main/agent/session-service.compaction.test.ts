import { describe, expect, it, vi } from 'vitest'
import { ModelRequestRepository } from '../providers/model-request-repository'
import { loadContinuousRuntimeHistory } from './context-checkpoint'
import type { AgentSessionServiceOptions } from './session-service'
import {
  log,
  config,
  type TitleResult,
  type TitleGenerationInput,
  titleResult,
  FakeAgentRuntime,
  createService,
  createDatabase,
  metadata
} from './session-service.test-support'

describe('AgentSessionService: compaction', () => {
  it('lets one newest complete turn borrow unused checkpoint budget without truncation', async () => {
    const database = await createDatabase()
    const summarizeHistory = vi.fn(
      async (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) => {
        const repository = new ModelRequestRepository(database, log)
        const request = await repository.start({
          operation: 'agent',
          provider: config,
          request: { purpose: 'manual_compaction_tail_borrow' },
          inputItems: 1,
          operationId: input.compactionId,
          projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
        })
        await repository.succeed(request.modelRequestId, {
          metadata: metadata('manual-tail-borrow'),
          outputItems: 1
        })
        return {
          summary: 'Goal and requested deliverable\nPreserve the earlier goal.',
          modelRequestId: request.modelRequestId
        }
      }
    )
    const service = createService(database, new FakeAgentRuntime(), undefined, { summarizeHistory })
    const session = service.createSession('Large recent turn')
    const recentTurn = `Keep this recent turn verbatim: ${'x'.repeat(85_000)}`
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
             agent_event_id, agent_session_id, sequence, type, payload_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      insert.run(
        crypto.randomUUID(),
        session.agentSessionId,
        1,
        'user_message',
        JSON.stringify({ content: 'Summarize this older goal.', delivery: 'prompt', timestamp: 1 }),
        '2026-08-12T00:00:00.000Z'
      )
      insert.run(
        crypto.randomUUID(),
        session.agentSessionId,
        2,
        'run_completed',
        JSON.stringify({ outcome: 'finished' }),
        '2026-08-12T00:00:00.000Z'
      )
      insert.run(
        crypto.randomUUID(),
        session.agentSessionId,
        3,
        'user_message',
        JSON.stringify({ content: recentTurn, delivery: 'prompt', timestamp: 3 }),
        '2026-08-12T00:00:00.000Z'
      )
      insert.run(
        crypto.randomUUID(),
        session.agentSessionId,
        4,
        'run_completed',
        JSON.stringify({ outcome: 'finished' }),
        '2026-08-12T00:00:00.000Z'
      )
    })

    await service.compactSession(session.agentSessionId)
    await vi.waitFor(() => expect(service.projectActivitySnapshot().compactions).toEqual([]))
    const summary = service
      .listEvents(session.agentSessionId)
      .find((event) => event.type === 'compaction_summary')
    expect(summary).toMatchObject({
      payload: expect.objectContaining({
        schemaVersion: 3,
        finalStep: true,
        coveredThroughSequence: 2,
        postCompactionBudgetTokens: 32_000,
        checkpointBudgetTokens: 12_000,
        recentTailBudgetTokens: 20_000,
        tailTokens: expect.any(Number)
      })
    })
    if (summary === undefined) throw new Error('Expected a compaction summary')
    expect((summary.payload as { tailTokens: number }).tailTokens).toBeGreaterThan(20_000)
    expect(loadContinuousRuntimeHistory(database, session.agentSessionId).at(-1)).toMatchObject({
      role: 'user',
      content: recentTurn
    })
    database.close()
  })

  it('keeps the latest successful rolling checkpoint when a later step fails', async () => {
    const database = await createDatabase()
    let attempt = 0
    const summarizeHistory = vi.fn(
      async (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) => {
        attempt += 1
        if (attempt === 2) throw new Error('second summary request failed')
        const repository = new ModelRequestRepository(database, log)
        const request = await repository.start({
          operation: 'agent',
          provider: config,
          request: { purpose: 'manual_compaction_partial' },
          inputItems: 1,
          operationId: input.compactionId,
          projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
        })
        await repository.succeed(request.modelRequestId, {
          metadata: metadata('manual-partial-step'),
          outputItems: 1
        })
        return {
          summary: 'Objective\nFirst rolling step survived.',
          modelRequestId: request.modelRequestId
        }
      }
    )
    const service = createService(database, new FakeAgentRuntime(), undefined, { summarizeHistory })
    const session = service.createSession('Partial rolling history')
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
             agent_event_id, agent_session_id, sequence, type, payload_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      native.transaction(() => {
        for (let sequence = 1; sequence <= 600; sequence += 1) {
          const userTurn = sequence % 2 === 1
          insert.run(
            crypto.randomUUID(),
            session.agentSessionId,
            sequence,
            userTurn ? 'user_message' : 'run_completed',
            JSON.stringify(
              userTurn
                ? {
                    content: `turn-${sequence}-${'x'.repeat(2_000)}`,
                    delivery: 'prompt',
                    timestamp: sequence
                  }
                : { outcome: 'finished' }
            ),
            '2026-08-12T00:00:00.000Z'
          )
        }
      })()
    })

    const { compactionId } = await service.compactSession(session.agentSessionId)
    await vi.waitFor(() => expect(service.projectActivitySnapshot().compactions).toEqual([]))
    const compactionEvents = service
      .listEvents(session.agentSessionId)
      .filter((event) => event.type === 'compaction_summary' || event.type === 'compaction_failed')
    expect(compactionEvents).toEqual([
      expect.objectContaining({
        type: 'compaction_summary',
        payload: expect.objectContaining({
          compactionId,
          stepIndex: 1,
          finalStep: false,
          coveredFromSequence: 1,
          coveredThroughSequence: expect.any(Number)
        })
      }),
      expect.objectContaining({
        type: 'compaction_failed',
        payload: expect.objectContaining({ compactionId, code: 'compaction_failed' })
      })
    ])
    const successfulPayload = compactionEvents[0]?.payload as { coveredThroughSequence?: number }
    expect(successfulPayload.coveredThroughSequence).toBeGreaterThan(240)
    database.close()
  }, 60_000)

  it('keeps a synthetic 200-event near-limit history within the byte budget before parsing payloads', async () => {
    const database = await createDatabase()
    const service = createService(database, new FakeAgentRuntime())
    const session = service.createSession('Bounded events')
    const payloadJson = JSON.stringify({ text: 'x'.repeat(2_095_000) })
    database.immediate((native) => {
      native.exec(`
          CREATE TEMP TABLE fixture_event_payload (
            agent_session_id TEXT NOT NULL,
            payload_json TEXT NOT NULL
          );
        `)
      native
        .prepare('INSERT INTO fixture_event_payload (agent_session_id, payload_json) VALUES (?, ?)')
        .run(session.agentSessionId, payloadJson)
      native.exec(`
          CREATE TEMP VIEW agent_events AS
          WITH RECURSIVE event_sequence(sequence) AS (
            SELECT 1
            UNION ALL
            SELECT sequence + 1 FROM event_sequence WHERE sequence < 200
          )
          SELECT printf('00000000-0000-4000-8000-%012x', sequence) AS agent_event_id,
                 fixture_event_payload.agent_session_id,
                 NULL AS agent_run_id,
                 sequence,
                 'user_message' AS type,
                 fixture_event_payload.payload_json,
                 NULL AS model_request_id,
                 '2026-07-31T00:00:00.000Z' AS created_at
            FROM event_sequence
            CROSS JOIN fixture_event_payload;
        `)
    })

    const first = service.listEventPage(session.agentSessionId, 0, 50)
    expect(first.events).toHaveLength(1)
    expect(first.events[0]?.sequence).toBe(1)
    expect(first.hasMore).toBe(true)
    expect(first.returnedBytes).toBeLessThan(4 * 1024 * 1024)
    expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(4 * 1024 * 1024)
    const second = service.listEventPage(session.agentSessionId, first.nextAfterSequence, 50)
    expect(second.events).toHaveLength(1)
    expect(second.events[0]?.sequence).toBe(2)
    expect(second.hasMore).toBe(true)
    expect(second.events[0]?.agentEventId).not.toBe(first.events[0]?.agentEventId)
    database.close()
  }, 15_000)

  it('paginates 200 events at the row limit without duplicates or omissions', async () => {
    const database = await createDatabase()
    const service = createService(database, new FakeAgentRuntime())
    const session = service.createSession('Row-bounded events')
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
             agent_event_id, agent_session_id, agent_run_id, sequence, type,
             payload_json, model_request_id, created_at
           ) VALUES (?, ?, NULL, ?, 'user_message', ?, NULL, ?)`
      )
      for (let sequence = 1; sequence <= 200; sequence += 1) {
        insert.run(
          crypto.randomUUID(),
          session.agentSessionId,
          sequence,
          JSON.stringify({ text: `event-${sequence}` }),
          '2026-07-31T00:00:00.000Z'
        )
      }
    })

    const sequences: number[] = []
    let afterSequence = 0
    while (true) {
      const page = service.listEventPage(session.agentSessionId, afterSequence, 50)
      expect(page.events.length).toBeLessThanOrEqual(50)
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(4 * 1024 * 1024)
      sequences.push(...page.events.map((event) => event.sequence))
      if (!page.hasMore) break
      expect(page.nextAfterSequence).toBeGreaterThan(afterSequence)
      afterSequence = page.nextAfterSequence
    }
    expect(sequences).toEqual(Array.from({ length: 200 }, (_, index) => index + 1))
    expect(new Set(sequences).size).toBe(200)
    database.close()
  })

  it('uses an immediate bounded fallback title and generates one durable automatic title', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    let resolveTitle: ((result: TitleResult) => void) | undefined
    const pendingTitle = new Promise<TitleResult>((resolve) => {
      resolveTitle = resolve
    })
    const generateTitle = vi.fn((_input: TitleGenerationInput) => pendingTitle)
    const published: Array<{ title: string; titleGenerating: boolean }> = []
    const service = createService(database, runtime, undefined, {
      generateTitle,
      publishSession: (event) => {
        published.push({ title: event.session.title, titleGenerating: event.titleGenerating })
      }
    })
    const session = service.createSession()
    const first = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '分析第三季度欧洲市场的增长机会与主要风险',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })

    expect(service.listSessions()[0]?.title).toBe('分析第三季度欧洲市场的增长机会与主要风险')
    expect(generateTitle).toHaveBeenCalledOnce()
    expect(generateTitle.mock.calls[0]?.[0]).toMatchObject({
      credential: 'agent-secret',
      request: { maxOutputTokens: 64, temperature: 0 }
    })
    expect(Buffer.byteLength(generateTitle.mock.calls[0]?.[0].request.prompt ?? '')).toBeLessThan(
      17_000
    )
    expect(published).toContainEqual({
      title: '分析第三季度欧洲市场的增长机会与主要风险',
      titleGenerating: true
    })
    expect(() => service.archiveSession(session.agentSessionId)).toThrow(
      'title must finish before archive'
    )
    await expect(service.generateSessionTitle(session.agentSessionId)).rejects.toThrow(
      'title must finish'
    )

    resolveTitle?.(titleResult('「欧洲市场增长机会」', 'automatic-title'))
    await vi.waitFor(() => expect(service.listSessions()[0]?.title).toBe('欧洲市场增长机会'))
    const request = await database.kysely
      .selectFrom('model_requests')
      .select(['agent_run_id', 'status', 'operation_kind', 'input_items', 'output_items'])
      .where('agent_run_id', '=', first.agentRunId)
      .where('status', '=', 'succeeded')
      .executeTakeFirstOrThrow()
    expect(request).toMatchObject({
      status: 'succeeded',
      operation_kind: 'agent',
      input_items: 1,
      output_items: 1
    })

    runtime.active().resolve()
    await first.completion
    const second = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Continue with recommendations.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(generateTitle).toHaveBeenCalledOnce()
    runtime.active().resolve()
    await second.completion
    database.close()
  })

  it('uses a compatible lightweight budget for reasoning-model titles', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const generateTitle = vi.fn(async (_input: TitleGenerationInput) =>
      titleResult('Reasoning model title', 'reasoning-title')
    )
    const resolve = vi.fn(async () => ({
      presetId: 'builtin:openai-codex',
      presetName: 'OpenAI Codex',
      providerId: 'openai-codex',
      timeoutMs: 60_000,
      model: {
        id: 'gpt-reasoning',
        name: 'GPT Reasoning',
        api: 'openai-codex-responses',
        provider: 'openai-codex',
        baseUrl: 'https://chatgpt.com/backend-api',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 128_000
      },
      auth: { auth: { apiKey: 'codex-secret' }, source: 'Stored OAuth credential' }
    }))
    const service = createService(database, runtime, undefined, {
      agentCatalog: { resolve } as never,
      generateTitle
    })
    const session = service.createSession(undefined, undefined, {
      presetId: 'builtin:openai-codex',
      modelId: 'gpt-reasoning'
    })
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Explain why this title request needs a reasoning-compatible budget.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })

    await vi.waitFor(() => expect(generateTitle).toHaveBeenCalledOnce())
    expect(generateTitle.mock.calls[0]?.[0].request).toMatchObject({ maxOutputTokens: 512 })
    expect(generateTitle.mock.calls[0]?.[0].request).not.toHaveProperty('temperature')
    await vi.waitFor(() => expect(service.listSessions()[0]?.title).toBe('Reasoning model title'))
    runtime.active().resolve()
    await started.completion
    database.close()
  })

  it('regenerates a title from bounded history and does not overwrite newer session state', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    let resolveAutomatic: ((result: TitleResult) => void) | undefined
    const automatic = new Promise<TitleResult>((resolve) => {
      resolveAutomatic = resolve
    })
    const generateTitle = vi
      .fn()
      .mockImplementationOnce(() => automatic)
      .mockResolvedValueOnce(titleResult('## Market strategy refresh.', 'manual-title'))
    const service = createService(database, runtime, undefined, { generateTitle })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: `Review market strategy ${'evidence '.repeat(3_000)}`,
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    database.immediate((native) =>
      native
        .prepare('UPDATE agent_sessions SET title = ? WHERE agent_session_id = ?')
        .run('Newer authoritative title', session.agentSessionId)
    )
    resolveAutomatic?.(titleResult('Stale automatic title', 'stale-title'))
    await vi.waitFor(() => expect(generateTitle).toHaveBeenCalledOnce())
    await vi.waitFor(() =>
      expect(service.listSessions()[0]?.title).toBe('Newer authoritative title')
    )
    runtime.active().resolve()
    await started.completion

    const regenerated = await service.generateSessionTitle(session.agentSessionId)
    expect(regenerated.title).toBe('Market strategy refresh')
    expect(Buffer.byteLength(generateTitle.mock.calls[1]?.[0].request.prompt ?? '')).toBeLessThan(
      17_000
    )
    database.close()
  })

  it('keeps the fallback on title failure and cancels an in-flight title request on close', async () => {
    const failureDatabase = await createDatabase()
    const failureRuntime = new FakeAgentRuntime()
    const failedService = createService(failureDatabase, failureRuntime, undefined, {
      generateTitle: vi.fn(async (_input: TitleGenerationInput): Promise<TitleResult> => {
        throw new Error('provider title failure')
      })
    })
    const failedSession = failedService.createSession()
    const failedRun = await failedService.startRun({
      agentSessionId: failedSession.agentSessionId,
      prompt: 'Keep this useful fallback title',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await vi.waitFor(() =>
      expect(failedService.listSessions()[0]?.title).toBe('Keep this useful fallback title')
    )
    expect(failureRuntime.active().input.agentRunId).toBe(failedRun.agentRunId)
    failureRuntime.active().resolve()
    await failedRun.completion
    failureDatabase.close()

    const closeDatabase = await createDatabase()
    const closeRuntime = new FakeAgentRuntime()
    const aborted = vi.fn()
    const closingService = createService(closeDatabase, closeRuntime, undefined, {
      generateTitle: vi.fn(
        (input: TitleGenerationInput) =>
          new Promise<TitleResult>((_resolve, reject) => {
            input.signal.addEventListener(
              'abort',
              () => {
                aborted()
                reject(input.signal.reason)
              },
              { once: true }
            )
          })
      )
    })
    const closingSession = closingService.createSession()
    await closingService.startRun({
      agentSessionId: closingSession.agentSessionId,
      prompt: 'Cancel title request on project close',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await closingService.close()
    expect(aborted).toHaveBeenCalledOnce()
    closeDatabase.close()
  })

  it('archives and restores idle conversations idempotently while rejecting archived writes', async () => {
    const database = await createDatabase()
    const service = createService(database, new FakeAgentRuntime())
    const session = service.createSession()

    const archived = service.archiveSession(session.agentSessionId)
    expect(archived).toMatchObject({ status: 'archived', archivedAt: expect.any(String) })
    expect(service.listSessions()).toEqual([])
    expect(service.listSessions('archived')).toEqual([archived])
    expect(service.archiveSession(session.agentSessionId)).toEqual(archived)
    expect(() => service.setApprovalMode(session.agentSessionId, 'yolo')).toThrow('archived')
    expect(() => service.setThinkingLevel(session.agentSessionId, 'high')).toThrow('archived')
    await expect(service.generateSessionTitle(session.agentSessionId)).rejects.toThrow('archived')
    await expect(
      service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'This write must remain blocked.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
    ).rejects.toThrow('archived')

    const restored = service.restoreSession(session.agentSessionId)
    expect(restored).toMatchObject({ status: 'active', archivedAt: null })
    expect(service.restoreSession(session.agentSessionId)).toEqual(restored)
    database.close()
  })
})
