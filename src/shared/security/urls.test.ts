import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from './urls'

describe('isAllowedExternalUrl', () => {
  it('allows only plain https hostnames without credentials, ports, or localhost', () => {
    expect(isAllowedExternalUrl('https://mineru.net')).toBe(true)
    expect(isAllowedExternalUrl('http://example.com')).toBe(false)
    expect(isAllowedExternalUrl('https://user:pass@allowed.test')).toBe(false)
    expect(isAllowedExternalUrl('https://allowed.test:8443')).toBe(false)
    expect(isAllowedExternalUrl('https://localhost')).toBe(false)
    expect(isAllowedExternalUrl('https://sub.localhost')).toBe(false)
  })

  it('rejects IP literals and trailing-dot hostnames that bypass the host checks', () => {
    expect(isAllowedExternalUrl('https://127.0.0.1')).toBe(false)
    expect(isAllowedExternalUrl('https://127.1')).toBe(false)
    expect(isAllowedExternalUrl('https://0x7f000001')).toBe(false)
    expect(isAllowedExternalUrl('https://2130706433')).toBe(false)
    expect(isAllowedExternalUrl('https://169.254.169.254')).toBe(false)
    expect(isAllowedExternalUrl('https://[::1]')).toBe(false)
    expect(isAllowedExternalUrl('https://allowed.test.')).toBe(false)
  })
})
