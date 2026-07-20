import { describe, expect, it } from 'vitest'
import { normalizedKnowledgeBlockSchema } from '../shared/contracts/knowledge'
import { groupBlocks } from './index-chunker'

describe('normalized block grouping', () => {
  it('keeps all consecutive image captions in the image chunk', () => {
    const blocks = [
      createBlock('a', 'image', undefined, ['images/figure.png']),
      createBlock('b', 'caption', 'Figure 1: Overview', ['images/figure.png']),
      createBlock('c', 'caption', 'Source: Example', ['images/figure.png']),
      createBlock('d', 'paragraph', 'The paragraph after the figure.')
    ]

    const groups = groupBlocks(blocks)

    expect(groups.map((group) => group.map((block) => block.type))).toEqual([
      ['image', 'caption', 'caption'],
      ['paragraph']
    ])
  })

  it('uses shared provider provenance when a caption has no asset reference', () => {
    const blocks = [
      createBlock('a', 'image', undefined, ['images/figure.png'], 'provider-image'),
      createBlock('b', 'caption', 'Figure 1', [], 'provider-image'),
      createBlock('c', 'paragraph', 'Following text')
    ]

    expect(groupBlocks(blocks).map((group) => group.length)).toEqual([2, 1])
  })
})

function createBlock(
  suffix: string,
  type: 'image' | 'caption' | 'paragraph',
  text?: string,
  assetRefs: string[] = [],
  sourceProviderBlockId?: string
) {
  return normalizedKnowledgeBlockSchema.parse({
    id: `kb_${suffix.repeat(32)}`,
    ordinal: suffix === 'a' ? 0 : suffix === 'b' ? 1 : suffix === 'c' ? 2 : 3,
    type,
    ...(text === undefined ? {} : { text, markdown: text }),
    headingPath: [],
    ...(sourceProviderBlockId === undefined ? {} : { sourceProviderBlockId }),
    assetRefs,
    contentHash: 'a'.repeat(64)
  })
}
