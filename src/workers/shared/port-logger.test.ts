import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPortLogger } from './port-logger'

describe('createPortLogger', () => {
  afterEach(() => vi.useRealTimers())

  it('batches low-level events and sends errors immediately', () => {
    vi.useFakeTimers()
    const postMessage = vi.fn()
    const log = createPortLogger(
      { postMessage },
      {
        processRole: 'background-worker',
        subsystem: 'worker',
        component: 'test'
      }
    )

    log('info', 'worker.test.started', 'Started')
    expect(postMessage).not.toHaveBeenCalled()
    vi.advanceTimersByTime(75)
    expect(postMessage).toHaveBeenCalledWith([expect.objectContaining({ processSequence: 0 })])

    log('error', 'worker.test.failed', 'Failed')
    expect(postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ processSequence: 1 }))
  })
})
