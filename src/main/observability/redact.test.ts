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
      filePath: '[REDACTED_PATH]'
    })
  })

  it('redacts credentials embedded inside error text rather than only object keys', () => {
    const serialized = JSON.stringify(
      redactLogValue({
        message: 'HTTP 401 api_key=private-key Authorization: Bearer private-bearer',
        cause: 'Cookie: session=private-cookie',
        stack: 'at file:///workspace/private-file.md and https://host.test/a?signature=private-sig'
      })
    )
    expect(serialized).toContain('HTTP 401')
    for (const privateValue of [
      'private-key',
      'private-bearer',
      'private-cookie',
      'private-file',
      'private-sig'
    ]) {
      expect(serialized).not.toContain(privateValue)
    }
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
