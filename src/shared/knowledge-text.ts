import type { NormalizedKnowledgeBlock } from './contracts/knowledge'

export function searchableKnowledgeBlockText(block: NormalizedKnowledgeBlock): string {
  if (block.markdown?.trim()) return block.markdown.trim()
  if (block.text?.trim()) return block.text.trim()
  if (block.assetRefs.length > 0) {
    return block.assetRefs.map((asset) => `[Image: ${asset}]`).join('\n')
  }
  return ''
}
