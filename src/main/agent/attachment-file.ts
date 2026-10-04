import { open } from 'node:fs/promises'
import { AGENT_IMAGE_MAX_BYTES } from '../../shared/contracts/agent-attachments'

export async function readBoundedAgentImage(
  path: string,
  maximum = AGENT_IMAGE_MAX_BYTES
): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const metadata = await file.stat()
    if (!metadata.isFile() || metadata.size === 0 || metadata.size > maximum)
      throw new Error('Image exceeds the file size limit')
    const buffer = Buffer.alloc(metadata.size + 1)
    let offset = 0
    while (offset < buffer.length) {
      const { bytesRead } = await file.read(buffer, offset, buffer.length - offset, offset)
      if (bytesRead === 0) break
      offset += bytesRead
    }
    if (offset !== metadata.size) throw new Error('Image changed during import')
    return buffer.subarray(0, offset)
  } finally {
    await file.close()
  }
}
