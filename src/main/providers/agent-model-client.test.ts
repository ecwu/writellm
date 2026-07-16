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
      expect.objectContaining({ config, credential: 'process-secret' })
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
})
