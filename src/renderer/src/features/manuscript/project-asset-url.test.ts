import { describe, expect, it, vi } from 'vitest'
import { logicalAssetId, resolveProjectAssetUrl } from './project-asset-url'

const ASSET_ID = '019c6a5c-8d34-4a8e-a602-3d37a52dc901'

describe('project asset URL resolution', () => {
  it('leaves BlockNote native image placeholders empty without issuing a capability', async () => {
    const resolveAsset = vi.fn()

    await expect(resolveProjectAssetUrl('', 'project-session', resolveAsset)).resolves.toBe('')
    expect(resolveAsset).not.toHaveBeenCalled()
  })

  it('exchanges only a logical project asset URL for a session-bound preview URL', async () => {
    const resolveAsset = vi.fn(async () => ({
      url: 'writellm://bundle/project-asset/preview-capability'
    }))

    await expect(
      resolveProjectAssetUrl(`writellm-asset:${ASSET_ID}`, 'project-session', resolveAsset)
    ).resolves.toBe('writellm://bundle/project-asset/preview-capability')
    expect(resolveAsset).toHaveBeenCalledWith({
      projectSessionId: 'project-session',
      assetId: ASSET_ID
    })
  })

  it('continues to reject arbitrary image sources', async () => {
    expect(() => logicalAssetId('https://example.com/image.png')).toThrow(
      'Image URL is not a project asset'
    )
    await expect(
      resolveProjectAssetUrl('data:image/png;base64,AAAA', 'project-session', vi.fn())
    ).rejects.toThrow('Image URL is not a project asset')
  })
})
