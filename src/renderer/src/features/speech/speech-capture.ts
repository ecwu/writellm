import { SpeechFailure } from '../../../../shared/speech-errors'

export type SpeechCaptureStage = 'microphone' | 'worklet' | 'context'
const preparationTimeoutMs = 10000
const stageMessages: Record<SpeechCaptureStage, string> = {
  microphone: 'Microphone preparation timed out. Check the input device and try again.',
  worklet: 'Speech audio processing could not load. Try dictation again.',
  context: 'Audio capture could not start. Try dictation again.'
}

export class SpeechCapturePreparationError extends SpeechFailure {
  readonly code: string
  constructor(
    readonly stage: SpeechCaptureStage,
    durationMs: number,
    contextState: AudioContextState | 'absent',
    timeout: boolean,
    cause: unknown
  ) {
    super(stage === 'microphone' && !timeout ? stageMessages.context : stageMessages[stage], {
      cause
    })
    this.name = 'SpeechCapturePreparationError'
    this.code = `speech_capture_${stage}_${timeout ? 'timeout' : 'failed'}`
    this.message = `${this.code} durationMs=${durationMs} contextState=${contextState}`
  }
}

class CaptureCancelled extends Error {}

/** One microphone stream supplies both PCM capture and the local volume meter. */
export class SpeechCapture {
  private stream: MediaStream | null = null
  private context: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private analyser: AnalyserNode | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private muted: GainNode | null = null
  private meter: ReturnType<typeof setInterval> | null = null
  private closed = false
  private pending = 0
  private queued = Promise.resolve()
  private flush: (() => void) | null = null
  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private cancelPreparation: (() => void) | null = null

  constructor(
    private readonly send: (pcm: Uint8Array) => Promise<void>,
    private readonly onVolume: (level: number) => void,
    private readonly onError: (err: unknown) => void
  ) {}

  private prepare<T>(
    stage: SpeechCaptureStage,
    operation: () => Promise<T>,
    releaseLate?: (value: T) => void
  ): Promise<T> {
    if (this.closed) return Promise.reject(new CaptureCancelled())
    const started = Date.now()
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const settle = (error?: unknown): boolean => {
        if (settled) return false
        settled = true
        clearTimeout(timer)
        this.cancelPreparation = null
        if (error !== undefined) reject(error)
        return true
      }
      const failure = (error: unknown, timeout = false): void => {
        const wrapped = new SpeechCapturePreparationError(
          stage,
          Date.now() - started,
          this.context?.state ?? 'absent',
          timeout,
          error
        )
        if (!settle(wrapped)) this.onError(wrapped)
      }
      const timer = setTimeout(
        () => failure(new Error('speech_capture_preparation_deadline'), true),
        preparationTimeoutMs
      )
      this.cancelPreparation = () => settle(new CaptureCancelled())
      try {
        void operation().then(
          (value) => {
            if (settle()) resolve(value)
            else releaseLate?.(value)
          },
          (err: unknown) => failure(err)
        )
      } catch (err) {
        failure(err)
      }
    })
  }

  async start(): Promise<void> {
    try {
      await this.startCapture()
    } catch (err) {
      this.dispose()
      if (!(err instanceof CaptureCancelled)) throw err
    }
  }

  private async startCapture(): Promise<void> {
    const stream = await this.prepare(
      'microphone',
      () =>
        navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, sampleRate: 24000 },
          video: false
        }),
      (lateStream) => {
        for (const track of lateStream.getTracks()) track.stop()
      }
    )
    if (this.closed) {
      for (const track of stream.getTracks()) track.stop()
      return
    }
    this.stream = stream
    for (const track of stream.getAudioTracks()) {
      track.addEventListener(
        'ended',
        () => {
          if (!this.closed) this.onError(new Error('speech_device_disconnected'))
        },
        { once: true }
      )
    }
    const context = new AudioContext({ sampleRate: 24000 })
    this.context = context
    if (context.sampleRate !== 24000) throw new Error('speech_sample_rate_unsupported')
    await this.prepare('worklet', () =>
      context.audioWorklet.addModule(
        new URL('audio/speech-capture.worklet.js', document.baseURI).href
      )
    )
    if (this.closed) return
    this.source = context.createMediaStreamSource(stream)
    this.node = new AudioWorkletNode(context, 'speech-capture', {
      channelCount: 1,
      channelCountMode: 'explicit',
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1]
    })
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 256
    this.analyser.channelCount = 1
    this.analyser.channelCountMode = 'explicit'
    this.muted = context.createGain()
    this.muted.gain.value = 0
    this.source.connect(this.analyser)
    this.source.connect(this.node)
    this.node.connect(this.muted).connect(context.destination)
    this.node.onprocessorerror = () => this.onError(new Error('speech_capture_failed'))
    this.node.port.onmessage = ({
      data
    }: MessageEvent<{ pcm?: Uint8Array; flushed?: boolean }>) => {
      if (data.flushed) {
        this.flush?.()
        return
      }
      if (this.closed || !data.pcm) return
      if (++this.pending > 20) {
        this.onError(new Error('speech_audio_backlog'))
        return
      }
      const pcm = data.pcm
      this.queued = this.queued
        .then(async () => {
          try {
            if (!this.closed) await this.send(pcm)
          } finally {
            this.pending--
          }
        })
        .catch((err: unknown) => {
          this.onError(err)
        })
    }
    const samples = new Float32Array(this.analyser.fftSize)
    this.meter = setInterval(() => {
      if (!this.analyser || this.closed) return
      this.analyser.getFloatTimeDomainData(samples)
      const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length)
      this.onVolume(Math.min(1, rms * 5))
    }, 50)
    await this.prepare('context', () => context.resume())
  }

  async finish(): Promise<void> {
    if (this.closed || !this.node) return
    if (this.meter) clearInterval(this.meter)
    // Ack is sent after the tail PCM on this same ordered MessagePort.
    try {
      await new Promise<void>((resolve, reject) => {
        this.flush = resolve
        this.flushTimer = setTimeout(() => reject(new Error('speech_capture_flush_timeout')), 1500)
        this.node?.port.postMessage('finish')
      })
      for (const track of this.stream?.getTracks() ?? []) track.stop()
      this.stream = null
      this.source?.disconnect()
      if (this.flushTimer) clearTimeout(this.flushTimer)
      await new Promise<void>((resolve, reject) => {
        this.flushTimer = setTimeout(() => reject(new Error('speech_audio_flush_timeout')), 1500)
        void this.queued.then(resolve, reject)
      })
    } finally {
      this.dispose()
    }
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.cancelPreparation?.()
    this.cancelPreparation = null
    if (this.meter) clearInterval(this.meter)
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.flush?.()
    this.flush = null
    for (const track of this.stream?.getTracks() ?? []) track.stop()
    this.node?.port.close()
    this.node?.disconnect()
    this.source?.disconnect()
    this.analyser?.disconnect()
    this.muted?.disconnect()
    if (this.context) void this.context.close().catch((err: unknown) => this.onError(err))
    this.stream = null
    this.node = null
    this.analyser = null
  }
}
