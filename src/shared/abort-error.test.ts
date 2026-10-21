import { describe, expect, it } from 'vitest'
import { createAbortError, isAbortError } from './abort-error'

describe('abort errors', () => {
  it('creates a stable abort error and recognizes only that error name', () => {
    const error = createAbortError('cancelled')
    expect(error).toMatchObject({ name: 'AbortError', message: 'cancelled' })
    expect(isAbortError(error)).toBe(true)
    expect(isAbortError(new Error('cancelled'))).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })

  it('preserves an underlying cancellation cause', () => {
    const cause = new Error('transport stopped')
    expect(createAbortError('cancelled', { cause })).toMatchObject({ name: 'AbortError', cause })
  })
})
