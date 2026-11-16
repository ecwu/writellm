import { createHash, type Hash } from 'node:crypto'
import { open } from 'node:fs/promises'
import {
  normalizedKnowledgeBlockSchema,
  type NormalizedKnowledgeBlock
} from '../../shared/contracts/knowledge'

export const NORMALIZED_BLOCKS_MAX_BYTES = 200 * 1024 * 1024
const MAX_BLOCK_LINE_BYTES = 2 * 1024 * 1024

interface NormalizedBlockEntry {
  block: NormalizedKnowledgeBlock
  startOffset: number
  nextOffset: number
}

export function readNormalizedBlocks(path: string, startOffset = 0) {
  return scanNormalizedBlocks(path, startOffset)
}

export async function verifyNormalizedBlocks(
  path: string,
  expected: { sha256: string; count: number },
  visit?: (block: NormalizedKnowledgeBlock) => void
): Promise<void> {
  const hash = createHash('sha256')
  let count = 0
  for await (const { block } of scanNormalizedBlocks(path, 0, hash)) {
    if (block.ordinal !== count) throw new Error('Normalized block ordinal is invalid')
    if (count >= expected.count) throw new Error('Normalized block count does not match')
    visit?.(block)
    count += 1
  }
  if (hash.digest('hex') !== expected.sha256) {
    throw new Error('Normalized blocks hash does not match')
  }
  if (count !== expected.count) throw new Error('Normalized block count does not match')
}

function parseBlock(bytes: Buffer): NormalizedKnowledgeBlock {
  if (bytes.byteLength === 0) throw new Error('Normalized block line is empty')
  if (bytes.byteLength > MAX_BLOCK_LINE_BYTES) {
    throw new Error('Normalized block line exceeds the size limit')
  }
  return normalizedKnowledgeBlockSchema.parse(JSON.parse(bytes.toString('utf8')))
}

async function* scanNormalizedBlocks(
  path: string,
  startOffset: number,
  hash?: Hash
): AsyncGenerator<NormalizedBlockEntry> {
  const handle = await open(path, 'r')
  try {
    const metadata = await handle.stat()
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > NORMALIZED_BLOCKS_MAX_BYTES) {
      throw new Error('Normalized block file size is invalid')
    }
    const start = Math.floor(startOffset)
    if (!Number.isSafeInteger(start) || start < 0 || start > metadata.size) {
      throw new Error('Normalized block cursor is invalid')
    }
    if (start > 0) {
      const previous = Buffer.allocUnsafe(1)
      const { bytesRead } = await handle.read(previous, 0, 1, start - 1)
      if (bytesRead !== 1 || previous[0] !== 0x0a) {
        throw new Error('Normalized block cursor is not on a line boundary')
      }
    }
    let position = start
    let pending = Buffer.alloc(0)
    while (position < metadata.size) {
      const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, metadata.size - position))
      const { bytesRead } = await handle.read(chunk, 0, chunk.byteLength, position)
      if (bytesRead === 0) throw new Error('Normalized block file changed size during reading')
      const current = chunk.subarray(0, bytesRead)
      hash?.update(current)
      const combined = pending.length === 0 ? current : Buffer.concat([pending, current])
      const combinedStart = position - pending.length
      position += bytesRead
      let lineStartIndex = 0
      while (true) {
        const newlineIndex = combined.indexOf(0x0a, lineStartIndex)
        if (newlineIndex < 0) break
        const bytes = combined.subarray(lineStartIndex, newlineIndex)
        yield {
          block: parseBlock(bytes),
          startOffset: combinedStart + lineStartIndex,
          nextOffset: combinedStart + newlineIndex + 1
        }
        lineStartIndex = newlineIndex + 1
      }
      pending = Buffer.from(combined.subarray(lineStartIndex))
      if (pending.byteLength > MAX_BLOCK_LINE_BYTES) {
        throw new Error('Normalized block line exceeds the size limit')
      }
    }
    if (hash !== undefined) {
      const { bytesRead } = await handle.read(Buffer.allocUnsafe(1), 0, 1, position)
      if (bytesRead !== 0) throw new Error('Normalized block file changed size during reading')
    }
    if (pending.byteLength > 0) {
      yield {
        block: parseBlock(pending),
        startOffset: metadata.size - pending.byteLength,
        nextOffset: metadata.size
      }
    }
  } finally {
    await handle.close()
  }
}
