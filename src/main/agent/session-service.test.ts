import { describe, expect, it, vi } from 'vitest'
import type { AgentEventRecord } from '../../shared/contracts/agent-ipc'
import type { AgentSessionServiceOptions } from './session-service'
import { SkillPromptBudgetError } from './context'
import {
  type log,
  FakeAgentRuntime,
  createService,
  createDatabase,
  faultNextImmediate,
  metadata,
  assistant
} from './session-service.test-support'

describe('AgentSessionService: runtime', () => {
  it('uses refreshed selected-model limits on the next run while retaining the active snapshot', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    let model = {
      id: 'manual-writer',
      name: 'Manual Writer',
      api: 'google-vertex' as const,
      provider: 'google-vertex',
      baseUrl: 'https://aiplatform.googleapis.com',
      reasoning: true,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 1_048_576,
      maxTokens: 65_536
    }
    const resolve = vi.fn(async () => ({
      presetId: 'builtin:google-vertex',
      presetName: 'Vertex',
      providerId: 'google-vertex',
      timeoutMs: 60_000,
      model,
      auth: { auth: { apiKey: 'fixture-secret' }, source: 'Stored API key' }
    }))
    const resolveModelLimits = vi.fn(async () => {
      throw new Error('Catalog selections must not use the legacy limits cache')
    })
    const service = createService(database, runtime, undefined, {
      agentCatalog: { resolve } as never,
      resolveModelLimits
    })
    const session = service.createSession('Current model', undefined, {
      presetId: 'builtin:google-vertex',
      modelId: model.id
    })
    const input = {
      agentSessionId: session.agentSessionId,
      prompt: 'Write a paragraph.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    }
    const first = await service.startRun(input)
    expect(runtime.active().input).toMatchObject({
      maxOutputTokens: 65_536,
      modelLimits: { contextWindowTokens: 1_048_576, outputLimitTokens: 65_536 },
      runtimeModel: { reasoning: true, contextWindow: 1_048_576, maxTokens: 65_536 }
    })
    model = { ...model, name: 'Updated Writer', contextWindow: 200_000, maxTokens: 32_768 }
    expect(runtime.active(first.agentRunId).input.maxOutputTokens).toBe(65_536)
    runtime.active(first.agentRunId).resolve()
    await first.completion
    const second = await service.startRun(input)
    expect(runtime.active().input).toMatchObject({
      maxOutputTokens: 32_768,
      modelLimits: { contextWindowTokens: 200_000, outputLimitTokens: 32_768 },
      runtimeModel: { name: 'Updated Writer', contextWindow: 200_000, maxTokens: 32_768 }
    })
    expect(service.requireRun(first.agentRunId).modelLimits).toMatchObject({
      contextWindowTokens: 1_048_576,
      outputLimitTokens: 65_536
    })
    expect(service.requireRun(second.agentRunId).modelLimits).toMatchObject({
      contextWindowTokens: 200_000,
      outputLimitTokens: 32_768
    })
    runtime.active().resolve()
    await second.completion
    const smaller = await service.startRun({ ...input, maxOutputTokens: 4_096 })
    expect(runtime.active().input.maxOutputTokens).toBe(4_096)
    runtime.active().resolve()
    await smaller.completion
    expect(resolveModelLimits).not.toHaveBeenCalled()
    expect(resolve).toHaveBeenCalledTimes(3)
    database.close()
  })

  it('persists output truncation as a failed run and omits its partial answer from the next context', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession('Output truncation')
    const input = {
      agentSessionId: session.agentSessionId,
      prompt: 'Write the chapter.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    }
    const first = await service.startRun(input)
    const active = runtime.active()
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'failed',
      failureCode: 'output_limit_reached',
      retryable: false,
      metadata: metadata('partial')
    })
    await active.emit({
      type: 'assistant_message',
      modelRequestId: active.input.modelRequestId,
      message: {
        ...assistant('Starting the draft.', 'partial'),
        stopReason: 'length',
        interrupted: true
      }
    })
    active.reject(
      Object.assign(new Error('Response cut off by output limit'), { code: 'output_limit_reached' })
    )
    await first.completion
    expect(service.requireRun(first.agentRunId)).toMatchObject({
      status: 'failed',
      errorCode: 'output_limit_reached'
    })
    const events = service.listEvents(session.agentSessionId)
    expect(events.some((event) => event.type === 'run_completed')).toBe(false)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'assistant_message',
        payload: expect.objectContaining({ content: 'Starting the draft.', interrupted: true })
      })
    )
    const next = await service.startRun({ ...input, prompt: 'Continue with a smaller section.' })
    expect(JSON.stringify(runtime.active().input.history)).not.toContain('Starting the draft.')
    runtime.active().resolve()
    await next.completion
    database.close()
  })

  it('persists a sticky mode and snapshots it immutably into each run', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession('Modes')
    expect(session.interactionMode).toBe('write')

    const planned = service.setInteractionMode(session.agentSessionId, 'plan')
    expect(planned.interactionMode).toBe('plan')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Plan the revision.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(runtime.active(started.agentRunId).input.interactionMode).toBe('plan')
    expect(service.requireRun(started.agentRunId).interactionMode).toBe('plan')
    expect(() => service.setInteractionMode(session.agentSessionId, 'ask')).toThrow('active')

    runtime.active(started.agentRunId).resolve()
    await started.completion
    expect(service.setInteractionMode(session.agentSessionId, 'ask').interactionMode).toBe('ask')
    expect(service.requireRun(started.agentRunId).interactionMode).toBe('plan')
    database.close()
  })

  it('runs four conversations concurrently and keeps queue, stop and session authority isolated', async () => {
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
      activeCount: 3,
      runs: expect.arrayContaining([
        expect.objectContaining({ agentRunId: first.agentRunId }),
        expect.objectContaining({ agentRunId: second.agentRunId }),
        expect.objectContaining({ agentRunId: third.agentRunId })
      ])
    })
    const fourth = await service.startRun({
      agentSessionId: fourthSession.agentSessionId,
      prompt: 'Fourth request',
      editorContext
    })
    expect(service.projectActivitySnapshot().activeCount).toBe(4)

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

    expect(service.requireRun(fourth.agentRunId).status).toBe('running')
    runtime.active(first.agentRunId).resolve()
    runtime.active(third.agentRunId).resolve()
    runtime.active(fourth.agentRunId).resolve()
    await Promise.all([first.completion, third.completion, fourth.completion])
    expect(service.projectActivitySnapshot().activeCount).toBe(0)
    database.close()
  })

  it('allows two runs plus one manual compaction and releases it after stop', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn(
      (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) =>
        new Promise<{ summary: string; modelRequestId: string }>((_resolve, reject) => {
          input.signal.addEventListener('abort', () => reject(input.signal.reason), { once: true })
        })
    )
    const service = createService(database, runtime, undefined, { summarizeHistory })
    const [manualSession, runSessionOne, runSessionTwo, fourthSession] = [
      'Manual',
      'Run one',
      'Run two',
      'Fourth'
    ].map((title) => service.createSession(title))
    if (!manualSession || !runSessionOne || !runSessionTwo || !fourthSession) {
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
    const fourth = await service.startRun({
      agentSessionId: fourthSession.agentSessionId,
      prompt: 'Fourth project task',
      editorContext
    })
    expect(service.projectActivitySnapshot().activeCount).toBe(4)

    await service.stopCompaction(manualSession.agentSessionId, compactionId)
    expect(service.projectActivitySnapshot()).toMatchObject({ activeCount: 3, compactions: [] })
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
    runtime.active(fourth.agentRunId).resolve()
    await Promise.all([first.completion, second.completion, fourth.completion])
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
      prompt: `永不截断🙂${'界'.repeat(120_000)}`,
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
              schemaVersion: 4,
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

  it('skips Writing Skill routing in Ask mode', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const route = vi.fn()
    const service = createService(database, runtime, undefined, {
      skillRouter: { route } as never
    })
    const session = service.createSession('Ask without skills')
    service.setInteractionMode(session.agentSessionId, 'ask')

    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'What does the introduction claim?',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(route).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(runtime.active(started.agentRunId)).toBeDefined())
    expect(service.requireRun(started.agentRunId).skillSnapshot.routingStatus).toBe('not_needed')
    runtime.active(started.agentRunId).resolve()
    await started.completion
    database.close()
  })

  it('cancels skill routing before the provider runtime starts', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    let routeEntered!: () => void
    const routeStarted = new Promise<void>((resolve) => {
      routeEntered = resolve
    })
    const service = createService(database, runtime, undefined, {
      skillRouter: {
        route: (input) =>
          new Promise((_resolve, reject) => {
            routeEntered()
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

    await routeStarted
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

  it('reports a concrete failure when an explicit Skill root cannot fit the context', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const commit = 'a'.repeat(40)
    const contextBuilder = {
      build: vi.fn((input: { prompt: string; skillPrompt?: { mandatory: string } }) => {
        if (input.skillPrompt?.mandatory.includes('EXPLICIT_BUNDLE')) {
          throw new SkillPromptBudgetError()
        }
        return {
          systemPrompt: `SYSTEM ${input.skillPrompt?.mandatory ?? ''}`,
          userRequest: input.prompt,
          writingContext: {},
          snapshot: {},
          includedSkillResources: [],
          skillPromptDropped: false
        }
      })
    }
    const service = createService(database, runtime, undefined, {
      contextBuilder: contextBuilder as never,
      skillRouter: {
        route: async () => ({
          snapshot: {
            schemaVersion: 4 as const,
            mode: 'explicit' as const,
            routingStatus: 'selected' as const,
            requestedSkills: [
              {
                skillId: 'explicit-method',
                displayName: 'Explicit Method',
                name: 'explicit-method',
                commit,
                manifestSha256: 'b'.repeat(64)
              }
            ],
            skills: [
              {
                skillId: 'explicit-method',
                displayName: 'Explicit Method',
                name: 'explicit-method',
                commit,
                manifestSha256: 'b'.repeat(64),
                invocationSource: 'user' as const
              }
            ],
            dependencies: [],
            resources: [],
            safeError: null
          },
          prompt: {
            mode: 'explicit' as const,
            mandatory: 'EXPLICIT_BUNDLE'.repeat(4_000),
            references: []
          },
          modelRequestId: null
        })
      }
    })
    const session = service.createSession('Explicit budget fallback')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '$explicit-method Revise this.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await started.completion
    expect(service.requireRun(started.agentRunId)).toMatchObject({
      status: 'failed',
      errorCode: 'skill_prompt_budget_exceeded',
      errorDetails: expect.objectContaining({
        message: expect.stringContaining('selected writing skill')
      })
    })
    expect(() => runtime.active(started.agentRunId)).toThrow('No fake Agent run is active')
    expect(contextBuilder.build).toHaveBeenCalledTimes(2)
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
      resolveModelLimits: async () => ({
        contextWindowTokens: 32_768,
        inputLimitTokens: 24_576,
        outputLimitTokens: 4_096,
        source: 'models_dev',
        catalogModelKey: 'test/compaction-stop',
        resolvedAt: '2026-08-12T00:00:00.000Z'
      }),
      summarizeHistory,
      skillRouter: {
        route: async () => ({
          snapshot: {
            schemaVersion: 4,
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
      prompt: '界'.repeat(15_000),
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
      message: assistant('文'.repeat(15_000), 'long-response')
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
        .prepare('UPDATE agent_sessions SET event_schema_version = ? WHERE agent_session_id = ?')
        .run(99, session.agentSessionId)
    )
    expect(() => service.setThinkingLevel(session.agentSessionId, 'low')).toThrow('incompatible')
    database.close()
  })

  it('keeps Writing Skills out of session state and prepares the catalog for every run', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const route = vi.fn(async () => ({
      snapshot: {
        schemaVersion: 4 as const,
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
})
