import {
  prepareSpeechErrorForLogging,
  speechErrorMessage,
  speechHttpFailure,
  speechProviderFailure,
  SpeechFailure
} from '../../shared/speech-errors'
import { OpenAIRealtimeWS } from 'openai/realtime/ws'
import WebSocket from 'ws'
import type { RealtimeClientEvent } from 'openai/resources/realtime/realtime'
import { z } from 'zod'
import {
  SPEECH_LIMITS,
  type SpeechWorkerStart,
  type SpeechWorkerCommand,
  type SpeechWorkerEvent
} from '../../shared/contracts/speech'
import { providerBaseUrlSchema } from '../../shared/contracts/providers'
import { fetchConfiguredEndpoint, readBoundedText } from '../outbound-http'

const textSchema = z
  .string()
  .refine((value) => Buffer.byteLength(value, 'utf8') <= SPEECH_LIMITS.maxTextBytes)
export function speechEndpoint(baseUrl: string, suffix: string): URL {
  const base = providerBaseUrlSchema.parse(baseUrl)
  const url = new URL(`${base}/${suffix}`)
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error('Speech endpoint requires HTTPS or loopback HTTP')
  return url
}
export function speechWav(pcm: Uint8Array): Uint8Array {
  const wav = Buffer.alloc(44 + pcm.byteLength)
  wav.write('RIFF')
  wav.writeUInt32LE(36 + pcm.byteLength, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(1, 22)
  wav.writeUInt32LE(24000, 24)
  wav.writeUInt32LE(48000, 28)
  wav.writeUInt16LE(2, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(pcm.byteLength, 40)
  wav.set(pcm, 44)
  return wav
}
export class SpeechWorkerSession {
  readonly #controller = new AbortController()
  #realtime: { socket: WebSocket; send: (event: RealtimeClientEvent) => void } | undefined
  #committedId: string | undefined
  #completed: { itemId: string; text: string } | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #partialTimer: ReturnType<typeof setTimeout> | undefined
  #ended = false
  #ready = false
  #finishing = false
  #sequence = 0
  #bytes = 0
  #frames: Uint8Array[] = []
  #itemId: string | undefined
  #text = ''
  constructor(
    readonly request: SpeechWorkerStart,
    readonly post: (event: SpeechWorkerEvent) => void,
    readonly failed: (error: unknown) => void
  ) {}
  async start(): Promise<void> {
    this.#deadline(10000)
    if (this.request.config.mode === 'file') {
      this.#ready = true
      if (this.request.test) {
        this.#frames = [new Uint8Array(48000)]
        this.#bytes = 48000
        await this.#file()
      } else {
        this.#emit('ready')
        this.#deadline(130000)
      }
      return
    }
    const endpoint = speechEndpoint(this.request.config.baseUrl, 'realtime')
    const official = endpoint.origin === 'https://api.openai.com'
    let realtime: { socket: WebSocket; send: (event: RealtimeClientEvent) => void }
    if (endpoint.protocol === 'http:' || this.request.credential === undefined) {
      endpoint.protocol = endpoint.protocol === 'http:' ? 'ws:' : 'wss:'
      endpoint.searchParams.set('intent', 'transcription')
      const socket = new WebSocket(endpoint, {
        maxPayload: 262144,
        perMessageDeflate: false,
        followRedirects: false,
        handshakeTimeout: 10000,
        headers:
          this.request.credential === undefined
            ? {}
            : { Authorization: `Bearer ${this.request.credential}` }
      })
      realtime = { socket, send: (event) => socket.send(JSON.stringify(event)) }
      socket.on('error', (error) => this.fail(error))
    } else {
      const sdk = new OpenAIRealtimeWS(
        {
          intent: 'transcription',
          options: {
            maxPayload: 262144,
            perMessageDeflate: false,
            followRedirects: false,
            handshakeTimeout: 10000
          }
        },
        { baseURL: this.request.config.baseUrl, apiKey: this.request.credential ?? '' }
      )
      sdk.on('error', (error) => this.fail(error))
      realtime = sdk
    }
    this.#realtime = realtime
    realtime.socket.on('message', (data) => {
      try {
        this.#message(JSON.parse(data.toString()))
      } catch (err) {
        this.fail(err)
      }
    })
    realtime.socket.on('unexpected-response', (_request, response) => {
      response.resume()
      this.fail(speechHttpFailure(response.statusCode ?? 502))
    })
    realtime.socket.on('close', () => {
      if (!this.#ended) this.fail(new Error('Speech connection closed'))
    })
    realtime.socket.on('open', () =>
      realtime.send({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              transcription: {
                model: this.request.config.model,
                ...(official && supportsSpeechLanguageHints(this.request.config.model)
                  ? { languages: ['zh', 'en'] }
                  : {})
              },
              turn_detection: null
            }
          }
        }
      })
    )
  }
  #message(raw: unknown): void {
    if (this.#ended) return
    const event = z
      .object({
        type: z.string(),
        item_id: z.string().max(200).optional(),
        delta: z.string().optional(),
        transcript: z.string().optional()
      })
      .parse(raw)
    if (
      event.type === 'error' ||
      event.type === 'conversation.item.input_audio_transcription.failed'
    ) {
      this.fail(speechProviderFailure(raw))
      return
    }
    if (event.type === 'session.updated') {
      if (this.#ready) return
      this.#ready = true
      if (this.request.test) {
        this.#emit('final', '')
        this.close()
      } else {
        this.#emit('ready')
        this.#deadline(130000)
      }
      return
    }
    if (event.type === 'input_audio_buffer.committed') {
      if (
        !this.#finishing ||
        event.item_id === undefined ||
        (this.#itemId !== undefined && this.#itemId !== event.item_id)
      )
        throw new Error('Unexpected committed speech turn')
      this.#committedId = event.item_id
      this.#complete()
      return
    }
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      if (
        event.item_id === undefined ||
        (this.#itemId !== undefined && this.#itemId !== event.item_id)
      )
        throw new Error('Unexpected speech turn')
      this.#itemId = event.item_id
      this.#text = normalizeSpeechDelta(this.#text, event.delta ?? '')
      if (this.#partialTimer === undefined)
        this.#partialTimer = setTimeout(() => {
          this.#partialTimer = undefined
          if (!this.#ended) this.#emit('partial', this.#text)
        }, 100)
      return
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      if (
        !this.#finishing ||
        event.item_id === undefined ||
        (this.#itemId !== undefined && this.#itemId !== event.item_id)
      )
        throw new Error('Unexpected final speech turn')
      this.#completed = { itemId: event.item_id, text: textSchema.parse(event.transcript) }
      this.#complete()
    }
  }
  #complete(): void {
    if (this.#completed === undefined || this.#committedId === undefined) return
    if (this.#completed.itemId !== this.#committedId)
      throw new Error('Speech final capability mismatch')
    this.#emit('final', this.#completed.text)
    this.close()
  }

  command(command: SpeechWorkerCommand): void {
    if (this.#ended) return
    if (command.type === 'speech-cancel') {
      this.close()
      return
    }
    if (command.type === 'speech-finish') {
      if (this.#finishing) return
      this.#finishing = true
      if (this.#bytes === 0) {
        this.#emit('final', '')
        this.close()
        return
      }
      if (this.request.config.mode === 'file') {
        void this.#file().catch((error) => this.fail(error))
      } else {
        this.#deadline(15000)
        if ((this.#realtime?.socket.bufferedAmount ?? 0) > 132000)
          throw new SpeechFailure('Speech network cannot keep up. Try a shorter recording.')
        this.#realtime?.send({ type: 'input_audio_buffer.commit' })
      }
      return
    }
    if (
      !this.#ready ||
      this.#finishing ||
      command.sequence !== this.#sequence ||
      this.#bytes + command.pcm.byteLength > SPEECH_LIMITS.maxAudioBytes
    )
      throw new Error('Speech audio sequence or budget is invalid')
    this.#sequence++
    this.#bytes += command.pcm.byteLength
    if (this.request.config.mode === 'file') {
      this.#frames.push(command.pcm.slice())
      return
    }
    const realtime = this.#realtime
    const event = {
      type: 'input_audio_buffer.append' as const,
      audio: Buffer.from(command.pcm).toString('base64')
    }
    if (
      realtime === undefined ||
      realtime.socket.bufferedAmount + Buffer.byteLength(JSON.stringify(event)) > 132000
    )
      throw new SpeechFailure('Speech network cannot keep up. Try a shorter recording.')
    realtime.send(event)
  }
  fail(error: unknown): void {
    if (this.#ended) return
    const failure = speechProviderFailure(error)
    const original =
      error instanceof Error ? error : new Error('Speech provider protocol error', { cause: error })
    prepareSpeechErrorForLogging(original, [
      this.request.config.baseUrl,
      ...(this.request.credential === undefined ? [] : [this.request.credential])
    ])
    this.failed(original)
    this.#emit('error', undefined, speechErrorMessage(failure), failure)
    this.close()
  }
  close(): void {
    if (this.#ended) return
    this.#ended = true
    clearTimeout(this.#timer)
    clearTimeout(this.#partialTimer)
    this.#controller.abort()
    this.#frames = []
    this.#realtime?.socket.terminate()
    this.#realtime = undefined
  }
  async #file(): Promise<void> {
    this.#deadline(60000)
    const endpoint = speechEndpoint(this.request.config.baseUrl, 'audio/transcriptions')
    const pcm = Buffer.concat(this.#frames)
    this.#frames = []
    const form = new FormData()
    form.set('model', this.request.config.model)
    form.set('response_format', 'json')
    form.set(
      'file',
      new Blob([new Uint8Array(speechWav(pcm))], { type: 'audio/wav' }),
      'speech.wav'
    )
    if (
      endpoint.origin === 'https://api.openai.com' &&
      supportsSpeechLanguageHints(this.request.config.model)
    ) {
      form.append('languages[]', 'zh')
      form.append('languages[]', 'en')
    }
    const response = await fetchConfiguredEndpoint(endpoint, {
      method: 'POST',
      body: form,
      signal: this.#controller.signal,
      headers:
        this.request.credential === undefined
          ? {}
          : { Authorization: `Bearer ${this.request.credential}` }
    })
    if (!response.ok) {
      await response.body?.cancel()
      throw speechHttpFailure(response.status)
    }
    const result = z
      .object({ text: textSchema })
      .parse(JSON.parse(await readBoundedText(response, 262144)))
    if (!this.#ended) {
      this.#emit('final', result.text)
      this.close()
    }
  }
  #emit(
    state: SpeechWorkerEvent['state'],
    text?: string,
    error?: string,
    failure?: SpeechFailure
  ): void {
    this.post({
      type: 'speech-event',
      requestId: this.request.requestId,
      projectSessionId: this.request.projectSessionId,
      state,
      ...(text === undefined ? {} : { text }),
      ...(error === undefined ? {} : { error }),
      ...(failure?.providerCode === undefined ? {} : { errorCode: failure.providerCode }),
      ...(failure?.providerParam === undefined ? {} : { errorParam: failure.providerParam })
    })
  }
  #deadline(ms: number): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => this.fail(new SpeechFailure('Speech connection timed out.')), ms)
  }
}

export function normalizeSpeechDelta(previous: string, delta: string): string {
  return textSchema.parse(previous + delta)
}

function supportsSpeechLanguageHints(model: string): boolean {
  return model === 'gpt-live-transcribe' || model === 'gpt-transcribe'
}
