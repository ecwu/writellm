import { EventEmitter } from 'node:events'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { AgentModelClient } from './agent-model-client'

const config: ProviderConfig = {
  role: 'agent',
  providerId: 'openai-compatible',
  baseUrl: 'https://agent.example.test/v1',
  model: 'writer',
  modelRevision: 'writer-rev-1',
  timeoutMs: 30_000,
  embeddingDimension: null,
  batchLimit: 1,
  fileSizeLimitMb: null
}

class FakeUtilityProcess extends EventEmitter {
  readonly kill = vi.fn(() => true)
  readonly postMessage = vi.fn((request: { requestId: string }) => {
    queueMicrotask(() => {
      this.emit('message', {
        type: 'text-delta',
        requestId: request.requestId,
        delta: 'draft'
      })
      this.emit('message', {
        type: 'result',
        requestId: request.requestId,
        result: {
          text: 'draft',
          stopReason: 'stop',
          metadata: {
            usage: {
              inputTokens: 1,
              outputTokens: 1,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              estimatedCostUsdMicros: null
            },
            responseIds: ['response-1'],
            retryCount: 0,
            providerModelId: 'writer'
          }
        }
      })
    })
  })
}

describe('AgentModelClient', () => {
  it('streams bounded events and resolves a utility-process result without returning credentials', async () => {
    const child = new FakeUtilityProcess()
    const factory = { fork: vi.fn(() => child) }
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      factory as never
    )
    const events: string[] = []
    const result = await client.run(
      config,
      'process-secret',
      { systemPrompt: 'system', prompt: 'prompt', maxOutputTokens: 100 },
      new AbortController().signal,
      (event) => events.push(event.delta)
    )

    expect(events).toEqual(['draft'])
    expect(result.text).toBe('draft')
    expect(JSON.stringify(result)).not.toContain('process-secret')
    expect(child.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ config, credential: { apiKey: 'process-secret' } })
    )
    await client.run(
      config,
      'process-secret',
      { systemPrompt: 'system', prompt: 'second', maxOutputTokens: 100 },
      new AbortController().signal,
      () => undefined
    )
    expect(factory.fork).toHaveBeenCalledOnce()
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('kills and rejects a running utility process when its capability is revoked', async () => {
    const child = new FakeUtilityProcess()
    child.postMessage.mockImplementation(() => undefined)
    const client = new AgentModelClient('/private/agent-model.js', pino({ level: 'silent' }), {
      fork: () => child
    } as never)
    const controller = new AbortController()
    const pending = client.run(
      config,
      'process-secret',
      { systemPrompt: '', prompt: 'prompt', maxOutputTokens: 100 },
      controller.signal,
      () => undefined
    )
    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('validates session capabilities and settles only after durable event handling', async () => {
    const child = new SessionUtilityProcess()
    const channel = createFakeMessageChannel()
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      {
        fork: () => child
      } as never,
      undefined,
      () => channel as never
    )
    const delivered: string[] = []
    const controller = new AbortController()
    const handle = client.beginSessionRun(
      config,
      'process-secret',
      {
        projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc441',
        agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc442',
        agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc443',
        modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc444',
        systemPrompt: 'system',
        history: [],
        prompt: 'prompt',
        maxOutputTokens: 100
      },
      controller.signal,
      async (event) => {
        await Promise.resolve()
        delivered.push(event.type)
      }
    )
    await handle.completion
    expect(delivered).toEqual(['assistant_delta'])
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('preserves the safe context-overflow code across the Worker boundary', async () => {
    const child = new OverflowSessionUtilityProcess()
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never,
      undefined,
      () => createFakeMessageChannel() as never
    )
    const handle = client.beginSessionRun(
      config,
      'process-secret',
      sessionInput(),
      new AbortController().signal,
      () => undefined
    )

    await expect(handle.completion).rejects.toMatchObject({
      code: 'context_overflow',
      status: 400,
      message: 'Agent provider context window exceeded'
    })
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('keeps three session runs isolated in one worker and cancels only the targeted run', async () => {
    const child = new ControlledSessionUtilityProcess()
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never,
      undefined,
      () => createFakeMessageChannel() as never
    )
    const controllers = [new AbortController(), new AbortController(), new AbortController()]
    const inputs = [
      sessionInput(),
      {
        ...sessionInput(),
        agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc445',
        agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc446',
        modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc447'
      },
      {
        ...sessionInput(),
        agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc448',
        agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc449',
        modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc450'
      }
    ]
    const handles = inputs.map((input, index) =>
      client.beginSessionRun(
        config,
        'process-secret',
        input,
        controllers[index]?.signal ?? new AbortController().signal,
        () => undefined
      )
    )

    await vi.waitFor(() => expect(child.runs).toHaveLength(3))
    controllers[1]?.abort()
    await expect(handles[1]?.completion).rejects.toMatchObject({ name: 'AbortError' })
    child.complete(inputs[0].agentRunId)
    child.complete(inputs[2].agentRunId)
    await expect(handles[0]?.completion).resolves.toMatchObject({ outcome: 'finished' })
    await expect(handles[2]?.completion).resolves.toMatchObject({ outcome: 'finished' })
    expect(child.cancelledRunIds).toEqual([inputs[1].agentRunId])
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('settles a capability-bound queue action only after the worker acknowledgement', async () => {
    const child = new ControlledSessionUtilityProcess()
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never,
      undefined,
      () => createFakeMessageChannel() as never
    )
    const input = sessionInput()
    const handle = client.beginSessionRun(
      config,
      'process-secret',
      input,
      new AbortController().signal,
      () => undefined
    )
    const actionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc461'
    const outcome = handle.queueAction({
      operation: 'delete_follow_up',
      actionId,
      projectSessionId: input.projectSessionId,
      agentSessionId: input.agentSessionId,
      agentRunId: input.agentRunId,
      pendingMessageId: '019c6a5c-8d34-7a8e-a602-3d37a52dc462'
    })

    await vi.waitFor(() => expect(child.queueActions).toHaveLength(1))
    let settled = false
    void outcome.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    child.acknowledgeQueueAction(actionId, 'completed')
    await expect(outcome).resolves.toBe('completed')
    child.complete(input.agentRunId)
    await expect(handle.completion).resolves.toMatchObject({ outcome: 'finished' })
  })

  it('rejects every active session run when the shared worker exits', async () => {
    const child = new ControlledSessionUtilityProcess()
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never,
      undefined,
      () => createFakeMessageChannel() as never
    )
    const handles = [
      sessionInput(),
      {
        ...sessionInput(),
        agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc455',
        agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc456',
        modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc457'
      }
    ].map((input) =>
      client.beginSessionRun(
        config,
        'process-secret',
        input,
        new AbortController().signal,
        () => undefined
      )
    )

    await vi.waitFor(() => expect(child.runs).toHaveLength(2))
    child.emit('exit', 1)

    await Promise.all(
      handles.map((handle) =>
        expect(handle.completion).rejects.toThrow('exited before responding (1)')
      )
    )
  })

  it('routes a capability-bound tool request over the dedicated transferred port', async () => {
    const child = new ToolBridgeUtilityProcess()
    const channel = createFakeMessageChannel()
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never,
      undefined,
      () => channel as never
    )
    const handled: Array<Record<string, unknown>> = []
    const handle = client.beginSessionRun(
      config,
      'process-secret',
      sessionInput(),
      new AbortController().signal,
      () => undefined,
      async (request) => {
        handled.push(request)
        if (request.toolName !== 'search_knowledge') {
          throw new Error('Expected a search_knowledge request')
        }
        return {
          schemaVersion: 2,
          type: 'tool_response',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          toolCallId: request.toolCallId,
          modelRequestId: request.modelRequestId,
          toolName: request.toolName,
          ok: true,
          data: { mode: 'none', rerankStatus: 'disabled', hits: [] }
        }
      }
    )
    await handle.completion

    expect(handled).toHaveLength(1)
    expect(handled[0]).toMatchObject({
      projectSessionId: sessionInput().projectSessionId,
      agentSessionId: sessionInput().agentSessionId,
      agentRunId: sessionInput().agentRunId,
      toolName: 'search_knowledge'
    })
    expect(child.toolResponse).toMatchObject({ type: 'tool_response', ok: true })
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('terminates the worker when a tool-bridge message uses a stale project capability', async () => {
    const child = new ToolBridgeUtilityProcess(true)
    const channel = createFakeMessageChannel()
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never,
      undefined,
      () => channel as never
    )
    const handle = client.beginSessionRun(
      config,
      'process-secret',
      sessionInput(),
      new AbortController().signal,
      () => undefined,
      async () => {
        throw new Error('A stale request must not reach the handler')
      }
    )

    await expect(handle.completion).rejects.toThrow()
    expect(child.kill).toHaveBeenCalledOnce()
  })

  it('returns a recoverable error for invalid tool arguments without terminating the worker', async () => {
    const child = new ToolBridgeUtilityProcess(false, true)
    const channel = createFakeMessageChannel()
    const handler = vi.fn()
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never,
      undefined,
      () => channel as never
    )
    const handle = client.beginSessionRun(
      config,
      'process-secret',
      sessionInput(),
      new AbortController().signal,
      () => undefined,
      handler
    )

    await handle.completion

    expect(handler).not.toHaveBeenCalled()
    expect(child.toolResponse).toMatchObject({
      type: 'tool_response',
      ok: false,
      error: {
        code: 'invalid_arguments',
        category: 'validation',
        recovery: { action: 'fix_arguments', tool: 'search_knowledge' }
      }
    })
    expect(child.kill).not.toHaveBeenCalled()
  })

  it('waits for in-flight tool handling to drain after an Agent stop', async () => {
    const child = new ToolBridgeUtilityProcess()
    const channel = createFakeMessageChannel()
    const client = new AgentModelClient(
      '/private/agent-model.js',
      pino({ level: 'silent' }),
      { fork: () => child } as never,
      undefined,
      () => channel as never
    )
    const controller = new AbortController()
    let handlerStarted = false
    let handlerSettled = false
    const handle = client.beginSessionRun(
      config,
      'process-secret',
      sessionInput(),
      controller.signal,
      () => undefined,
      async (request, signal) => {
        handlerStarted = true
        await new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => setTimeout(resolve, 20), { once: true })
        })
        handlerSettled = true
        return {
          schemaVersion: 2,
          type: 'tool_response',
          requestId: request.requestId,
          projectSessionId: request.projectSessionId,
          agentSessionId: request.agentSessionId,
          agentRunId: request.agentRunId,
          toolCallId: request.toolCallId,
          modelRequestId: request.modelRequestId,
          toolName: request.toolName,
          ok: false,
          error: {
            code: 'aborted',
            category: 'cancelled',
            message: 'Agent tool request was aborted',
            recovery: { action: 'do_not_retry' }
          }
        }
      }
    )
    await vi.waitFor(() => expect(handlerStarted).toBe(true))
    controller.abort()
    await expect(handle.completion).rejects.toMatchObject({ name: 'AbortError' })
    expect(handlerSettled).toBe(true)
  })
})

class SessionUtilityProcess extends EventEmitter {
  readonly kill = vi.fn(() => true)
  readonly postMessage = vi.fn((request: Record<string, unknown>) => {
    if (request.operation !== 'run_start') return
    queueMicrotask(() => {
      const envelope = {
        requestId: request.requestId,
        projectSessionId: request.projectSessionId,
        agentSessionId: request.agentSessionId,
        agentRunId: request.agentRunId
      }
      this.emit('message', {
        type: 'event',
        ...envelope,
        event: { type: 'assistant_delta', delta: 'draft' }
      })
      this.emit('message', { type: 'result', ...envelope, status: 'completed' })
    })
  })
}

class OverflowSessionUtilityProcess extends EventEmitter {
  readonly kill = vi.fn(() => true)
  readonly postMessage = vi.fn((request: Record<string, unknown>) => {
    if (request.operation !== 'run_start') return
    queueMicrotask(() =>
      this.emit('message', {
        type: 'error',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId,
        agentSessionId: request.agentSessionId,
        agentRunId: request.agentRunId,
        error: {
          name: 'ProviderError',
          message: 'Agent provider context window exceeded',
          httpStatus: 400,
          code: 'context_overflow'
        }
      })
    )
  })
}

class ControlledSessionUtilityProcess extends EventEmitter {
  readonly kill = vi.fn(() => true)
  readonly runs: Array<Record<string, unknown>> = []
  readonly queueActions: Array<Record<string, unknown>> = []
  readonly cancelledRunIds: string[] = []
  readonly postMessage = vi.fn((request: Record<string, unknown>) => {
    if (request.operation === 'run_start') this.runs.push(request)
    if (
      request.operation === 'delete_follow_up' ||
      request.operation === 'reserve_follow_up' ||
      request.operation === 'commit_follow_up_steer'
    ) {
      this.queueActions.push(request)
    }
    if (request.operation === 'cancel' && typeof request.agentRunId === 'string') {
      this.cancelledRunIds.push(request.agentRunId)
    }
  })

  complete(agentRunId: string): void {
    const request = this.runs.find((candidate) => candidate.agentRunId === agentRunId)
    if (request === undefined) throw new Error('Unknown controlled Agent run')
    this.emit('message', {
      type: 'result',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId,
      agentSessionId: request.agentSessionId,
      agentRunId: request.agentRunId,
      status: 'completed',
      outcome: 'finished'
    })
  }

  acknowledgeQueueAction(actionId: string, outcome: 'completed' | 'stale'): void {
    const action = this.queueActions.find((candidate) => candidate.actionId === actionId)
    if (action === undefined) throw new Error('Unknown controlled queue action')
    this.emit('message', {
      type: 'event',
      requestId: action.requestId,
      projectSessionId: action.projectSessionId,
      agentSessionId: action.agentSessionId,
      agentRunId: action.agentRunId,
      event: { type: 'queue_action_completed', actionId, operation: action.operation, outcome }
    })
  }
}

class ToolBridgeUtilityProcess extends EventEmitter {
  readonly kill = vi.fn(() => true)
  toolResponse: unknown

  constructor(
    private readonly staleProjectCapability = false,
    private readonly invalidArguments = false
  ) {
    super()
  }

  readonly postMessage = vi.fn((request: Record<string, unknown>, transfer?: FakeMessagePort[]) => {
    if (request.operation !== 'run_start') return
    const port = transfer?.[0]
    if (port === undefined) throw new Error('Expected a dedicated tool port')
    port.on('message', (event: { data: unknown }) => {
      this.toolResponse = event.data
      this.emit('message', {
        type: 'result',
        requestId: request.requestId,
        projectSessionId: request.projectSessionId,
        agentSessionId: request.agentSessionId,
        agentRunId: request.agentRunId,
        status: 'completed'
      })
    })
    port.start()
    queueMicrotask(() =>
      port.postMessage({
        type: 'tool_request',
        requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc451',
        projectSessionId: this.staleProjectCapability
          ? '019c6a5c-8d34-7a8e-a602-3d37a52dc459'
          : request.projectSessionId,
        agentSessionId: request.agentSessionId,
        agentRunId: request.agentRunId,
        toolCallId: 'tool-search',
        modelRequestId: request.modelRequestId,
        toolName: 'search_knowledge',
        args: {
          query: this.invalidArguments ? '' : 'evidence',
          knowledgeItemIds: [],
          fileExtensions: [],
          parseRevisionIds: [],
          limit: 10,
          rerank: true
        }
      })
    )
  })
}

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

function sessionInput() {
  return {
    projectSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc441',
    agentSessionId: '019c6a5c-8d34-7a8e-a602-3d37a52dc442',
    agentRunId: '019c6a5c-8d34-7a8e-a602-3d37a52dc443',
    modelRequestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc444',
    systemPrompt: 'system',
    history: [],
    prompt: 'prompt',
    maxOutputTokens: 100
  }
}
