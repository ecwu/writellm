import { PhotonImage } from '@silvia-odwyer/photon-node'
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { processAgentImage } from './agent-image-process'
import { imageFixture, orientedJpeg } from './agent-image-fixtures.test-support'
import { AGENT_IMAGE_MAX_BASE64 } from '../shared/contracts/agent-attachments'

describe('Agent image processing in Electron', () => {
  it.each(['png', 'jpeg', 'webp'] as const)(
    'decodes %s without upscaling and produces a verified copy',
    (mime) => {
      const result = processAgentImage(imageFixture(3, 2, mime), `image/${mime}`)
      expect(result).toMatchObject({ type: 'image', mimeType: 'image/png', width: 3, height: 2 })
      const bytes = Buffer.from(result.data, 'base64')
      expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
      expect(result.data.length).toBeLessThan(AGENT_IMAGE_MAX_BASE64)
    }
  )
  it('preserves transparent pixels and bounds the longest edge', () => {
    const transparent = processAgentImage(imageFixture(), 'image/png')
    const image = PhotonImage.new_from_byteslice(Buffer.from(transparent.data, 'base64'))
    try {
      expect(image.get_raw_pixels()[3]).toBe(0)
    } finally {
      image.free()
    }
    expect(processAgentImage(imageFixture(2400, 2), 'image/png')).toMatchObject({
      width: 2000,
      height: 1
    })
  })
  it.each([2, 3, 4, 5, 6, 7, 8])('applies JPEG EXIF orientation %s', (orientation) => {
    const result = processAgentImage(orientedJpeg(orientation), 'image/jpeg')
    expect([result.width, result.height]).toEqual(orientation >= 5 ? [2, 3] : [3, 2])
    const original = PhotonImage.new_from_byteslice(imageFixture(3, 2, 'jpeg'))
    const transformed = PhotonImage.new_from_byteslice(Buffer.from(result.data, 'base64'))
    try {
      const firstPixel = Array.from(original.get_raw_pixels().slice(0, 4))
      const position =
        orientation === 2
          ? 2
          : orientation === 3
            ? 5
            : orientation === 4
              ? 3
              : orientation === 5
                ? 0
                : orientation === 6
                  ? 1
                  : orientation === 7
                    ? 5
                    : 4
      expect(
        Array.from(transformed.get_raw_pixels().slice(position * 4, position * 4 + 4))
      ).toEqual(firstPixel)
    } finally {
      original.free()
      transformed.free()
    }
  })
  it('rejects corrupt, oversized, mismatched and animated input before publication', () => {
    expect(() => processAgentImage(Buffer.alloc(10), 'image/png')).toThrow()
    const forged = imageFixture()
    forged.writeUInt32BE(8193, 16)
    expect(() => processAgentImage(forged, 'image/png')).toThrow()
    expect(() => processAgentImage(Buffer.alloc(20 * 1024 * 1024 + 1), 'image/png')).toThrow()
    expect(() => processAgentImage(imageFixture(), 'image/jpeg')).toThrow()
    const animated = Buffer.alloc(30)
    animated.write('RIFF', 0)
    animated.writeUInt32LE(22, 4)
    animated.write('WEBPVP8X', 8)
    animated[20] = 2
    expect(() => processAgentImage(animated, 'image/webp')).toThrow('Animated')
  })
})
