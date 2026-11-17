import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { SpeechService } from './speech-service'
import type { SpeechClient } from './speech-client'
import type { ProviderService } from '../providers/provider-service'
import type { SpeechWorkerStart, SpeechWorkerEvent } from '../../shared/contracts/speech'

function setup() {
  const id = randomUUID()
  let revoked = false
  let activeRequest: SpeechWorkerStart | undefined
  let listener: ((event: SpeechWorkerEvent) => void) | undefined
  let resolve: () => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const client = {
    start: vi.fn(
      (
        request: SpeechWorkerStart,
        signal: AbortSignal,
        event: (event: SpeechWorkerEvent) => void
      ) => {
        activeRequest = request
        listener = event
        const completion = new Promise<void>((yes, no) => {
          resolve = yes
          reject = no
        })
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
        queueMicrotask(() =>
          event({
            type: 'speech-event',
            requestId: request.requestId,
            projectSessionId: request.projectSessionId,
            state: 'ready'
          })
        )
        return completion
      }
    ),
    send: vi.fn(),
    reset: vi.fn(),
    terminate: vi.fn()
  }
  const providers = {
    withSpeechProvider: vi.fn(
      async (operation: Parameters<ProviderService['withSpeechProvider']>[0]) =>
        operation(
          {
            role: 'speech',
            providerId: 'openai-compatible',
            baseUrl: 'http://localhost:123/v1',
            model: 'whisper',
            mode: 'file',
            timeoutMs: 60000,
            batchLimit: 1,
            embeddingDimension: null,
            fileSizeLimitMb: null
          },
          undefined
        )
    )
  }
  const emit = vi.fn()
  const service = new SpeechService({
    client: client as unknown as SpeechClient,
    providers: providers as Pick<ProviderService, 'withSpeechProvider'>,
    log: pino({ enabled: false }),
    assertSession: (sessionId) => {
      if (revoked || sessionId !== id) throw new Error('stale session')
    },
    emit
  })
  return {
    service,
    client,
    emit,
    id,
    revoke: () => {
      revoked = true
    },
    event: (state: SpeechWorkerEvent['state'], text?: string) => {
      if (activeRequest === undefined || listener === undefined) throw new Error('not started')
      listener({
        type: 'speech-event',
        requestId: activeRequest.requestId,
        projectSessionId: activeRequest.projectSessionId,
        state,
        text
      })
      if (state === 'final') resolve()
    },
    fail: () => reject(new Error('worker crashed'))
  }
}
describe('SpeechService lifecycle', () => {
  it('connection-tests an explicit source and model without requiring a project or changing selection', async () => {
    const { service, client } = setup()
    const provider = vi.spyOn(service.options.providers, 'withSpeechProvider')
    const result = service.testConnection(1, 'sp-test-source', 'sp-test-model')
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledOnce())
    expect(provider).toHaveBeenCalledWith(expect.any(Function), 'sp-test-source', 'sp-test-model')
    service.cancelTest(1)
    await expect(result).rejects.toThrow()
    service.close()
  })

  it('reserves preparing capture and discards a revoked sender before permission settles', async () => {
    const { service, id, client } = setup()
    let release: () => void = () => undefined
    service.options.prepareCapture = () =>
      new Promise<void>((resolve) => {
        release = resolve
      })
    const started = service.start(1, id)
    await Promise.resolve()
    await expect(service.start(1, id)).rejects.toThrow('already active')
    await expect(service.testConnection(1)).rejects.toThrow('already active')
    service.revokeSender(1)
    release()
    await expect(started).rejects.toThrow('could not start')
    expect(client.start).not.toHaveBeenCalled()
    service.close()
  })

  it('isolates sender and project, preserves sequence and tail ordering', async () => {
    const { service, client, id } = setup()
    const result = await service.start(1, id)
    const identity = { projectSessionId: id, recognitionId: result.recognitionId }
    expect(() =>
      service.pushAudio(2, { ...identity, sequence: 0, pcm: new Uint8Array(2) })
    ).toThrow('another window')
    service.pushAudio(1, { ...identity, sequence: 0, pcm: new Uint8Array(4800) })
    service.pushAudio(1, { ...identity, sequence: 1, pcm: new Uint8Array(2) })
    service.finish(1, identity)
    service.finish(1, identity)
    expect(client.send.mock.calls.map((call) => call[0].type)).toEqual([
      'speech-audio',
      'speech-audio',
      'speech-finish'
    ])
    service.close()
  })
  it('rejects unknown frame/finish and treats unknown cancellation as no-op', async () => {
    const { service, client, id } = setup()
    const unknown = { projectSessionId: id, recognitionId: randomUUID() }
    service.cancel(1, unknown)
    expect(() => service.finish(1, unknown)).toThrow()
    expect(() =>
      service.pushAudio(1, { ...unknown, sequence: 0, pcm: new Uint8Array(2) })
    ).toThrow()
    expect(client.start).not.toHaveBeenCalled()
    service.close()
  })
  it('cancels on revocation and discards late provider events', async () => {
    const { service, emit, id, revoke, event, client } = setup()
    await service.start(1, id)
    revoke()
    service.revokeSession(id)
    event('partial', 'late')
    expect(emit).not.toHaveBeenCalled()
    expect(client.reset).toHaveBeenCalledTimes(1)
    service.close()
  })
  it('releases final state immediately and gives complete snapshots monotonic event numbers', async () => {
    const { service, emit, id, event, client } = setup()
    const result = await service.start(1, id)
    event('partial', 'hello')
    event('partial', 'corrected')
    event('final', 'authoritative')
    await vi.waitFor(() => expect(client.reset).toHaveBeenCalledTimes(1))
    expect(
      emit.mock.calls.map((call) => ({
        state: call[1].state,
        text: call[1].text,
        sequence: call[1].sequence
      }))
    ).toEqual([
      { state: 'partial', text: 'hello', sequence: 0 },
      { state: 'partial', text: 'corrected', sequence: 1 },
      { state: 'final', text: 'authoritative', sequence: 2 }
    ])
    expect(() =>
      service.finish(1, { projectSessionId: id, recognitionId: result.recognitionId })
    ).toThrow()
    service.cancel(1, { projectSessionId: id, recognitionId: result.recognitionId })
    service.close()
  })
  it('terminates a failed worker without replaying audio', async () => {
    const { service, emit, id, fail, client } = setup()
    await service.start(1, id)
    fail()
    await vi.waitFor(() => expect(client.reset).toHaveBeenCalledTimes(1))
    expect(emit.mock.calls[0][1].state).toBe('error')
    expect(client.start).toHaveBeenCalledTimes(1)
    service.close()
  })
  it('mutually excludes testing and recognition and supports cancellation', async () => {
    const { service, id, client } = setup()
    const test = service.testConnection(1)
    await vi.waitFor(() => expect(client.start).toHaveBeenCalledOnce())
    await expect(service.start(1, id)).rejects.toThrow('already active')
    service.cancelTest(2)
    expect(client.reset).not.toHaveBeenCalled()
    service.cancelTest(1)
    await expect(test).rejects.toThrow('could not start')
    expect(client.reset).toHaveBeenCalledOnce()
    service.close()
  })
  it('terminates an out-of-order frame without sending it', async () => {
    const { service, id, client } = setup()
    const result = await service.start(1, id)
    expect(() =>
      service.pushAudio(1, {
        projectSessionId: id,
        recognitionId: result.recognitionId,
        sequence: 1,
        pcm: new Uint8Array(2)
      })
    ).toThrow('sequence')
    expect(client.send).not.toHaveBeenCalled()
    expect(client.reset).toHaveBeenCalledOnce()
    service.close()
  })
})
