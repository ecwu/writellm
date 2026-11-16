import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SpeechCapture, SpeechCapturePreparationError } from './speech-capture'
import { replaceSpeechSelection } from './use-speech-draft'

describe('speech PCM worklet', () => {
  function processor() {
    const messages: Array<{ pcm?: Uint8Array; flushed?: boolean }> = []
    let Processor:
      | (new () => {
          port: { onmessage: (event: { data: string }) => void }
          process: (inputs: Float32Array[][]) => boolean
        })
      | undefined
    runInNewContext(
      readFileSync(resolve('src/renderer/public/audio/speech-capture.worklet.js'), 'utf8'),
      {
        AudioWorkletProcessor: class {
          port = {
            postMessage: (message: { pcm?: Uint8Array; flushed?: boolean }) =>
              messages.push(structuredClone(message))
          }
        },
        registerProcessor: (_name: string, value: typeof Processor) => {
          Processor = value
        }
      }
    )
    if (!Processor) throw new Error('Worklet processor missing')
    return { worklet: new Processor(), messages }
  }
  it('emits 100ms mono PCM16 frames, clips samples and flushes the tail before ack', () => {
    const { worklet, messages } = processor()
    const samples = new Float32Array(2403)
    samples[0] = -2
    samples[1] = 2
    samples[2] = 0.5
    worklet.process([[samples]])
    expect(messages).toHaveLength(1)
    expect(messages[0].pcm).toHaveLength(4800)
    const pcm = messages[0].pcm
    if (!pcm) throw new Error('PCM frame missing')
    const view = new DataView(pcm.buffer)
    expect([view.getInt16(0, true), view.getInt16(2, true), view.getInt16(4, true)]).toEqual([
      -32768, 32767, 16384
    ])
    worklet.port.onmessage({ data: 'finish' })
    expect(messages[1].pcm).toHaveLength(6)
    expect(messages[2]).toEqual({ flushed: true })
    worklet.port.onmessage({ data: 'finish' })
    expect(messages).toHaveLength(3)
    expect(worklet.process([[samples]])).toBe(false)
  })
  it('does not invent audio for absent input or send empty tail frames', () => {
    const { worklet, messages } = processor()
    worklet.process([])
    worklet.port.onmessage({ data: 'finish' })
    expect(messages).toEqual([{ flushed: true }])
  })
})

describe('speech capture lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })
  function setup() {
    const stop = vi.fn()
    const close = vi.fn(async () => {})
    const addModule = vi.fn(async () => {})
    const resume = vi.fn(async () => {})
    const connect = vi.fn(function (this: unknown) {
      return this
    })
    const disconnect = vi.fn()
    const nodes: Array<{
      port: {
        onmessage: ((event: { data: unknown }) => void) | null
        postMessage: ReturnType<typeof vi.fn>
        close: ReturnType<typeof vi.fn>
      }
    }> = []
    const stream = {
      getTracks: () => [{ stop }],
      getAudioTracks: () => [{ addEventListener: vi.fn() }]
    }
    const getUserMedia = vi.fn(async (): Promise<MediaStream> => stream as unknown as MediaStream)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('document', { baseURI: 'writellm://bundle/index.html' })
    vi.stubGlobal(
      'AudioContext',
      class {
        sampleRate = 24000
        state: AudioContextState = 'suspended'
        destination = {}
        audioWorklet = { addModule }
        close = close
        resume = resume
        createMediaStreamSource = vi.fn(() => ({ connect, disconnect }))
        createAnalyser = vi.fn(() => ({
          fftSize: 256,
          connect,
          disconnect,
          getFloatTimeDomainData: (samples: Float32Array) => samples.fill(0)
        }))
        createGain = vi.fn(() => ({ gain: { value: 1 }, connect, disconnect }))
      }
    )
    vi.stubGlobal(
      'AudioWorkletNode',
      class {
        connect = connect
        disconnect = disconnect
        port = {
          onmessage: null as ((event: { data: unknown }) => void) | null,
          postMessage: vi.fn(),
          close: vi.fn()
        }
        constructor() {
          nodes.push(this)
        }
      }
    )
    return { stop, close, getUserMedia, nodes, addModule, resume }
  }
  it('bounds unresolved microphone preparation and stops a stream that arrives after timeout', async () => {
    vi.useFakeTimers()
    const { stop, getUserMedia, addModule } = setup()
    let resolveStream: ((stream: MediaStream) => void) | undefined
    getUserMedia.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve
        })
    )
    const capture = new SpeechCapture(vi.fn(), vi.fn(), vi.fn())
    const starting = expect(capture.start()).rejects.toMatchObject({
      code: 'speech_capture_microphone_timeout',
      stage: 'microphone',
      safeMessage: 'Microphone preparation timed out. Check the input device and try again.'
    })
    await vi.advanceTimersByTimeAsync(10000)
    await starting
    expect(addModule).not.toHaveBeenCalled()
    resolveStream?.({ getTracks: () => [{ stop }] } as unknown as MediaStream)
    await Promise.resolve()
    expect(stop).toHaveBeenCalledTimes(1)
  })
  it('preserves an original preparation rejection with bounded stage-only diagnostic fields', async () => {
    const { getUserMedia } = setup()
    const original = new Error('device internal detail')
    getUserMedia.mockRejectedValue(original)
    const capture = new SpeechCapture(vi.fn(), vi.fn(), vi.fn())
    try {
      await capture.start()
      throw new Error('Expected microphone rejection')
    } catch (err) {
      expect(err).toBeInstanceOf(SpeechCapturePreparationError)
      expect(err).toMatchObject({
        stage: 'microphone',
        code: 'speech_capture_microphone_failed',
        cause: original
      })
      expect((err as Error).message).not.toContain('device internal detail')
    }
  })
  it('bounds a stalled worklet load and releases the stream and context', async () => {
    vi.useFakeTimers()
    const { addModule, stop, close, nodes, resume } = setup()
    addModule.mockImplementation(() => new Promise(() => {}))
    const capture = new SpeechCapture(vi.fn(), vi.fn(), vi.fn())
    const starting = expect(capture.start()).rejects.toMatchObject({
      code: 'speech_capture_worklet_timeout',
      stage: 'worklet'
    })
    await vi.advanceTimersByTimeAsync(10000)
    await starting
    expect(stop).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(nodes).toHaveLength(0)
    expect(resume).not.toHaveBeenCalled()
  })
  it('bounds a suspended context resume and releases capture resources', async () => {
    vi.useFakeTimers()
    const { resume, stop, close, nodes } = setup()
    resume.mockImplementation(() => new Promise(() => {}))
    const capture = new SpeechCapture(vi.fn(), vi.fn(), vi.fn())
    const starting = expect(capture.start()).rejects.toMatchObject({
      code: 'speech_capture_context_timeout',
      stage: 'context',
      message: 'speech_capture_context_timeout durationMs=10000 contextState=suspended'
    })
    await vi.advanceTimersByTimeAsync(10000)
    await starting
    expect(stop).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(nodes[0].port.close).toHaveBeenCalledTimes(1)
  })
  it('cancels preparation immediately without waiting for a pending microphone result', async () => {
    const { getUserMedia } = setup()
    getUserMedia.mockImplementation(() => new Promise(() => {}))
    const capture = new SpeechCapture(vi.fn(), vi.fn(), vi.fn())
    const starting = capture.start()
    capture.dispose()
    await starting
  })
  it('does not initialize a worklet after cancellation during its module load', async () => {
    const { addModule, close, stop, nodes } = setup()
    let completeModule: (() => void) | undefined
    addModule.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeModule = resolve
        })
    )
    const capture = new SpeechCapture(vi.fn(), vi.fn(), vi.fn())
    const starting = capture.start()
    await Promise.resolve()
    await Promise.resolve()
    capture.dispose()
    await starting
    completeModule?.()
    await Promise.resolve()
    expect(stop).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(nodes).toHaveLength(0)
  })
  it('uses one stream, waits for tail acknowledgement and pending IPC before closing', async () => {
    const { stop, close, getUserMedia, nodes } = setup()
    const sent: Uint8Array[] = []
    let release: (() => void) | undefined
    const capture = new SpeechCapture(
      async (pcm) => {
        sent.push(pcm)
        await new Promise<void>((done) => {
          release = done
        })
      },
      vi.fn(),
      vi.fn()
    )
    await capture.start()
    const finishing = capture.finish()
    expect(nodes[0].port.postMessage).toHaveBeenCalledWith('finish')
    nodes[0].port.onmessage?.({ data: { pcm: new Uint8Array([1, 0]) } })
    nodes[0].port.onmessage?.({ data: { flushed: true } })
    await Promise.resolve()
    expect(stop).toHaveBeenCalledTimes(1)
    release?.()
    await finishing
    expect(sent).toEqual([new Uint8Array([1, 0])])
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    capture.dispose()
    expect(stop).toHaveBeenCalledTimes(1)
  })
  it('fails a missing flush acknowledgement within a bounded deadline and stops tracks', async () => {
    vi.useFakeTimers()
    const { stop } = setup()
    const capture = new SpeechCapture(vi.fn(), vi.fn(), vi.fn())
    await capture.start()
    const finishing = expect(capture.finish()).rejects.toThrow('speech_capture_flush_timeout')
    await vi.advanceTimersByTimeAsync(1500)
    await finishing
    expect(stop).toHaveBeenCalledTimes(1)
  })
  it('bounds worklet loading and preserves the failed stage in diagnostics', async () => {
    vi.useFakeTimers()
    const { addModule, close, stop } = setup()
    addModule.mockImplementation(() => new Promise(() => {}))
    const capture = new SpeechCapture(vi.fn(), vi.fn(), vi.fn())
    const starting = expect(capture.start()).rejects.toMatchObject({
      name: 'SpeechCapturePreparationError',
      code: 'speech_capture_worklet_timeout',
      stage: 'worklet',
      safeMessage: 'Speech audio processing could not load. Try dictation again.',
      cause: expect.objectContaining({ message: 'speech_capture_preparation_deadline' })
    })
    await vi.advanceTimersByTimeAsync(10000)
    await starting
    expect(stop).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })
  it('bounds a stalled audio IPC drain and releases the microphone before waiting', async () => {
    vi.useFakeTimers()
    const { stop, nodes } = setup()
    const capture = new SpeechCapture(() => new Promise<void>(() => {}), vi.fn(), vi.fn())
    await capture.start()
    nodes[0].port.onmessage?.({ data: { pcm: new Uint8Array([1, 0]) } })
    const finishing = expect(capture.finish()).rejects.toThrow('speech_audio_flush_timeout')
    nodes[0].port.onmessage?.({ data: { flushed: true } })
    await Promise.resolve()
    expect(stop).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1500)
    await finishing
  })
  it('reports real silent input as zero and stops meter updates on disposal', async () => {
    vi.useFakeTimers()
    setup()
    const volume = vi.fn()
    const capture = new SpeechCapture(vi.fn(), volume, vi.fn())
    await capture.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(volume.mock.calls).toEqual([[0], [0]])
    capture.dispose()
    await vi.advanceTimersByTimeAsync(100)
    expect(volume).toHaveBeenCalledTimes(2)
  })
  it('cancels a pending permission result without retaining its stream', async () => {
    const { stop, getUserMedia } = setup()
    let resolveStream: ((stream: MediaStream) => void) | undefined
    const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream
    getUserMedia.mockImplementation(
      () =>
        new Promise((done) => {
          resolveStream = done
        })
    )
    const capture = new SpeechCapture(vi.fn(), vi.fn(), vi.fn())
    const starting = capture.start()
    capture.dispose()
    resolveStream?.(stream)
    await starting
    expect(stop).toHaveBeenCalledTimes(1)
  })
})

it('replaces the selected draft range while preserving surrounding text and Unicode', () => {
  expect(replaceSpeechSelection('请改这里，保留引用。', 2, 4, '研究背景')).toBe(
    '请改研究背景，保留引用。'
  )
  expect(replaceSpeechSelection('原稿', 2, 2, '补充')).toBe('原稿补充')
})
