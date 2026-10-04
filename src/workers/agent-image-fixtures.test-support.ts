import { PhotonImage } from '@silvia-odwyer/photon-node'

export function imageFixture(width = 3, height = 2, mime: 'png' | 'jpeg' | 'webp' = 'png'): Buffer {
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set([index % 255, 80, 140, mime === 'png' && index === 0 ? 0 : 255], index)
  }
  const image = new PhotonImage(pixels, width, height)
  try {
    return Buffer.from(
      mime === 'jpeg'
        ? image.get_bytes_jpeg(90)
        : mime === 'webp'
          ? image.get_bytes_webp()
          : image.get_bytes()
    )
  } finally {
    image.free()
  }
}

export function orientedJpeg(orientation: number): Buffer {
  const bytes = imageFixture(3, 2, 'jpeg')
  const exif = Buffer.from(
    '45786966000049492a0008000000010012010300010000000100000000000000',
    'hex'
  )
  exif.writeUInt16LE(orientation, 24)
  const marker = Buffer.alloc(4)
  marker.writeUInt16BE(0xffe1, 0)
  marker.writeUInt16BE(exif.length + 2, 2)
  return Buffer.concat([bytes.subarray(0, 2), marker, exif, bytes.subarray(2)])
}
