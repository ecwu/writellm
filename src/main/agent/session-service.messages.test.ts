import { describe, expect, it, vi } from 'vitest'
import { dirname } from 'node:path'
import { openProjectDatabase } from '../project/project-database'
import {
  AGENT_PENDING_MESSAGE_LIMIT,
  AGENT_PENDING_MESSAGE_MAX_BYTES
} from '../../shared/contracts/agent'
import { ModelRequestRepository } from '../providers/model-request-repository'
import type { AgentSessionServiceOptions } from './session-service'
import { recoverInterruptedAgentWork } from './session-recovery'
import { AgentContextBuilder } from './context'
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
  it.each(['0.80.10', 'historical-pi-build'])(
    'continues valid history recorded under %s after reopening the database',
    async (recordedVersion) => {
      const database = await createDatabase()
      const runtime = new FakeAgentRuntime()
      const service = createService(database, runtime)
      const session = service.createSession('Existing conversation')
      const first = await service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Remember the first draft.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
      await runtime.active().emit({
        type: 'assistant_message',
        modelRequestId: runtime.active().input.modelRequestId,
        message: assistant('The first draft is ready.', 'original-response')
      })
      runtime.active().resolve()
      await first.completion
      await database.kysely
        .updateTable('agent_sessions')
        .set({ pi_runtime_version: recordedVersion })
        .where('agent_session_id', '=', session.agentSessionId)
        .execute()
      const originalEvents = service.listEvents(session.agentSessionId)
      const projectRoot = database.immediate((sqlite) => dirname(dirname(sqlite.name)))
      database.close()
      const reopened = await openProjectDatabase({
        projectRoot,
        manifest: {
          format: 'writellm-project',
          formatVersion: 1,
          projectId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
          createdAt: '2026-07-21T00:00:00.000Z'
        },
        applicationVersion: '1.0.0-test',
        log
      })
      const resumed = createService(reopened, runtime)
      expect(resumed.listSessions()[0]).toMatchObject({ compatible: true })
      expect(resumed.listEvents(session.agentSessionId)).toEqual(originalEvents)
      resumed.setApprovalMode(session.agentSessionId, 'manual')
      resumed.setThinkingLevel(session.agentSessionId, 'low')
      const next = await resumed.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Continue the draft.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
      expect(JSON.stringify(runtime.active().input.history)).toContain('The first draft is ready.')
      runtime.active().resolve()
      await next.completion
      expect(
        await reopened.kysely
          .selectFrom('agent_sessions')
          .select('pi_runtime_version')
          .where('agent_session_id', '=', session.agentSessionId)
          .executeTakeFirstOrThrow()
      ).toEqual({ pi_runtime_version: recordedVersion })
      resumed.archiveSession(session.agentSessionId)
      await expect(
        resumed.startRun({
          agentSessionId: session.agentSessionId,
          prompt: 'Archived conversations must stay archived.',
          editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
        })
      ).rejects.toThrow('archived')
      reopened.close()
    }
  )

  it('persists concrete cause diagnostics while removing secrets, private prompts and paths', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const errorLog = vi.fn()
    const service = createService(database, runtime, undefined, {
      log: { ...log, error: errorLog } as never
    })
    const session = service.createSession('Diagnostic projection')
    const privatePrompt = 'UNPUBLISHED_PRIVATE_MANUSCRIPT_BODY'
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: privatePrompt,
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const failure = new Error(
      `Cannot encode request ${privatePrompt} at /Users/person/private/book.md`,
      {
        cause: Object.assign(new Error('Invalid session credential agent-secret'), {
          code: 'BAD_SESSION'
        })
      }
    )
    runtime.active().reject(failure)
    await started.completion
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({ err: failure }),
      expect.any(String)
    )
    const diagnostic = service.requireRun(started.agentRunId).errorDetails
    expect(diagnostic).toMatchObject({
      message: expect.stringContaining('Cannot encode request'),
      causes: [expect.objectContaining({ code: 'BAD_SESSION' })]
    })
    const terminal = service
      .listEvents(session.agentSessionId)
      .find((event) => event.type === 'run_interrupted')
    expect(terminal?.payload).toMatchObject({ schemaVersion: 2, diagnostic })
    const serialized = JSON.stringify(terminal?.payload)
    expect(serialized).not.toContain(privatePrompt)
    expect(serialized).not.toContain('agent-secret')
    expect(serialized).not.toContain('/Users/person')
    database.close()
  })

  it('publishes and completes an answer when automatic Skill dependencies remain unread', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const publishDelta = vi.fn()
    const state = {
      mode: 'auto' as const,
      candidates: new Map(),
      automaticCandidateUris: new Set<string>(),
      requestedSkills: [],
      invocationSources: new Map<string, 'user' | 'agent'>(),
      dependencyCandidates: new Map(),
      activeSkills: [],
      dependencies: [],
      readResources: new Map()
    }
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
      prompt: {
        mode: 'auto' as const,
        mandatory: '<available_skills />',
        references: []
      },
      modelRequestId: null,
      state
    }))
    const service = createService(database, runtime, undefined, {
      publishDelta,
      skillRouter: { route }
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
    await active.emit({ type: 'assistant_delta', delta: 'Visible answer' })
    expect(publishDelta).toHaveBeenCalledWith(expect.objectContaining({ delta: 'Visible answer' }))
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('response-without-skill')
    })
    await active.emit({
      type: 'assistant_message',
      modelRequestId: active.input.modelRequestId,
      message: assistant('Visible answer', 'response-without-skill')
    })
    active.resolve()
    await started.completion

    expect(service.requireRun(started.agentRunId)).toMatchObject({
      status: 'completed',
      errorCode: null,
      skillSnapshot: {
        schemaVersion: 4,
        routingStatus: 'not_needed',
        requestedSkills: [],
        skills: [],
        safeError: null
      }
    })
    expect(service.listEvents(session.agentSessionId).map((event) => event.type)).toEqual([
      'user_message',
      'assistant_message',
      'run_completed'
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
    await expect(
      active.emit({
        type: 'model_call_finished',
        modelRequestId: followUp.modelRequestId,
        outcome: 'succeeded',
        metadata: metadata('premature-response')
      })
    ).rejects.toThrow('unauthorized model request')
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

  it.each(['deletePendingFollowUp', 'steerPendingFollowUp'] as const)(
    'settles the run when %s removes a message but cannot abort its request',
    async (action) => {
      const database = await createDatabase()
      const runtime = new FakeAgentRuntime()
      const service = createService(database, runtime)
      const session = service.createSession()
      const run = await service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Keep working.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
      await service.followUp(run.agentRunId, 'Adjust the draft.')
      const pending = service.projectActivitySnapshot().runs[0]?.pendingMessages[0]
      if (pending === undefined) throw new Error('Expected a pending Follow-up')
      const failure = new Error('Could not record the request abort')
      const abort = vi
        .spyOn(ModelRequestRepository.prototype, 'abort')
        .mockRejectedValueOnce(failure)
      try {
        await expect(service[action](run.agentRunId, pending.pendingMessageId)).rejects.toBe(
          failure
        )
        await run.completion
        expect(service.projectActivitySnapshot().runs).toEqual([])
        expect(
          await database.kysely.selectFrom('model_requests').select('status').execute()
        ).toEqual([{ status: 'aborted' }, { status: 'aborted' }])
        expect(
          service
            .listEvents(session.agentSessionId)
            .filter((event) => event.type === 'user_message')
        ).toHaveLength(1)
      } finally {
        abort.mockRestore()
        await service.abort(run.agentRunId)
        await run.completion
        database.close()
      }
    }
  )

  it.each([{ fails: false }, { fails: true }])(
    'coordinates Stop with a pending queue abort (first write fails: $fails)',
    async ({ fails }) => {
      const database = await createDatabase()
      const runtime = new FakeAgentRuntime()
      const service = createService(database, runtime)
      const session = service.createSession()
      const run = await service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Keep working.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
      await service.followUp(run.agentRunId, 'Adjust the draft.')
      const queued = runtime.active().commands[0]
      if (queued?.pendingMessageId === undefined) throw new Error('Expected a pending Follow-up')
      const firstAbort = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const failure = new Error('Could not record the queue abort')
      const abortRequest = ModelRequestRepository.prototype.abort
      const abort = vi
        .spyOn(ModelRequestRepository.prototype, 'abort')
        .mockImplementation(async function (this: ModelRequestRepository, ...args) {
          if (args[1] === 'queue_deleted') {
            firstAbort.resolve()
            await release.promise
            if (fails) throw failure
          }
          return abortRequest.apply(this, args)
        })
      const deleted = Promise.allSettled([
        service.deletePendingFollowUp(run.agentRunId, queued.pendingMessageId)
      ])
      try {
        await Promise.race([firstAbort.promise, deleted])
        const stopped = service.abort(run.agentRunId)
        await vi.waitFor(async () => {
          const initial = await database.kysely
            .selectFrom('model_requests')
            .select('status')
            .where('model_request_id', '=', runtime.active().input.modelRequestId)
            .executeTakeFirstOrThrow()
          expect(initial.status).toBe('aborted')
        })
        release.resolve()
        await stopped
        expect(await deleted).toEqual([
          fails
            ? { status: 'rejected', reason: failure }
            : { status: 'fulfilled', value: undefined }
        ])
        expect(
          abort.mock.calls.filter(([id]) => id === queued.modelRequestId).map(([, code]) => code)
        ).toEqual(fails ? ['queue_deleted', 'agent_run_ended'] : ['queue_deleted'])
        const request = await database.kysely
          .selectFrom('model_requests')
          .select('status')
          .where('model_request_id', '=', queued.modelRequestId)
          .executeTakeFirstOrThrow()
        expect(request.status).toBe('aborted')
      } finally {
        release.resolve()
        await deleted
        await service.abort(run.agentRunId)
        abort.mockRestore()
        database.close()
      }
    }
  )

  it.each(['steer', 'followUp'] as const)(
    'aborts the model request when %s cannot prepare context',
    async (delivery) => {
      const database = await createDatabase()
      const runtime = new FakeAgentRuntime()
      const service = createService(database, runtime)
      const session = service.createSession()
      const run = await service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Keep working.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
      const failure = new Error('Context could not be prepared')
      const build = vi.spyOn(AgentContextBuilder.prototype, 'build').mockImplementationOnce(() => {
        throw failure
      })
      try {
        await expect(service[delivery](run.agentRunId, 'Adjust the draft.')).rejects.toBe(failure)
        expect(runtime.active().commands).toEqual([])
        const requests = await database.kysely
          .selectFrom('model_requests')
          .select(['status', 'error_json'])
          .where('model_request_id', '!=', runtime.active().input.modelRequestId)
          .execute()
        expect(requests).toEqual([
          {
            status: 'aborted',
            error_json: JSON.stringify({ code: 'queue_delivery_failed', retryable: false })
          }
        ])
      } finally {
        build.mockRestore()
        await service.abort(run.agentRunId)
        await run.completion
        database.close()
      }
    }
  )

  it.each(['steer', 'promotion', 'consumption'] as const)(
    'stops %s delivery while Main publishes history',
    async (delivery) => {
      const database = await createDatabase()
      const runtime = new FakeAgentRuntime()
      const publishing = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const content = 'Adjust the draft.'
      const service = createService(database, runtime, async (event) => {
        if (event.type === 'user_message' && event.payload.content === content) {
          publishing.resolve()
          await release.promise
        }
      })
      const session = service.createSession()
      const run = await service.startRun({
        agentSessionId: session.agentSessionId,
        prompt: 'Keep working.',
        editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
      })
      try {
        const active = runtime.active()
        let submission: Promise<void>
        if (delivery === 'steer') {
          submission = service.steer(run.agentRunId, content)
        } else {
          await service.followUp(run.agentRunId, content)
          const queued = active.commands[0]
          if (queued?.pendingMessageId === undefined)
            throw new Error('Expected a pending Follow-up')
          submission =
            delivery === 'promotion'
              ? service.steerPendingFollowUp(run.agentRunId, queued.pendingMessageId)
              : active.emit({
                  type: 'follow_up_consumption_requested',
                  consumptionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc418',
                  pendingMessageId: queued.pendingMessageId,
                  modelRequestId: queued.modelRequestId
                })
        }
        const result = Promise.allSettled([submission])
        expect(
          await Promise.race([publishing.promise.then(() => true), result.then(() => false)])
        ).toBe(true)
        await service.abort(run.agentRunId)
        release.resolve()
        expect(await result).toEqual([
          delivery === 'consumption'
            ? { status: 'fulfilled', value: undefined }
            : {
                status: 'rejected',
                reason: new Error(
                  'Agent run ended or changed before the message could be delivered'
                )
              }
        ])
        expect(active.commands.map((command) => command.operation)).toEqual(
          delivery === 'steer' ? [] : ['follow_up']
        )
        expect(active.followUpConsumptionIds).toEqual([])
        const requests = await database.kysely
          .selectFrom('model_requests')
          .select('status')
          .execute()
        expect(requests.map((request) => request.status)).toEqual(
          Array.from({ length: delivery === 'promotion' ? 3 : 2 }, () => 'aborted')
        )
        expect(
          service
            .listEvents(session.agentSessionId)
            .filter((event) => event.type === 'user_message')
        ).toHaveLength(2)
      } finally {
        release.resolve()
        await service.abort(run.agentRunId)
        database.close()
      }
    }
  )

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

  it.each([
    {
      limit: 'message count',
      waitingCount: AGENT_PENDING_MESSAGE_LIMIT - 1,
      content: 'One more message',
      errorMessage: `Up to ${AGENT_PENDING_MESSAGE_LIMIT} messages`
    },
    {
      limit: 'UTF-8 bytes',
      waitingCount: 3,
      content: 'é'.repeat(AGENT_PENDING_MESSAGE_MAX_BYTES / 8),
      errorMessage: 'Waiting messages cannot exceed 1 MiB'
    }
  ])('enforces the $limit limit when Follow-ups arrive together', async (scenario) => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession('Concurrent Follow-ups')
    const run = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Keep working.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    try {
      for (let index = 0; index < scenario.waitingCount; index += 1) {
        await service.followUp(run.agentRunId, scenario.content)
      }
      const attempts = await Promise.allSettled([
        service.followUp(run.agentRunId, scenario.content),
        service.followUp(run.agentRunId, scenario.content)
      ])
      expect(attempts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ status: 'fulfilled' }),
          expect.objectContaining({
            status: 'rejected',
            reason: expect.objectContaining({
              message: expect.stringContaining(scenario.errorMessage)
            })
          })
        ])
      )
      expect(service.projectActivitySnapshot().runs[0]?.pendingMessages).toHaveLength(
        scenario.waitingCount + 1
      )
      const commands = runtime.active().commands
      expect(commands).toHaveLength(scenario.waitingCount + 1)
      const aborted = await database.kysely
        .selectFrom('model_requests')
        .select(['model_request_id', 'error_json'])
        .where('status', '=', 'aborted')
        .executeTakeFirstOrThrow()
      expect(aborted.error_json).toBe(
        JSON.stringify({ code: 'queue_authorization_failed', retryable: false })
      )
      expect(commands.map((command) => command.modelRequestId)).not.toContain(
        aborted.model_request_id
      )
      expect(service.listEvents(session.agentSessionId).map((event) => event.type)).toEqual([
        'user_message'
      ])

      await service.steer(run.agentRunId, 'Steer still works.')
      expect(commands.at(-1)?.operation).toBe('steer')
    } finally {
      await service.abort(run.agentRunId)
      await run.completion
      database.close()
    }
  })

  it('retries a failed request abort when concurrent Follow-ups reach capacity', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession()
    const run = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Keep working.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const content = 'é'.repeat(AGENT_PENDING_MESSAGE_MAX_BYTES / 8)
    for (let index = 0; index < 3; index += 1) await service.followUp(run.agentRunId, content)

    const abort = vi
      .spyOn(ModelRequestRepository.prototype, 'abort')
      .mockRejectedValueOnce(new Error('Could not record the request abort'))
    try {
      const attempts = await Promise.allSettled([
        service.followUp(run.agentRunId, content),
        service.followUp(run.agentRunId, content)
      ])
      expect(attempts).toEqual(
        expect.arrayContaining([
          { status: 'fulfilled', value: undefined },
          {
            status: 'rejected',
            reason: new Error('Waiting messages cannot exceed 1 MiB in this run')
          }
        ])
      )
      await run.completion
      const [rejectedRequestId, reason] = abort.mock.calls[0] ?? []
      expect(reason).toBe('queue_authorization_failed')
      expect(abort).toHaveBeenCalledWith(rejectedRequestId, 'agent_run_ended')
      expect(runtime.active().commands).toHaveLength(4)
      expect(await database.kysely.selectFrom('model_requests').select('status').execute()).toEqual(
        Array.from({ length: 6 }, () => ({ status: 'aborted' }))
      )
    } finally {
      abort.mockRestore()
      await service.abort(run.agentRunId)
      await run.completion
      database.close()
    }
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

  it('retries a failed abort started by run settlement', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession()
    const run = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Keep working.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const modelRequestId = runtime.active().input.modelRequestId
    const abort = vi
      .spyOn(ModelRequestRepository.prototype, 'abort')
      .mockRejectedValueOnce(new Error('Could not record the request abort'))
    try {
      await service.abort(run.agentRunId)
      expect(abort.mock.calls).toEqual([
        [modelRequestId, 'agent_run_ended'],
        [modelRequestId, 'agent_run_ended']
      ])
      expect(
        await database.kysely
          .selectFrom('model_requests')
          .select('status')
          .where('model_request_id', '=', modelRequestId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: 'aborted' })
    } finally {
      abort.mockRestore()
      database.close()
    }
  })

  it.each([
    { delivery: 'steer', end: 'Stop', status: 'interrupted' },
    { delivery: 'followUp', end: 'Stop', status: 'interrupted' },
    { delivery: 'promotion', end: 'project close', status: 'interrupted' },
    { delivery: 'followUp', end: 'normal completion', status: 'completed' }
  ] as const)('drains a pending $delivery save before $end', async ({ delivery, end, status }) => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession()
    const run = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Keep working.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    if (delivery === 'steer') await active.emit({ type: 'assistant_delta', delta: 'Partial draft' })
    if (delivery === 'steer' || end === 'normal completion') {
      await active.emit({
        type: 'model_call_finished',
        modelRequestId: active.input.modelRequestId,
        outcome: 'succeeded',
        metadata: metadata('response-before-queue-save')
      })
    }
    if (delivery === 'promotion') await service.followUp(run.agentRunId, 'Adjust the draft.')
    const pendingMessageId = active.commands[0]?.pendingMessageId
    const saved = Promise.withResolvers<string>()
    const release = Promise.withResolvers<void>()
    const start = ModelRequestRepository.prototype.start
    const save = vi
      .spyOn(ModelRequestRepository.prototype, 'start')
      .mockImplementationOnce(async function (this: ModelRequestRepository, input) {
        const request = await start.call(this, input)
        saved.resolve(request.modelRequestId)
        await release.promise
        return request
      })
    const submission = Promise.allSettled([
      delivery === 'promotion'
        ? service.steerPendingFollowUp(run.agentRunId, pendingMessageId ?? '')
        : service[delivery](run.agentRunId, 'Adjust the draft.')
    ])
    try {
      const modelRequestId = await Promise.race([saved.promise, submission.then(() => '')])
      expect(modelRequestId).not.toBe('')
      if (end === 'normal completion') active.resolve()
      const ending =
        end === 'Stop'
          ? service.abort(run.agentRunId)
          : end === 'project close'
            ? service.close()
            : run.completion
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(service.requireRun(run.agentRunId).status).toBe('running')
      await expect(service.followUp(run.agentRunId, 'Too late.')).rejects.toThrow()
      expect(save).toHaveBeenCalledTimes(1)

      release.resolve()
      await ending
      expect(await submission).toEqual([expect.objectContaining({ status: 'rejected' })])
      expect(service.requireRun(run.agentRunId).status).toBe(status)
      expect(active.commands).toHaveLength(delivery === 'promotion' ? 1 : 0)
      expect(
        service.listEvents(session.agentSessionId).filter((event) => event.type === 'user_message')
      ).toHaveLength(1)
      if (delivery === 'steer') {
        expect(service.listEvents(session.agentSessionId)).toContainEqual(
          expect.objectContaining({
            type: 'assistant_message',
            modelRequestId: null,
            payload: expect.objectContaining({ content: 'Partial draft', interrupted: true })
          })
        )
      }
      expect(
        await database.kysely
          .selectFrom('model_requests')
          .select('status')
          .where('model_request_id', '=', modelRequestId)
          .executeTakeFirstOrThrow()
      ).toEqual({ status: 'aborted' })
    } finally {
      release.resolve()
      await submission
      save.mockRestore()
      await service.abort(run.agentRunId)
      database.close()
    }
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

  it('persists exhausted retries without transient warnings and accepts the next normal run', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const warn = vi.fn()
    const service = createService(database, runtime, undefined, { log: { ...log, warn } as never })
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
    const cause = Object.assign(new Error('Upstream queue is unavailable'), {
      code: 'UPSTREAM_BUSY'
    })
    const exhausted = Object.assign(
      new Error('Provider shard writer-2 returned HTTP 503', { cause }),
      { statusCode: 503 }
    )
    exhausted.name = 'ProviderRetriesExhaustedError'
    active.reject(exhausted)
    await started.completion

    expect(service.listRuns(session.agentSessionId)[0]).toMatchObject({
      status: 'failed',
      errorCode: 'provider_retries_exhausted',
      errorDetails: {
        message: 'Provider shard writer-2 returned HTTP 503',
        httpStatus: 503,
        causes: [
          expect.objectContaining({
            message: 'Upstream queue is unavailable',
            code: 'UPSTREAM_BUSY'
          })
        ]
      }
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
    expect(JSON.stringify(warn.mock.calls)).not.toContain('agent.provider_retry.scheduled')
    expect(
      service.listEvents(session.agentSessionId).some((event) => event.type === 'model_retry')
    ).toBe(false)
    const next = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Try a new question.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(next.agentRunId).not.toBe(started.agentRunId)
    runtime.active(next.agentRunId).resolve()
    await next.completion
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
    const overflowedRun = runtime.active(retried.agentRunId)
    const firstModelRequestId = overflowedRun.input.modelRequestId
    const cleaningUp = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const abortRequest = ModelRequestRepository.prototype.abort
    const abort = vi
      .spyOn(ModelRequestRepository.prototype, 'abort')
      .mockImplementation(async function (this: ModelRequestRepository, ...args) {
        if (args[0] === firstModelRequestId) {
          cleaningUp.resolve()
          await release.promise
        }
        return abortRequest.apply(this, args)
      })
    overflowedRun.reject(contextOverflowError())
    try {
      await cleaningUp.promise
      await expect(service.followUp(retried.agentRunId, 'Late queue input.')).rejects.toThrow(
        'Earlier conversation is still being summarized'
      )
      expect(overflowedRun.commands).toEqual([])
    } finally {
      abort.mockRestore()
      release.resolve()
    }
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

  it('does not auto-compact a low-token conversation after 10,000 tool lifecycle events', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn()
    const service = createService(database, runtime, undefined, { summarizeHistory })
    const session = service.createSession('Tool-heavy conversation')
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
           agent_event_id, agent_session_id, sequence, type, payload_json, created_at
         ) VALUES (?, ?, ?, 'tool_attempted', '{}', ?)`
      )
      native.transaction(() => {
        for (let sequence = 1; sequence <= 10_000; sequence += 1) {
          insert.run(
            crypto.randomUUID(),
            session.agentSessionId,
            sequence,
            '2026-09-01T00:00:00.000Z'
          )
        }
      })()
    })

    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Answer this short request without compacting.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })

    expect(summarizeHistory).not.toHaveBeenCalled()
    expect(runtime.active(started.agentRunId).input.history).toEqual([])
    runtime.active(started.agentRunId).resolve()
    await started.completion
    database.close()
  }, 60_000)

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
    expect(service.listEvents(session.agentSessionId).at(-1)?.payload).toMatchObject({
      schemaVersion: 2,
      code: 'user_stopped',
      status: 'interrupted',
      diagnostic: expect.objectContaining({
        stage: 'run',
        message: expect.any(String)
      })
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
    expect(recoverInterruptedAgentWork(database, log)).toBe(2)
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
    expect(recoverInterruptedAgentWork(database, log)).toBe(0)
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

  it('keeps incompatible event history readable but rejects new runs', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const service = createService(database, runtime)
    const session = service.createSession('Legacy session')
    await database.kysely
      .updateTable('agent_sessions')
      .set({ event_schema_version: 99 })
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
