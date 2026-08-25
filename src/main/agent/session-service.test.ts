import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_PENDING_MESSAGE_LIMIT,
  AGENT_PENDING_MESSAGE_MAX_BYTES,
  type AgentRuntimeEvent
} from '../../shared/contracts/agent'
import type { AgentEventRecord } from '../../shared/contracts/agent-ipc'
import type { AgentToolRequest, AgentToolResponse } from '../../shared/contracts/agent-tools'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type {
  AgentSessionRunHandle,
  AgentSessionRunInput,
  AgentSessionRuntime
} from '../providers/gateways'
import { ModelRequestRepository } from '../providers/model-request-repository'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import { loadContinuousRuntimeHistory } from './context-checkpoint'
import { AgentSessionService, type AgentSessionServiceOptions } from './session-service'
import { AgentToolDomainError } from './read-tools'

const temporaryDirectories: string[] = []
const log = pino({ level: 'silent' })
const config: Extract<ProviderConfig, { role: 'agent' }> = {
  role: 'agent',
  providerId: 'openai-compatible',
  baseUrl: 'https://agent.example.test/v1',
  model: 'writer',
  modelRevision: 'writer-r1',
  timeoutMs: 30_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true }))
  )
})

describe('AgentSessionService', () => {
  it('runs three conversations concurrently, rejects 3+1, and targets queue and stop by run', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const sessions = ['One', 'Two', 'Three', 'Four'].map((title) => service.createSession(title))
    const editorContext = {
      activeSectionId: null,
      activeBlockId: null,
      selectedBlockIds: []
    }

    const firstSession = sessions[0]
    const fourthSession = sessions[3]
    if (firstSession === undefined || fourthSession === undefined) {
      throw new Error('Expected four test conversations')
    }
    const first = await service.startRun({
      agentSessionId: firstSession.agentSessionId,
      prompt: 'First request',
      editorContext
    })
    await expect(
      service.startRun({
        agentSessionId: firstSession.agentSessionId,
        prompt: 'Duplicate request',
        editorContext
      })
    ).rejects.toThrow('already active in this conversation')
    const [second, third] = await Promise.all(
      sessions.slice(1, 3).map((session, index) =>
        service.startRun({
          agentSessionId: session.agentSessionId,
          prompt: `Concurrent request ${index + 2}`,
          editorContext
        })
      )
    )

    expect(service.projectActivitySnapshot()).toMatchObject({
      limit: 3,
      activeCount: 3,
      runs: expect.arrayContaining([
        expect.objectContaining({ agentRunId: first.agentRunId }),
        expect.objectContaining({ agentRunId: second.agentRunId }),
        expect.objectContaining({ agentRunId: third.agentRunId })
      ])
    })
    await expect(
      service.startRun({
        agentSessionId: fourthSession.agentSessionId,
        prompt: 'Fourth request',
        editorContext
      })
    ).rejects.toThrow('Up to 3 Agent tasks can work at once')

    await service.followUp(second.agentRunId, 'Queue only on the second run')
    expect(runtime.active(second.agentRunId).commands).toHaveLength(1)
    expect(runtime.active(first.agentRunId).commands).toHaveLength(0)
    await service.abort(second.agentRunId)
    expect(service.requireRun(second.agentRunId)).toMatchObject({
      status: 'interrupted',
      errorCode: 'user_stopped'
    })
    expect(service.requireRun(first.agentRunId).status).toBe('running')
    expect(service.requireRun(third.agentRunId).status).toBe('running')

    const fourth = await service.startRun({
      agentSessionId: fourthSession.agentSessionId,
      prompt: 'Fourth request after release',
      editorContext
    })
    runtime.active(first.agentRunId).resolve()
    runtime.active(third.agentRunId).resolve()
    runtime.active(fourth.agentRunId).resolve()
    await Promise.all([first.completion, third.completion, fourth.completion])
    expect(service.projectActivitySnapshot().activeCount).toBe(0)
    database.close()
  })

  it('allows two runs plus one manual compaction and releases the slot after stop', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn(
      (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) =>
        new Promise<{ summary: string; modelRequestId: string }>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
        })
    )
    const service = createService(database, runtime, undefined, { summarizeHistory })
    const [manualSession, runSessionOne, runSessionTwo, blockedSession] = [
      'Manual',
      'Run one',
      'Run two',
      'Blocked'
    ].map((title) => service.createSession(title))
    if (!manualSession || !runSessionOne || !runSessionTwo || !blockedSession) {
      throw new Error('Expected four test conversations')
    }
    const editorContext = {
      activeSectionId: null,
      activeBlockId: null,
      selectedBlockIds: []
    }
    for (const prompt of ['Old turn one', 'Old turn two']) {
      const run = await service.startRun({
        agentSessionId: manualSession.agentSessionId,
        prompt,
        editorContext
      })
      runtime.active(run.agentRunId).resolve()
      await run.completion
    }
    const [first, second] = await Promise.all(
      [runSessionOne, runSessionTwo].map((session) =>
        service.startRun({
          agentSessionId: session.agentSessionId,
          prompt: session.title,
          editorContext
        })
      )
    )

    const { compactionId } = await service.compactSession(manualSession.agentSessionId)
    await vi.waitFor(() => expect(summarizeHistory).toHaveBeenCalledOnce())
    expect(service.projectActivitySnapshot()).toMatchObject({
      limit: 3,
      activeCount: 3,
      runs: expect.arrayContaining([
        expect.objectContaining({ agentRunId: first.agentRunId }),
        expect.objectContaining({ agentRunId: second.agentRunId })
      ]),
      compactions: [
        expect.objectContaining({
          compactionId,
          agentSessionId: manualSession.agentSessionId,
          trigger: 'manual',
          phase: 'summarizing'
        })
      ]
    })
    expect(
      service
        .listSessions()
        .find((session) => session.agentSessionId === manualSession.agentSessionId)
    ).toMatchObject({ workflowState: 'compacting' })
    await expect(
      service.startRun({
        agentSessionId: blockedSession.agentSessionId,
        prompt: 'Fourth project task',
        editorContext
      })
    ).rejects.toThrow('Up to 3 Agent tasks can work at once')

    await service.stopCompaction(manualSession.agentSessionId, compactionId)
    expect(service.projectActivitySnapshot()).toMatchObject({ activeCount: 2, compactions: [] })
    expect(
      service
        .listEvents(manualSession.agentSessionId)
        .filter((event) => event.type === 'compaction_failed')
    ).toEqual([
      expect.objectContaining({
        agentRunId: null,
        payload: expect.objectContaining({ code: 'aborted', aborted: true })
      })
    ])

    runtime.active(first.agentRunId).resolve()
    runtime.active(second.agentRunId).resolve()
    await Promise.all([first.completion, second.completion])
    database.close()
  })

  it('cancels and settles every active conversation when the project closes', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const sessions = ['Close one', 'Close two', 'Close three'].map((title) =>
      service.createSession(title)
    )
    const runs = await Promise.all(
      sessions.map((session) =>
        service.startRun({
          agentSessionId: session.agentSessionId,
          prompt: `Keep ${session.title} active`,
          editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
        })
      )
    )

    await service.close()

    expect(runs.map((run) => service.requireRun(run.agentRunId).status)).toEqual([
      'interrupted',
      'interrupted',
      'interrupted'
    ])
    expect(service.projectActivitySnapshot()).toMatchObject({ activeCount: 0, runs: [] })
    database.close()
  })

  it('releases a reserved slot when asynchronous run preparation fails', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const activityCounts: number[] = []
    const service = createService(database, runtime, undefined, {
      publishActivity: (snapshot) => {
        activityCounts.push(snapshot.activeCount)
      },
      skillRouter: {
        route: async () => {
          throw new Error('Skill catalog disappeared')
        }
      }
    })
    const failedSession = service.createSession('Missing skill')

    const started = await service.startRun({
      agentSessionId: failedSession.agentSessionId,
      prompt: 'This preparation will fail.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await started.completion
    expect(service.requireRun(started.agentRunId)).toMatchObject({
      status: 'failed',
      errorCode: 'skill_route_failed'
    })
    expect(service.projectActivitySnapshot().activeCount).toBe(0)
    expect(activityCounts).toEqual([1, 1, 0])
    database.close()
  })

  it('keeps run cleanup registered when current-session delivery lookup fails', async () => {
    const opened = await createDatabase()
    const fault = faultNextImmediate(opened)
    const runtime = new FakeAgentRuntime()
    const original = new Error('simulated current-session lookup failure')
    const warn = vi.fn()
    const failureLog = { info: vi.fn(), warn, error: vi.fn() } as unknown as typeof log
    let runSnapshots = 0
    const service = createService(fault.database, runtime, undefined, {
      log: failureLog,
      publishActivity: (snapshot) => {
        if (snapshot.activeCount !== 1 || snapshot.runs.length !== 1) return
        runSnapshots += 1
        if (runSnapshots === 2) fault.failNext(original)
      }
    })
    const firstSession = service.createSession('Delivery lookup failure')
    const started = await service.startRun({
      agentSessionId: firstSession.agentSessionId,
      prompt: 'Keep the cleanup chain registered.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })

    expect(
      warn.mock.calls.find(([fields]) => fields.event === 'agent.session.delivery_failed')?.[0]
    ).toEqual(
      expect.objectContaining({ err: original, agentSessionId: firstSession.agentSessionId })
    )
    runtime.active(started.agentRunId).resolve()
    await started.completion
    expect(service.projectActivitySnapshot().activeCount).toBe(0)

    const nextSession = service.createSession('Slot remains reusable')
    const next = await service.startRun({
      agentSessionId: nextSession.agentSessionId,
      prompt: 'Use the released slot.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    runtime.active(next.agentRunId).resolve()
    await next.completion
    expect(service.projectActivitySnapshot().activeCount).toBe(0)
    fault.database.close()
  })

  it('keeps manual-compaction cleanup registered when session delivery lookup fails', async () => {
    const opened = await createDatabase()
    const fault = faultNextImmediate(opened)
    const runtime = new FakeAgentRuntime()
    const original = new Error('simulated compaction session lookup failure')
    const warn = vi.fn()
    const failureLog = { info: vi.fn(), warn, error: vi.fn() } as unknown as typeof log
    let armDeliveryFailure = false
    const summarizeHistory = vi.fn(
      (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) =>
        new Promise<{ summary: string; modelRequestId: string }>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
        })
    )
    const service = createService(fault.database, runtime, undefined, {
      log: failureLog,
      summarizeHistory,
      publishActivity: (snapshot) => {
        if (armDeliveryFailure && snapshot.compactions.length === 1) {
          armDeliveryFailure = false
          fault.failNext(original)
        }
      }
    })
    const session = service.createSession('Compaction delivery failure')
    for (const prompt of ['Historical turn one', 'Historical turn two']) {
      const run = await service.startRun({
        agentSessionId: session.agentSessionId,
        prompt,
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
      runtime.active(run.agentRunId).resolve()
      await run.completion
    }

    armDeliveryFailure = true
    const { compactionId } = await service.compactSession(session.agentSessionId)
    await vi.waitFor(() => expect(summarizeHistory).toHaveBeenCalledOnce())
    expect(
      warn.mock.calls.find(([fields]) => fields.event === 'agent.session.delivery_failed')?.[0]
    ).toEqual(expect.objectContaining({ err: original, agentSessionId: session.agentSessionId }))
    await service.stopCompaction(session.agentSessionId, compactionId)
    expect(service.projectActivitySnapshot().activeCount).toBe(0)

    const nextSession = service.createSession('Slot after compaction failure')
    const next = await service.startRun({
      agentSessionId: nextSession.agentSessionId,
      prompt: 'Use the released compaction slot.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    runtime.active(next.agentRunId).resolve()
    await next.completion
    expect(service.projectActivitySnapshot().activeCount).toBe(0)
    fault.database.close()
  })

  it('fails oversized current input as current_turn_too_large before starting Pi', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime, undefined, {
      resolveModelLimits: async () => ({
        contextWindowTokens: 32_000,
        inputLimitTokens: 24_000,
        outputLimitTokens: 4_096,
        source: 'models_dev',
        catalogModelKey: 'test/small-model',
        resolvedAt: '2026-08-12T00:00:00.000Z'
      })
    })
    const session = service.createSession('Oversized current turn')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: `永不截断🙂${'界'.repeat(20_000)}`,
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await started.completion

    expect(service.requireRun(started.agentRunId)).toMatchObject({
      status: 'failed',
      errorCode: 'current_turn_too_large'
    })
    expect(() => runtime.active(started.agentRunId)).toThrow('No fake Agent run is active')
    database.close()
  })

  it('returns a pending run before skill routing and permits only Stop until routing completes', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    let resolveRoute: (() => void) | undefined
    const routed = new Promise<void>((resolve) => {
      resolveRoute = resolve
    })
    const service = createService(database, runtime, undefined, {
      skillRouter: {
        route: async () => {
          await routed
          return {
            snapshot: {
              schemaVersion: 3,
              mode: 'auto',
              routingStatus: 'not_needed',
              requestedSkills: [],
              skills: [],
              dependencies: [],
              resources: [],
              safeError: null
            },
            prompt: { mode: 'auto', mandatory: '', references: [] },
            modelRequestId: null
          }
        }
      }
    })
    const session = service.createSession('Skill routing')

    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Draft an opening.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })

    expect(service.requireRun(started.agentRunId).skillSnapshot.routingStatus).toBe('pending')
    expect(() => runtime.active()).toThrow('No fake Agent run')
    await expect(service.steer(started.agentRunId, 'Too soon')).rejects.toThrow(
      'skill selection is still in progress'
    )
    resolveRoute?.()
    await vi.waitFor(() => expect(runtime.active().input.agentRunId).toBe(started.agentRunId))
    runtime.active().resolve()
    await started.completion
    expect(service.requireRun(started.agentRunId).skillSnapshot.routingStatus).toBe('not_needed')
    database.close()
  })

  it('cancels skill routing before the provider runtime starts', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime, undefined, {
      skillRouter: {
        route: (input) =>
          new Promise((_resolve, reject) => {
            input.signal.addEventListener('abort', () => reject(input.signal.reason), {
              once: true
            })
          })
      }
    })
    const session = service.createSession('Cancelable skill routing')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Draft an opening.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })

    await service.abort(started.agentRunId)

    expect(service.requireRun(started.agentRunId)).toMatchObject({
      status: 'interrupted',
      errorCode: 'user_stopped'
    })
    expect(() => runtime.active()).toThrow('No fake Agent run')
    database.close()
  })

  it('persists presentation-only metadata while keeping the full model prompt', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession('Revision feedback')
    const prompt =
      'The user rejected the section update. Address this feedback: use a quieter opening.'
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt,
      presentation: {
        kind: 'review_feedback',
        displayContent: 'Use a quieter opening.'
      },
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })

    expect(runtime.active().input.prompt).toBe(prompt)
    expect(service.listEventPage(session.agentSessionId, 0, 10).events[0]?.payload).toMatchObject({
      content: prompt,
      presentation: {
        kind: 'review_feedback',
        displayContent: 'Use a quieter opening.'
      }
    })
    runtime.active().resolve()
    await started.completion
    database.close()
  })

  it('publishes the queued prompt and marks routing failed when skill routing errors', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const published: AgentEventRecord[] = []
    const service = createService(
      database,
      runtime,
      (event) => {
        published.push(event)
      },
      {
        skillRouter: {
          route: async () => {
            throw new Error('router exploded')
          }
        }
      }
    )
    const session = service.createSession('Routing failure')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Draft an opening.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await started.completion

    const run = service.requireRun(started.agentRunId)
    expect(run).toMatchObject({ status: 'failed', errorCode: 'skill_route_failed' })
    expect(run.skillSnapshot).toMatchObject({
      routingStatus: 'failed',
      safeError: 'skill_route_failed'
    })
    expect(published.map((event) => event.type)).toEqual(['user_message', 'run_interrupted'])
    expect(published[0]?.payload).toMatchObject({ delivery: 'prompt' })
    expect(() => runtime.active()).toThrow('No fake Agent run')
    database.close()
  })

  it('projects bounded historical SkillRouter usage through listRuns', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession('Historical route usage')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Draft an opening.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('historical-route')
    })
    active.resolve()
    await started.completion

    database.immediate((sqlite) => {
      sqlite
        .prepare(
          `UPDATE model_requests
              SET delivery = 'skill_route', input_tokens = 7, output_tokens = 2,
                  cache_read_tokens = 3, cache_write_tokens = 1,
                  estimated_cost_usd_micros = 9, retry_count = 2
            WHERE model_request_id = ?`
        )
        .run(active.input.modelRequestId)
      sqlite
        .prepare('UPDATE agent_runs SET skill_route_model_request_id = ? WHERE agent_run_id = ?')
        .run(active.input.modelRequestId, started.agentRunId)
    })

    expect(service.listRuns(session.agentSessionId)[0]?.skillRouteUsage).toEqual({
      inputTokens: 7,
      outputTokens: 2,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
      estimatedCostUsdMicros: 9,
      retryCount: 2
    })
    database.close()
  })

  it('records a user stop during compaction as user_stopped instead of compaction_failed', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn(
      (
        input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]
      ): Promise<{ summary: string; modelRequestId: string }> =>
        new Promise((_resolve, reject) => {
          if (input.signal.aborted) {
            reject(input.signal.reason)
            return
          }
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
        })
    )
    const service = createService(database, runtime, undefined, {
      messageTokenBudget: 4_096,
      summarizeHistory,
      skillRouter: {
        route: async () => ({
          snapshot: {
            schemaVersion: 3,
            mode: 'auto',
            routingStatus: 'not_needed',
            requestedSkills: [],
            skills: [],
            dependencies: [],
            resources: [],
            safeError: null
          },
          prompt: { mode: 'auto', mandatory: '', references: [] },
          modelRequestId: null
        })
      }
    })
    const session = service.createSession('Compaction stop')
    const first = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '界'.repeat(2_500),
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await vi.waitFor(() => expect(runtime.active().input.agentRunId).toBe(first.agentRunId))
    const firstActive = runtime.active()
    await firstActive.emit({
      type: 'model_call_finished',
      modelRequestId: firstActive.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('long-response')
    })
    await firstActive.emit({
      type: 'assistant_message',
      modelRequestId: firstActive.input.modelRequestId,
      message: assistant('文'.repeat(2_500), 'long-response')
    })
    firstActive.resolve()
    await first.completion

    const second = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Continue.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await vi.waitFor(() => expect(summarizeHistory).toHaveBeenCalledOnce())
    await service.abort(second.agentRunId)
    await second.completion

    expect(service.requireRun(second.agentRunId)).toMatchObject({
      status: 'interrupted',
      errorCode: 'user_stopped'
    })
    database.close()
  })

  it('snapshots the selected Pi preset and model and only permits idle switching', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const resolve = vi.fn(async () => ({
      presetId: 'builtin:anthropic',
      presetName: 'Anthropic',
      providerId: 'anthropic',
      timeoutMs: 45_000,
      model: {
        id: 'claude-writer',
        name: 'Claude Writer',
        api: 'anthropic-messages',
        provider: 'anthropic',
        baseUrl: 'https://api.anthropic.com',
        reasoning: true,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 16_384
      },
      auth: { auth: { apiKey: 'anthropic-secret' }, source: 'Stored API key' }
    }))
    const service = createService(database, runtime, undefined, {
      agentCatalog: { resolve } as never
    })
    const session = service.createSession(
      'Provider selection',
      undefined,
      {
        presetId: 'builtin:anthropic',
        modelId: 'claude-writer'
      },
      'xhigh'
    )
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Draft an opening.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })

    expect(runtime.active().config).toMatchObject({
      providerId: 'anthropic',
      presetId: 'builtin:anthropic',
      providerName: 'Anthropic',
      model: 'claude-writer',
      modelName: 'Claude Writer',
      api: 'anthropic-messages'
    })
    expect(JSON.parse(runtime.active().credential)).toEqual({ apiKey: 'anthropic-secret' })
    expect(runtime.active().input).toMatchObject({
      thinkingLevel: 'high',
      runtimeModel: {
        id: 'claude-writer',
        provider: 'anthropic',
        reasoning: true
      }
    })
    expect(() =>
      service.setModelSelection(session.agentSessionId, {
        presetId: 'builtin:openai',
        modelId: 'gpt-writer'
      })
    ).toThrow('active')
    expect(() => service.setThinkingLevel(session.agentSessionId, 'low')).toThrow('active')
    expect(() => service.archiveSession(session.agentSessionId)).toThrow('run must finish')

    runtime.active().resolve()
    await started.completion
    const runs = service.listRuns(session.agentSessionId, 10)
    expect(runs[0]).toMatchObject({
      providerPresetId: 'builtin:anthropic',
      providerId: 'anthropic',
      providerLabel: 'Anthropic',
      modelId: 'claude-writer',
      modelLabel: 'Claude Writer',
      api: 'anthropic-messages',
      thinkingLevel: 'high'
    })
    expect(service.listSessions()[0]?.thinkingLevel).toBe('high')
    await expect(
      database.kysely
        .selectFrom('model_requests')
        .select('thinking_level')
        .where('agent_run_id', '=', started.agentRunId)
        .executeTakeFirstOrThrow()
    ).resolves.toEqual({ thinking_level: 'high' })
    expect(JSON.stringify(runs)).not.toContain('anthropic-secret')
    expect(resolve).toHaveBeenCalledWith({
      presetId: 'builtin:anthropic',
      modelId: 'claude-writer'
    })

    database.immediate((sqlite) =>
      sqlite
        .prepare('UPDATE agent_sessions SET pi_runtime_version = ? WHERE agent_session_id = ?')
        .run('read-only-runtime', session.agentSessionId)
    )
    expect(() => service.setThinkingLevel(session.agentSessionId, 'low')).toThrow('incompatible')
    database.close()
  })

  it('keeps Writing Skills out of session state and prepares the catalog for every run', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const route = vi.fn(async () => ({
      snapshot: {
        schemaVersion: 3 as const,
        mode: 'auto' as const,
        routingStatus: 'available' as const,
        requestedSkills: [],
        skills: [],
        dependencies: [],
        resources: [],
        safeError: null
      },
      prompt: { mode: 'auto' as const, mandatory: '<available_skills />', references: [] },
      modelRequestId: null
    }))
    const service = createService(database, runtime, undefined, {
      skillRouter: { route }
    })
    const session = service.createSession('Dynamic skills')
    expect(session).not.toHaveProperty('skillSelection')

    const first = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'First message.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await vi.waitFor(() => expect(runtime.active().input.agentRunId).toBe(first.agentRunId))
    runtime.active().resolve()
    await first.completion
    const second = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Second message.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await vi.waitFor(() => expect(runtime.active().input.agentRunId).toBe(second.agentRunId))
    runtime.active().resolve()
    await second.completion

    expect(route).toHaveBeenCalledTimes(2)
    database.close()
  })

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

  it('creates the strict migration-0016 tables and indexes', async () => {
    const database = await createDatabase()
    const names = database.immediate(
      (native) =>
        native
          .prepare(
            `SELECT name FROM sqlite_master
              WHERE type IN ('table', 'index') AND name LIKE 'agent_%'
              ORDER BY name`
          )
          .pluck()
          .all() as string[]
    )
    expect(names).toEqual(
      expect.arrayContaining([
        'agent_events',
        'agent_events_run_idx',
        'agent_events_session_sequence_idx',
        'agent_runs',
        'agent_runs_status_idx',
        'agent_sessions'
      ])
    )
    expect(database.immediate((native) => native.pragma('foreign_key_check'))).toEqual([])
    database.close()
  })

  it('persists tool provenance and authorizes exactly one linked post-tool model call', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const execute = vi.fn(async () => ({
      mode: 'fts' as const,
      rerankStatus: 'disabled' as const,
      hits: [
        {
          citationId: 'citation-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          knowledgeItemId: '019c6a5c-8d34-7a8e-a602-3d37a52dc471',
          parseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc472',
          chunkId: 'chunk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          title: 'Source',
          snippet: 'Evidence',
          headingPath: [],
          sourceBlockIds: ['block-source']
        }
      ]
    }))
    const service = createService(database, runtime, undefined, { tools: { execute } as never })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Find evidence.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('response-tool-call')
    })
    await active.emit({
      type: 'assistant_message',
      modelRequestId: active.input.modelRequestId,
      message: { ...assistant('', 'response-tool-call'), stopReason: 'toolUse' }
    })
    const toolResponse = await active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc473',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'tool-search-1',
      modelRequestId: active.input.modelRequestId,
      toolName: 'search_knowledge',
      args: {
        query: 'evidence',
        knowledgeItemIds: [],
        fileExtensions: [],
        parseRevisionIds: [],
        limit: 10,
        rerank: true
      }
    })
    expect(toolResponse).toMatchObject({ ok: true, toolName: 'search_knowledge' })
    const continuationId = '019c6a5c-8d34-7a8e-a602-3d37a52dc474'
    await active.emit({
      type: 'model_call_requested',
      continuationId,
      reason: 'tool_continuation'
    })
    expect(active.authorizations).toHaveLength(1)
    expect(active.authorizations[0]?.continuationId).toBe(continuationId)
    const authorization = active.authorizations[0]
    if (authorization === undefined) throw new Error('Expected continuation authorization')
    const continuationModelRequestId = authorization.modelRequestId
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: continuationModelRequestId,
      outcome: 'succeeded',
      metadata: metadata('response-final')
    })
    await active.emit({
      type: 'assistant_message',
      modelRequestId: continuationModelRequestId,
      message: assistant('Grounded answer', 'response-final')
    })
    active.resolve()
    await started.completion

    expect(execute).toHaveBeenCalledOnce()
    const events = service.listEvents(session.agentSessionId)
    expect(events.map((event) => event.type)).toEqual([
      'user_message',
      'assistant_message',
      'tool_call',
      'tool_result',
      'assistant_message',
      'run_completed'
    ])
    expect(events.find((event) => event.type === 'tool_result')?.payload).toMatchObject({
      citationIds: ['citation-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
      knowledgeItemIds: ['019c6a5c-8d34-7a8e-a602-3d37a52dc471'],
      parseRevisionIds: ['019c6a5c-8d34-7a8e-a602-3d37a52dc472']
    })
    expect(
      await database.kysely
        .selectFrom('model_requests')
        .select(['agent_run_id', 'status'])
        .orderBy('created_at')
        .execute()
    ).toEqual([
      { agent_run_id: started.agentRunId, status: 'succeeded' },
      { agent_run_id: started.agentRunId, status: 'succeeded' }
    ])

    const reopenedRuntime = new FakeAgentRuntime()
    const reopened = createService(database, reopenedRuntime)
    const continued = await reopened.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Continue with that evidence.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(reopenedRuntime.active().input.history).toMatchObject([
      { role: 'user', content: 'Find evidence.' },
      { role: 'assistant', message: { content: 'Grounded answer', stopReason: 'stop' } }
    ])
    reopenedRuntime.active().reject(workerExitError())
    await continued.completion
    database.close()
  })

  it('authorizes exactly one tool-free finalization call after a run reaches 180 events', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const info = vi.fn()
    const service = createService(database, runtime, undefined, {
      log: { ...log, info } as never
    })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Work until the bounded final response.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active(started.agentRunId)
    for (let index = 0; index < 179; index += 1) {
      await active.emit({
        type: 'tool_attempted',
        modelRequestId: active.input.modelRequestId,
        toolCallId: `tool-attempt-${index}`,
        requestedToolName: 'search_knowledge',
        argsHash: 'a'.repeat(64),
        argumentShape: 'object',
        timestamp: index
      })
    }

    await active.emit({
      type: 'model_call_requested',
      continuationId: '019c6a5c-8d34-7a8e-a602-3d37a52dc474',
      reason: 'tool_continuation'
    })

    expect(active.authorizations).toHaveLength(1)
    expect(active.authorizations[0]).toMatchObject({
      finalize: true,
      systemPrompt: expect.stringContaining('final model call')
    })
    expect(JSON.stringify(info.mock.calls)).toContain('agent.run.finalization_started')
    active.reject(workerExitError())
    await started.completion
    database.close()
  })

  it('persists and publishes a clarification before waiting, then resumes the same run once', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const info = vi.fn()
    const questionLog = {
      info,
      warn: vi.fn(),
      error: vi.fn()
    } as unknown as typeof log
    const service = createService(database, runtime, undefined, { log: questionLog })
    const session = service.createSession('Clarification')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Revise the ending.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active(started.agentRunId)
    const toolCallId = 'tool-question-1'
    const responsePromise = active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc480',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId,
      modelRequestId: active.input.modelRequestId,
      toolName: 'ask_user',
      args: {
        questions: [
          {
            id: 'scope',
            header: 'Scope',
            question: 'Which scope should the revision use?',
            options: [
              { label: 'Conclusion (Recommended)', description: 'Revise only the ending.' },
              { label: 'Document', description: 'Revise the full manuscript.' }
            ]
          }
        ]
      }
    })

    await vi.waitFor(() => {
      expect(service.projectActivitySnapshot().runs[0]).toMatchObject({
        agentRunId: started.agentRunId,
        phase: 'awaiting_input',
        pendingQuestion: { toolCallId, submitting: false }
      })
    })
    expect(service.listSessions()[0]).toMatchObject({ workflowState: 'awaiting_input' })
    expect(service.listEvents(session.agentSessionId).map((event) => event.type)).toEqual([
      'user_message',
      'tool_call'
    ])
    const parallelSession = service.createSession('Parallel while waiting')
    const parallelRun = await service.startRun({
      agentSessionId: parallelSession.agentSessionId,
      prompt: 'Continue independent work.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(service.projectActivitySnapshot().activeCount).toBe(2)
    runtime.active(parallelRun.agentRunId).resolve()
    await parallelRun.completion
    expect(service.projectActivitySnapshot().runs[0]).toMatchObject({
      agentRunId: started.agentRunId,
      phase: 'awaiting_input'
    })
    await expect(
      service.answerUserQuestion({
        agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc499',
        agentRunId: started.agentRunId,
        toolCallId,
        answers: [{ questionId: 'scope', kind: 'option', value: 'Document' }]
      })
    ).rejects.toThrow('capability mismatch')
    await expect(
      service.answerUserQuestion({
        agentSessionId: session.agentSessionId,
        agentRunId: started.agentRunId,
        toolCallId,
        answers: [{ questionId: 'scope', kind: 'option', value: 'Unavailable choice' }]
      })
    ).rejects.toThrow('not available')

    const answerPromise = service.answerUserQuestion({
      agentSessionId: session.agentSessionId,
      agentRunId: started.agentRunId,
      toolCallId,
      answers: [{ questionId: 'scope', kind: 'custom', value: 'Only the final two paragraphs' }]
    })
    const response = await responsePromise
    await answerPromise
    expect(response).toMatchObject({
      ok: true,
      toolName: 'ask_user',
      data: {
        answers: [{ questionId: 'scope', kind: 'custom', value: 'Only the final two paragraphs' }]
      }
    })
    expect(service.projectActivitySnapshot().runs[0]).toMatchObject({
      phase: 'running',
      pendingQuestion: null
    })
    expect(service.listEvents(session.agentSessionId).map((event) => event.type)).toEqual([
      'user_message',
      'tool_call',
      'user_message',
      'tool_result'
    ])
    const clarification = service.listEvents(session.agentSessionId)[2]
    expect(clarification).toMatchObject({
      type: 'user_message',
      payload: {
        delivery: 'clarification',
        presentation: { kind: 'clarification_answer', toolCallId }
      }
    })

    await expect(
      service.answerUserQuestion({
        agentSessionId: session.agentSessionId,
        agentRunId: started.agentRunId,
        toolCallId,
        answers: [{ questionId: 'scope', kind: 'option', value: 'Document' }]
      })
    ).rejects.toThrow('no longer pending')
    const continuationId = '019c6a5c-8d34-7a8e-a602-3d37a52dc481'
    await active.emit({ type: 'model_call_requested', continuationId, reason: 'tool_continuation' })
    expect(active.authorizations).toHaveLength(1)
    const logs = JSON.stringify(info.mock.calls)
    expect(logs).toContain('agent.question.wait_started')
    expect(logs).toContain('agent.question.answer_received')
    expect(logs).not.toContain('Which scope should the revision use?')
    expect(logs).not.toContain('Only the final two paragraphs')

    active.resolve()
    await started.completion
    database.close()
  })

  it('cancels an unanswered clarification with the run instead of fabricating an answer', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession('Cancelled clarification')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Choose a direction.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active(started.agentRunId)
    const responsePromise = active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc482',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'tool-question-stop',
      modelRequestId: active.input.modelRequestId,
      toolName: 'ask_user',
      args: {
        questions: [
          {
            id: 'direction',
            header: 'Direction',
            question: 'Which direction should be used?',
            options: [
              { label: 'A (Recommended)', description: 'Use direction A.' },
              { label: 'B', description: 'Use direction B.' }
            ]
          }
        ]
      }
    })
    await vi.waitFor(() =>
      expect(service.projectActivitySnapshot().runs[0]?.phase).toBe('awaiting_input')
    )

    const stopping = service.abort(started.agentRunId)
    await expect(responsePromise).resolves.toMatchObject({
      ok: false,
      error: { code: 'aborted' }
    })
    await stopping
    await started.completion
    expect(service.requireRun(started.agentRunId)).toMatchObject({
      status: 'interrupted',
      errorCode: 'user_stopped'
    })
    expect(service.projectActivitySnapshot().runs).toEqual([])
    const events = service.listEvents(session.agentSessionId)
    expect(events.map((event) => event.type)).toEqual([
      'user_message',
      'tool_call',
      'tool_result',
      'run_interrupted'
    ])
    expect(
      events.some((event) => {
        return event.type === 'user_message' && event.payload.delivery === 'clarification'
      })
    ).toBe(false)
    database.close()
  })

  it('persists a selected Skill snapshot before returning guidance without storing its body', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const commit = 'a'.repeat(40)
    const snapshot = {
      schemaVersion: 3 as const,
      mode: 'auto' as const,
      routingStatus: 'selected' as const,
      requestedSkills: [],
      skills: [
        {
          skillId: 'nature-writing',
          displayName: 'Nature Writing',
          name: 'nature-writing',
          commit,
          manifestSha256: 'b'.repeat(64),
          invocationSource: 'agent' as const
        }
      ],
      dependencies: [],
      resources: [],
      safeError: null
    }
    const state = {
      mode: 'auto' as const,
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
    const service = createService(database, runtime, undefined, {
      skillRouter: {
        route: async () => ({
          snapshot: { ...snapshot, routingStatus: 'available' as const, skills: [] },
          prompt: { mode: 'auto', mandatory: '<available_skills />', references: [] },
          modelRequestId: null,
          state
        }),
        read: async () => ({
          snapshot,
          prompt: { mode: 'auto', mandatory: '<skill>Loaded.</skill>', references: [] },
          data: {
            skillId: 'nature-writing',
            displayName: 'Nature Writing',
            commit,
            relativePath: 'SKILL.md',
            sha256: 'c'.repeat(64),
            byteSize: 18,
            content: 'PRIVATE SKILL BODY',
            references: [],
            dependencies: []
          }
        })
      }
    })
    const session = service.createSession('Progressive skill')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Use a method.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await vi.waitFor(() => expect(runtime.active().input.agentRunId).toBe(started.agentRunId))
    const active = runtime.active()
    const response = await active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc479',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'tool-skill-1',
      modelRequestId: active.input.modelRequestId,
      toolName: 'read_writing_skill',
      args: { uri: `writellm://skills/nature-writing/${commit}/SKILL.md` }
    })

    expect(JSON.stringify(response)).toContain('PRIVATE SKILL BODY')
    expect(service.requireRun(started.agentRunId).skillSnapshot.routingStatus).toBe('selected')
    expect(JSON.stringify(service.listEvents(session.agentSessionId))).not.toContain(
      'PRIVATE SKILL BODY'
    )
    expect(JSON.stringify(service.listEvents(session.agentSessionId))).not.toContain(
      'writellm://skills/'
    )
    active.resolve()
    await started.completion
    database.close()
  })

  it('rejects a tool request carrying a mismatched project-session capability', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const execute = vi.fn()
    const service = createService(database, runtime, undefined, { tools: { execute } as never })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Find evidence.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()

    await expect(
      active.requestTool({
        type: 'tool_request',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc475',
        projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc499',
        agentSessionId: active.input.agentSessionId,
        agentRunId: active.input.agentRunId,
        toolCallId: 'tool-search-forged-capability',
        modelRequestId: active.input.modelRequestId,
        toolName: 'search_knowledge',
        args: {
          query: 'evidence',
          knowledgeItemIds: [],
          fileExtensions: [],
          parseRevisionIds: [],
          limit: 10,
          rerank: true
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'unauthorized',
        message: 'Agent tool request is unauthorized. Next: Do not retry this operation.'
      }
    })
    expect(execute).not.toHaveBeenCalled()
    expect(service.listEvents(session.agentSessionId).map((event) => event.type)).toEqual([
      'user_message'
    ])

    active.resolve()
    await started.completion
    database.close()
  })

  it('returns tool-aware recovery for conflicts, stale cursors, and citation provenance', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const execute = vi.fn(async (input: { toolName: AgentToolRequest['toolName'] }) => {
      if (input.toolName === 'submit_section_change') {
        throw new AgentToolDomainError('conflict', 'Target block hash is stale')
      }
      if (input.toolName === 'read_outline') {
        throw new AgentToolDomainError('stale_cursor', 'Outline cursor is stale')
      }
      throw new AgentToolDomainError(
        'invalid_arguments',
        'Citation provenance is missing for the requested source label'
      )
    })
    const service = createService(database, runtime, undefined, { tools: { execute } as never })
    const fixtures = [
      {
        toolName: 'submit_section_change' as const,
        args: {
          sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc476',
          operations: [{ type: 'insertTextBlocks', placement: 'end', blocks: [{ text: 'Body.' }] }]
        },
        expected: { action: 'refresh_context', tool: 'read_section', maxAttempts: 1 }
      },
      {
        toolName: 'read_outline' as const,
        args: { cursor: 'stale' },
        expected: { action: 'restart_pagination', tool: 'read_outline', maxAttempts: 1 }
      },
      {
        toolName: 'read_citations' as const,
        args: { citationIds: [`citation-${'a'.repeat(40)}`] },
        expected: { action: 'refresh_context', tool: 'search_knowledge', maxAttempts: 1 }
      }
    ]

    for (const [index, fixture] of fixtures.entries()) {
      const session = service.createSession(`Recovery ${index}`)
      const started = await service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Recover safely.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
      const active = runtime.active()
      const response = await active.requestTool({
        type: 'tool_request',
        requestId: `019c6a5c-8d34-7a8e-a602-3d37a52dc48${index}`,
        projectSessionId: active.input.projectSessionId,
        agentSessionId: active.input.agentSessionId,
        agentRunId: active.input.agentRunId,
        toolCallId: `tool-recovery-${index}`,
        modelRequestId: active.input.modelRequestId,
        toolName: fixture.toolName,
        args: fixture.args
      } as AgentToolRequest)
      expect(response).toMatchObject({
        ok: false,
        error: {
          recovery: fixture.expected,
          message: expect.stringContaining('Next:')
        }
      })
      active.resolve()
      await started.completion
    }
    database.close()
  })

  it('reports a non-retryable image provider rejection instead of a read-tool failure', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const providerError = Object.assign(new Error('Safe worker error'), {
      status: 400,
      providerCode: 'INVALID_ARGUMENT'
    })
    const execute = vi.fn(async () => {
      throw new Error('Auxiliary model request failed', { cause: providerError })
    })
    const service = createService(database, runtime, undefined, { tools: { execute } as never })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Generate a diagram.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    const response = await active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc475',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'tool-image-1',
      modelRequestId: active.input.modelRequestId,
      toolName: 'generate_image',
      args: {
        mode: 'insert',
        sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc476',
        anchor: null,
        placement: 'end',
        prompt: 'A bounded diagram',
        altText: 'Diagram',
        caption: '',
        aspectRatio: '16:9',
        imageSize: '2K'
      }
    })

    expect(response).toMatchObject({
      ok: false,
      error: {
        code: 'unavailable',
        category: 'transient',
        message:
          'Image provider rejected the generation request (HTTP 400 / INVALID_ARGUMENT); verify the image API key, model access, and provider settings. Next: Ask the user to verify provider access.',
        recovery: { action: 'ask_user' }
      }
    })
    expect(JSON.stringify(response)).not.toContain('read tool')
    expect(service.listEvents(session.agentSessionId).at(-1)?.payload).toMatchObject({
      isError: true,
      error: {
        code: 'unavailable',
        message: expect.stringContaining('HTTP 400 / INVALID_ARGUMENT')
      }
    })
    active.resolve()
    await started.completion
    database.close()
  })

  it('persists manual review as a completed wait state and locks only that conversation', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const proposalId = '019c6a5c-8d34-7a8e-a602-3d37a52dc491'
    const execute = vi.fn(async (input: { toolCallEventId: string }) => {
      const now = new Date().toISOString()
      database.immediate((native) => {
        native
          .prepare(
            `INSERT INTO mutation_proposals (
               mutation_proposal_id, agent_session_id, agent_run_id, tool_call_event_id,
               agent_tool_call_id, kind, payload_json, base_revision_id,
               base_brief_version, base_outline_version, status, decision_at,
               applied_revision_id, applied_brief_version, applied_outline_version,
               undo_revision_id, replaces_proposal_id, rejected_reason, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 'brief_update', ?, NULL, 1, NULL, 'pending', NULL,
                       NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`
          )
          .run(
            proposalId,
            session.agentSessionId,
            started.agentRunId,
            input.toolCallEventId,
            'proposal-tool-call',
            JSON.stringify({ schemaVersion: 1, kind: 'brief_update' }),
            now,
            now
          )
      })
      return proposalToolResult('brief_update')
    })
    const service = createService(database, runtime, undefined, {
      tools: { execute, shouldAutoApprove: () => false } as never
    })
    const session = service.createSession('Manual review', 'manual')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Propose a brief change.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('proposal-call')
    })
    await active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc490',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'proposal-tool-call',
      modelRequestId: active.input.modelRequestId,
      toolName: 'submit_brief_change',
      args: { changes: { title: 'Revised title' }, citationIds: [] }
    })

    await expect(service.followUp(started.agentRunId, 'Keep going.')).rejects.toThrow(
      'waiting for review'
    )
    active.resolve('awaiting_review')
    await started.completion

    expect(service.requireRun(started.agentRunId)).toMatchObject({
      status: 'completed',
      errorCode: null
    })
    expect(service.listEvents(session.agentSessionId).at(-1)).toMatchObject({
      type: 'run_completed',
      payload: {
        status: 'completed',
        outcome: 'awaiting_review',
        proposalId,
        proposalKind: 'brief_update'
      }
    })
    expect(service.listSessions()).toContainEqual(
      expect.objectContaining({
        agentSessionId: session.agentSessionId,
        workflowState: 'awaiting_review'
      })
    )
    await expect(
      service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Bypass review.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
    ).rejects.toThrow('waiting for review')
    expect(() => service.archiveSession(session.agentSessionId)).toThrow(
      'pending proposal before archive'
    )

    database.immediate((native) => {
      native
        .prepare(
          `UPDATE mutation_proposals
              SET status = 'generating', decision_at = ?, updated_at = ?
            WHERE mutation_proposal_id = ?`
        )
        .run(new Date().toISOString(), new Date().toISOString(), proposalId)
    })
    expect(service.listSessions()).toContainEqual(
      expect.objectContaining({
        agentSessionId: session.agentSessionId,
        workflowState: 'generating'
      })
    )
    await expect(
      service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Bypass generation.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
    ).rejects.toThrow('waiting for image generation')
    expect(() => service.archiveSession(session.agentSessionId)).toThrow(
      'generation must finish before archive'
    )

    database.immediate((native) => {
      native
        .prepare(
          `UPDATE mutation_proposals
              SET status = 'rejected', rejected_reason = 'test rejection', updated_at = ?
            WHERE mutation_proposal_id = ?`
        )
        .run(new Date().toISOString(), proposalId)
    })
    expect(service.listSessions()).toContainEqual(
      expect.objectContaining({
        agentSessionId: session.agentSessionId,
        workflowState: 'idle'
      })
    )
    database.close()
  })

  it.each([
    ['manual', 'brief_update', true, false],
    ['section_auto', 'outline_patch', false, true],
    ['manual', 'section_patch', true, false],
    ['section_auto', 'section_patch', false, true],
    ['section_auto', 'brief_update', true, false],
    ['yolo', 'brief_update', false, true]
  ] as const)(
    'enforces approval mode %s for %s proposals',
    async (mode, kind, blocks, autoApproves) => {
      const database = await createDatabase()
      const runtime = new FakeAgentRuntime()
      const approveProposalAutomatically = vi.fn(async () => proposalOutcome(kind, 'applied'))
      const execute = vi.fn(async () => proposalToolResult(kind))
      const shouldAutoApprove = vi.fn(() => autoApproves)
      const service = createService(database, runtime, undefined, {
        tools: { execute, shouldAutoApprove, approveProposalAutomatically } as never
      })
      const session = service.createSession('Approval matrix', mode)
      const started = await service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Propose a change.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
      const active = runtime.active()
      await active.emit({
        type: 'model_call_finished',
        modelRequestId: active.input.modelRequestId,
        outcome: 'succeeded',
        metadata: metadata('proposal-call')
      })
      const responsePromise = active.requestTool({
        type: 'tool_request',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc490',
        projectSessionId: active.input.projectSessionId,
        agentSessionId: active.input.agentSessionId,
        agentRunId: active.input.agentRunId,
        toolCallId: 'proposal-tool-call',
        modelRequestId: active.input.modelRequestId,
        toolName:
          kind === 'brief_update'
            ? 'submit_brief_change'
            : kind === 'outline_patch'
              ? 'submit_outline_change'
              : 'submit_section_change',
        args: {}
      } as never)
      await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
      expect(shouldAutoApprove).toHaveBeenCalledOnce()
      expect(approveProposalAutomatically).toHaveBeenCalledTimes(autoApproves ? 1 : 0)
      await expect(responsePromise).resolves.toMatchObject({
        ok: true,
        data: { continuation: blocks ? 'pause_for_review' : 'continue' }
      })
      expect(service.listEvents(session.agentSessionId).map((event) => event.type)).toEqual([
        'user_message',
        'tool_call',
        'tool_result'
      ])
      active.resolve(blocks ? 'awaiting_review' : 'finished')
      await started.completion
      expect(service.requireRun(started.agentRunId)).toMatchObject({
        status: 'completed',
        errorCode: null
      })
      expect(service.listEvents(session.agentSessionId).at(-1)).toMatchObject({
        type: 'run_completed',
        payload: {
          outcome: blocks ? 'awaiting_review' : 'finished'
        }
      })
      database.close()
    }
  )

  it('applies approval mode changes made during an active run to proposal decisions', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const approveProposalAutomatically = vi.fn(async () =>
      proposalOutcome('section_patch', 'applied')
    )
    const execute = vi.fn(async () => proposalToolResult('section_patch'))
    const shouldAutoApprove = vi.fn(() => true)
    const service = createService(database, runtime, undefined, {
      tools: { execute, shouldAutoApprove, approveProposalAutomatically } as never
    })
    const session = service.createSession('Mid-run mode change', 'manual')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Propose a change.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('proposal-call')
    })
    service.setApprovalMode(session.agentSessionId, 'yolo')
    const responsePromise = active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc492',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'proposal-tool-call',
      modelRequestId: active.input.modelRequestId,
      toolName: 'submit_section_change',
      args: {}
    } as never)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    expect(shouldAutoApprove).toHaveBeenCalledWith(
      session.agentSessionId,
      '019c6a5c-8d34-7a8e-a602-3d37a52dc491',
      'yolo'
    )
    expect(approveProposalAutomatically).toHaveBeenCalledOnce()
    await expect(responsePromise).resolves.toMatchObject({
      ok: true,
      data: { continuation: 'continue' }
    })
    active.resolve('finished')
    await started.completion
    database.close()
  })

  it('allows approval mode changes while a proposal awaits review', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const execute = vi.fn(async () => proposalToolResult('section_patch'))
    const service = createService(database, runtime, undefined, {
      tools: { execute, shouldAutoApprove: () => false } as never
    })
    const session = service.createSession('Review-time mode change', 'manual')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Propose a change.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('proposal-call')
    })
    const responsePromise = active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc493',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'proposal-tool-call',
      modelRequestId: active.input.modelRequestId,
      toolName: 'submit_section_change',
      args: {}
    } as never)
    await expect(responsePromise).resolves.toMatchObject({
      ok: true,
      data: { continuation: 'pause_for_review' }
    })
    const updated = service.setApprovalMode(session.agentSessionId, 'yolo')
    expect(updated.approvalMode).toBe('yolo')
    active.resolve('awaiting_review')
    await started.completion
    database.close()
  })

  it('creates one recorded raw-event compaction summary only under token pressure', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    let service!: AgentSessionService
    const summarizeHistory = vi.fn(
      async (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) => {
        expect(service.projectActivitySnapshot()).toMatchObject({
          activeCount: 1,
          compactions: [],
          runs: [expect.objectContaining({ phase: 'compacting' })]
        })
        expect(
          service.listSessions().find((session) => session.agentSessionId === input.agentSessionId)
        ).toMatchObject({ workflowState: 'compacting' })
        const repository = new ModelRequestRepository(database, log)
        const request = await repository.start({
          operation: 'agent',
          provider: config,
          request: { purpose: 'compaction', coveredThroughSequence: input.coveredThroughSequence },
          inputItems: 1,
          operationId: input.compactionId,
          ...(input.agentRunId === null ? {} : { agentRunId: input.agentRunId }),
          projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
        })
        await repository.succeed(request.modelRequestId, {
          metadata: metadata('compaction-response'),
          outputItems: 1
        })
        return {
          summary: 'The user requested a long Chinese draft.',
          modelRequestId: request.modelRequestId
        }
      }
    )
    service = createService(database, runtime, undefined, {
      messageTokenBudget: 4_096,
      summarizeHistory
    })
    const session = service.createSession()
    const first = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '界'.repeat(2_500),
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const firstActive = runtime.active()
    await firstActive.emit({
      type: 'model_call_finished',
      modelRequestId: firstActive.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('long-response')
    })
    await firstActive.emit({
      type: 'assistant_message',
      modelRequestId: firstActive.input.modelRequestId,
      message: assistant('文'.repeat(2_500), 'long-response')
    })
    firstActive.resolve()
    await first.completion

    const second = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Continue.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(summarizeHistory).toHaveBeenCalledOnce()
    expect(summarizeHistory.mock.calls[0]?.[0].sourcePayloadJson).toContain(
      '"authority":"events-and-current-business-rows"'
    )
    expect(summarizeHistory.mock.calls[0]?.[0].sourcePayloadJson).toContain('"type":"user_message"')
    expect(runtime.active().input.history).toEqual([
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('The user requested a long Chinese draft.')
      })
    ])
    const summaries = service
      .listEvents(session.agentSessionId)
      .filter((event) => event.type === 'compaction_summary')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      agentRunId: second.agentRunId,
      modelRequestId: expect.any(String),
      payload: {
        coveredFromSequence: 1,
        coveredThroughSequence: 3,
        schemaVersion: 3,
        handoffMode: 'bounded_conversation_memory'
      }
    })
    runtime.active().reject(workerExitError())
    await second.completion

    const third = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '界'.repeat(2_500),
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(summarizeHistory).toHaveBeenCalledOnce()
    expect(
      service
        .listEvents(session.agentSessionId)
        .filter((event) => event.type === 'compaction_summary')
    ).toHaveLength(1)
    runtime.active().reject(workerExitError())
    await third.completion
    database.close()
  })

  it('stops before provider work when automatic failure would omit a user turn', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime, undefined, {
      messageTokenBudget: 4_096,
      summarizeHistory: vi.fn(async () => {
        throw new Error('summary provider unavailable')
      })
    })
    const session = service.createSession('Automatic fallback')
    const first = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '界'.repeat(2_500),
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const firstActive = runtime.active(first.agentRunId)
    await firstActive.emit({
      type: 'model_call_finished',
      modelRequestId: firstActive.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('fallback-source')
    })
    await firstActive.emit({
      type: 'assistant_message',
      modelRequestId: firstActive.input.modelRequestId,
      message: assistant('文'.repeat(2_500), 'fallback-source')
    })
    firstActive.resolve()
    await first.completion

    const second = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Continue despite summary failure.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await second.completion
    expect(() => runtime.active(second.agentRunId)).toThrow('No fake Agent run is active')
    expect(service.requireRun(second.agentRunId)).toMatchObject({
      status: 'failed',
      errorCode: 'compaction_required'
    })
    expect(service.listEvents(session.agentSessionId)).toContainEqual(
      expect.objectContaining({
        agentRunId: second.agentRunId,
        type: 'compaction_failed',
        payload: expect.objectContaining({
          trigger: 'auto_threshold',
          code: 'compaction_failed',
          retryable: true,
          aborted: false
        })
      })
    )
    database.close()
  })

  it('rejects a run above the 2,000-event compaction ceiling without calling the provider', async () => {
    const database = await createDatabase()
    const summarizeHistory = vi.fn()
    const service = createService(database, new FakeAgentRuntime(), undefined, { summarizeHistory })
    const session = service.createSession('Oversized source run')
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, sequence, type, payload_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      native.transaction(() => {
        for (let sequence = 1; sequence <= 2_000; sequence += 1) {
          insert.run(
            crypto.randomUUID(),
            session.agentSessionId,
            sequence,
            'tool_attempted',
            JSON.stringify({ requestedToolName: 'search_knowledge' }),
            '2026-08-12T00:00:00.000Z'
          )
        }
        insert.run(
          crypto.randomUUID(),
          session.agentSessionId,
          2_001,
          'run_interrupted',
          JSON.stringify({ code: 'run_failed' }),
          '2026-08-12T00:00:00.000Z'
        )
      })()
    })
    const originalCount = database.immediate((native) =>
      Number(
        native
          .prepare('SELECT COUNT(*) FROM agent_events WHERE agent_session_id = ?')
          .pluck()
          .get(session.agentSessionId)
      )
    )

    await service.compactSession(session.agentSessionId)
    await vi.waitFor(() => expect(service.projectActivitySnapshot().compactions).toEqual([]))

    expect(summarizeHistory).not.toHaveBeenCalled()
    const terminal = database.immediate(
      (native) =>
        native
          .prepare(
            `SELECT type, payload_json
             FROM agent_events
            WHERE agent_session_id = ?
            ORDER BY sequence DESC
            LIMIT 1`
          )
          .get(session.agentSessionId) as { type: string; payload_json: string }
    )
    expect(terminal.type).toBe('compaction_failed')
    expect(JSON.parse(terminal.payload_json)).toMatchObject({
      code: 'compaction_run_too_large',
      retryable: false,
      aborted: false
    })
    expect(
      database.immediate((native) =>
        Number(
          native
            .prepare('SELECT COUNT(*) FROM agent_events WHERE agent_session_id = ?')
            .pluck()
            .get(session.agentSessionId)
        )
      )
    ).toBe(originalCount + 2)
    database.close()
  })

  it('rejects an escaped compaction prompt above the Agent character contract before provider work', async () => {
    const database = await createDatabase()
    const summarizeHistory = vi.fn()
    const service = createService(database, new FakeAgentRuntime(), undefined, { summarizeHistory })
    const session = service.createSession('Oversized escaped prompt')
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
        JSON.stringify({
          content: `<${'x'.repeat(262_140)}>`,
          delivery: 'prompt',
          timestamp: 1
        }),
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
        JSON.stringify({ content: 'Recent raw turn', delivery: 'prompt', timestamp: 3 }),
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

    expect(summarizeHistory).not.toHaveBeenCalled()
    expect(service.listEvents(session.agentSessionId).at(-1)).toMatchObject({
      type: 'compaction_failed',
      payload: {
        code: 'compaction_run_too_large',
        retryable: false,
        aborted: false
      }
    })
    database.close()
  })

  it('persists every successful rolling step with continuous, non-overlapping coverage', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn(
      async (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) => {
        const repository = new ModelRequestRepository(database, log)
        const request = await repository.start({
          operation: 'agent',
          provider: config,
          request: { purpose: 'manual_compaction', through: input.coveredThroughSequence },
          inputItems: 1,
          operationId: input.compactionId,
          projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
        })
        await repository.succeed(request.modelRequestId, {
          metadata: metadata(`manual-step-${input.coveredThroughSequence}`),
          outputItems: 1
        })
        return {
          summary: `Objective\nRolling checkpoint through ${input.coveredThroughSequence}.`,
          modelRequestId: request.modelRequestId
        }
      }
    )
    const service = createService(database, runtime, undefined, { summarizeHistory })
    const session = service.createSession('Long rolling history')
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
    const summaries = service
      .listEvents(session.agentSessionId)
      .filter((event) => event.type === 'compaction_summary')
    expect(summaries.length).toBeGreaterThanOrEqual(2)
    expect(summaries.length).toBeLessThanOrEqual(4)
    const payloads = summaries.map(
      (event) =>
        event.payload as {
          compactionId: string
          coveredFromSequence: number
          coveredThroughSequence: number
          finalStep: boolean
          schemaVersion: number
          handoffMode: string
          postCompactionBudgetTokens: number
          checkpointBudgetTokens: number
          recentTailBudgetTokens: number
        }
    )
    const firstPayload = payloads[0]
    const finalPayload = payloads.at(-1)
    expect(firstPayload).toMatchObject({
      compactionId,
      coveredFromSequence: 1,
      finalStep: false,
      schemaVersion: 3,
      handoffMode: 'bounded_conversation_memory',
      postCompactionBudgetTokens: 32_000,
      checkpointBudgetTokens: 12_000,
      recentTailBudgetTokens: 20_000
    })
    expect(firstPayload?.coveredThroughSequence).toBeGreaterThan(240)
    expect(finalPayload).toMatchObject({
      compactionId,
      coveredThroughSequence: 598,
      finalStep: true,
      schemaVersion: 3,
      handoffMode: 'bounded_conversation_memory',
      postCompactionBudgetTokens: 32_000,
      checkpointBudgetTokens: 12_000,
      recentTailBudgetTokens: 20_000
    })
    for (let index = 1; index < payloads.length; index += 1) {
      expect(payloads[index]?.coveredFromSequence).toBe(
        (payloads[index - 1]?.coveredThroughSequence ?? 0) + 1
      )
    }
    expect(summarizeHistory).toHaveBeenCalledTimes(summaries.length)
    expect(summarizeHistory.mock.calls.every(([input]) => input.maxOutputTokens === 12_000)).toBe(
      true
    )
    expect(summarizeHistory.mock.calls[1]?.[0].sourcePayloadJson).toContain(
      `Rolling checkpoint through ${firstPayload?.coveredThroughSequence}`
    )
    const runtimeHistory = loadContinuousRuntimeHistory(database, session.agentSessionId)
    expect(runtimeHistory[0]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('authority="conversation_memory"')
    })
    expect(runtimeHistory.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining('turn-599-')
    })
    database.close()
  })

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
  })

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
  })

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

type TitleResult = {
  text: string
  stopReason: 'stop'
  metadata: ReturnType<typeof metadata>
}

type TitleGenerationInput = Parameters<NonNullable<AgentSessionServiceOptions['generateTitle']>>[0]

function titleResult(text: string, responseId: string): TitleResult {
  return { text, stopReason: 'stop', metadata: metadata(responseId) }
}

interface FakeActiveRun {
  config: ProviderConfig
  credential: string
  input: AgentSessionRunInput
  commands: Array<{
    operation: 'steer' | 'follow_up'
    modelRequestId: string
    pendingMessageId?: string
  }>
  authorizations: Array<{
    continuationId: string
    modelRequestId: string
    systemPrompt: string
    finalize?: boolean
  }>
  requestTool: (request: AgentToolRequest) => Promise<AgentToolResponse>
  emit: (event: AgentRuntimeEvent) => Promise<void>
  resolve: (outcome?: 'finished' | 'awaiting_review') => void
  reject: (error: Error) => void
}

class FakeAgentRuntime implements AgentSessionRuntime {
  readonly #active = new Map<string, FakeActiveRun>()
  #latestRunId: string | undefined

  beginSessionRun(
    _config: ProviderConfig,
    credential: string,
    input: AgentSessionRunInput,
    signal: AbortSignal,
    onEvent: (event: AgentRuntimeEvent) => void | Promise<void>,
    onToolRequest?: (request: AgentToolRequest, signal: AbortSignal) => Promise<AgentToolResponse>
  ): AgentSessionRunHandle {
    if (_config.role === 'agent' && _config.presetId === undefined) {
      expect(credential).toBe('agent-secret')
    }
    let resolve: (outcome?: 'finished' | 'awaiting_review') => void = () => undefined
    let reject: (error: Error) => void = () => undefined
    const completion = new Promise<{ outcome: 'finished' | 'awaiting_review' }>(
      (resolvePromise, rejectPromise) => {
        resolve = (outcome = 'finished') => resolvePromise({ outcome })
        reject = rejectPromise
      }
    )
    signal.addEventListener(
      'abort',
      () => {
        const error = new Error('Agent run aborted')
        error.name = 'AbortError'
        reject(error)
      },
      { once: true }
    )
    const commands: FakeActiveRun['commands'] = []
    const authorizations: FakeActiveRun['authorizations'] = []
    const active = {
      config: _config,
      credential,
      input,
      commands,
      authorizations,
      requestTool: (request) => {
        if (onToolRequest === undefined) throw new Error('No fake Agent tool handler')
        return onToolRequest(request, signal)
      },
      emit: async (event) => onEvent(event),
      resolve,
      reject
    }
    this.#active.set(input.agentRunId, active)
    this.#latestRunId = input.agentRunId
    return {
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc431',
      completion,
      steer: (command) =>
        commands.push({ operation: 'steer', modelRequestId: command.modelRequestId }),
      followUp: (command) =>
        commands.push({
          operation: 'follow_up',
          modelRequestId: command.modelRequestId,
          pendingMessageId: command.pendingMessageId
        }),
      queueAction: () => Promise.resolve('completed'),
      authorizeFollowUpConsumption: () => undefined,
      authorizeModelCall: (command) =>
        authorizations.push({
          continuationId: command.continuationId,
          modelRequestId: command.modelRequestId,
          systemPrompt: command.systemPrompt,
          ...(command.finalize === undefined ? {} : { finalize: command.finalize })
        })
    }
  }

  active(agentRunId = this.#latestRunId): FakeActiveRun {
    const active = agentRunId === undefined ? undefined : this.#active.get(agentRunId)
    if (active === undefined) throw new Error('No fake Agent run is active')
    return active
  }
}

function createService(
  database: ProjectDatabase,
  runtime: AgentSessionRuntime,
  publishEvent?: AgentSessionServiceOptions['publishEvent'],
  overrides: Partial<
    Pick<
      AgentSessionServiceOptions,
      | 'agentCatalog'
      | 'contextBuilder'
      | 'log'
      | 'tools'
      | 'summarizeHistory'
      | 'messageTokenBudget'
      | 'publishDelta'
      | 'publishSession'
      | 'publishActivity'
      | 'generateTitle'
      | 'resolveModelLimits'
      | 'skillRouter'
    >
  > = {}
): AgentSessionService {
  return new AgentSessionService({
    projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
    projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422',
    database,
    runtime,
    providers: {
      withConfiguredProvider: async (_role, operation) => operation(config, 'agent-secret')
    } as never,
    log,
    ...(typeof publishEvent === 'function' ? { publishEvent } : {}),
    ...overrides
  })
}

async function createDatabase(): Promise<ProjectDatabase> {
  const parent = await mkdtemp(join(tmpdir(), 'writellm-agent-session-'))
  temporaryDirectories.push(parent)
  const root = join(parent, 'Agent.writellm')
  await mkdir(root)
  return initializeProjectDatabase({
    projectRoot: root,
    manifest: {
      format: 'writellm-project',
      formatVersion: 1,
      projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
      createdAt: '2026-07-21T00:00:00.000Z'
    },
    applicationVersion: '1.0.0-test',
    log
  })
}

function faultNextImmediate(database: ProjectDatabase): {
  database: ProjectDatabase
  failNext(error: Error): void
} {
  let nextFailure: Error | null = null
  const faulting = Object.create(database) as ProjectDatabase
  faulting.immediate = <T>(operation: Parameters<ProjectDatabase['immediate']>[0]): T => {
    const failure = nextFailure
    nextFailure = null
    if (failure !== null) throw failure
    return database.immediate(operation) as T
  }
  return {
    database: faulting,
    failNext(error) {
      nextFailure = error
    }
  }
}

function metadata(
  responseId: string
): Extract<AgentRuntimeEvent, { type: 'model_call_finished' }>['metadata'] {
  return {
    usage: {
      inputTokens: 10,
      outputTokens: 4,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      estimatedCostUsdMicros: null
    },
    responseIds: [responseId],
    retryCount: 0,
    providerModelId: 'writer-resolved'
  }
}

function assistant(content: string, responseId: string) {
  return {
    content,
    stopReason: 'stop' as const,
    provider: 'openai-compatible',
    model: 'writer',
    responseId,
    metadata: metadata(responseId),
    timestamp: Date.now(),
    interrupted: false
  }
}

function contextOverflowError(): Error & { code: string; status: number } {
  return Object.assign(new Error('Maximum context length exceeded'), {
    code: 'context_length_exceeded',
    status: 400
  })
}

function proposalToolResult(kind: 'brief_update' | 'outline_patch' | 'section_patch') {
  return {
    proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc491',
    kind,
    status: 'pending' as const,
    preview: {
      summary: 'Proposed change',
      affectedSectionIds: [],
      beforeText: 'before',
      afterText: 'after',
      beforeTextTruncated: false,
      afterTextTruncated: false,
      citedSources: []
    }
  }
}

function proposalOutcome(
  kind: 'brief_update' | 'outline_patch' | 'section_patch',
  outcome: 'applied' | 'rejected'
) {
  return {
    outcome,
    proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc491',
    effectiveProposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc491',
    kind,
    message: null
  }
}

function workerExitError(): Error {
  return new Error('writellm-agent-worker exited before responding (1)')
}
