import type { NormalizedKnowledgeBlock } from './contracts/knowledge'

export function captionMatchesImage(
  caption: NormalizedKnowledgeBlock,
  image: NormalizedKnowledgeBlock
): boolean {
  if (caption.type !== 'caption' || image.type !== 'image') return false
  return (
    caption.assetRefs.some((asset) => image.assetRefs.includes(asset)) ||
    (caption.sourceProviderBlockId !== undefined &&
      caption.sourceProviderBlockId === image.sourceProviderBlockId)
  )
}
