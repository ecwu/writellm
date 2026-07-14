import { describe, expect, it } from 'vitest'
import { currentLogContext, withLogContext } from './log-context'

describe('log context', () => {
  it('propagates and merges immutable async context', async () => {
    await withLogContext({ operationId: 'op-1' }, async () => {
      await Promise.resolve()
      expect(currentLogContext()).toEqual({ operationId: 'op-1' })
      withLogContext({ jobId: 'job-1' }, () => {
        expect(currentLogContext()).toEqual({ operationId: 'op-1', jobId: 'job-1' })
      })
    })
    expect(currentLogContext()).toEqual({})
  })
})
