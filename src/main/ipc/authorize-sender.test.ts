import { describe, expect, it } from 'vitest'
import { isTrustedRendererUrl } from './authorize-sender'

describe('isTrustedRendererUrl', () => {
  it('accepts only the application origin in production', () => {
    expect(isTrustedRendererUrl('writellm://bundle/index.html')).toBe(true)
    expect(isTrustedRendererUrl('writellm://evil/index.html')).toBe(false)
    expect(isTrustedRendererUrl('file:///tmp/index.html')).toBe(false)
  })

  it('accepts the configured development origin exactly', () => {
    const developmentUrl = 'http://localhost:5173'
    expect(isTrustedRendererUrl('http://localhost:5173/src/main.tsx', developmentUrl)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost.evil:5173', developmentUrl)).toBe(false)
  })
})
