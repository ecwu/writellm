import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('renderer content security policy', () => {
  it('allows only the application protocol and inline data for image previews', () => {
    const html = readFileSync(new URL('../../renderer/index.html', import.meta.url), 'utf8')
    const policy = /content="([^"]+)"/.exec(html)?.[1]

    expect(policy).toContain("img-src 'self' data: writellm://bundle")
    expect(policy).toContain('writellm-asset:')
    expect(policy).not.toContain('img-src *')
    expect(policy).not.toContain('img-src http:')
    expect(policy).not.toContain('img-src https:')
    expect(policy).toContain("font-src 'self' data:")
    expect(policy).not.toContain('frame-ancestors')
  })
})
