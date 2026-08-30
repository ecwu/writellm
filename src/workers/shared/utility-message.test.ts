import { describe, expect, it } from 'vitest'
import {
  extractUtilityProjectSessionId,
  extractUtilityRequestId,
  findUtilityHttpStatus,
  INVALID_UTILITY_REQUEST_ID,
  safeUtilityStack
} from './utility-message'

describe('utility message helpers', () => {
  it('projects only bounded worker correlation fields', () => {
    const requestId = '12345678-1234-4234-8234-123456789abc'
    expect(extractUtilityRequestId({ requestId })).toBe(requestId)
    expect(extractUtilityRequestId({ requestId: 'not-a-request-id' })).toBe(
      INVALID_UTILITY_REQUEST_ID
    )
    expect(extractUtilityProjectSessionId({ projectSessionId: 'session-1' })).toBe('session-1')
    expect(extractUtilityProjectSessionId({ projectSessionId: 42 })).toBeNull()
  })

  it('finds a bounded HTTP status through causes and replaces the stack message', () => {
    expect(findUtilityHttpStatus(new Error('outer', { cause: { statusCode: 429 } }))).toBe(429)
    expect(findUtilityHttpStatus({ status: 99 })).toBeUndefined()
    expect(safeUtilityStack('Error: private\n    at worker.ts:1:1', 'Safe failure')).toBe(
      'Safe failure\n    at worker.ts:1:1'
    )
    expect(safeUtilityStack(undefined, 'Safe failure')).toBeUndefined()
  })
})
