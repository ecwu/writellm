import { createHash } from 'node:crypto'

export function redactTraceImages(value: unknown): unknown {
  if (typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)) {
    const comma = value.indexOf(',')
    return metadata(value.slice(comma + 1), value.slice(5, value.indexOf(';')))
  }
  if (Array.isArray(value)) return value.map(redactTraceImages)
  if (value === null || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const mime = record['mimeType'] ?? record['mime_type'] ?? record['media_type']
  if (
    typeof record['data'] === 'string' &&
    (record['type'] === 'image' ||
      record['type'] === 'base64' ||
      (typeof mime === 'string' && mime.startsWith('image/')))
  ) {
    const { data, ...rest } = record
    return {
      ...Object.fromEntries(
        Object.entries(rest).map(([key, entry]) => [key, redactTraceImages(entry)])
      ),
      ...metadata(data as string, typeof mime === 'string' ? mime : 'image/unknown')
    }
  }
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, redactTraceImages(entry)])
  )
}

function metadata(data: string, mimeType: string): Record<string, unknown> {
  const bytes = Buffer.from(data, 'base64')
  const dimensions =
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
      : {}
  return {
    imageRedacted: true,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    mimeType,
    byteSize: bytes.length,
    base64Bytes: data.length,
    ...dimensions
  }
}
