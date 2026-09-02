import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentUtilityRequest } from '../shared/contracts/model-runtime'
import { runAgentModelRequest } from './agent-model-request'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('runAgentModelRequest', () => {
  it('uses the Pi Agent lifecycle with injected OpenAI-compatible streaming and no storage', async () => {
    let authorization = ''
    let requestBody = ''
    let attempt = 0
    const fetchMock = vi.fn<typeof fetch>(async (_input, init) => {
      attempt += 1
      authorization = String(new Headers(init?.headers).get('authorization') ?? '')
      requestBody = String(init?.body)
      if (attempt === 1) {
        return new Response(JSON.stringify({ error: { message: 'rate limited' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '0' }
        })
      }
      const chunks = [
        `data: ${JSON.stringify({
          id: 'agent-response-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'writer-model-resolved',
          choices: [
            { index: 0, delta: { role: 'assistant', content: 'Draft ' }, finish_reason: null }
          ]
        })}\n\n`,
        `data: ${JSON.stringify({
          id: 'agent-response-1',
          object: 'chat.completion.chunk',
          created: 1,
          model: 'writer-model-resolved',
          choices: [{ index: 0, delta: { content: 'complete.' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 }
        })}\n\n`,
        'data: [DONE]\n\n'
      ]
      return new Response(chunks.join(''), {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'x-request-id': 'agent-response-1'
        }
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    const request: AgentUtilityRequest = {
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc301',
      config: {
        role: 'agent',
        providerId: 'openai-compatible',
        baseUrl: 'https://agent.example.test/v1',
        model: 'writer-model',
        modelRevision: 'writer-rev-1',
        timeoutMs: 5_000,
        embeddingDimension: null,
        batchLimit: 1,
        fileSizeLimitMb: null
      },
      credential: { apiKey: 'agent-secret' },
      modelLimits: {
        contextWindowTokens: 131_072,
        inputLimitTokens: null,
        outputLimitTokens: null,
        source: 'legacy_fallback',
        catalogModelKey: null,
        resolvedAt: null
      },
      input: {
        systemPrompt: 'You draft prose.',
        prompt: 'Write a line.',
        maxOutputTokens: 100
      }
    }
    const deltas: string[] = []
    const captures: Array<{
      apiId: string
      physicalAttempt: number
      documents: Array<{ kind: string; value: unknown }>
    }> = []
    const result = await runAgentModelRequest(
      request,
      (delta) => deltas.push(delta),
      undefined,
      async (capture) => {
        expect(fetchMock).toHaveBeenCalledTimes(captures.length)
        captures.push(capture)
      }
    )

    expect(authorization).toBe('Bearer agent-secret')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.parse(requestBody)).toMatchObject({
      model: 'writer-model',
      stream: true,
      messages: [
        { role: 'system', content: 'You draft prose.' },
        { role: 'user', content: [{ type: 'text', text: 'Write a line.' }] }
      ]
    })
    expect(deltas.join('')).toBe('Draft complete.')
    expect(result).toMatchObject({
      text: 'Draft complete.',
      stopReason: 'stop',
      metadata: {
        usage: { inputTokens: 9, outputTokens: 3 },
        responseIds: ['agent-response-1'],
        retryCount: 1,
        providerModelId: 'writer-model-resolved'
      }
    })
    expect(JSON.stringify(result)).not.toContain('agent-secret')
    expect(JSON.stringify(result)).not.toContain('Write a line.')
    expect(captures.map((capture) => capture.physicalAttempt)).toEqual([1, 2, 2])
    expect(
      captures.flatMap((capture) => capture.documents.map((document) => document.kind))
    ).toEqual([
      'harness_request',
      'provider_request',
      'harness_request',
      'provider_request',
      'provider_response'
    ])
    expect(JSON.stringify(captures)).toContain('Write a line.')
    expect(JSON.stringify(captures)).not.toContain('agent-secret')
  })

  it('preserves the provider diagnostic when a utility request fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { message: 'temperature is unsupported' } }), {
            status: 400,
            headers: { 'content-type': 'application/json' }
          })
        )
      )
    )
    const request: AgentUtilityRequest = {
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc302',
      config: {
        role: 'agent',
        providerId: 'openai-compatible',
        baseUrl: 'https://agent.example.test/v1',
        model: 'writer-model',
        modelRevision: 'writer-rev-1',
        timeoutMs: 5_000,
        embeddingDimension: null,
        batchLimit: 1,
        fileSizeLimitMb: null
      },
      credential: { apiKey: 'agent-secret' },
      modelLimits: {
        contextWindowTokens: 131_072,
        inputLimitTokens: null,
        outputLimitTokens: null,
        source: 'legacy_fallback',
        catalogModelKey: null,
        resolvedAt: null
      },
      input: {
        systemPrompt: 'Create a title.',
        prompt: 'Conversation data.',
        maxOutputTokens: 64,
        temperature: 0
      }
    }

    await expect(runAgentModelRequest(request, () => undefined)).rejects.toThrow(
      'temperature is unsupported'
    )
  })

  it('continues the utility request when trace delivery fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>(async () => {
        const responseId = 'agent-trace-failure-response'
        return new Response(
          [
            `data: ${JSON.stringify({
              id: responseId,
              object: 'chat.completion.chunk',
              created: 1,
              model: 'writer-model-resolved',
              choices: [
                {
                  index: 0,
                  delta: { role: 'assistant', content: 'Completed.' },
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
              usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 }
            })}\n\n`,
            'data: [DONE]\n\n'
          ].join(''),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
      })
    )
    const request: AgentUtilityRequest = {
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc303',
      config: {
        role: 'agent',
        providerId: 'openai-compatible',
        baseUrl: 'https://agent.example.test/v1',
        model: 'writer-model',
        modelRevision: 'writer-rev-1',
        timeoutMs: 5_000,
        embeddingDimension: null,
        batchLimit: 1,
        fileSizeLimitMb: null
      },
      credential: { apiKey: 'agent-secret' },
      modelLimits: {
        contextWindowTokens: 131_072,
        inputLimitTokens: null,
        outputLimitTokens: null,
        source: 'legacy_fallback',
        catalogModelKey: null,
        resolvedAt: null
      },
      input: {
        systemPrompt: 'You draft prose.',
        prompt: 'Write a line.',
        maxOutputTokens: 100
      }
    }
    const traceError = new Error('trace sink unavailable')
    const onTraceError = vi.fn(() => {
      throw new Error('trace error reporter unavailable')
    })
    const result = await runAgentModelRequest(
      request,
      () => undefined,
      undefined,
      () => {
        throw traceError
      },
      onTraceError
    )

    expect(result.text).toBe('Completed.')
    expect(onTraceError).toHaveBeenCalledWith(traceError)
  })

  it('preserves the original provider cause, status, and code at the utility boundary', async () => {
    const providerError = Object.assign(new Error('provider transport exploded'), {
      code: 'E_PROVIDER_TRANSPORT',
      status: 503
    })
    const headers = {} as Record<string, string>
    Object.defineProperty(headers, 'authorization', {
      enumerable: true,
      get: () => {
        throw providerError
      }
    })
    const request: AgentUtilityRequest = {
      requestId: '019c6a5c-8d34-7a8e-a602-3d37a52dc304',
      config: {
        role: 'agent',
        providerId: 'openai-compatible',
        baseUrl: 'https://agent.example.test/v1',
        model: 'writer-model',
        modelRevision: 'writer-rev-1',
        timeoutMs: 5_000,
        embeddingDimension: null,
        batchLimit: 1,
        fileSizeLimitMb: null
      },
      credential: { apiKey: '', headers },
      modelLimits: {
        contextWindowTokens: 131_072,
        inputLimitTokens: null,
        outputLimitTokens: null,
        source: 'legacy_fallback',
        catalogModelKey: null,
        resolvedAt: null
      },
      input: {
        systemPrompt: 'You draft prose.',
        prompt: 'Write a line.',
        maxOutputTokens: 100
      }
    }

    await expect(runAgentModelRequest(request, () => undefined)).rejects.toMatchObject({
      message: 'provider transport exploded',
      code: 'E_PROVIDER_TRANSPORT',
      status: 503,
      cause: providerError
    })
  })
})
