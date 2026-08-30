import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_PENDING_MESSAGE_LIMIT,
  AGENT_PENDING_MESSAGE_MAX_BYTES
} from '../../shared/contracts/agent'
import { ModelRequestRepository } from '../providers/model-request-repository'
import type { AgentSessionServiceOptions } from './session-service'
import {
  log,
  config,
  FakeAgentRuntime,
  createService,
  createDatabase,
  metadata,
  assistant,
  contextOverflowError,
  workerExitError
} from './session-service.test-support'

describe('AgentSessionService: messages', () => {
  it('fails closed without publishing an answer when requested Skills were not loaded', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const publishDelta = vi.fn()
    const commit = 'a'.repeat(40)
    const requested = {
      skillId: 'nature-writing',
      displayName: 'Nature Writing',
      name: 'nature-writing',
      commit,
      manifestSha256: 'b'.repeat(64)
    }
    const state = {
      mode: 'explicit' as const,
      candidates: new Map(),
      automaticCandidateUris: new Set<string>(),
      requestedSkills: [],
      requiredSkills: [],
      invocationSources: new Map<string, 'user' | 'agent'>(),
      dependencyCandidates: new Map(),
      activeSkills: [],
      loadingEntrypointUri: null,
      entrypointModelRequestIds: new Set<string>(),
      dependencies: [],
      readResources: new Map(),
      readingResources: new Map(),
      replay: false,
      allowedResourceKeys: null,
      preparationClosed: false
    }
    const route = vi.fn(async () => ({
      snapshot: {
        schemaVersion: 3 as const,
        mode: 'explicit' as const,
        routingStatus: 'available' as const,
        requestedSkills: [requested],
        skills: [],
        dependencies: [],
        resources: [],
        safeError: null
      },
      prompt: {
        mode: 'explicit' as const,
        mandatory: '<requested_writing_skills />',
        references: []
      },
      modelRequestId: null,
      state
    }))
    const service = createService(database, runtime, undefined, {
      publishDelta,
      skillRouter: { route, isPrepared: vi.fn(() => false) }
    })
    const session = service.createSession('Required skill')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '$nature-writing Rewrite this.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await vi.waitFor(() => expect(runtime.active(started.agentRunId)).toBeDefined())
    const active = runtime.active(started.agentRunId)
    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({ userPrompt: '$nature-writing Rewrite this.' })
    )
    await active.emit({ type: 'assistant_delta', delta: 'Must stay hidden' })
    expect(publishDelta).not.toHaveBeenCalled()
    await expect(
      active.emit({
        type: 'assistant_message',
        modelRequestId: active.input.modelRequestId,
        message: { ...assistant('', 'response-tool-use'), stopReason: 'toolUse' }
      })
    ).resolves.toBeUndefined()
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('response-unfulfilled')
    })
    let preparationError: Error | null = null
    try {
      await active.emit({
        type: 'assistant_message',
        modelRequestId: active.input.modelRequestId,
        message: assistant('Must not be persisted', 'response-unfulfilled')
      })
    } catch (err) {
      preparationError = err instanceof Error ? err : new Error(String(err))
    }
    if (preparationError === null) throw new Error('Expected Skill preparation to fail')
    active.reject(
      Object.assign(new Error(preparationError.message), { code: 'skill_request_unfulfilled' })
    )
    await started.completion

    expect(service.requireRun(started.agentRunId)).toMatchObject({
      status: 'failed',
      errorCode: 'skill_request_unfulfilled',
      skillSnapshot: {
        schemaVersion: 3,
        routingStatus: 'failed',
        requestedSkills: [requested],
        skills: [],
        safeError: 'skill_request_unfulfilled'
      }
    })
    expect(service.listEvents(session.agentSessionId).map((event) => event.type)).toEqual([
      'user_message',
      'assistant_message',
      'run_interrupted'
    ])
    database.close()
  })

  it('persists ordered session history, steering/follow-up turns, and one linked model request per call', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const published: number[] = []
    const service = createService(database, runtime, (event) => {
      published.push(event.sequence)
    })
    const session = service.createSession('Drafting')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Draft an opening.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await service.steer(started.agentRunId, 'Use a calmer tone.')
    await service.followUp(started.agentRunId, 'Then summarize it.')

    const active = runtime.active()
    const followUp = active.commands.find((command) => command.operation === 'follow_up')
    if (followUp?.pendingMessageId === undefined) throw new Error('Expected a pending Follow-up')
    await active.emit({
      type: 'follow_up_consumption_requested',
      consumptionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc418',
      pendingMessageId: followUp.pendingMessageId,
      modelRequestId: followUp.modelRequestId
    })
    const modelRequestIds = [
      active.input.modelRequestId,
      ...active.commands.map((command) => command.modelRequestId)
    ]
    for (const [index, modelRequestId] of modelRequestIds.entries()) {
      await active.emit({
        type: 'model_call_finished',
        modelRequestId,
        outcome: 'succeeded',
        metadata: metadata(`response-${index + 1}`)
      })
      await active.emit({
        type: 'assistant_message',
        modelRequestId,
        message: assistant(`answer-${index + 1}`, `response-${index + 1}`)
      })
    }
    active.resolve()
    await started.completion

    const events = service.listEvents(session.agentSessionId)
    expect(events.map((event) => event.type)).toEqual([
      'user_message',
      'user_message',
      'user_message',
      'assistant_message',
      'assistant_message',
      'assistant_message',
      'run_completed'
    ])
    expect(events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(published).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(
      await database.kysely
        .selectFrom('model_requests')
        .select(['agent_run_id', 'status'])
        .orderBy('created_at')
        .execute()
    ).toEqual([
      { agent_run_id: started.agentRunId, status: 'succeeded' },
      { agent_run_id: started.agentRunId, status: 'succeeded' },
      { agent_run_id: started.agentRunId, status: 'succeeded' }
    ])
    expect(
      await database.kysely
        .selectFrom('agent_runs')
        .select(['status', 'error_json'])
        .executeTakeFirstOrThrow()
    ).toEqual({ status: 'completed', error_json: null })

    const reopenedRuntime = new FakeAgentRuntime()
    const reopened = createService(database, reopenedRuntime)
    const continued = await reopened.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Continue.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(reopenedRuntime.active().input.history).toHaveLength(6)
    reopenedRuntime.active().reject(workerExitError())
    await continued.completion
    expect(
      await database.kysely
        .selectFrom('agent_runs')
        .select('status')
        .where('agent_run_id', '=', continued.agentRunId)
        .executeTakeFirstOrThrow()
    ).toEqual({ status: 'interrupted' })
    database.close()
  })

  it('projects multiple pending Follow-ups and persists only consumed or steered messages', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession('Pending queue')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Keep working.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })

    await service.followUp(started.agentRunId, 'First waiting message.')
    await service.followUp(started.agentRunId, 'Delete this message.')
    await service.followUp(started.agentRunId, 'Steer this message.')
    const commands = runtime
      .active()
      .commands.filter((command) => command.operation === 'follow_up')
    const [, deleted, steered] = commands
    if (deleted?.pendingMessageId === undefined || steered?.pendingMessageId === undefined) {
      throw new Error('Expected three pending Follow-ups')
    }
    expect(
      service.projectActivitySnapshot().runs[0]?.pendingMessages.map((message) => message.content)
    ).toEqual(['First waiting message.', 'Delete this message.', 'Steer this message.'])
    expect(
      service.listEvents(session.agentSessionId).filter((event) => event.type === 'user_message')
    ).toHaveLength(1)

    await service.deletePendingFollowUp(started.agentRunId, deleted.pendingMessageId)
    await service.steerPendingFollowUp(started.agentRunId, steered.pendingMessageId)

    await expect(
      runtime.active().emit({
        type: 'assistant_message',
        modelRequestId: deleted.modelRequestId,
        message: assistant('Stale deleted response.', 'stale-deleted-response')
      })
    ).rejects.toThrow('unauthorized model request')

    expect(
      service.projectActivitySnapshot().runs[0]?.pendingMessages.map((message) => message.content)
    ).toEqual(['First waiting message.'])
    expect(
      service
        .listEvents(session.agentSessionId)
        .filter((event) => event.type === 'user_message')
        .map((event) => event.payload)
    ).toEqual([
      expect.objectContaining({ content: 'Keep working.', delivery: 'prompt' }),
      expect.objectContaining({ content: 'Steer this message.', delivery: 'steer' })
    ])
    expect(
      await database.kysely
        .selectFrom('model_requests')
        .select('status')
        .execute()
        .then((rows) => {
          const counts: Record<string, number> = {}
          for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1
          return counts
        })
    ).toEqual({ running: 3, aborted: 2 })

    await service.abort(started.agentRunId)
    await started.completion
    expect(await database.kysely.selectFrom('model_requests').select('status').execute()).toEqual(
      Array.from({ length: 5 }, () => ({ status: 'aborted' }))
    )
    database.close()
  })

  it('enforces pending Follow-up count and aggregate byte limits without consuming the draft', async () => {
    const countDatabase = await createDatabase()
    const countRuntime = new FakeAgentRuntime()
    const countService = createService(countDatabase, countRuntime)
    const countSession = countService.createSession('Pending count limit')
    const countRun = await countService.startRun({
      agentSessionId: countSession.agentSessionId,
      prompt: 'Keep working.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    for (let index = 0; index < AGENT_PENDING_MESSAGE_LIMIT; index += 1) {
      await countService.followUp(countRun.agentRunId, `Message ${index + 1}`)
    }
    await expect(countService.followUp(countRun.agentRunId, 'One too many')).rejects.toThrow(
      `Up to ${AGENT_PENDING_MESSAGE_LIMIT} messages`
    )
    expect(countService.projectActivitySnapshot().runs[0]?.pendingMessages).toHaveLength(
      AGENT_PENDING_MESSAGE_LIMIT
    )
    await countService.abort(countRun.agentRunId)
    await countRun.completion
    countDatabase.close()

    const byteDatabase = await createDatabase()
    const byteRuntime = new FakeAgentRuntime()
    const byteService = createService(byteDatabase, byteRuntime)
    const byteSession = byteService.createSession('Pending byte limit')
    const byteRun = await byteService.startRun({
      agentSessionId: byteSession.agentSessionId,
      prompt: 'Keep working.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const quarterLimit = 'a'.repeat(AGENT_PENDING_MESSAGE_MAX_BYTES / 4)
    for (let index = 0; index < 4; index += 1) {
      await byteService.followUp(byteRun.agentRunId, quarterLimit)
    }
    await expect(byteService.followUp(byteRun.agentRunId, 'x')).rejects.toThrow(
      'Waiting messages cannot exceed 1 MiB'
    )
    expect(byteService.projectActivitySnapshot().runs[0]?.pendingMessages).toHaveLength(4)
    await byteService.abort(byteRun.agentRunId)
    await byteRun.completion
    byteDatabase.close()
  })

  it('persists partial output as interrupted and aborts the model request on project close', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Draft slowly.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await runtime.active().emit({ type: 'assistant_delta', delta: 'Partial draft' })
    await service.close()
    await started.completion

    expect(
      await database.kysely.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()
    ).toEqual({ status: 'interrupted' })
    expect(
      await database.kysely.selectFrom('model_requests').select('status').executeTakeFirstOrThrow()
    ).toEqual({ status: 'aborted' })
    const events = service.listEvents(session.agentSessionId)
    expect(events.map((event) => event.type)).toEqual([
      'user_message',
      'assistant_message',
      'run_interrupted'
    ])
    expect(events[1]?.payload).toMatchObject({ content: 'Partial draft', interrupted: true })
    database.close()
  })

  it('records provider timeout as a failed run instead of a user interruption', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Wait for the provider.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'timed_out',
      metadata: metadata('response-timeout')
    })
    await active.emit({
      type: 'assistant_message',
      modelRequestId: active.input.modelRequestId,
      message: {
        ...assistant('', 'response-timeout'),
        stopReason: 'error',
        interrupted: false
      }
    })
    const timeout = new Error('Agent provider request timed out')
    timeout.name = 'ProviderTimeoutError'
    active.reject(timeout)
    await started.completion

    expect(service.listRuns(session.agentSessionId)[0]).toMatchObject({
      status: 'failed',
      errorCode: 'provider_timeout'
    })
    expect(
      await database.kysely
        .selectFrom('model_requests')
        .select(['status', 'error_json'])
        .executeTakeFirstOrThrow()
    ).toMatchObject({
      status: 'failed',
      error_json: JSON.stringify({ code: 'provider_timeout', retryable: true })
    })
    database.close()
  })

  it('persists exhausted provider retries as a retryable failed request and run', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Retry a transient provider failure.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    await active.emit({
      type: 'model_call_retrying',
      modelRequestId: active.input.modelRequestId,
      completedAttempts: 4,
      maxAttempts: 5,
      delayMs: 8_000,
      reasonCode: 'server_error'
    })
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'failed',
      failureCode: 'provider_retries_exhausted',
      retryable: true,
      httpStatus: 503,
      metadata: { ...metadata('response-exhausted'), retryCount: 4 }
    })
    await active.emit({
      type: 'assistant_message',
      modelRequestId: active.input.modelRequestId,
      message: {
        ...assistant('', 'response-exhausted'),
        stopReason: 'error',
        metadata: { ...metadata('response-exhausted'), retryCount: 4 },
        interrupted: true
      }
    })
    const exhausted = new Error('Agent provider request failed after 5 attempts')
    exhausted.name = 'ProviderRetriesExhaustedError'
    active.reject(exhausted)
    await started.completion

    expect(service.listRuns(session.agentSessionId)[0]).toMatchObject({
      status: 'failed',
      errorCode: 'provider_retries_exhausted'
    })
    expect(
      await database.kysely
        .selectFrom('model_requests')
        .select(['status', 'error_json', 'retry_count'])
        .executeTakeFirstOrThrow()
    ).toMatchObject({
      status: 'failed',
      error_json: JSON.stringify({
        code: 'provider_retries_exhausted',
        retryable: true,
        httpStatus: 503
      }),
      retry_count: 4
    })
    database.close()
  })

  it('retries one provider overflow only before activity and records a fresh model request', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn(
      async (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) => {
        const repository = new ModelRequestRepository(database, log)
        const request = await repository.start({
          operation: 'agent',
          provider: config,
          request: { purpose: 'overflow_compaction' },
          inputItems: 1,
          operationId: input.compactionId,
          ...(input.agentRunId === null ? {} : { agentRunId: input.agentRunId }),
          projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
        })
        await repository.succeed(request.modelRequestId, {
          metadata: metadata('overflow-compaction-response'),
          outputItems: 1
        })
        return {
          summary: 'Objective\nPreserve the earlier completed turn.',
          modelRequestId: request.modelRequestId
        }
      }
    )
    const service = createService(database, runtime, undefined, { summarizeHistory })
    const session = service.createSession()
    const earlier = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Earlier completed request',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    runtime.active(earlier.agentRunId).resolve()
    await earlier.completion

    const retried = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Current request',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const firstModelRequestId = runtime.active(retried.agentRunId).input.modelRequestId
    runtime.active(retried.agentRunId).reject(contextOverflowError())
    await vi.waitFor(() => {
      expect(runtime.active(retried.agentRunId).input.modelRequestId).not.toBe(firstModelRequestId)
    })
    const retryModelRequestId = runtime.active(retried.agentRunId).input.modelRequestId
    expect(summarizeHistory).toHaveBeenCalledOnce()
    expect(summarizeHistory.mock.calls[0]?.[0]).toMatchObject({
      agentRunId: retried.agentRunId,
      trigger: 'provider_overflow'
    })

    runtime.active(retried.agentRunId).reject(contextOverflowError())
    await retried.completion
    expect(service.listRuns(session.agentSessionId)[0]).toMatchObject({
      agentRunId: retried.agentRunId,
      status: 'failed',
      errorCode: 'context_overflow'
    })
    expect(
      service
        .listEvents(session.agentSessionId)
        .filter((event) => event.type === 'compaction_summary')
    ).toHaveLength(1)
    const runRequests = await database.kysely
      .selectFrom('model_requests')
      .select(['model_request_id', 'status'])
      .where('agent_run_id', '=', retried.agentRunId)
      .execute()
    expect(runRequests.map((request) => request.model_request_id)).toEqual(
      expect.arrayContaining([firstModelRequestId, retryModelRequestId])
    )
    expect(runRequests.filter((request) => request.status === 'aborted')).toHaveLength(2)
    database.close()
  })

  it('does not replay a provider overflow after assistant activity', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn()
    const service = createService(database, runtime, undefined, { summarizeHistory })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Do not replay tools or partial output',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active(started.agentRunId)
    await active.emit({ type: 'assistant_delta', delta: 'Partial visible answer' })
    active.reject(contextOverflowError())
    await started.completion

    expect(summarizeHistory).not.toHaveBeenCalled()
    expect(service.listRuns(session.agentSessionId)[0]).toMatchObject({
      status: 'failed',
      errorCode: 'context_overflow_after_activity'
    })
    expect(service.listEvents(session.agentSessionId)).toContainEqual(
      expect.objectContaining({
        type: 'assistant_message',
        payload: expect.objectContaining({ content: 'Partial visible answer', interrupted: true })
      })
    )
    database.close()
  })

  it('records an exhausted active read batch without replaying prior tool activity', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn()
    const service = createService(database, runtime, undefined, { summarizeHistory })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Continue one bounded RQ3 section.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const error: Error & { code?: string } = new Error(
      'The latest Agent read batch still exceeds context after one smaller-read recovery'
    )
    error.name = 'AgentToolBatchContextExhaustedError'
    error.code = 'tool_batch_context_exhausted'
    runtime.active(started.agentRunId).reject(error)
    await started.completion

    expect(summarizeHistory).not.toHaveBeenCalled()
    expect(service.listRuns(session.agentSessionId)[0]).toMatchObject({
      status: 'failed',
      errorCode: 'tool_batch_context_exhausted'
    })
    expect(
      service.listEvents(session.agentSessionId).filter((event) => event.type === 'run_interrupted')
    ).toContainEqual(
      expect.objectContaining({
        payload: expect.objectContaining({
          status: 'failed',
          code: 'tool_batch_context_exhausted'
        })
      })
    )
    database.close()
  })

  it('records an explicit user stop and blocks queueing after cancellation', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Stop this run.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await service.abort(started.agentRunId)
    await expect(service.abort(started.agentRunId)).resolves.toBeUndefined()

    expect(service.listRuns(session.agentSessionId)[0]).toMatchObject({
      status: 'interrupted',
      errorCode: 'user_stopped'
    })
    expect(service.listEvents(session.agentSessionId).at(-1)?.payload).toEqual({
      code: 'user_stopped',
      status: 'interrupted'
    })
    await expect(service.followUp(started.agentRunId, 'This must not be queued.')).rejects.toThrow(
      'active'
    )
    database.close()
  })

  it('recovers running rows after relaunch without claiming a false completion', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const first = createService(database, runtime)
    const sessions = [first.createSession('First'), first.createSession('Second')]
    const started = await Promise.all(
      sessions.map((session) =>
        first.startRun({
          agentSessionId: session.agentSessionId,
          prompt: 'Draft.',
          editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
        })
      )
    )
    expect(started).toHaveLength(2)

    const relaunched = createService(database, new FakeAgentRuntime())
    expect(relaunched.recoverInterruptedRuns()).toBe(2)
    expect(await database.kysely.selectFrom('agent_runs').select('status').execute()).toEqual([
      { status: 'interrupted' },
      { status: 'interrupted' }
    ])
    for (const session of sessions) {
      expect(relaunched.listEvents(session.agentSessionId).at(-1)?.type).toBe('run_interrupted')
    }
    database.close()
  })

  it('closes an unmatched compaction start as process_restarted without resuming model work', async () => {
    const database = await createDatabase()
    const first = createService(database, new FakeAgentRuntime())
    const session = first.createSession('Interrupted compaction')
    const compactionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc499'
    database.immediate((native) => {
      native
        .prepare(
          `INSERT INTO agent_events (
               agent_event_id, agent_session_id, sequence, type, payload_json, created_at
             ) VALUES (?, ?, 1, 'compaction_started', ?, ?)`
        )
        .run(
          '019c6a5c-8d34-7a8e-a602-3d37a52dc498',
          session.agentSessionId,
          JSON.stringify({
            schemaVersion: 2,
            compactionId,
            trigger: 'manual',
            phase: 'planning',
            timestamp: Date.parse('2026-08-12T00:00:00.000Z')
          }),
          '2026-08-12T00:00:00.000Z'
        )
    })

    const relaunched = createService(database, new FakeAgentRuntime())
    expect(relaunched.recoverInterruptedRuns()).toBe(0)
    expect(relaunched.listEvents(session.agentSessionId).at(-1)).toMatchObject({
      agentRunId: null,
      type: 'compaction_failed',
      payload: {
        schemaVersion: 2,
        compactionId,
        trigger: 'manual',
        code: 'process_restarted',
        retryable: true,
        aborted: true
      }
    })
    database.close()
  })

  it('keeps durable run truth complete when renderer event delivery closes', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime, (event) => {
      if (event.type === 'assistant_message') throw new Error('Renderer closed')
    })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Draft.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('response-renderer-close')
    })
    await active.emit({
      type: 'assistant_message',
      modelRequestId: active.input.modelRequestId,
      message: assistant('Durable answer', 'response-renderer-close')
    })
    active.resolve()
    await started.completion

    expect(
      await database.kysely.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()
    ).toEqual({ status: 'completed' })
    expect(service.listEvents(session.agentSessionId).map((event) => event.type)).toEqual([
      'user_message',
      'assistant_message',
      'run_completed'
    ])
    database.close()
  })

  it('keeps incompatible history readable but requires a new session for new runs', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession('Legacy session')
    await database.kysely
      .updateTable('agent_sessions')
      .set({ pi_runtime_version: '0.80.7' })
      .where('agent_session_id', '=', session.agentSessionId)
      .execute()

    expect(service.listSessions()).toEqual([
      expect.objectContaining({ agentSessionId: session.agentSessionId, compatible: false })
    ])
    await expect(
      service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Continue.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
    ).rejects.toThrow('incompatible')
    expect(service.listEvents(session.agentSessionId)).toEqual([])
    database.close()
  })
})
