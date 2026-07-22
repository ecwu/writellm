import { describe, expect, it } from 'vitest'
import { isAllowedExternalUrl } from '../../shared/security/urls'
import {
  isSilentWindowPresentation,
  resolveWindowPresentation,
  WINDOW_PRESENTATION_ENV
} from './window-presentation'

describe('isAllowedExternalUrl', () => {
  it('allows only web URLs', () => {
    expect(isAllowedExternalUrl('https://electron-vite.org')).toBe(true)
    expect(isAllowedExternalUrl('http://localhost')).toBe(false)
    expect(isAllowedExternalUrl('file:///tmp/secret')).toBe(false)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
  })
})

describe('window presentation', () => {
  it('keeps normal launches interactive when no mode is configured', () => {
    expect(resolveWindowPresentation(undefined)).toBe('interactive')
    expect(isSilentWindowPresentation(resolveWindowPresentation(undefined))).toBe(false)
  })

  it('resolves the explicit silent E2E mode', () => {
    expect(resolveWindowPresentation('silent')).toBe('silent-e2e')
    expect(isSilentWindowPresentation(resolveWindowPresentation('silent'))).toBe(true)
  })

  it('accepts explicit interactive mode', () => {
    expect(resolveWindowPresentation('interactive')).toBe('interactive')
  })

  it('rejects an unknown mode', () => {
    expect(() => resolveWindowPresentation('hidden')).toThrow(WINDOW_PRESENTATION_ENV)
  })
})
