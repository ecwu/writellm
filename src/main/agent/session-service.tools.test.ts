import { describe, expect, it, vi } from 'vitest'
import type { AgentToolRequest } from '../../shared/contracts/agent-tools'
import { SkillReadError } from '../skills/skill-router'
import { AgentToolDomainError } from './read-tools'
import {
  log,
  activateToolGroups,
  FakeAgentRuntime,
  createService,
  createDatabase,
  metadata,
  assistant,
  workerExitError
} from './session-service.test-support'

describe('AgentSessionService: tools', () => {
  it('returns a dependency read error to the model without failing the run', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
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
    const service = createService(database, runtime, undefined, {
      skillRouter: {
        route: async () => ({
          snapshot: {
            schemaVersion: 4 as const,
            mode: 'auto' as const,
            routingStatus: 'selected' as const,
            requestedSkills: [],
            skills: [],
            dependencies: [],
            resources: [],
            safeError: null
          },
          prompt: { mode: 'auto' as const, mandatory: '<skill>Root</skill>', references: [] },
          modelRequestId: null,
          state
        }),
        read: async () => {
          throw new SkillReadError('conflict', 'The dependency could not be loaded')
        }
      }
    })
    const session = service.createSession('Recover from dependency read')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Use the available guidance.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    await vi.waitFor(() => expect(runtime.active(started.agentRunId)).toBeDefined())
    const active = runtime.active(started.agentRunId)
    await expect(
      active.requestTool({
        type: 'tool_request',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc470',
        projectSessionId: active.input.projectSessionId,
        agentSessionId: active.input.agentSessionId,
        agentRunId: active.input.agentRunId,
        toolCallId: 'tool-failed-dependency',
        modelRequestId: active.input.modelRequestId,
        toolName: 'read_writing_skill',
        args: { uri: `writellm://skills/dependency/${'a'.repeat(40)}/SKILL.md` }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: 'conflict' } })
    await active.emit({
      type: 'model_call_finished',
      modelRequestId: active.input.modelRequestId,
      outcome: 'succeeded',
      metadata: metadata('dependency-recovery')
    })
    await active.emit({
      type: 'assistant_message',
      modelRequestId: active.input.modelRequestId,
      message: assistant('Continued with the root guidance.', 'dependency-recovery')
    })
    active.resolve()
    await started.completion

    expect(service.requireRun(started.agentRunId)).toMatchObject({
      status: 'completed',
      errorCode: null
    })
    database.close()
  })

  it('rejects forged tool-group activation in Ask mode before tool execution', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const execute = vi.fn()
    const service = createService(database, runtime, undefined, { tools: { execute } as never })
    const session = service.createSession('Ask ceiling')
    service.setInteractionMode(session.agentSessionId, 'ask')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Read only.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active(started.agentRunId)
    const response = await active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc473',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'tool-forged-activation',
      modelRequestId: active.input.modelRequestId,
      toolName: 'activate_tool_groups',
      args: { groups: ['section'] }
    })

    expect(response).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
    expect(execute).not.toHaveBeenCalled()
    active.resolve()
    await started.completion
    database.close()
  })

  it('rejects a forged manuscript mutation in Plan mode before tool execution', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const execute = vi.fn()
    const service = createService(database, runtime, undefined, { tools: { execute } as never })
    const session = service.createSession('Plan ceiling')
    service.setInteractionMode(session.agentSessionId, 'plan')
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Plan only.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active(started.agentRunId)
    const response = await active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc474',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: 'tool-forged-review-mutation',
      modelRequestId: active.input.modelRequestId,
      toolName: 'submit_section_change',
      args: {}
    } as never)

    expect(response).toMatchObject({ ok: false, error: { code: 'unauthorized' } })
    expect(execute).not.toHaveBeenCalled()
    active.resolve()
    await started.completion
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

  it('continues authorizing tool calls beyond 180 durable events without forced finalization', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const info = vi.fn()
    const service = createService(database, runtime, undefined, {
      log: { ...log, info } as never
    })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Continue gathering the requested evidence.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active(started.agentRunId)
    for (let index = 0; index < 200; index += 1) {
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
    expect(active.authorizations[0]?.systemPrompt).not.toContain('final model call')
    await active.emit({
      type: 'model_call_requested',
      continuationId: '019c6a5c-8d34-7a8e-a602-3d37a52dc475',
      reason: 'tool_continuation'
    })
    expect(active.authorizations).toHaveLength(2)
    expect(JSON.stringify(info.mock.calls)).not.toContain('agent.run.finalization_started')
    active.reject(workerExitError())
    await started.completion
    database.close()
  }, 15_000)

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
      schemaVersion: 4 as const,
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
      invocationSources: new Map<string, 'user' | 'agent'>(),
      dependencyCandidates: new Map(),
      activeSkills: [],
      dependencies: [],
      readResources: new Map()
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
      },
      tools: {
        execute: vi.fn(async (input: { toolName: AgentToolRequest['toolName'] }) => {
          expect(input.toolName).toBe('search_knowledge')
          return { mode: 'fts', rerankStatus: 'disabled', hits: [] }
        })
      } as never
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
    await expect(
      active.requestTool({
        type: 'tool_request',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc480',
        projectSessionId: active.input.projectSessionId,
        agentSessionId: active.input.agentSessionId,
        agentRunId: active.input.agentRunId,
        toolCallId: 'tool-mixed-after-skill',
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
      ok: true,
      data: { mode: 'fts', rerankStatus: 'disabled', hits: [] }
    })
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

  it('rejects inactive capabilities and accumulates bounded tool-group activation', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const execute = vi.fn()
    const service = createService(database, runtime, undefined, { tools: { execute } as never })
    const session = service.createSession()
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Prepare a section review.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active()
    await expect(
      active.requestTool({
        type: 'tool_request',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc4a1',
        projectSessionId: active.input.projectSessionId,
        agentSessionId: active.input.agentSessionId,
        agentRunId: active.input.agentRunId,
        toolCallId: 'tool-inactive-section',
        modelRequestId: active.input.modelRequestId,
        toolName: 'submit_section_change',
        args: {
          sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc476',
          citationIds: [],
          operations: [
            {
              type: 'insertTextBlocks',
              anchor: null,
              placement: 'end',
              blocks: [{ blockType: 'paragraph', text: 'Body.' }]
            }
          ]
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'unauthorized', recovery: { action: 'do_not_retry' } }
    })
    expect(execute).not.toHaveBeenCalled()

    await activateToolGroups(active, ['section'])
    await expect(
      active.requestTool({
        type: 'tool_request',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc4a2',
        projectSessionId: active.input.projectSessionId,
        agentSessionId: active.input.agentSessionId,
        agentRunId: active.input.agentRunId,
        toolCallId: 'tool-activate-more-groups',
        modelRequestId: active.input.modelRequestId,
        toolName: 'activate_tool_groups',
        args: { groups: ['section', 'review'] }
      })
    ).resolves.toMatchObject({
      ok: true,
      data: {
        activated: ['review'],
        alreadyActive: ['section'],
        activeGroups: ['section', 'review']
      }
    })

    await active.emit({
      type: 'model_call_requested',
      continuationId: '019c6a5c-8d34-7a8e-a602-3d37a52dc4a3',
      reason: 'tool_continuation'
    })
    expect(active.authorizations.at(-1)).toMatchObject({
      activeToolGroups: ['section', 'review'],
      runtimeMessageBudgetTokens: expect.any(Number)
    })
    expect(active.authorizations.at(-1)?.runtimeMessageBudgetTokens).toBeLessThan(
      active.input.runtimeMessageBudgetTokens ?? Number.POSITIVE_INFINITY
    )
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
        expected: { action: 'refresh_context', tool: 'read_section' }
      },
      {
        toolName: 'read_outline' as const,
        args: { cursor: 'stale' },
        expected: { action: 'restart_pagination', tool: 'read_outline' }
      },
      {
        toolName: 'read_citations' as const,
        args: { citationIds: [`citation-${'a'.repeat(40)}`] },
        expected: { action: 'refresh_context', tool: 'search_knowledge' }
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
      if (fixture.toolName === 'submit_section_change') {
        await activateToolGroups(active, ['section'])
      }
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

  it.each([
    {
      state: 'searched',
      evidenceTool: 'search_knowledge' as const,
      evidenceArgs: { query: 'evidence' },
      expected: { action: 'refresh_context', tool: 'read_citations' }
    },
    {
      state: 'expanded',
      evidenceTool: 'read_citations' as const,
      evidenceArgs: { citationIds: [`citation-${'a'.repeat(40)}`] },
      expected: { action: 'fix_arguments' }
    }
  ])('routes citation recovery from $state run evidence', async (fixture) => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const warn = vi.fn()
    const execute = vi.fn(async (input: { toolName: AgentToolRequest['toolName'] }) => {
      if (input.toolName === 'search_knowledge') {
        return {
          mode: 'fts',
          rerankStatus: 'disabled',
          hits: [
            {
              citationId: `citation-${'a'.repeat(40)}`,
              knowledgeItemId: '019c6a5c-8d34-7a8e-a602-3d37a52dc471',
              parseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc472',
              chunkId: `chunk-${'a'.repeat(40)}`,
              title: 'Source',
              snippet: 'Evidence',
              headingPath: [],
              sourceBlockIds: ['block-source']
            }
          ]
        }
      }
      if (input.toolName === 'read_citations') {
        return {
          citations: [
            {
              citationId: `citation-${'a'.repeat(40)}`,
              knowledgeItemId: '019c6a5c-8d34-7a8e-a602-3d37a52dc471',
              parseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc472',
              chunkId: `chunk-${'a'.repeat(40)}`,
              title: 'Source',
              text: 'Expanded evidence',
              contentHash: 'b'.repeat(64),
              offset: 0,
              totalChars: 17,
              nextOffset: null,
              headingPath: [],
              sourceBlockIds: ['block-source']
            }
          ],
          missingCitationIds: [],
          truncated: false
        }
      }
      throw new AgentToolDomainError(
        'invalid_arguments',
        'Readable source labels require corresponding expanded citationIds'
      )
    })
    const service = createService(database, runtime, undefined, {
      tools: { execute } as never,
      log: { ...log, warn } as never
    })
    const session = service.createSession(`Citation recovery ${fixture.state}`)
    const started = await service.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Use the available evidence.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    const active = runtime.active(started.agentRunId)
    await activateToolGroups(active, ['section'])
    await expect(
      active.requestTool({
        type: 'tool_request',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc4b0',
        projectSessionId: active.input.projectSessionId,
        agentSessionId: active.input.agentSessionId,
        agentRunId: active.input.agentRunId,
        toolCallId: `tool-evidence-${fixture.state}`,
        modelRequestId: active.input.modelRequestId,
        toolName: fixture.evidenceTool,
        args: fixture.evidenceArgs
      } as AgentToolRequest)
    ).resolves.toMatchObject({ ok: true })
    const response = await active.requestTool({
      type: 'tool_request',
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc4b1',
      projectSessionId: active.input.projectSessionId,
      agentSessionId: active.input.agentSessionId,
      agentRunId: active.input.agentRunId,
      toolCallId: `tool-section-${fixture.state}`,
      modelRequestId: active.input.modelRequestId,
      toolName: 'submit_section_change',
      args: {
        sectionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc476',
        operations: [
          {
            type: 'insertTextBlocks',
            anchor: null,
            placement: 'end',
            blocks: [{ blockType: 'paragraph', text: 'Body.' }]
          }
        ],
        citationIds: []
      }
    })
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'agent.tool.safe_failure_projected',
        citationRecoveryState: fixture.state
      }),
      'Projected a safe Agent tool failure'
    )
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'invalid_arguments', recovery: fixture.expected }
    })
    active.resolve()
    await started.completion
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
    await activateToolGroups(active, ['image'])
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
        message: expect.stringContaining('Auxiliary model request failed'),
        recovery: { action: 'ask_user' }
      }
    })
    expect(JSON.stringify(response)).not.toContain('read tool')
    expect(service.listEvents(session.agentSessionId).at(-1)?.payload).toMatchObject({
      isError: true,
      error: {
        code: 'unavailable',
        message: expect.stringContaining('Auxiliary model request failed'),
        details: expect.objectContaining({
          message: 'Auxiliary model request failed',
          causes: expect.arrayContaining([
            expect.objectContaining({
              message: 'Safe worker error',
              code: 'INVALID_ARGUMENT',
              httpStatus: 400
            })
          ])
        })
      }
    })
    active.resolve()
    await started.completion
    database.close()
  })
})
