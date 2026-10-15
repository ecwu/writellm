import { EventEmitter } from 'node:events'
import pino from 'pino'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  AuxiliaryUtilityRequest,
  AuxiliaryUtilityResponse
} from '../../shared/contracts/model-runtime'
import type { ProviderConfig } from '../../shared/contracts/providers'
import { AuxiliaryModelClient } from './auxiliary-model-client'

const projectSessionId = '11111111-1111-4111-8111-111111111111'
const metadata = {
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    estimatedCostUsdMicros: 0
  },
  responseIds: [],
  retryCount: 0,
  providerModelId: 'model'
}
const embedding = { embeddings: [[0.1, 0.2]], metadata }
const ranking = { ranking: [{ originalIndex: 0, score: 0.9 }], metadata }
const image = {
  dataBase64: 'AAAA',
  mimeType: 'image/png',
  effectiveImageSize: '1K',
  metadata
} as const
const imageInput = { prompt: 'An illustration', aspectRatio: 'auto', imageSize: '1K' } as const
const clients: AuxiliaryModelClient[] = []
afterEach(() => {
  for (const client of clients.splice(0)) client.terminate()
})

function config(role: 'embedding' | 'rerank' | 'image'): ProviderConfig {
  const common = {
    role,
    model: 'model',
    timeoutMs: 30_000,
    embeddingDimension: 2,
    batchLimit: 1,
    fileSizeLimitMb: null
  }
  return (
    role === 'image'
      ? {
          ...common,
          providerId: 'google-vertex',
          projectId: 'test-project',
          location: 'global',
          defaultAspectRatio: 'auto',
          defaultImageSize: '1K'
        }
      : { ...common, providerId: 'openai-compatible', baseUrl: 'https://provider.invalid/v1' }
  ) as ProviderConfig
}

function harness() {
  class Child extends EventEmitter {
    kill = vi.fn(() => true)
    postMessage = vi.fn((_request: unknown) => {})
  }
  const child = new Child()
  const factory = { fork: vi.fn(() => child) }
  const log = pino({ level: 'silent' })
  const error = vi.spyOn(log, 'error')
  const client = new AuxiliaryModelClient('/private/background-worker.js', log, factory as never)
  clients.push(client)
  const request = (index = 0) => child.postMessage.mock.calls[index]?.[0] as AuxiliaryUtilityRequest
  const reply = (response: AuxiliaryUtilityResponse | object) => child.emit('message', response)
  return { child, factory, error, client, request, reply }
}

describe('AuxiliaryModelClient', () => {
  it('returns embedding and rerank results through one persistent worker with session binding', async () => {
    const fixture = harness()
    const embedded = fixture.client.embedBatch(
      config('embedding'),
      'secret',
      { values: ['Text'] },
      new AbortController().signal,
      projectSessionId
    )
    const first = fixture.request()
    expect(first).toMatchObject({
      operation: 'embedding',
      projectSessionId,
      input: { values: ['Text'] }
    })
    fixture.reply({
      type: 'embedding-result',
      requestId: first.requestId,
      projectSessionId,
      result: embedding
    })
    await expect(embedded).resolves.toEqual(embedding)
    const reranked = fixture.client.rerank(
      config('rerank'),
      'secret',
      { query: 'Question', documents: ['Text'], topN: 1 },
      new AbortController().signal
    )
    const second = fixture.request(1)
    expect(second).toMatchObject({ operation: 'rerank', projectSessionId: null })
    expect(second.requestId).not.toBe(first.requestId)
    fixture.reply({ type: 'rerank-result', requestId: second.requestId, result: ranking })
    await expect(reranked).resolves.toEqual(ranking)
    expect(fixture.factory.fork).toHaveBeenCalledOnce()
  })

  it.each(['embedding', 'rerank', 'image'] as const)(
    'rejects a provider with the wrong %s role before starting a worker',
    async (operation) => {
      const { client, factory } = harness()
      const signal = new AbortController().signal
      const wrong = config(operation === 'embedding' ? 'rerank' : 'embedding')
      const pending =
        operation === 'embedding'
          ? client.embedBatch(wrong, 'secret', { values: ['Text'] }, signal)
          : operation === 'rerank'
            ? client.rerank(wrong, 'secret', { query: 'Q', documents: ['Text'], topN: 1 }, signal)
            : client.generateImage(wrong, undefined, imageInput, signal, projectSessionId)
      await expect(pending).rejects.toThrow('role is required')
      expect(factory.fork).not.toHaveBeenCalled()
    }
  )

  it('rejects malformed inputs before starting a worker', () => {
    const { client, factory } = harness()
    const signal = new AbortController().signal
    expect(() => client.embedBatch(config('embedding'), 'secret', { values: [] }, signal)).toThrow()
    expect(() =>
      client.rerank(
        config('rerank'),
        'secret',
        { query: 'Q', documents: ['Text'], topN: 2 },
        signal
      )
    ).toThrow('topN')
    expect(() =>
      client.generateImage(
        config('image'),
        undefined,
        { ...imageInput, prompt: '' },
        signal,
        projectSessionId
      )
    ).toThrow()
    expect(factory.fork).not.toHaveBeenCalled()
  })

  it.each(['session mismatch', 'malformed result'] as const)(
    'rejects %s responses and terminates the invalid worker',
    async (mode) => {
      const fixture = harness()
      const pending = fixture.client.embedBatch(
        config('embedding'),
        'secret',
        { values: ['Text'] },
        new AbortController().signal,
        projectSessionId
      )
      fixture.reply({
        type: 'embedding-result',
        requestId: fixture.request().requestId,
        projectSessionId:
          mode === 'session mismatch' ? '11111111-1111-4111-8111-111111111112' : projectSessionId,
        result: mode === 'malformed result' ? { embeddings: [[]], metadata } : embedding
      })
      await expect(pending).rejects.toThrow('invalid response')
      expect(fixture.child.kill).toHaveBeenCalledOnce()
      expect(fixture.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'auxiliary_model.response_invalid',
          err: expect.any(Error)
        }),
        expect.any(String)
      )
    }
  )

  it('rejects a valid response for the wrong operation', async () => {
    const fixture = harness()
    const pending = fixture.client.embedBatch(
      config('embedding'),
      'secret',
      { values: ['Text'] },
      new AbortController().signal
    )
    fixture.reply({
      type: 'rerank-result',
      requestId: fixture.request().requestId,
      result: ranking
    })
    await expect(pending).rejects.toThrow('Embedding response type mismatch')
  })

  it('preserves provider diagnostics as the failure cause without terminating a healthy worker', async () => {
    const fixture = harness()
    const pending = fixture.client.rerank(
      config('rerank'),
      'secret',
      { query: 'Q', documents: ['Text'], topN: 1 },
      new AbortController().signal
    )
    fixture.reply({
      type: 'error',
      requestId: fixture.request().requestId,
      error: {
        name: 'ProviderError',
        message: 'Quota exceeded',
        stack: 'original provider stack',
        httpStatus: 429,
        providerCode: 'RATE_LIMIT'
      }
    })
    await expect(pending).rejects.toMatchObject({
      message: 'Auxiliary model request failed',
      cause: {
        name: 'ProviderError',
        message: 'Quota exceeded',
        stack: 'original provider stack',
        status: 429,
        providerCode: 'RATE_LIMIT'
      }
    })
    expect(fixture.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        event: 'auxiliary_model.failed',
        err: expect.objectContaining({ status: 429 })
      }),
      expect.any(String)
    )
    expect(fixture.child.kill).not.toHaveBeenCalled()
  })

  it('sends session-bound cancellation and rejects an active request on abort', async () => {
    const fixture = harness()
    const controller = new AbortController()
    const pending = fixture.client.embedBatch(
      config('embedding'),
      'secret',
      { values: ['Text'] },
      controller.signal,
      projectSessionId
    )
    const request = fixture.request()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.child.postMessage).toHaveBeenLastCalledWith({
      type: 'cancel',
      requestId: request.requestId,
      projectSessionId
    })
    expect(fixture.child.kill).not.toHaveBeenCalled()
  })

  it('does not start a worker for a request that is already aborted', async () => {
    const fixture = harness()
    await expect(
      fixture.client.embedBatch(
        config('embedding'),
        'secret',
        { values: ['Text'] },
        AbortSignal.abort()
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(fixture.factory.fork).not.toHaveBeenCalled()
  })

  it('serializes image work, omits ambient credentials, and cancels a queued image without dispatch', async () => {
    const fixture = harness()
    const first = fixture.client.generateImage(
      config('image'),
      undefined,
      imageInput,
      new AbortController().signal,
      projectSessionId
    )
    const controller = new AbortController()
    const cancelled = fixture.client.generateImage(
      config('image'),
      undefined,
      imageInput,
      controller.signal,
      projectSessionId
    )
    const rejected = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    const third = fixture.client.generateImage(
      config('image'),
      undefined,
      { ...imageInput, prompt: 'Third image' },
      new AbortController().signal,
      projectSessionId
    )
    expect(fixture.child.postMessage).toHaveBeenCalledOnce()
    expect(fixture.request()).not.toHaveProperty('credential')
    controller.abort()
    fixture.reply({
      type: 'image-result',
      requestId: fixture.request().requestId,
      projectSessionId,
      result: image
    })
    await expect(first).resolves.toEqual(image)
    await rejected
    await vi.waitFor(() => expect(fixture.child.postMessage).toHaveBeenCalledTimes(2))
    expect(fixture.request(1).input).toMatchObject({ prompt: 'Third image' })
    fixture.reply({
      type: 'image-result',
      requestId: fixture.request(1).requestId,
      projectSessionId,
      result: image
    })
    await expect(third).resolves.toEqual(image)
  })

  it('rejects pending and future requests when the client terminates', async () => {
    const fixture = harness()
    const run = () =>
      fixture.client.embedBatch(
        config('embedding'),
        'secret',
        { values: ['Text'] },
        new AbortController().signal
      )
    const pending = run()
    fixture.client.terminate()
    await expect(pending).rejects.toThrow('terminated')
    await expect(run()).rejects.toThrow('closed')
    expect(fixture.child.kill).toHaveBeenCalledOnce()
  })
})
