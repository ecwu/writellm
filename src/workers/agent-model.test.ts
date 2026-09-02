import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunStart, AgentRuntimeMessage } from '../shared/contracts/agent'

class FakeParentPort extends EventEmitter {
  readonly messages: unknown[] = []
  readonly postMessage = vi.fn((message: unknown) => {
    this.messages.push(message)
  })
}

class FakeToolPort extends EventEmitter {
  readonly start = vi.fn()
  readonly close = vi.fn(() => this.emit('close'))
  readonly postMessage = vi.fn()
}

describe('agent-model worker admission', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('runs five mixed Agent and Notebook sessions concurrently without application admission rejection', async () => {
    const expectedRequestCount = 5
    const parentPort = new FakeParentPort()
    const toolPorts = Array.from({ length: expectedRequestCount }, () => new FakeToolPort())
    const previousParentPort = Object.getOwnPropertyDescriptor(process, 'parentPort')
    const processRecord = process as unknown as Record<string, unknown>
    Object.defineProperty(process, 'parentPort', {
      configurable: true,
      value: parentPort
    })

    let releaseFetches = (): void => undefined
    let fetchStarted = 0
    const allFetchesStarted = new Promise<void>((resolve) => {
      releaseFetches = resolve
    })
    const requestBodies: Array<Record<string, unknown>> = []
    const requests = Array.from({ length: expectedRequestCount }, (_, index) => makeRequest(index))

    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        requestBodies.push(body)
        fetchStarted += 1
        if (fetchStarted === expectedRequestCount) {
          const first = requests[0]
          if (first === undefined) throw new Error('Missing first test request')
          parentPort.emit('message', {
            data: {
              operation: 'cancel',
              requestId: first.requestId,
              projectSessionId: uuidFor(99, 1),
              agentSessionId: first.agentSessionId,
              agentRunId: first.agentRunId
            }
          })
          releaseFetches()
        }
        await allFetchesStarted
        const bodyText = JSON.stringify(body)
        const requestIndex = requests.findIndex((request) => bodyText.includes(request.prompt))
        return completionResponse(
          requestIndex < 0 ? 'isolated-response' : `isolated-response-${requestIndex}`,
          requestIndex < 0 ? 'isolated-response' : `isolated-response-${requestIndex}`
        )
      })
    )

    try {
      vi.resetModules()
      await import('./agent-model')
      for (const [index, request] of requests.entries()) {
        parentPort.emit('message', { data: request, ports: [toolPorts[index]] })
      }

      await vi.waitFor(() => expect(fetchStarted).toBe(expectedRequestCount))
      await vi.waitFor(() =>
        expect(runtimeResponses(parentPort)).toHaveLength(expectedRequestCount)
      )

      const messages = runtimeResponses(parentPort)
      expect(messages.every((message) => message.type === 'result')).toBe(true)
      for (const request of requests) {
        expect(messages).toContainEqual(
          expect.objectContaining({
            type: 'result',
            requestId: request.requestId,
            projectSessionId: request.projectSessionId,
            agentSessionId: request.agentSessionId,
            agentRunId: request.agentRunId,
            status: 'completed',
            outcome: 'finished'
          })
        )
      }

      expect(requestBodies).toHaveLength(expectedRequestCount)
      for (const request of requests) {
        const body = requestBodies.find((candidate) =>
          JSON.stringify(candidate).includes(request.prompt)
        )
        expect(body).toBeDefined()
        for (const otherRequest of requests) {
          if (otherRequest === request) continue
          expect(JSON.stringify(body)).not.toContain(otherRequest.prompt)
        }
      }

      const writingBody = requestBodies.find((candidate) =>
        JSON.stringify(candidate).includes('system-0')
      )
      const notebookBody = requestBodies.find((candidate) =>
        JSON.stringify(candidate).includes('system-1')
      )
      expect(JSON.stringify(writingBody)).toContain('get_writing_context')
      expect(JSON.stringify(notebookBody)).toContain('search_knowledge')
      expect(JSON.stringify(notebookBody)).not.toContain('get_writing_context')
      expect(toolPorts.every((port) => port.close.mock.calls.length === 1)).toBe(true)
    } finally {
      releaseFetches()
      if (previousParentPort === undefined) delete processRecord.parentPort
      else Object.defineProperty(process, 'parentPort', previousParentPort)
    }
  })
})

function makeRequest(index: number): AgentRunStart {
  const projectSessionId = uuidFor(1, 1)
  return {
    operation: 'run_start',
    requestId: uuidFor(index + 1, 2),
    projectSessionId,
    agentSessionId: uuidFor(index + 1, 3),
    agentRunId: uuidFor(index + 1, 4),
    modelRequestId: uuidFor(index + 1, 5),
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
    credential: { apiKey: `agent-secret-${index}` },
    systemPrompt: `system-${index}`,
    history: [],
    prompt: `prompt-${index}`,
    toolProfile: index % 2 === 0 ? 'writing' : 'notebook_knowledge',
    interactionMode: 'write',
    activeToolGroups: [],
    thinkingLevel: 'off',
    maxOutputTokens: 100
  }
}

function uuidFor(run: number, field: number): string {
  return `019c6a5c-8d34-7a8e-a602-${run.toString(16).padStart(4, '0')}${field
    .toString(16)
    .padStart(8, '0')}`
}

function runtimeResponses(parentPort: FakeParentPort): Array<AgentRuntimeMessage> {
  return parentPort.messages.filter((message): message is AgentRuntimeMessage => {
    if (message === null || typeof message !== 'object') return false
    const type = (message as { type?: unknown }).type
    return type === 'result' || type === 'error'
  })
}

function completionResponse(text: string, responseId: string): Response {
  const chunks = [
    `data: ${JSON.stringify({
      id: responseId,
      object: 'chat.completion.chunk',
      created: 1,
      model: 'writer-model-resolved',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: text },
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
    headers: { 'content-type': 'text/event-stream' }
  })
}
