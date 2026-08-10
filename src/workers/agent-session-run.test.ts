import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunStart, AgentRuntimeEvent } from '../shared/contracts/agent'
import { boundAgentContextByTokens, estimateAgentTokens } from '../shared/agent-context-budget'
import { runAgentSession, type AgentSessionRunControl } from './agent-session-run'

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
  it('keeps complete recent turns and safely truncates an oversized current turn', () => {
    const messages = Array.from({ length: 101 }, (_, index) => ({
      role: 'user' as const,
      content: `turn-${index}`,
      timestamp: index
    }))
    const bounded = boundAgentContextByTokens(messages, 4_096)
    expect(bounded).toHaveLength(101)
    expect(bounded[0]).toMatchObject({ content: 'turn-0' })
    expect(bounded.at(-1)).toMatchObject({ content: 'turn-100' })
    const oversized = boundAgentContextByTokens(
      [{ role: 'user', content: '界'.repeat(20_000), timestamp: 1 }],
      4_096
    )
    expect(estimateAgentTokens(oversized)).toBeLessThanOrEqual(4_096)
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
      (event) => events.push(event),
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
      request,
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
