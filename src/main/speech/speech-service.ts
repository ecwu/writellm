import { currentLogContext } from '../observability/log-context'
import { prepareSpeechErrorForLogging, SpeechFailure } from '../../shared/speech-errors'
import { randomUUID } from 'node:crypto'
import type { Logger } from 'pino'
import {
  SPEECH_LIMITS,
  speechAudioSchema,
  speechEventSchema,
  type SpeechAudio,
  type SpeechEvent,
  type SpeechWorkerCommand,
  type SpeechStartResult
} from '../../shared/contracts/speech'
import type { ProviderService } from '../providers/provider-service'
import type { SpeechClient } from './speech-client'

interface ActiveSpeech {
  recognitionId: string
  projectSessionId: string | null
  senderId: number
  controller: AbortController
  sequence: number
  bytes: number
  eventSequence: number
  finishing: boolean
  ready: boolean
  timer: ReturnType<typeof setTimeout>
}
export class SpeechService {
  #active: ActiveSpeech | undefined
  constructor(
    readonly options: {
      providers: Pick<ProviderService, 'withSpeechProvider'>
      client: SpeechClient
      log: Logger
      assertSession: (id: string) => unknown
      prepareCapture?: () => Promise<void>
      emit: (senderId: number, event: SpeechEvent) => void
    }
  ) {}
  async start(senderId: number, projectSessionId: string): Promise<SpeechStartResult> {
    this.options.assertSession(projectSessionId)
    return this.#begin(senderId, projectSessionId, false) as Promise<SpeechStartResult>
  }
  async testConnection(senderId: number, sourceId?: string): Promise<void> {
    await this.#begin(senderId, null, true, sourceId)
  }
  async #begin(
    senderId: number,
    projectSessionId: string | null,
    test: boolean,
    sourceId?: string
  ): Promise<SpeechStartResult | undefined> {
    if (this.#active !== undefined) throw new Error('Speech is already active')
    const recognitionId = randomUUID()
    const controller = new AbortController()
    const active: ActiveSpeech = {
      recognitionId,
      projectSessionId,
      senderId,
      controller,
      sequence: 0,
      bytes: 0,
      eventSequence: 0,
      finishing: false,
      ready: false,
      timer: setTimeout(() => controller.abort(), test ? 70000 : 190000)
    }
    this.#active = active
    let resolveReady: () => void = () => undefined
    let rejectReady: (error: unknown) => void = () => undefined
    const ready = new Promise<void>((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    const completion = this.options.providers.withSpeechProvider(async (config, credential) => {
      if (!test) await this.options.prepareCapture?.()
      if (this.#active !== active || controller.signal.aborted) throw new Error('Speech cancelled')
      if (projectSessionId !== null) this.options.assertSession(projectSessionId)
      let failureDelivered = false
      const workerCompletion = this.options.client.start(
        {
          type: 'speech-start',
          context: currentLogContext(),
          requestId: recognitionId,
          projectSessionId,
          config: { baseUrl: config.baseUrl, model: config.model, mode: config.mode },
          ...(credential === undefined ? {} : { credential }),
          test
        },
        controller.signal,
        (message) => {
          if (this.#active !== active || controller.signal.aborted) return
          if (projectSessionId !== null) this.options.assertSession(projectSessionId)
          if (message.state === 'ready') {
            this.options.log.info(
              { event: 'speech.recognition.ready', recognitionId, mode: config.mode },
              'Speech provider ready'
            )
            active.ready = true
            resolveReady()
            return
          }
          if (message.state === 'error') {
            if (!test) {
              failureDelivered = true
              this.#emit(active, 'error', undefined, message.error ?? 'Speech failed', message)
            }
            return
          }
          if (message.state === 'final') {
            if (!test) this.#emit(active, 'final', message.text ?? '')
            resolveReady()
            return
          }
          if (!test) this.#emit(active, 'partial', message.text ?? '')
        }
      )
      const settled = workerCompletion
        .catch((err) => {
          if (!test) rejectReady(err)
          prepareSpeechErrorForLogging(err)
          this.options.log.error(
            {
              event: 'speech.recognition.failed',
              err,
              recognitionId,
              ...(err instanceof SpeechFailure
                ? { providerCode: err.providerCode, providerParam: err.providerParam }
                : {})
            },
            'Speech recognition failed'
          )
          if (!test && !failureDelivered && this.#active === active && !controller.signal.aborted) {
            try {
              this.#emit(active, 'error', undefined, 'Speech recognition failed.')
            } catch (deliveryError) {
              this.options.log.error(
                { event: 'speech.error_delivery.failed', err: deliveryError, recognitionId },
                'Speech capability ended before error delivery'
              )
            }
          }
          if (test) throw err
        })
        .finally(() => this.#release(active))
      if (test) {
        await settled
        return
      }
      await ready
      if (this.#active !== active || controller.signal.aborted) throw new Error('Speech cancelled')
      return {
        recognitionId,
        mode: config.mode,
        sampleRate: 24000 as const,
        channels: 1 as const,
        maxDurationMs: 120000 as const,
        maxFrameBytes: 4800 as const
      }
    }, sourceId)
    try {
      return await completion
    } catch (err) {
      prepareSpeechErrorForLogging(err)
      this.options.log.error(
        { event: 'speech.start.failed', err, recognitionId },
        'Speech request failed'
      )
      this.#release(active)
      throw new SpeechFailure(
        err instanceof SpeechFailure
          ? err.safeMessage
          : 'Speech could not start. Check the configuration and connection.',
        {
          cause: err,
          ...(err instanceof SpeechFailure
            ? { providerCode: err.providerCode, providerParam: err.providerParam }
            : {})
        }
      )
    }
  }

  pushAudio(senderId: number, input: SpeechAudio): void {
    const frame = speechAudioSchema.parse(input)
    const active = this.#owned(senderId, frame.projectSessionId, frame.recognitionId)
    if (!active) throw new Error('Speech recognition is no longer active')
    if (
      !active.ready ||
      active.finishing ||
      frame.sequence !== active.sequence ||
      active.bytes + frame.pcm.byteLength > SPEECH_LIMITS.maxAudioBytes
    ) {
      this.#release(active)
      throw new Error('Speech audio sequence or budget is invalid')
    }
    active.sequence++
    active.bytes += frame.pcm.byteLength
    this.#send(active, {
      type: 'speech-audio',
      requestId: active.recognitionId,
      projectSessionId: frame.projectSessionId,
      sequence: frame.sequence,
      pcm: frame.pcm
    })
  }
  finish(senderId: number, input: { projectSessionId: string; recognitionId: string }): void {
    const active = this.#owned(senderId, input.projectSessionId, input.recognitionId)
    if (!active) throw new Error('Speech recognition is no longer active')
    if (active.finishing) return
    active.finishing = true
    this.#send(active, {
      type: 'speech-finish',
      requestId: active.recognitionId,
      projectSessionId: input.projectSessionId
    })
  }
  cancel(senderId: number, input: { projectSessionId: string; recognitionId: string }): void {
    const active = this.#owned(senderId, input.projectSessionId, input.recognitionId)
    if (active) this.#release(active)
  }
  cancelTest(senderId: number): void {
    const active = this.#active
    if (active?.projectSessionId === null && active.senderId === senderId) this.#release(active)
  }
  revokeSession(id: string): void {
    if (this.#active?.projectSessionId === id) this.#release(this.#active)
  }
  revokeSender(id: number): void {
    if (this.#active?.senderId === id) this.#release(this.#active)
  }
  close(): void {
    if (this.#active) this.#release(this.#active)
    this.options.client.terminate()
  }
  #send(active: ActiveSpeech, command: SpeechWorkerCommand): void {
    try {
      this.options.client.send(command)
    } catch (err) {
      prepareSpeechErrorForLogging(err)
      this.options.log.error(
        { event: 'speech.command.failed', err, recognitionId: active.recognitionId },
        'Speech worker command failed'
      )
      this.#release(active)
      throw new Error('Speech worker is unavailable.', { cause: err })
    }
  }
  #owned(senderId: number, projectSessionId: string, id: string): ActiveSpeech | undefined {
    this.options.assertSession(projectSessionId)
    const active = this.#active
    if (active?.recognitionId !== id) return undefined
    if (active.projectSessionId !== projectSessionId || active.senderId !== senderId)
      throw new Error('Speech recognition belongs to another window')
    return active
  }
  #emit(
    active: ActiveSpeech,
    state: SpeechEvent['state'],
    text?: string,
    error?: string,
    metadata?: { errorCode?: SpeechEvent['errorCode']; errorParam?: SpeechEvent['errorParam'] }
  ): void {
    if (active.projectSessionId === null) return
    this.options.assertSession(active.projectSessionId)
    this.options.emit(
      active.senderId,
      speechEventSchema.parse({
        recognitionId: active.recognitionId,
        projectSessionId: active.projectSessionId,
        sequence: active.eventSequence++,
        state,
        ...(text === undefined ? {} : { text }),
        ...(error === undefined ? {} : { error }),
        ...(metadata?.errorCode === undefined ? {} : { errorCode: metadata.errorCode }),
        ...(metadata?.errorParam === undefined ? {} : { errorParam: metadata.errorParam })
      })
    )
  }
  #release(active: ActiveSpeech): void {
    if (this.#active !== active) return
    this.options.log.info(
      {
        event: 'speech.recognition.released',
        recognitionId: active.recognitionId,
        frameCount: active.sequence,
        audioBytes: active.bytes
      },
      'Speech resources released'
    )
    this.#active = undefined
    clearTimeout(active.timer)
    active.controller.abort()
    this.options.client.reset()
  }
}
