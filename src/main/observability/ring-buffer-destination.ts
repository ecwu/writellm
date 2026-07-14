import { Writable } from 'node:stream'
import { diagnosticLogSchema } from '../../shared/observability/log-schema'
import { redactLogValue } from './redact'
import type { LogRingBuffer } from './log-ring-buffer'

export class RingBufferDestination extends Writable {
  #pending = ''

  constructor(private readonly ringBuffer: LogRingBuffer) {
    super()
  }

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error) => void
  ): void {
    this.#pending += chunk.toString()
    const lines = this.#pending.split('\n')
    this.#pending = lines.pop() ?? ''

    for (const line of lines) {
      if (line.length === 0) continue
      try {
        const parsed = diagnosticLogSchema.parse(redactLogValue(JSON.parse(line)))
        this.ringBuffer.push(parsed)
      } catch (error) {
        callback(
          error instanceof Error ? error : new Error('Invalid ring buffer output', { cause: error })
        )
        return
      }
    }
    callback()
  }
}
