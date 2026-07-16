import { describe, expect, it } from 'vitest'
import { redactLogValue } from './redact'

describe('redactLogValue', () => {
  it('redacts nested credentials and private absolute paths', () => {
    expect(
      redactLogValue({
        credentials: { apiKey: 'secret' },
        ciphertext: 'encrypted-but-sensitive',
        filePath: '/Users/private/Documents/manuscript.md'
      })
    ).toEqual({
      credentials: '[REDACTED]',
      ciphertext: '[REDACTED]',
      filePath: '[PRIVATE_PATH]'
    })
  })

  it('bounds depth and collection sizes', () => {
    expect(
      redactLogValue({ nested: { one: { two: { three: { four: { five: 'value' } } } } } })
    ).toEqual({
      nested: { one: { two: { three: { four: { five: '[TRUNCATED]' } } } } }
    })
    expect(
      redactLogValue(Array.from({ length: 150 }, (_, index) => index)) as unknown[]
    ).toHaveLength(100)
  })
})
