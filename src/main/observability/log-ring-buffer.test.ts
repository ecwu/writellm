import { describe, expect, it, vi } from 'vitest'
import { LogRingBuffer } from './log-ring-buffer'

describe('LogRingBuffer', () => {
  it('bounds entries and publishes new events', () => {
    const buffer = new LogRingBuffer(2)
    const listener = vi.fn()
    const unsubscribe = buffer.subscribe(listener)
    buffer.push({ event: 'one' })
    buffer.push({ event: 'two' })
    buffer.push({ event: 'three' })
    unsubscribe()

    expect(buffer.snapshot()).toEqual([{ event: 'two' }, { event: 'three' }])
    expect(listener).toHaveBeenCalledTimes(3)
  })
})
