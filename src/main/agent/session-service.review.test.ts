import { describe, expect, it, vi } from 'vitest'
import { ModelRequestRepository } from '../providers/model-request-repository'
import { loadContinuousRuntimeHistory } from './context-checkpoint'
import type { AgentSessionService, AgentSessionServiceOptions } from './session-service'
import {
  log,
  config,
  activateToolGroups,
  FakeAgentRuntime,
  createService,
  createDatabase,
  metadata,
  assistant,
  proposalToolResult,
  proposalOutcome,
  workerExitError
} from './session-service.test-support'

describe('AgentSessionService: review', () => {
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
    await activateToolGroups(active, ['brief'])
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
      await activateToolGroups(active, [
        kind === 'brief_update' ? 'brief' : kind === 'outline_patch' ? 'outline' : 'section'
      ])
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
        'tool_result',
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
    await activateToolGroups(active, ['section'])
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
    await activateToolGroups(active, ['section'])
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
    const interactionUpdated = service.setInteractionMode(session.agentSessionId, 'plan')
    expect(interactionUpdated.interactionMode).toBe('plan')
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
      resolveModelLimits: async () => ({
        contextWindowTokens: 32_768,
        inputLimitTokens: 24_576,
        outputLimitTokens: 4_096,
        source: 'models_dev',
        catalogModelKey: 'test/compaction',
        resolvedAt: '2026-08-12T00:00:00.000Z'
      }),
      summarizeHistory
    })
    const session = service.createSession()
    const first = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '界'.repeat(15_000),
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
      message: assistant('文'.repeat(15_000), 'long-response')
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
    expect(runtime.active().input.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'user',
          content: expect.stringContaining('The user requested a long Chinese draft.')
        })
      ])
    )
    const summaries = service
      .listEvents(session.agentSessionId)
      .filter((event) => event.type === 'compaction_summary')
    expect(summaries).toHaveLength(1)
    expect(summaries[0]).toMatchObject({
      agentRunId: second.agentRunId,
      modelRequestId: expect.any(String),
      payload: expect.objectContaining({
        coveredFromSequence: 1,
        coveredThroughSequence: 3,
        schemaVersion: 4,
        previousCheckpointEventId: null,
        omittedEventCount: expect.any(Number),
        estimatedTokensBefore: expect.any(Number),
        estimatedTokensAfter: expect.any(Number)
      })
    })
    runtime.active().reject(workerExitError())
    await second.completion

    const third = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '界'.repeat(15_000),
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

  it('retains the concrete compaction failure when automatic summarization fails', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn(async () => {
      throw new Error('summary provider unavailable')
    })
    const service = createService(database, runtime, undefined, {
      resolveModelLimits: async () => ({
        contextWindowTokens: 32_768,
        inputLimitTokens: 24_576,
        outputLimitTokens: 4_096,
        source: 'models_dev',
        catalogModelKey: 'test/compaction-failure',
        resolvedAt: '2026-08-12T00:00:00.000Z'
      }),
      summarizeHistory
    })
    const session = service.createSession('Automatic compaction failure')
    const first = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: '界'.repeat(15_000),
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
      message: assistant('文'.repeat(15_000), 'fallback-source')
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
      errorCode: 'compaction_required',
      errorDetails: expect.objectContaining({
        message: 'summary provider unavailable'
      })
    })
    expect(summarizeHistory).toHaveBeenCalledOnce()
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

  it('compacts a history above the former 2,000-event ceiling', async () => {
    const database = await createDatabase()
    const summarizeHistory = vi.fn(
      async (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) => {
        const repository = new ModelRequestRepository(database, log)
        const request = await repository.start({
          operation: 'agent',
          provider: config,
          request: { purpose: 'manual_compaction' },
          inputItems: 1,
          operationId: input.compactionId,
          projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
        })
        await repository.succeed(request.modelRequestId, {
          metadata: metadata('manual-large-history'),
          outputItems: 1
        })
        return {
          summary: 'The long history was summarized.',
          modelRequestId: request.modelRequestId
        }
      }
    )
    const service = createService(database, new FakeAgentRuntime(), undefined, { summarizeHistory })
    const session = service.createSession('Large source history')
    database.immediate((native) => {
      const insert = native.prepare(
        `INSERT INTO agent_events (
             agent_event_id, agent_session_id, sequence, type, payload_json, created_at
           ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      native.transaction(() => {
        insert.run(
          crypto.randomUUID(),
          session.agentSessionId,
          1,
          'user_message',
          JSON.stringify({ content: 'Older request', delivery: 'prompt', timestamp: 1 }),
          '2026-08-12T00:00:00.000Z'
        )
        for (let sequence = 2; sequence <= 2_000; sequence += 1) {
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
          'run_completed',
          JSON.stringify({ outcome: 'finished' }),
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

    const { compactionId } = await service.compactSession(session.agentSessionId)
    await vi.waitFor(() => expect(service.projectActivitySnapshot().compactions).toEqual([]))

    expect(summarizeHistory).toHaveBeenCalledOnce()
    const summary = service
      .listEventPage(session.agentSessionId, 2_001, 10)
      .events.find((event) => event.type === 'compaction_summary')
    expect(summary).toMatchObject({
      payload: expect.objectContaining({
        schemaVersion: 4,
        compactionId,
        coveredFromSequence: 1,
        coveredThroughSequence: 2_001,
        omittedEventCount: expect.any(Number),
        estimatedTokensBefore: expect.any(Number),
        estimatedTokensAfter: expect.any(Number)
      })
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

  it('compacts an oversized historical prompt while retaining the recent raw turn', async () => {
    const database = await createDatabase()
    const summarizeHistory = vi.fn(
      async (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) => {
        const repository = new ModelRequestRepository(database, log)
        const request = await repository.start({
          operation: 'agent',
          provider: config,
          request: { purpose: 'manual_compaction' },
          inputItems: 1,
          operationId: input.compactionId,
          projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422'
        })
        await repository.succeed(request.modelRequestId, {
          metadata: metadata('manual-oversized-prompt'),
          outputItems: 1
        })
        return {
          summary: 'The oversized historical turn was summarized.',
          modelRequestId: request.modelRequestId
        }
      }
    )
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

    const { compactionId } = await service.compactSession(session.agentSessionId)
    await vi.waitFor(() => expect(service.projectActivitySnapshot().compactions).toEqual([]))

    expect(summarizeHistory).toHaveBeenCalledOnce()
    expect(service.listEvents(session.agentSessionId).at(-1)).toMatchObject({
      type: 'compaction_summary',
      payload: expect.objectContaining({
        schemaVersion: 4,
        compactionId,
        coveredFromSequence: 1,
        coveredThroughSequence: 2,
        omittedEventCount: expect.any(Number),
        estimatedTokensBefore: expect.any(Number),
        estimatedTokensAfter: expect.any(Number)
      })
    })
    const payload = service.listEvents(session.agentSessionId).at(-1)?.payload as {
      omittedEventCount: number
    }
    expect(payload.omittedEventCount).toBeGreaterThan(0)
    expect(loadContinuousRuntimeHistory(database, session.agentSessionId).at(-1)).toMatchObject({
      role: 'user',
      content: 'Recent raw turn'
    })
    database.close()
  })

  it('persists one successful checkpoint with continuous coverage', async () => {
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
          metadata: metadata(`manual-checkpoint-${input.coveredThroughSequence}`),
          outputItems: 1
        })
        return {
          summary: `Objective\nCheckpoint through ${input.coveredThroughSequence}.`,
          modelRequestId: request.modelRequestId
        }
      }
    )
    const service = createService(database, runtime, undefined, { summarizeHistory })
    const session = service.createSession('Long history')
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
    expect(summaries).toHaveLength(1)
    const payload = summaries[0]?.payload as {
      compactionId: string
      coveredFromSequence: number
      coveredThroughSequence: number
      omittedEventCount: number
      schemaVersion: number
      estimatedTokensBefore: number
      estimatedTokensAfter: number
    }
    expect(payload).toMatchObject({
      compactionId,
      coveredFromSequence: 1,
      coveredThroughSequence: expect.any(Number),
      schemaVersion: 4,
      previousCheckpointEventId: null,
      omittedEventCount: expect.any(Number),
      estimatedTokensBefore: expect.any(Number),
      estimatedTokensAfter: expect.any(Number)
    })
    expect(payload.coveredThroughSequence).toBeGreaterThan(0)
    expect(payload.coveredThroughSequence).toBeLessThan(600)
    expect(summarizeHistory).toHaveBeenCalledOnce()
    expect(summarizeHistory.mock.calls[0]?.[0].maxOutputTokens).toBe(8_192)
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
  }, 60_000)
})
