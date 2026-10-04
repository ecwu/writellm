import { createHash } from 'node:crypto'
import { PhotonImage, resize, SamplingFilter } from '@silvia-odwyer/photon-node'
import {
  AGENT_IMAGE_MAX_BASE64,
  agentImageContentSchema,
  type AgentImageContent
} from '../shared/contracts/agent-attachments'
import { validateImageBytes } from '../main/manuscript/asset-service'

export function processAgentImage(bytes: Buffer, mimeType: string): AgentImageContent {
  const dimensions = validateImageBytes(bytes, mimeType)
  if (
    mimeType === 'image/webp' &&
    bytes.subarray(12, 16).toString('ascii') === 'VP8X' &&
    ((bytes[20] ?? 0) & 2) !== 0
  ) {
    throw new Error('Animated WebP images are not supported')
  }
  let image = PhotonImage.new_from_byteslice(bytes)
  try {
    if (image.get_width() !== dimensions.width || image.get_height() !== dimensions.height) {
      throw new Error('Decoded image dimensions do not match its header')
    }
    const orientation = mimeType === 'image/jpeg' ? jpegOrientation(bytes) : 1
    if (orientation !== 1) {
      const oriented = orientImage(image, orientation)
      image.free()
      image = oriented
    }
    const ratio = Math.min(1, 2000 / Math.max(image.get_width(), image.get_height()))
    if (ratio < 1) {
      const smaller = resize(
        image,
        Math.max(1, Math.floor(image.get_width() * ratio)),
        Math.max(1, Math.floor(image.get_height() * ratio)),
        SamplingFilter.Lanczos3
      )
      image.free()
      image = smaller
    }
    while (true) {
      const encoded = Buffer.from(image.get_bytes())
      const data = encoded.toString('base64')
      if (data.length < AGENT_IMAGE_MAX_BASE64) {
        return agentImageContentSchema.parse({
          type: 'image',
          data,
          mimeType: 'image/png',
          sha256: createHash('sha256').update(encoded).digest('hex'),
          width: image.get_width(),
          height: image.get_height()
        })
      }
      if (image.get_width() === 1 && image.get_height() === 1)
        throw new Error('Image cannot fit the sending budget')
      const smaller = resize(
        image,
        Math.max(1, Math.floor(image.get_width() * 0.8)),
        Math.max(1, Math.floor(image.get_height() * 0.8)),
        SamplingFilter.Lanczos3
      )
      image.free()
      image = smaller
    }
  } finally {
    image.free()
  }
}

function orientImage(image: PhotonImage, orientation: number): PhotonImage {
  const width = image.get_width()
  const height = image.get_height()
  const swapped = orientation >= 5
  const targetWidth = swapped ? height : width
  const targetHeight = swapped ? width : height
  const source = image.get_raw_pixels()
  const target = new Uint8Array(source.length)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [tx, ty] =
        orientation === 2
          ? [width - 1 - x, y]
          : orientation === 3
            ? [width - 1 - x, height - 1 - y]
            : orientation === 4
              ? [x, height - 1 - y]
              : orientation === 5
                ? [y, x]
                : orientation === 6
                  ? [height - 1 - y, x]
                  : orientation === 7
                    ? [height - 1 - y, width - 1 - x]
                    : [y, width - 1 - x]
      const start = (y * width + x) * 4
      target.set(source.subarray(start, start + 4), (ty * targetWidth + tx) * 4)
    }
  }
  return new PhotonImage(target, targetWidth, targetHeight)
}

export function jpegOrientation(bytes: Buffer): number {
  let offset = 2
  while (offset + 4 <= bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const size = bytes.readUInt16BE(offset + 2)
    if (size < 2 || offset + size + 2 > bytes.length) break
    const segment = bytes.subarray(offset + 4, offset + 2 + size)
    if (marker === 0xe1 && segment.subarray(0, 6).equals(Buffer.from('Exif\0\0'))) {
      const tiff = segment.subarray(6)
      if (tiff.length < 8) throw new Error('JPEG orientation metadata is damaged')
      const little = tiff.toString('ascii', 0, 2) === 'II'
      if (!little && tiff.toString('ascii', 0, 2) !== 'MM')
        throw new Error('JPEG orientation metadata is damaged')
      const u16 = (at: number): number => (little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at))
      const u32 = (at: number): number => (little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at))
      if (u16(2) !== 42) throw new Error('JPEG orientation metadata is damaged')
      const ifd = u32(4)
      if (ifd + 2 > tiff.length) throw new Error('JPEG orientation metadata is damaged')
      const count = u16(ifd)
      if (ifd + 2 + count * 12 > tiff.length)
        throw new Error('JPEG orientation metadata is damaged')
      for (let index = 0; index < count; index += 1) {
        const entry = ifd + 2 + index * 12
        if (u16(entry) !== 0x112) continue
        if (u16(entry + 2) !== 3 || u32(entry + 4) !== 1)
          throw new Error('JPEG orientation metadata is damaged')
        const value = u16(entry + 8)
        if (value < 1 || value > 8) throw new Error('JPEG orientation metadata is damaged')
        return value
      }
    }
    offset += 2 + size
  }
  return 1
}
