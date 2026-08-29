import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunStart, AgentRuntimeEvent } from '../shared/contracts/agent'
import {
  AgentCurrentTurnTooLargeError,
  boundAgentContextByTokens
} from '../shared/agent-context-budget'
import {
  recoverAuthorizedContinuation,
  runAgentSession,
  type AgentSessionRunControl
} from './agent-session-run'

const request: AgentRunStart = {
  operation: 'run_start',
  requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc411',
  projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc412',
  agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc413',
  agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc414',
  modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc415',
  config: {
    role: 'agent',
    providerId: 'openai-compatible',
    baseUrl: 'https://agent.example.test/v1',
    model: 'writer-model',
    modelRevision: 'writer-r1',
    timeoutMs: 5_000,
    embeddingDimension: null,
    batchLimit: 1,
    fileSizeLimitMb: null
  },
  credential: 'agent-secret',
  systemPrompt: 'You draft prose.',
  history: [
    { role: 'user', content: 'Earlier request', timestamp: 1 },
    {
      role: 'assistant',
      message: {
        content: 'Earlier answer',
        stopReason: 'stop',
        provider: 'openai-compatible',
        model: 'writer-model',
        metadata: {
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            estimatedCostUsdMicros: null
          },
          responseIds: ['earlier-response'],
          retryCount: 0,
          providerModelId: 'writer-model'
        },
        timestamp: 2
      }
    }
  ],
  prompt: 'Write a line.',
  thinkingLevel: 'off',
  maxOutputTokens: 100
}

const reasoningRequest: AgentRunStart = {
  ...request,
  thinkingLevel: 'high',
  runtimeModel: {
    id: 'writer-model',
    name: 'Reasoning Writer',
    api: 'openai-completions',
    provider: 'openai-compatible',
    baseUrl: 'https://agent.example.test/v1',
    reasoning: true,
    thinkingLevelMap: { high: 'high' },
    input: ['text'],
    contextWindow: 131_072,
    maxTokens: 8_192,
    compat: {
      supportsReasoningEffort: true,
      supportsUsageInStreaming: true,
      maxTokensField: 'max_tokens'
    }
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('runAgentSession', () => {
  it('recovers one authorized continuation or fails explicitly when Pi cannot consume it', async () => {
    let pending = 1
    const recoveredLog = vi.fn()
    await expect(
      recoverAuthorizedContinuation({
        awaitingReview: false,
        pendingAuthorizationCount: () => pending,
        continueAgent: async () => {
          pending = 0
        },
        waitForIdle: async () => undefined,
        log: recoveredLog
      })
    ).resolves.toBeUndefined()
    expect(recoveredLog).toHaveBeenCalledWith(
      'info',
      'agent.worker.continuation_recovered',
      expect.any(String),
      { pendingAuthorizationCount: 1 }
    )

    await expect(
      recoverAuthorizedContinuation({
        awaitingReview: false,
        pendingAuthorizationCount: () => 1,
        continueAgent: async () => undefined,
        waitForIdle: async () => undefined
      })
    ).rejects.toMatchObject({ code: 'continuation_lost' })
  })

  it('keeps complete recent turns and rejects an oversized current turn without string truncation', () => {
    const messages = Array.from({ length: 101 }, (_, index) => ({
      role: 'user' as const,
      content: `turn-${index}`,
      timestamp: index
    }))
    const bounded = boundAgentContextByTokens(messages, 4_096)
    expect(bounded).toHaveLength(101)
    expect(bounded[0]).toMatchObject({ content: 'turn-0' })
    expect(bounded.at(-1)).toMatchObject({ content: 'turn-100' })
    expect(() =>
      boundAgentContextByTokens(
        [{ role: 'user', content: '界'.repeat(20_000), timestamp: 1 }],
        4_096
      )
    ).toThrow(AgentCurrentTurnTooLargeError)
  })

  it('keeps the Thinking snapshot across retry, steer, and follow-up calls', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    const bodies: unknown[] = []
    let fetchAttempt = 0
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      fetchAttempt += 1
      bodies.push(JSON.parse(String(init?.body)))
      if (fetchAttempt === 1) {
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve
        })
      }
      return completionResponse(`answer-${fetchAttempt - 1}`, `response-${fetchAttempt - 1}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: AgentRuntimeEvent[] = []
    let control: AgentSessionRunControl | undefined
    const running = runAgentSession(
      reasoningRequest,
      (event) => {
        events.push(event)
        if (event.type === 'follow_up_consumption_requested') {
          control?.authorizeFollowUpConsumption({
            operation: 'authorize_follow_up_consumption',
            requestId: request.requestId,
            projectSessionId: request.projectSessionId,
            agentSessionId: request.agentSessionId,
            agentRunId: request.agentRunId,
            consumptionId: event.consumptionId,
            pendingMessageId: event.pendingMessageId,
            modelRequestId: event.modelRequestId
          })
        }
      },
      (value) => {
        control = value
      },
      undefined,
      new FakeMessagePort() as never
    )
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'))
    control?.enqueue({
      operation: 'steer',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId,
      modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc416',
      content: 'Change direction.',
      timestamp: 3,
      systemPrompt: request.systemPrompt
    })
    control?.enqueue({
      operation: 'follow_up',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId,
      pendingMessageId: '019c6a5c-8d34-7a8e-a602-3d37a52dc418',
      modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc417',
      content: 'Now summarize.',
      timestamp: 4,
      systemPrompt: request.systemPrompt
    })
    resolveFirst?.(
      new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '0' }
      })
    )
    await running

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(bodies[0]).toMatchObject({
      messages: [
        { role: 'developer', content: 'You draft prose.' },
        { role: 'user' },
        { role: 'assistant' },
        { role: 'user' }
      ]
    })
    expect(bodies).toHaveLength(4)
    for (const body of bodies) expect(body).toMatchObject({ reasoning_effort: 'high' })
    const finished = events.filter((event) => event.type === 'model_call_finished')
    expect(finished).toHaveLength(3)
    expect(
      finished.map((event) => event.type === 'model_call_finished' && event.modelRequestId)
    ).toEqual([
      request.modelRequestId,
      '019c6a5c-8d34-7a8e-a602-3d37a52dc416',
      '019c6a5c-8d34-7a8e-a602-3d37a52dc417'
    ])
    expect(
      finished.map((event) =>
        event.type === 'model_call_finished' ? event.metadata.retryCount : -1
      )
    ).toEqual([1, 0, 0])
    expect(
      events
        .filter((event) => event.type === 'assistant_message')
        .map((event) => (event.type === 'assistant_message' ? event.message.content : ''))
    ).toEqual(['answer-1', 'answer-2', 'answer-3'])
    expect(JSON.stringify(events)).not.toContain('agent-secret')
  })

  it('deletes and promotes individual Follow-ups and waits for consumption authorization', async () => {
    let resolveFirst: ((response: Response) => void) | undefined
    let fetchCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        fetchCount += 1
        if (fetchCount === 1) {
          return new Promise<Response>((resolve) => {
            resolveFirst = resolve
          })
        }
        return completionResponse(`answer-${fetchCount}`, `response-${fetchCount}`)
      })
    )
    const events: AgentRuntimeEvent[] = []
    let control: AgentSessionRunControl | undefined
    const running = runAgentSession(
      request,
      (event) => events.push(event),
      (value) => {
        control = value
      },
      undefined,
      new FakeMessagePort() as never
    )
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf('function'))
    const followUps = [
      [
        '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
        'First pending.',
        '019c6a5c-8d34-7a8e-a602-3d37a52dc416'
      ],
      [
        '019c6a5c-8d34-7a8e-a602-3d37a52dc422',
        'Delete pending.',
        '019c6a5c-8d34-7a8e-a602-3d37a52dc417'
      ],
      [
        '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
        'Promote pending.',
        '019c6a5c-8d34-7a8e-a602-3d37a52dc418'
      ]
    ] as const
    for (const [pendingMessageId, content, modelRequestId] of followUps) {
      control?.enqueue({
        operation: 'follow_up',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId,
        agentSessionId: request.agentSessionId,
        agentRunId: request.agentRunId,
        pendingMessageId,
        modelRequestId,
        content,
        timestamp: 5,
        systemPrompt: request.systemPrompt
      })
    }
    control?.queueAction({
      operation: 'delete_follow_up',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId,
      actionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc424',
      pendingMessageId: followUps[1][0]
    })
    const reservationId = '019c6a5c-8d34-7a8e-a602-3d37a52dc425'
    control?.queueAction({
      operation: 'reserve_follow_up',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId,
      actionId: reservationId,
      pendingMessageId: followUps[2][0]
    })
    control?.queueAction({
      operation: 'commit_follow_up_steer',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId,
      actionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc426',
      reservationId,
      modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc419',
      systemPrompt: request.systemPrompt
    })

    resolveFirst?.(completionResponse('answer-1', 'response-1'))
    await vi.waitFor(() =>
      expect(events.some((event) => event.type === 'follow_up_consumption_requested')).toBe(true)
    )
    expect(fetchCount).toBe(2)
    const consumption = events.find((event) => event.type === 'follow_up_consumption_requested')
    if (consumption?.type !== 'follow_up_consumption_requested') {
      throw new Error('Expected Follow-up consumption request')
    }
    control?.authorizeFollowUpConsumption({
      operation: 'authorize_follow_up_consumption',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId,
      consumptionId: consumption.consumptionId,
      pendingMessageId: consumption.pendingMessageId,
      modelRequestId: consumption.modelRequestId
    })
    await running

    expect(fetchCount).toBe(3)
    expect(
      events
        .filter((event) => event.type === 'model_call_finished')
        .map((event) => (event.type === 'model_call_finished' ? event.modelRequestId : ''))
    ).toEqual([
      request.modelRequestId,
      '019c6a5c-8d34-7a8e-a602-3d37a52dc419',
      '019c6a5c-8d34-7a8e-a602-3d37a52dc416'
    ])
    expect(
      events
        .filter((event) => event.type === 'queue_action_completed')
        .map((event) => (event.type === 'queue_action_completed' ? event.outcome : ''))
    ).toEqual(['completed', 'completed', 'completed'])
  })

  it('passes the snapshotted Thinking level through Pi without exposing thinking content', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return completionResponse('Visible answer', 'reasoning-response', 'Private chain')
      })
    )
    const events: AgentRuntimeEvent[] = []
    await runAgentSession(
      reasoningRequest,
      (event) => events.push(event),
      () => undefined,
      undefined,
      new FakeMessagePort() as never
    )

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toMatchObject({ reasoning_effort: 'high' })
    expect(events.find((event) => event.type === 'assistant_message')).toMatchObject({
      type: 'assistant_message',
      message: { content: 'Visible answer' }
    })
    expect(JSON.stringify(events)).not.toContain('Private chain')
  })

  it('does not send a reasoning effort when Thinking is off', async () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return completionResponse('Visible answer', 'off-response')
      })
    )

    await runAgentSession(
      request,
      () => undefined,
      () => undefined,
      undefined,
      new FakeMessagePort() as never
    )

    expect(bodies).toHaveLength(1)
    expect(bodies[0]).not.toHaveProperty('reasoning_effort')
  })

  it('executes a bounded read tool and waits for one authorized continuation model call', async () => {
    const bodies: Array<{
      messages?: Array<{ role?: string; content?: unknown }>
      reasoning_effort?: string
    }> = []
    let fetchAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        fetchAttempt += 1
        bodies.push(JSON.parse(String(init?.body)))
        return fetchAttempt === 1
          ? toolCallResponse('tool-search', 'search_knowledge', { query: 'evidence' })
          : completionResponse('Grounded answer', 'response-after-tool')
      })
    )
    const events: AgentRuntimeEvent[] = []
    const { port1, port2 } = createFakeMessageChannel()
    const toolRequests: Array<Record<string, unknown>> = []
    port2.on('message', (event: { data: Record<string, unknown> }) => {
      toolRequests.push(event.data)
      port2.postMessage({
        type: 'tool_response',
        ...responseCapability(event.data),
        ok: true,
        data: {
          mode: 'fts',
          rerankStatus: 'disabled',
          hits: [knowledgeHit()]
        }
      })
    })
    let control: AgentSessionRunControl | undefined
    const continuationModelRequestId = '019c6a5c-8d34-7a8e-a602-3d37a52dc419'
    await runAgentSession(
      reasoningRequest,
      (event) => {
        events.push(event)
        if (event.type === 'model_call_requested') {
          control?.authorizeModelCall({
            operation: 'authorize_model_call',
            requestId: request.requestId,
            projectSessionId: request.projectSessionId,
            agentSessionId: request.agentSessionId,
            agentRunId: request.agentRunId,
            continuationId: event.continuationId,
            modelRequestId: continuationModelRequestId,
            systemPrompt: request.systemPrompt
          })
        }
      },
      (value) => {
        control = value
      },
      undefined,
      port1 as never
    )

    expect(fetchAttempt).toBe(2)
    expect(toolRequests).toHaveLength(1)
    expect(toolRequests[0]).toMatchObject({
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId,
      modelRequestId: request.modelRequestId,
      toolCallId: 'tool-search',
      toolName: 'search_knowledge'
    })
    expect(events.filter((event) => event.type === 'model_call_requested')).toHaveLength(1)
    expect(
      events
        .filter((event) => event.type === 'model_call_finished')
        .map((event) => (event.type === 'model_call_finished' ? event.modelRequestId : ''))
    ).toEqual([request.modelRequestId, continuationModelRequestId])
    expect(JSON.stringify(bodies[1])).toContain('<UNTRUSTED_EXTERNAL')
    expect(bodies.map((body) => body.reasoning_effort)).toEqual(['high', 'high'])
    expect(JSON.stringify(bodies)).not.toContain('agent-secret')
  })

  it('replaces the next-turn tool set after one exclusive capability activation', async () => {
    const bodies: Array<{
      tools?: Array<{
        function?: { name?: string; parameters?: { type?: string; properties?: unknown } }
      }>
    }> = []
    let fetchAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        fetchAttempt += 1
        bodies.push(JSON.parse(String(init?.body)))
        return fetchAttempt === 1
          ? toolCallResponse('tool-activate', 'activate_tool_groups', { groups: ['section'] })
          : completionResponse('Section tools are ready.', 'response-after-activation')
      })
    )
    const { port1, port2 } = createFakeMessageChannel()
    port2.on('message', (event: { data: Record<string, unknown> }) => {
      port2.postMessage({
        type: 'tool_response',
        ...responseCapability(event.data),
        ok: true,
        data: { activated: ['section'], alreadyActive: [], activeGroups: ['section'] }
      })
    })
    let control: AgentSessionRunControl | undefined
    await runAgentSession(
      request,
      (event) => {
        if (event.type !== 'model_call_requested') return
        control?.authorizeModelCall({
          operation: 'authorize_model_call',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          continuationId: event.continuationId,
          modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc41a',
          systemPrompt: request.systemPrompt,
          activeToolGroups: ['section']
        })
      },
      (value) => {
        control = value
      },
      undefined,
      port1 as never
    )

    const toolNames = (body: (typeof bodies)[number]) =>
      body.tools?.map((tool) => tool.function?.name) ?? []
    expect(toolNames(bodies[0] ?? {})).toContain('activate_tool_groups')
    expect(toolNames(bodies[0] ?? {})).not.toContain('submit_section_change')
    expect(toolNames(bodies[1] ?? {})).toContain('submit_section_change')
    expect(toolNames(bodies[1] ?? {})).not.toContain('generate_image')
    for (const body of bodies) {
      for (const tool of body.tools ?? []) {
        expect(tool.function?.parameters?.type).toBe('object')
        expect(tool.function?.parameters?.properties).toEqual(expect.any(Object))
      }
      const readSection = body.tools?.find((tool) => tool.function?.name === 'read_section')
      expect(readSection?.function?.parameters?.properties).toMatchObject({
        sectionId: { type: 'string' },
        view: { type: 'string', enum: ['summary', 'canonical', 'fragment', 'table'] }
      })
    }
  })

  it('removes tools from a finalization authorization and returns a terminal assistant answer', async () => {
    const bodies: Array<Record<string, unknown>> = []
    let fetchAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        fetchAttempt += 1
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return fetchAttempt === 1
          ? toolCallResponse('tool-final', 'search_knowledge', { query: 'final evidence' })
          : completionResponse('Best available final answer', 'response-finalized')
      })
    )
    const { port1, port2 } = createFakeMessageChannel()
    port2.on('message', (event: { data: Record<string, unknown> }) => {
      port2.postMessage({
        type: 'tool_response',
        ...responseCapability(event.data),
        ok: true,
        data: { mode: 'fts', rerankStatus: 'disabled', hits: [knowledgeHit()] }
      })
    })
    const events: AgentRuntimeEvent[] = []
    let control: AgentSessionRunControl | undefined

    await runAgentSession(
      request,
      (event) => {
        events.push(event)
        if (event.type !== 'model_call_requested') return
        control?.authorizeModelCall({
          operation: 'authorize_model_call',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          continuationId: event.continuationId,
          modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc423',
          systemPrompt: 'Return the best result and unfinished items now.',
          finalize: true
        })
      },
      (value) => {
        control = value
      },
      undefined,
      port1 as never
    )

    expect(fetchAttempt).toBe(2)
    expect(bodies[0]?.tools).toBeDefined()
    expect(bodies[1]?.tools).toEqual([])
    expect(JSON.stringify(bodies[1]?.messages)).toContain('final evidence')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'assistant_message',
        message: expect.objectContaining({ content: 'Best available final answer' })
      })
    )
  })

  it('uses one Pi tool-loop turn to recover an oversized active read with a smaller read', async () => {
    const bodies: unknown[] = []
    let fetchAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        fetchAttempt += 1
        const body = JSON.parse(String(init?.body))
        bodies.push(body)
        if (fetchAttempt === 1) {
          return toolCallResponse('read-rq3-large', 'read_section', {
            sectionId: request.agentSessionId,
            limit: 20
          })
        }
        if (fetchAttempt === 2) {
          return toolCallResponse('read-rq3-small', 'read_section', {
            sectionId: request.agentSessionId,
            limit: 5
          })
        }
        return completionResponse('RQ3 continued safely', 'response-after-smaller-read')
      })
    )
    const { port1, port2 } = createFakeMessageChannel()
    let toolCount = 0
    port2.on('message', (event: { data: Record<string, unknown> }) => {
      toolCount += 1
      port2.postMessage({
        type: 'tool_response',
        ...responseCapability(event.data),
        ok: true,
        data: sectionReadResult(
          toolCount === 1 ? 'oversized RQ3 body '.repeat(2_000) : 'bounded RQ3 body'
        )
      })
    })
    const events: AgentRuntimeEvent[] = []
    const logs: string[] = []
    let control: AgentSessionRunControl | undefined
    let authorizationIndex = 0
    const modelRequestIds = [
      '019c6a5c-8d34-7a8e-a602-3d37a52dc416',
      '019c6a5c-8d34-7a8e-a602-3d37a52dc417'
    ]
    await runAgentSession(
      {
        ...request,
        modelLimits: {
          contextWindowTokens: 21_000,
          inputLimitTokens: null,
          outputLimitTokens: 100,
          source: 'manual_override',
          catalogModelKey: null,
          resolvedAt: null
        }
      },
      (event) => {
        events.push(event)
        if (event.type !== 'model_call_requested') return
        const modelRequestId = modelRequestIds[authorizationIndex]
        authorizationIndex += 1
        if (modelRequestId === undefined) throw new Error('Unexpected model authorization')
        control?.authorizeModelCall({
          operation: 'authorize_model_call',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          continuationId: event.continuationId,
          modelRequestId,
          systemPrompt: request.systemPrompt
        })
      },
      (value) => {
        control = value
      },
      undefined,
      port1 as never,
      (_level, event) => logs.push(event)
    )

    expect(fetchAttempt).toBe(3)
    expect(events.filter((event) => event.type === 'tool_preflight_failed')).toEqual([])
    expect(toolCount).toBe(2)
    expect(JSON.stringify(bodies[1])).toContain('active_batch_retry')
    expect(JSON.stringify(bodies[1])).toContain('maxConcurrentBodyReads')
    expect(JSON.stringify(bodies[1])).not.toContain('oversized RQ3 body')
    expect(JSON.stringify(bodies[2])).toContain('bounded RQ3 body')
    expect(JSON.stringify(bodies[2])).toContain('block-rq3')
    expect(JSON.stringify(bodies[2])).toContain('b'.repeat(64))
    expect(logs).toEqual([
      'agent.context.active_batch_retry',
      'agent.context.active_batch_recovered'
    ])
    expect(events.filter((event) => event.type === 'model_call_requested')).toHaveLength(2)
  })

  it('fails before a third provider call when the smaller active read is still oversized', async () => {
    let fetchAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        fetchAttempt += 1
        return toolCallResponse(
          fetchAttempt === 1 ? 'read-large-first' : 'read-large-second',
          'read_section',
          { sectionId: request.agentSessionId, limit: fetchAttempt === 1 ? 20 : 5 }
        )
      })
    )
    const { port1, port2 } = createFakeMessageChannel()
    port2.on('message', (event: { data: Record<string, unknown> }) => {
      port2.postMessage({
        type: 'tool_response',
        ...responseCapability(event.data),
        ok: true,
        data: sectionReadResult('still oversized '.repeat(2_000))
      })
    })
    let control: AgentSessionRunControl | undefined
    let authorizationIndex = 0
    const modelRequestIds = [
      '019c6a5c-8d34-7a8e-a602-3d37a52dc416',
      '019c6a5c-8d34-7a8e-a602-3d37a52dc417'
    ]
    const running = runAgentSession(
      {
        ...request,
        modelLimits: {
          contextWindowTokens: 21_000,
          inputLimitTokens: null,
          outputLimitTokens: 100,
          source: 'manual_override',
          catalogModelKey: null,
          resolvedAt: null
        }
      },
      (event) => {
        if (event.type !== 'model_call_requested') return
        const modelRequestId = modelRequestIds[authorizationIndex]
        authorizationIndex += 1
        if (modelRequestId === undefined) throw new Error('Unexpected model authorization')
        control?.authorizeModelCall({
          operation: 'authorize_model_call',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          continuationId: event.continuationId,
          modelRequestId,
          systemPrompt: request.systemPrompt
        })
      },
      (value) => {
        control = value
      },
      undefined,
      port1 as never
    )

    await expect(running).rejects.toMatchObject({
      code: 'tool_batch_context_exhausted'
    })
    expect(fetchAttempt).toBe(2)
  })

  it('projects a safe preflight diagnostic and continues the turn after invalid arguments', async () => {
    let fetchAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        fetchAttempt += 1
        return fetchAttempt === 1
          ? toolCallResponse('tool-invalid', 'search_knowledge', {
              query: 'PRIVATE_ARGUMENT_VALUE',
              limit: 'not-a-number'
            })
          : completionResponse('Recovered answer', 'response-after-invalid-tool')
      })
    )
    const events: AgentRuntimeEvent[] = []
    const { port1, port2 } = createFakeMessageChannel()
    const toolRequests: unknown[] = []
    port2.on('message', (event: { data: unknown }) => toolRequests.push(event.data))
    let control: AgentSessionRunControl | undefined
    await runAgentSession(
      request,
      (event) => {
        events.push(event)
        if (event.type === 'model_call_requested') {
          control?.authorizeModelCall({
            operation: 'authorize_model_call',
            requestId: request.requestId,
            projectSessionId: request.projectSessionId,
            agentSessionId: request.agentSessionId,
            agentRunId: request.agentRunId,
            continuationId: event.continuationId,
            modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc499',
            systemPrompt: request.systemPrompt
          })
        }
      },
      (value) => {
        control = value
      },
      undefined,
      port1 as never
    )

    expect(fetchAttempt).toBe(2)
    expect(toolRequests).toEqual([])
    const failure = events.find((event) => event.type === 'tool_preflight_failed')
    expect(failure).toMatchObject({
      type: 'tool_preflight_failed',
      requestedToolName: 'search_knowledge',
      phase: 'pre_dispatch',
      diagnostic: {
        code: 'invalid_arguments',
        paths: expect.arrayContaining(['/limit'])
      }
    })
    expect(JSON.stringify(failure)).not.toContain('PRIVATE_ARGUMENT_VALUE')
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'assistant_message',
        message: expect.objectContaining({ content: 'Recovered answer' })
      })
    )
  })

  it('blocks Writing Skill preparation mixed with non-Skill tools in one response', async () => {
    let fetchAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        fetchAttempt += 1
        return fetchAttempt === 1
          ? toolCallsResponse([
              {
                id: 'tool-skill',
                name: 'read_writing_skill',
                args: {
                  uri: `writellm://skills/nature-writing/${'a'.repeat(40)}/SKILL.md`
                }
              },
              { id: 'tool-search', name: 'search_knowledge', args: { query: 'evidence' } }
            ])
          : completionResponse('Recovered after preparation.', 'response-after-mixed-tools')
      })
    )
    const events: AgentRuntimeEvent[] = []
    const { port1, port2 } = createFakeMessageChannel()
    const toolRequests: unknown[] = []
    port2.on('message', (event: { data: unknown }) => toolRequests.push(event.data))
    let control: AgentSessionRunControl | undefined
    await runAgentSession(
      request,
      (event) => {
        events.push(event)
        if (event.type === 'model_call_requested') {
          control?.authorizeModelCall({
            operation: 'authorize_model_call',
            requestId: request.requestId,
            projectSessionId: request.projectSessionId,
            agentSessionId: request.agentSessionId,
            agentRunId: request.agentRunId,
            continuationId: event.continuationId,
            modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc498',
            systemPrompt: request.systemPrompt
          })
        }
      },
      (value) => {
        control = value
      },
      undefined,
      port1 as never
    )

    expect(fetchAttempt).toBe(2)
    expect(toolRequests).toEqual([])
    expect(events.filter((event) => event.type === 'tool_preflight_failed')).toHaveLength(2)
  })

  it.each(['ask_user', 'activate_tool_groups'] as const)(
    'requires %s to be the only tool in its assistant response',
    async (toolName) => {
      let fetchAttempt = 0
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async () => {
          fetchAttempt += 1
          return fetchAttempt === 1
            ? toolCallsResponse([
                {
                  id: 'tool-question',
                  name: toolName,
                  args:
                    toolName === 'activate_tool_groups'
                      ? { groups: ['section'] }
                      : {
                          questions: [
                            {
                              id: 'scope',
                              header: 'Scope',
                              question: 'Which scope should be used?',
                              options: [
                                {
                                  label: 'Section (Recommended)',
                                  description: 'Limit the revision.'
                                },
                                { label: 'Document', description: 'Revise the full manuscript.' }
                              ]
                            }
                          ]
                        }
                },
                { id: 'tool-search', name: 'search_knowledge', args: { query: 'evidence' } }
              ])
            : completionResponse('Recovered after isolated question.', 'response-after-question')
        })
      )
      const events: AgentRuntimeEvent[] = []
      const { port1, port2 } = createFakeMessageChannel()
      const toolRequests: unknown[] = []
      port2.on('message', (event: { data: unknown }) => toolRequests.push(event.data))
      let control: AgentSessionRunControl | undefined
      await runAgentSession(
        request,
        (event) => {
          events.push(event)
          if (event.type === 'model_call_requested') {
            control?.authorizeModelCall({
              operation: 'authorize_model_call',
              requestId: request.requestId,
              projectSessionId: request.projectSessionId,
              agentSessionId: request.agentSessionId,
              agentRunId: request.agentRunId,
              continuationId: event.continuationId,
              modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc497',
              systemPrompt: request.systemPrompt
            })
          }
        },
        (value) => {
          control = value
        },
        undefined,
        port1 as never
      )

      expect(fetchAttempt).toBe(2)
      expect(toolRequests).toEqual([])
      expect(events.filter((event) => event.type === 'tool_preflight_failed')).toHaveLength(2)
    }
  )

  it('ends at a manual-review barrier without requesting a continuation model call', async () => {
    let fetchAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        fetchAttempt += 1
        return toolCallResponse('tool-proposal', 'submit_brief_change', {
          changes: { title: 'Revised title' },
          citationIds: []
        })
      })
    )
    const events: AgentRuntimeEvent[] = []
    const { port1, port2 } = createFakeMessageChannel()
    port2.on('message', (event: { data: Record<string, unknown> }) => {
      port2.postMessage({
        type: 'tool_response',
        ...responseCapability(event.data),
        ok: true,
        data: {
          proposal: {
            proposalId: '019c6a5c-8d34-7a8e-a602-3d37a52dc418',
            kind: 'brief_update',
            status: 'pending'
          },
          application: { status: 'not_applied' },
          continuation: 'pause_for_review',
          warnings: []
        }
      })
    })

    const result = await runAgentSession(
      { ...request, activeToolGroups: ['brief'] },
      (event) => events.push(event),
      () => undefined,
      undefined,
      port1 as never
    )

    expect(result).toEqual({ outcome: 'awaiting_review' })
    expect(fetchAttempt).toBe(1)
    expect(events.filter((event) => event.type === 'model_call_requested')).toEqual([])
  })

  it('does not count tool execution against the legacy provider timeout', async () => {
    const shortRequest = {
      ...request,
      config: { ...request.config, timeoutMs: 50 }
    }
    let fetchAttempt = 0
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        fetchAttempt += 1
        return fetchAttempt === 1
          ? toolCallResponse('tool-slow', 'search_knowledge', { query: 'evidence' })
          : completionResponse('Completed after the tool.', 'response-after-slow-tool')
      })
    )
    const { port1, port2 } = createFakeMessageChannel()
    port2.on('message', (event: { data: Record<string, unknown> }) => {
      setTimeout(() => {
        port2.postMessage({
          type: 'tool_response',
          ...responseCapability(event.data),
          ok: true,
          data: {
            mode: 'fts',
            rerankStatus: 'disabled',
            hits: [knowledgeHit()]
          }
        })
      }, 75)
    })
    const events: AgentRuntimeEvent[] = []
    let control: AgentSessionRunControl | undefined
    await runAgentSession(
      shortRequest,
      (event) => {
        events.push(event)
        if (event.type === 'model_call_requested') {
          control?.authorizeModelCall({
            operation: 'authorize_model_call',
            requestId: shortRequest.requestId,
            projectSessionId: shortRequest.projectSessionId,
            agentSessionId: shortRequest.agentSessionId,
            agentRunId: shortRequest.agentRunId,
            continuationId: event.continuationId,
            modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc422',
            systemPrompt: shortRequest.systemPrompt
          })
        }
      },
      (value) => {
        control = value
      },
      undefined,
      port1 as never
    )

    expect(fetchAttempt).toBe(2)
    expect(
      events
        .filter((event) => event.type === 'model_call_finished')
        .map((event) => (event.type === 'model_call_finished' ? event.outcome : ''))
    ).toEqual(['succeeded', 'succeeded'])
  })

  it('continues beyond the legacy provider timeout and still honors an external stop', async () => {
    const shortRequest = {
      ...request,
      config: { ...request.config, timeoutMs: 40 }
    }
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async () =>
          new Promise<Response>((resolve) => {
            setTimeout(() => resolve(completionResponse('Slow success', 'slow-response')), 75)
          })
      )
    )
    const slowEvents: AgentRuntimeEvent[] = []
    await expect(
      runAgentSession(
        shortRequest,
        (event) => slowEvents.push(event),
        () => undefined,
        undefined,
        new FakeMessagePort() as never
      )
    ).resolves.toEqual({ outcome: 'finished' })
    expect(slowEvents).toContainEqual(
      expect.objectContaining({ type: 'model_call_finished', outcome: 'succeeded' })
    )
    expect(slowEvents).not.toContainEqual(
      expect.objectContaining({ type: 'model_call_finished', outcome: 'timed_out' })
    )

    const stopController = new AbortController()
    const stopEvents: AgentRuntimeEvent[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(
        async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const onAbort = () => {
              const error = new Error('request aborted')
              error.name = 'AbortError'
              reject(error)
            }
            init?.signal?.addEventListener('abort', onAbort, { once: true })
          })
      )
    )
    const stopping = runAgentSession(
      request,
      (event) => stopEvents.push(event),
      () => undefined,
      stopController.signal,
      new FakeMessagePort() as never
    )
    await new Promise((resolve) => setTimeout(resolve, 5))
    stopController.abort()
    await expect(stopping).rejects.toMatchObject({ name: 'AbortError' })
    expect(stopEvents).not.toContainEqual(
      expect.objectContaining({ type: 'model_call_finished', outcome: 'timed_out' })
    )
  })

  it('preserves a real provider context overflow as a safe machine-readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'context_length_exceeded',
                message: 'Maximum context length exceeded for this model'
              }
            }),
            { status: 400, headers: { 'content-type': 'application/json' } }
          )
        )
      )
    )
    const events: AgentRuntimeEvent[] = []

    let error: unknown
    try {
      await runAgentSession(
        request,
        (event) => events.push(event),
        () => undefined,
        undefined,
        new FakeMessagePort() as never
      )
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe('Agent provider context window exceeded')
    expect((error as Error & { code?: string }).code).toBe('context_overflow')
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'model_call_finished', outcome: 'failed' })
    )
  })

  it('makes at most five logical attempts for transient provider failures', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const events: AgentRuntimeEvent[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        attempts += 1
        return new Response(JSON.stringify({ error: { message: 'service unavailable' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' }
        })
      })
    )

    const running = runAgentSession(
      request,
      (event) => events.push(event),
      () => undefined,
      undefined,
      new FakeMessagePort() as never
    )
    const rejected = expect(running).rejects.toMatchObject({
      name: 'ProviderRetriesExhaustedError'
    })
    await vi.waitFor(() => expect(attempts).toBe(1))
    for (const [delayMs, expectedAttempts] of [
      [1_000, 2],
      [2_000, 3],
      [4_000, 4],
      [8_000, 5]
    ] as const) {
      await vi.advanceTimersByTimeAsync(delayMs)
      await vi.waitFor(() => expect(attempts).toBe(expectedAttempts))
    }
    await rejected
    expect(attempts).toBe(5)
    expect(events.filter((event) => event.type === 'model_call_retrying')).toHaveLength(4)
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'model_call_finished',
        outcome: 'failed',
        failureCode: 'provider_retries_exhausted',
        retryable: true,
        metadata: expect.objectContaining({ retryCount: 4 })
      })
    )
  })
})

class FakeMessagePort extends EventEmitter {
  peer: FakeMessagePort | undefined
  readonly start = vi.fn()
  readonly close = vi.fn(() => this.emit('close'))
  readonly postMessage = vi.fn((data: unknown) => {
    queueMicrotask(() => this.peer?.emit('message', { data }))
  })
}

function createFakeMessageChannel(): { port1: FakeMessagePort; port2: FakeMessagePort } {
  const port1 = new FakeMessagePort()
  const port2 = new FakeMessagePort()
  port1.peer = port2
  port2.peer = port1
  return { port1, port2 }
}

function completionResponse(text: string, responseId: string, reasoning?: string): Response {
  const chunks = [
    `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            content: text,
            ...(reasoning === undefined ? {} : { reasoning_content: reasoning })
          },
          finish_reason: null
        }
      ]
    })}\n\n`,
    `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }
    })}\n\n`,
    'data: [DONE]\n\n'
  ]
  return new Response(chunks.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'x-request-id': responseId }
  })
}

function toolCallResponse(
  toolCallId: string,
  name: string,
  args: Record<string, unknown>
): Response {
  const chunks = [
    `data: ${JSON.stringify({
      id: 'response-tool-call',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: toolCallId,
                type: 'function',
                function: { name, arguments: JSON.stringify(args) }
              }
            ]
          },
          finish_reason: null
        }
      ]
    })}\n\n`,
    `data: ${JSON.stringify({
      id: 'response-tool-call',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }
    })}\n\n`,
    'data: [DONE]\n\n'
  ]
  return new Response(chunks.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'response-tool-call' }
  })
}

function toolCallsResponse(
  calls: Array<{ id: string; name: string; args: Record<string, unknown> }>
): Response {
  const chunks = [
    `data: ${JSON.stringify({
      id: 'response-tool-calls',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [
        {
          index: 0,
          delta: {
            role: 'assistant',
            tool_calls: calls.map((call, index) => ({
              index,
              id: call.id,
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.args) }
            }))
          },
          finish_reason: null
        }
      ]
    })}\n\n`,
    `data: ${JSON.stringify({
      id: 'response-tool-calls',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }
    })}\n\n`,
    'data: [DONE]\n\n'
  ]
  return new Response(chunks.join(''), {
    status: 200,
    headers: { 'content-type': 'text/event-stream', 'x-request-id': 'response-tool-calls' }
  })
}

function knowledgeHit() {
  return {
    citationId: 'citation-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    knowledgeItemId: '019c6a5c-8d34-7a8e-a602-3d37a52dc420',
    parseRevisionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc421',
    chunkId: 'chunk-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    title: 'Source',
    snippet: 'Evidence',
    headingPath: [],
    sourceBlockIds: ['source-block']
  }
}

function sectionReadResult(text: string) {
  const chunks = text.match(/[\s\S]{1,8000}/gu) ?? ['']
  return {
    section: {
      sectionId: request.agentSessionId,
      parentSectionId: null,
      position: 0,
      level: 1,
      title: 'RQ3',
      objective: null,
      status: 'drafting',
      currentRevisionId: request.modelRequestId,
      wordCount: 10,
      characterCount: text.length
    },
    revisionId: request.modelRequestId,
    blocks: chunks.map((chunk, index) => ({
      blockId: index === 0 ? 'block-rq3' : `block-rq3-${index}`,
      blockType: 'paragraph',
      parentBlockId: null,
      depth: 0,
      ordinal: index,
      text: chunk,
      textTruncated: false,
      blockHash: 'b'.repeat(64),
      childBlockIds: [],
      hasRichContent: false
    })),
    canonicalBlock: null,
    canonicalFragment: null,
    fragmentOffset: null,
    nextFragmentOffset: null,
    missingBlockIds: [],
    nextCursor: null,
    totalBlocks: chunks.length
  }
}

function responseCapability(request: Record<string, unknown>) {
  return {
    schemaVersion: 2,
    requestId: request.requestId,
    projectSessionId: request.projectSessionId,
    agentSessionId: request.agentSessionId,
    agentRunId: request.agentRunId,
    toolCallId: request.toolCallId,
    modelRequestId: request.modelRequestId,
    toolName: request.toolName
  }
}
