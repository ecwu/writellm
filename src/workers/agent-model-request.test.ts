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
    const result = await runAgentModelRequest(request, (delta) => deltas.push(delta))

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
  })
})
