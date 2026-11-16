import { afterEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { randomUUID } from 'node:crypto'
import { normalizeSpeechDelta, speechEndpoint, speechWav, SpeechWorkerSession } from './session'
import {
  speechAudioSchema,
  type SpeechWorkerEvent,
  type SpeechWorkerStart
} from '../../shared/contracts/speech'

const sessions: SpeechWorkerSession[] = []
afterEach(() => {
  for (const session of sessions.splice(0)) session.close()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function request(
  mode: 'file' | 'realtime',
  baseUrl = 'http://127.0.0.1:12345/prefix/v1',
  test = false
): SpeechWorkerStart {
  return {
    type: 'speech-start',
    requestId: randomUUID(),
    projectSessionId: test ? null : randomUUID(),
    config: {
      baseUrl,
      model: mode === 'realtime' ? 'gpt-live-transcribe' : 'gpt-transcribe',
      mode
    },
    test
  }
}
function session(request: SpeechWorkerStart) {
  const events: SpeechWorkerEvent[] = []
  const errors: unknown[] = []
  const worker = new SpeechWorkerSession(
    request,
    (event) => events.push(event),
    (error) => errors.push(error)
  )
  sessions.push(worker)
  return { worker, events, errors }
}
function command(request: SpeechWorkerStart) {
  return { requestId: request.requestId, projectSessionId: request.projectSessionId as string }
}
describe('speech boundaries', () => {
  it('accepts only bounded even Uint8Array PCM', () => {
    const identity = { projectSessionId: randomUUID(), recognitionId: randomUUID(), sequence: 0 }
    for (const pcm of [
      [],
      new Uint8Array(),
      new Uint8Array(1),
      new Uint8Array(4802),
      new Uint16Array(4),
      { 0: 1, length: 2 }
    ])
      expect(speechAudioSchema.safeParse({ ...identity, pcm }).success).toBe(false)
    expect(speechAudioSchema.parse({ ...identity, pcm: new Uint8Array(4800) }).pcm.byteLength).toBe(
      4800
    )
  })
  it('preserves prefixes and restricts configured endpoint authority', () => {
    expect(speechEndpoint('http://[::1]:123/prefix/v1', 'audio/transcriptions').href).toBe(
      'http://[::1]:123/prefix/v1/audio/transcriptions'
    )
    for (const value of [
      'http://example.com/v1',
      'http://192.168.1.1',
      'https://key@example.com',
      'https://example.com/#fragment',
      'https://example.com/?token=x'
    ])
      expect(() => speechEndpoint(value, 'realtime')).toThrow()
  })
  it('builds mono PCM16 WAV and bounds incremental snapshots', () => {
    const wav = Buffer.from(speechWav(new Uint8Array([1, 2])))
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(24)).toBe(24000)
    expect(wav.readUInt32LE(40)).toBe(2)
    expect(normalizeSpeechDelta('Hello', ' world')).toBe('Hello world')
    expect(() => normalizeSpeechDelta('', 'a'.repeat(65537))).toThrow()
  })
  it('rejects duplicate sequence and never commits empty audio', async () => {
    const req = request('file')
    const { worker, events } = session(req)
    await worker.start()
    worker.command({ type: 'speech-finish', ...command(req) })
    expect(events.map((e) => e.state)).toEqual(['ready', 'final'])
    expect(events[1].text).toBe('')
    worker.command({ type: 'speech-finish', ...command(req) })
    expect(events).toHaveLength(2)
  })
  it('uploads bounded WAV exactly once and accepts empty JSON text', async () => {
    const fetcher = vi.fn(async (_url: URL, init: RequestInit) => {
      const form = init.body as FormData
      expect(form.get('model')).toBe('gpt-transcribe')
      expect(form.get('response_format')).toBe('json')
      expect(form.has('languages[]')).toBe(false)
      const file = form.get('file') as File
      expect(file.size).toBe(48)
      expect(init.redirect).toBe('error')
      expect(new Headers(init.headers).has('authorization')).toBe(false)
      return Response.json({ text: '' })
    })
    vi.stubGlobal('fetch', fetcher)
    const req = request('file')
    const { worker, events } = session(req)
    await worker.start()
    worker.command({ type: 'speech-audio', ...command(req), sequence: 0, pcm: new Uint8Array(4) })
    worker.command({ type: 'speech-finish', ...command(req) })
    worker.command({ type: 'speech-finish', ...command(req) })
    await vi.waitFor(() => expect(events.at(-1)?.state).toBe('final'))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('connection testing uploads one second of silence without a draft event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: URL, init: RequestInit) => {
        expect((init.body as FormData).get('file')).toMatchObject({ size: 48044 })
        return Response.json({ text: '' })
      })
    )
    const { worker, events } = session(request('file', undefined, true))
    await worker.start()
    expect(events.map((e) => e.state)).toEqual(['final'])
    expect(events[0].projectSessionId).toBeNull()
  })
  it('reports invalid JSON, oversized results and HTTP auth failure without retry', async () => {
    for (const response of [
      new Response('not-json'),
      Response.json({ text: '字'.repeat(30000) }),
      new Response('', { status: 401 })
    ]) {
      const fetcher = vi.fn(async () => response)
      vi.stubGlobal('fetch', fetcher)
      const { worker, errors } = session(request('file', undefined, true))
      await expect(worker.start()).rejects.toThrow()
      worker.close()
      expect(fetcher).toHaveBeenCalledTimes(1)
      expect(errors).toEqual([])
    }
  })
  it('enforces order and total audio budget', async () => {
    const req = request('file')
    const { worker } = session(req)
    await worker.start()
    expect(() =>
      worker.command({ type: 'speech-audio', ...command(req), sequence: 1, pcm: new Uint8Array(2) })
    ).toThrow()
    for (let sequence = 0; sequence < 1200; sequence++)
      worker.command({ type: 'speech-audio', ...command(req), sequence, pcm: new Uint8Array(4800) })
    expect(() =>
      worker.command({
        type: 'speech-audio',
        ...command(req),
        sequence: 1200,
        pcm: new Uint8Array(2)
      })
    ).toThrow()
  })
  it('times out connection and releases once', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: URL, init: RequestInit) =>
          new Promise((_resolve, reject) =>
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          )
      )
    )
    const { worker, events, errors } = session(request('file', undefined, true))
    const rejected = expect(worker.start()).rejects.toThrow('aborted')
    await vi.advanceTimersByTimeAsync(60001)
    await rejected
    expect(events.at(-1)?.state).toBe('error')
    expect(errors).toHaveLength(1)
  })
})

describe('loopback realtime protocol', () => {
  async function fixture(
    run: (url: string, connect: (handler: (socket: WebSocket) => void) => void) => Promise<void>
  ) {
    const server = createServer()
    const wss = new WebSocketServer({ server })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Missing port')
    let connected: (socket: WebSocket) => void = () => undefined
    wss.on('connection', (socket, request) => {
      expect(request.url).toBe('/prefix/v1/realtime?intent=transcription')
      expect(request.headers.authorization).toBeUndefined()
      connected(socket)
    })
    try {
      await run(`http://127.0.0.1:${address.port}/prefix/v1`, (callback) => {
        connected = callback
      })
    } finally {
      for (const socket of wss.clients) socket.terminate()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
  it('waits for configuration, forwards tail before one commit, correlates final and stops', async () => {
    await fixture(async (url, connect) => {
      const received: Record<string, unknown>[] = []
      connect((socket) =>
        socket.on('message', (data) => {
          const event = JSON.parse(data.toString())
          received.push(event)
          if (event.type === 'session.update') {
            expect(event.session.audio.input.transcription).toEqual({
              model: 'gpt-live-transcribe'
            })
            expect(event.session.audio.input.turn_detection).toBeNull()
            socket.send(JSON.stringify({ type: 'session.updated' }))
          }
          if (event.type === 'input_audio_buffer.commit') {
            socket.send(
              JSON.stringify({
                type: 'conversation.item.input_audio_transcription.delta',
                item_id: 'one',
                delta: 'partial'
              })
            )
            socket.send(
              JSON.stringify({
                type: 'conversation.item.input_audio_transcription.completed',
                item_id: 'one',
                transcript: 'final replaces partial'
              })
            )
            socket.send(JSON.stringify({ type: 'input_audio_buffer.committed', item_id: 'one' }))
          }
        })
      )
      const req = request('realtime', url)
      const { worker, events } = session(req)
      await worker.start()
      await vi.waitFor(() => expect(events[0]?.state).toBe('ready'))
      worker.command({
        type: 'speech-audio',
        ...command(req),
        sequence: 0,
        pcm: new Uint8Array(4800)
      })
      worker.command({ type: 'speech-audio', ...command(req), sequence: 1, pcm: new Uint8Array(2) })
      worker.command({ type: 'speech-finish', ...command(req) })
      worker.command({ type: 'speech-finish', ...command(req) })
      await vi.waitFor(() => expect(events.at(-1)?.state).toBe('final'))
      expect(events.at(-1)?.text).toBe('final replaces partial')
      expect(received.map((e) => e.type)).toEqual([
        'session.update',
        'input_audio_buffer.append',
        'input_audio_buffer.append',
        'input_audio_buffer.commit'
      ])
    })
  })
  it('connection test closes after session.updated without audio', async () => {
    await fixture(async (url, connect) => {
      const messages: string[] = []
      connect((socket) =>
        socket.on('message', (data) => {
          messages.push(JSON.parse(data.toString()).type)
          socket.send(JSON.stringify({ type: 'session.updated' }))
        })
      )
      const { worker, events } = session(request('realtime', url, true))
      await worker.start()
      await vi.waitFor(() => expect(events.at(-1)?.state).toBe('final'))
      expect(messages).toEqual(['session.update'])
    })
  })
})
