import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { SpeechWorkerEvent, SpeechWorkerStart } from '../../shared/contracts/speech'

const transports = vi.hoisted(() => {
  class Socket {
    bufferedAmount = 0
    readonly send = vi.fn()
    readonly terminate = vi.fn()
    readonly listeners = new Map<string, ((...args: unknown[]) => void)[]>()
    on(name: string, listener: (...args: unknown[]) => void): this {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener])
      return this
    }
    emit(name: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(name) ?? []) listener(...args)
    }
  }
  const sdkConstructed = vi.fn()
  const directConstructed = vi.fn()
  const sdks: Sdk[] = []
  const sockets: Socket[] = []
  class Sdk {
    readonly socket = new Socket()
    readonly send = vi.fn()
    readonly on = vi.fn()
    constructor(options: unknown, client: unknown) {
      sdkConstructed(options, client)
      sdks.push(this)
    }
  }
  class DirectSocket extends Socket {
    constructor(url: URL, options: unknown) {
      super()
      directConstructed(url.href, options)
      sockets.push(this)
    }
  }
  return { Sdk, DirectSocket, sdkConstructed, directConstructed, sdks, sockets }
})
vi.mock('openai/realtime/ws', () => ({ OpenAIRealtimeWS: transports.Sdk }))
vi.mock('ws', () => ({ default: transports.DirectSocket }))

import { SpeechWorkerSession } from './session'
import { agentDiagnosticForLogging } from '../../shared/agent-diagnostic-error'

const sessions: SpeechWorkerSession[] = []
const connectionOptions = {
  maxPayload: 262144,
  perMessageDeflate: false,
  followRedirects: false,
  handshakeTimeout: 10000
}
afterEach(() => {
  for (const session of sessions.splice(0)) session.close()
  transports.sdks.length = 0
  transports.sockets.length = 0
  vi.clearAllMocks()
})
function setup(baseUrl: string, credential?: string, test = false) {
  const request: SpeechWorkerStart = {
    type: 'speech-start',
    requestId: randomUUID(),
    projectSessionId: test ? null : randomUUID(),
    config: { baseUrl, model: 'gpt-live-transcribe', mode: 'realtime' },
    ...(credential === undefined ? {} : { credential }),
    test
  }
  const events: SpeechWorkerEvent[] = []
  const failed = vi.fn()
  const session = new SpeechWorkerSession(request, (event) => events.push(event), failed)
  sessions.push(session)
  return { request, session, events, failed }
}
function configuration(languages = false) {
  return {
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24000 },
          transcription: {
            model: 'gpt-live-transcribe',
            ...(languages ? { languages: ['zh', 'en'] } : {})
          },
          turn_detection: null
        }
      }
    }
  }
}

describe('speech transport selection', () => {
  it('preserves SDK-first invalid_parameter before the raw socket listener and redacts original diagnostics', async () => {
    const { session, events, failed } = setup('https://api.openai.com/v1', 'fixture-key', true)
    await session.start()
    const sdk = transports.sdks[0]
    const errorCallback = sdk.on.mock.calls.find(([name]) => name === 'error')?.[1]
    if (typeof errorCallback !== 'function') throw new Error('SDK error callback missing')
    const original = Object.assign(
      new Error('private provider response with fixture-key at https://api.openai.com/v1'),
      {
        error: {
          code: 'invalid_parameter',
          param: 'session.audio.input.transcription.languages',
          message: 'private response'
        }
      }
    )
    errorCallback(original)
    sdk.socket.emit(
      'message',
      Buffer.from(JSON.stringify({ type: 'error', error: original.error }))
    )
    expect(events).toEqual([
      expect.objectContaining({
        state: 'error',
        error:
          'Speech provider rejected a configured parameter. Parameter: session.audio.input.transcription.languages.',
        errorCode: 'invalid_parameter',
        errorParam: 'session.audio.input.transcription.languages'
      })
    ])
    expect(failed).toHaveBeenCalledExactlyOnceWith(original)
    expect(sdk.socket.terminate).toHaveBeenCalledOnce()
    expect(JSON.stringify(agentDiagnosticForLogging(original))).not.toMatch(
      /private provider response|fixture-key|https:\/\/api.openai.com/
    )
  })

  it('maps direct socket protocol errors with the same safe machine metadata', async () => {
    const { session, events } = setup('https://custom.example/v1')
    await session.start()
    transports.sockets[0].emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'error',
          error: { code: 'model_not_found', param: 'model', message: 'private model details' }
        })
      )
    )
    expect(events[0]).toMatchObject({
      state: 'error',
      errorCode: 'model_not_found',
      errorParam: 'model'
    })
    expect(events[0].error).not.toContain('private')
  })

  it.each(['gpt-4o-transcribe', 'gpt-4o-mini-transcribe', 'whisper-1'])(
    'keeps configured %s and omits unsupported official language hints',
    async (model) => {
      const { session, request } = setup('https://api.openai.com/v1', 'fixture-key')
      request.config.model = model
      await session.start()
      const sdk = transports.sdks[0]
      sdk.socket.emit('open')
      const expected = configuration()
      expected.session.audio.input.transcription.model = model
      expect(sdk.send).toHaveBeenCalledExactlyOnceWith(expected)
      expect(transports.sdkConstructed).toHaveBeenCalledTimes(1)
    }
  )

  it('uses the SDK for authenticated official HTTPS with transcription intent and bounded options', async () => {
    const { session, events, failed } = setup('https://api.openai.com/v1', 'fixture-key')
    await session.start()
    expect(transports.directConstructed).not.toHaveBeenCalled()
    expect(transports.sdkConstructed).toHaveBeenCalledExactlyOnceWith(
      { intent: 'transcription', options: connectionOptions },
      { baseURL: 'https://api.openai.com/v1', apiKey: 'fixture-key' }
    )
    const sdk = transports.sdks[0]
    expect(sdk.on).toHaveBeenCalledWith('error', expect.any(Function))
    expect(events).toEqual([])
    sdk.socket.emit('open')
    expect(sdk.send).toHaveBeenCalledExactlyOnceWith(configuration(true))
    expect(JSON.stringify(sdk.send.mock.calls)).not.toContain('fixture-key')
    sdk.socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
    expect(events.map((event) => event.state)).toEqual(['ready'])
    session.close()
    session.close()
    expect(sdk.socket.terminate).toHaveBeenCalledTimes(1)
    expect(failed).not.toHaveBeenCalled()
  })

  it('uses direct WSS without an authorization header for a custom HTTPS endpoint without a key', async () => {
    const { session, request, events, failed } = setup('https://speech.example.test/proxy/v1')
    await session.start()
    expect(transports.sdkConstructed).not.toHaveBeenCalled()
    expect(transports.directConstructed).toHaveBeenCalledExactlyOnceWith(
      'wss://speech.example.test/proxy/v1/realtime?intent=transcription',
      { ...connectionOptions, headers: {} }
    )
    const socket = transports.sockets[0]
    socket.emit('open')
    expect(socket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify(configuration()))
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
    session.command({
      type: 'speech-cancel',
      requestId: request.requestId,
      projectSessionId: request.projectSessionId
    })
    socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
    socket.emit('close')
    session.close()
    expect(socket.terminate).toHaveBeenCalledTimes(1)
    expect(socket.send).toHaveBeenCalledTimes(1)
    expect(events.map((event) => event.state)).toEqual(['ready'])
    expect(failed).not.toHaveBeenCalled()
  })

  it('omits official language hints for an authenticated custom HTTPS SDK connection', async () => {
    const { session } = setup('https://speech.example.test/proxy/v1', 'custom-fixture-key')
    await session.start()
    expect(transports.sdkConstructed).toHaveBeenCalledExactlyOnceWith(
      { intent: 'transcription', options: connectionOptions },
      { baseURL: 'https://speech.example.test/proxy/v1', apiKey: 'custom-fixture-key' }
    )
    const sdk = transports.sdks[0]
    sdk.socket.emit('open')
    expect(sdk.send).toHaveBeenCalledExactlyOnceWith(configuration())
    session.close()
    expect(sdk.socket.terminate).toHaveBeenCalledTimes(1)
  })

  it('closes the official connection test after configuration acceptance without sending audio', async () => {
    const { session, events, failed } = setup('https://api.openai.com/v1', 'fixture-key', true)
    await session.start()
    const sdk = transports.sdks[0]
    sdk.socket.emit('open')
    expect(events).toEqual([])
    sdk.socket.emit('message', Buffer.from(JSON.stringify({ type: 'session.updated' })))
    expect(events).toEqual([
      expect.objectContaining({ state: 'final', text: '', projectSessionId: null })
    ])
    expect(sdk.send).toHaveBeenCalledExactlyOnceWith(configuration(true))
    expect(sdk.socket.terminate).toHaveBeenCalledTimes(1)
    sdk.socket.emit('close')
    expect(failed).not.toHaveBeenCalled()
  })
})
