import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRuntimeEvent } from '../../shared/contracts/agent'
import type { AgentToolRequest, AgentToolResponse } from '../../shared/contracts/agent-tools'
import type { ProviderConfig } from '../../shared/contracts/providers'
import type {
  AgentSessionRunHandle,
  AgentSessionRunInput,
  AgentSessionRuntime
} from '../providers/gateways'
import { ModelRequestRepository } from '../providers/model-request-repository'
import { initializeProjectDatabase, type ProjectDatabase } from '../project/project-database'
import { AgentSessionService, type AgentSessionServiceOptions } from './session-service'

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
    const session = service.createSession('Provider selection', undefined, {
      presetId: 'builtin:anthropic',
      modelId: 'claude-writer'
    })
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
    expect(() =>
      service.setModelSelection(session.agentSessionId, {
        presetId: 'builtin:openai',
        modelId: 'gpt-writer'
      })
    ).toThrow('active')

    runtime.active().resolve()
    await started.completion
    const runs = service.listRuns(session.agentSessionId, 10)
    expect(runs[0]).toMatchObject({
      providerPresetId: 'builtin:anthropic',
      providerId: 'anthropic',
      providerLabel: 'Anthropic',
      modelId: 'claude-writer',
      modelLabel: 'Claude Writer',
      api: 'anthropic-messages'
    })
    expect(JSON.stringify(runs)).not.toContain('anthropic-secret')
    expect(resolve).toHaveBeenCalledWith({
      presetId: 'builtin:anthropic',
      modelId: 'claude-writer'
    })
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
    const session = first.createSession()
    const started = await first.startRun({
      agentSessionId: session.agentSessionId,
      prompt: 'Draft.',
      editorContext: { activeSectionId: null, activeBlockId: null, selectedBlockIds: [] }
    })
    expect(started.agentRunId).toBeTypeOf('string')

    const relaunched = createService(database, new FakeAgentRuntime())
    expect(relaunched.recoverInterruptedRuns()).toBe(1)
    expect(
      await database.kysely.selectFrom('agent_runs').select('status').executeTakeFirstOrThrow()
    ).toEqual({ status: 'interrupted' })
    expect(relaunched.listEvents(session.agentSessionId).at(-1)?.type).toBe('run_interrupted')
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
          'Image provider rejected the generation request (HTTP 400 / INVALID_ARGUMENT); verify the image API key, model access, and provider settings',
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
    ['section_auto', 'outline_patch', true, false],
    ['manual', 'section_patch', true, false],
    ['section_auto', 'section_patch', false, true],
    ['yolo', 'brief_update', true, false]
  ] as const)('enforces approval mode %s for %s proposals', async (mode, kind, blocks, autoApproves) => {
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
  })

  it('creates one recorded raw-event compaction summary only under token pressure', async () => {
    const database = await createDatabase()
    const runtime = new FakeAgentRuntime()
    const summarizeHistory = vi.fn(
      async (input: Parameters<NonNullable<AgentSessionServiceOptions['summarizeHistory']>>[0]) => {
        const repository = new ModelRequestRepository(database, log)
        const request = await repository.start({
          operation: 'agent',
          provider: config,
          request: { purpose: 'compaction', coveredThroughSequence: input.coveredThroughSequence },
          inputItems: 1,
          operationId: 'compaction-operation',
          agentRunId: input.agentRunId,
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
    const service = createService(database, runtime, undefined, {
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
    expect(summarizeHistory.mock.calls[0]?.[0].sourceText).toContain('USER: 界')
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
      payload: { coveredThroughSequence: 2 }
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
})

interface FakeActiveRun {
  config: ProviderConfig
  credential: string
  input: AgentSessionRunInput
  commands: Array<{ operation: 'steer' | 'follow_up'; modelRequestId: string }>
  authorizations: Array<{ continuationId: string; modelRequestId: string }>
  requestTool: (request: AgentToolRequest) => Promise<AgentToolResponse>
  emit: (event: AgentRuntimeEvent) => Promise<void>
  resolve: (outcome?: 'finished' | 'awaiting_review') => void
  reject: (error: Error) => void
}

class FakeAgentRuntime implements AgentSessionRuntime {
  #active: FakeActiveRun | undefined

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
    const commands: Array<{ operation: 'steer' | 'follow_up'; modelRequestId: string }> = []
    const authorizations: Array<{ continuationId: string; modelRequestId: string }> = []
    this.#active = {
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
    return {
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc431',
      completion,
      steer: (command) =>
        commands.push({ operation: 'steer', modelRequestId: command.modelRequestId }),
      followUp: (command) =>
        commands.push({ operation: 'follow_up', modelRequestId: command.modelRequestId }),
      authorizeModelCall: (command) =>
        authorizations.push({
          continuationId: command.continuationId,
          modelRequestId: command.modelRequestId
        })
    }
  }

  active(): FakeActiveRun {
    if (this.#active === undefined) throw new Error('No fake Agent run is active')
    return this.#active
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
      | 'tools'
      | 'summarizeHistory'
      | 'messageTokenBudget'
      | 'publishDelta'
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
