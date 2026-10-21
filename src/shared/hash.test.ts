import { describe, expect, it } from 'vitest'
import { sha256 } from './hash'

describe('sha256', () => {
  it('hashes text and bytes with the same digest', () => {
    const expected = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
    expect(sha256('abc')).toBe(expected)
    expect(sha256(new TextEncoder().encode('abc'))).toBe(expected)
  })
})
