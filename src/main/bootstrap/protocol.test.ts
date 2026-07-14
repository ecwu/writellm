import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRendererAsset } from './protocol-path'

describe('renderer asset paths', () => {
  const root = resolve('/application/renderer')

  it('resolves application assets inside the renderer root', () => {
    expect(resolveRendererAsset(root, 'writellm://bundle/')).toBe(resolve(root, 'index.html'))
    expect(resolveRendererAsset(root, 'writellm://bundle/assets/app.js')).toBe(
      resolve(root, 'assets/app.js')
    )
  })

  it('rejects unknown origins and traversal', () => {
    expect(resolveRendererAsset(root, 'writellm://other/index.html')).toBeNull()
    expect(resolveRendererAsset(root, 'writellm://bundle/%2e%2e/secret')).toBeNull()
  })
})
