import { describe, expect, it } from 'vitest'
import { reconstructUtilityError } from './utility-message'

describe('utility message helpers', () => {
  it('reconstructs bounded worker diagnostics with identity and provider fields', () => {
    const cause = new Error('request failed')
    const error = reconstructUtilityError(
      {
        name: 'ProviderError',
        message: 'Quota exceeded',
        stack: 'ProviderError: Quota exceeded\n    at worker.ts:1:1',
        httpStatus: 429,
        providerCode: 'RATE_LIMIT'
      },
      { cause }
    )

    expect(error).toMatchObject({
      name: 'ProviderError',
      message: 'Quota exceeded',
      stack: 'ProviderError: Quota exceeded\n    at worker.ts:1:1',
      status: 429,
      providerCode: 'RATE_LIMIT',
      cause
    })
  })
})
