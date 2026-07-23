import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { ManuscriptAssetCapabilities } from './asset-capabilities'

describe('ManuscriptAssetCapabilities', () => {
  it('binds preview bytes to an active project session and revalidates every read', async () => {
    let active = true
    const readVerified = vi.fn(async () => ({
      row: { byte_size: 3, mime_type: 'image/png' },
      bytes: Buffer.from([1, 2, 3])
    }))
    const capabilities = new ManuscriptAssetCapabilities({
      isSessionActive: () => active,
      log: pino({ level: 'silent' })
    })
    const issued = capabilities.issue({
      projectSessionId: 'project-session',
      assetId: 'asset-id',
      assets: { readVerified } as never
    })
    const first = await capabilities.handle(new Request(issued.url))
    expect(first?.status).toBe(200)
    expect(first?.headers.get('content-type')).toBe('image/png')
    expect(first?.headers.get('cache-control')).toBe('no-store')
    expect(readVerified).toHaveBeenCalledTimes(1)
    await capabilities.handle(new Request(issued.url, { method: 'HEAD' }))
    expect(readVerified).toHaveBeenCalledTimes(2)

    active = false
    expect((await capabilities.handle(new Request(issued.url)))?.status).toBe(404)
    active = true
    capabilities.revokeSession('project-session')
    expect((await capabilities.handle(new Request(issued.url)))?.status).toBe(404)
  })

  it('does not serve bytes when hash, size, MIME, or storage verification fails', async () => {
    const capabilities = new ManuscriptAssetCapabilities({
      isSessionActive: () => true,
      log: pino({ level: 'silent' })
    })
    const issued = capabilities.issue({
      projectSessionId: 'project-session',
      assetId: 'asset-id',
      assets: { readVerified: async () => Promise.reject(new Error('changed')) } as never
    })
    expect((await capabilities.handle(new Request(issued.url)))?.status).toBe(404)
  })
})
