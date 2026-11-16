import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import type { UtilityProcess } from 'electron'
import { SpeechClient } from './speech-client'
import { SpeechService } from './speech-service'
import { SpeechFailure, speechErrorMessage } from '../../shared/speech-errors'
import type { ProviderService } from '../providers/provider-service'

class Child extends EventEmitter {
  readonly postMessage = vi.fn()
  readonly kill = vi.fn()
}
const message =
  'Speech provider rejected a configured parameter. Parameter: session.audio.input.transcription.languages.'
function setup() {
  const child = new Child()
  const log = pino({ enabled: false })
  const client = new SpeechClient('/fixture/background-worker.js', log, {
    fork: () => child as unknown as UtilityProcess
  })
  return { child, client, log }
}
describe('speech rejection propagation', () => {
  it('rejects worker protocol errors as SpeechFailure instead of throwing from its event handler', async () => {
    const { child, client } = setup()
    const request = {
      type: 'speech-start' as const,
      requestId: randomUUID(),
      projectSessionId: null,
      config: {
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4o-transcribe',
        mode: 'realtime' as const
      },
      test: true
    }
    const event = vi.fn()
    const result = client.start(request, new AbortController().signal, event).then(
      () => undefined,
      (error) => error
    )
    child.emit('message', {
      type: 'speech-event',
      requestId: request.requestId,
      projectSessionId: null,
      state: 'error',
      error: message,
      errorCode: 'invalid_parameter',
      errorParam: 'session.audio.input.transcription.languages'
    })
    const failure = await result
    expect(failure).toBeInstanceOf(SpeechFailure)
    expect(failure).toMatchObject({
      providerCode: 'invalid_parameter',
      providerParam: 'session.audio.input.transcription.languages',
      safeMessage: message
    })
    expect(event).toHaveBeenCalledOnce()
    client.terminate()
  })

  it('retains the safe protocol message and cause through the Main connection-test wrapper', async () => {
    const { child, client, log } = setup()
    const service = new SpeechService({
      client,
      log,
      providers: {
        withSpeechProvider: async (operation) =>
          operation(
            {
              role: 'speech',
              providerId: 'openai-compatible',
              baseUrl: 'https://api.openai.com/v1',
              model: 'gpt-4o-transcribe',
              mode: 'realtime',
              timeoutMs: 60000,
              batchLimit: 1,
              embeddingDimension: null,
              fileSizeLimitMb: null
            },
            'fixture-key'
          )
      } as Pick<ProviderService, 'withSpeechProvider'>,
      assertSession: () => undefined,
      emit: vi.fn()
    })
    const result = service.testConnection(1).then(
      () => undefined,
      (error) => error
    )
    await vi.waitFor(() => expect(child.postMessage).toHaveBeenCalledOnce())
    const request = child.postMessage.mock.calls[0][0]
    child.emit('message', {
      type: 'speech-event',
      requestId: request.requestId,
      projectSessionId: null,
      state: 'error',
      error: message,
      errorCode: 'invalid_parameter',
      errorParam: 'session.audio.input.transcription.languages'
    })
    const failure = await result
    expect(failure).toBeInstanceOf(SpeechFailure)
    expect(failure.cause).toBeInstanceOf(SpeechFailure)
    expect(failure.providerCode).toBe('invalid_parameter')
    expect(speechErrorMessage(failure)).toBe(message)
    expect(
      speechErrorMessage(
        new Error(`Error invoking remote method 'speech:test': Error: ${failure.message}`)
      )
    ).toBe(message)
    service.close()
  })
})
