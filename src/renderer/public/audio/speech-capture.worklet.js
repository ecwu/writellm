// Self-contained same-origin AudioWorklet: Chromium owns mono mixing and resampling.
class SpeechCapture extends AudioWorkletProcessor {
  constructor() {
    super()
    this.frame = new Uint8Array(4800)
    this.offset = 0
    this.stopped = false
    this.port.onmessage = ({ data }) => {
      if (data !== 'finish' || this.stopped) return
      this.stopped = true
      if (this.offset > 0) this.port.postMessage({ pcm: this.frame.slice(0, this.offset) })
      this.port.postMessage({ flushed: true })
    }
  }
  process(inputs) {
    if (this.stopped) return false
    const input = inputs[0]?.[0]
    if (!input) return true
    const view = new DataView(this.frame.buffer)
    for (const sample of input) {
      const clipped = Math.max(-1, Math.min(1, sample))
      view.setInt16(this.offset, Math.round(clipped * (clipped < 0 ? 32768 : 32767)), true)
      this.offset += 2
      if (this.offset === this.frame.length) {
        this.port.postMessage({ pcm: this.frame })
        this.offset = 0
      }
    }
    return true
  }
}
registerProcessor('speech-capture', SpeechCapture)
