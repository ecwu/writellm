import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from '../../shared/security/urls'

describe('isAllowedExternalUrl', () => {
  it('allows only web URLs', () => {
    expect(isAllowedExternalUrl('https://electron-vite.org')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost')).toBe(true)
    expect(isAllowedExternalUrl('file:///tmp/secret')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
  })
})
