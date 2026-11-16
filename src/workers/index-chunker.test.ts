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

    const groups = [...groupBlocks(blocks)]

    expect(groups.map((group) => group.spans.map(({ block }) => block.type))).toEqual([
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

    expect([...groupBlocks(blocks)].map((group) => group.spans.length)).toEqual([2, 1])
  })

  it('uses the existing code-unit budget including separators already in the group', () => {
    const first = 'a'.repeat(798)
    const second = '🙂'.repeat(400)
    const groups = [
      ...groupBlocks([
        createBlock('a', 'paragraph', first),
        createBlock('b', 'paragraph', second),
        createBlock('c', 'paragraph', 'c')
      ])
    ]

    expect(groups.map((group) => group.text)).toEqual([`${first}\n\n${second}`, 'c'])
  })

  it('ends the image run at a nonempty block with different provenance', () => {
    const image = createBlock('a', 'image', undefined, ['images/figure.png'])
    const related = createBlock('c', 'caption', 'x'.repeat(2_000), ['images/figure.png'])
    const unrelated = createBlock('d', 'caption', 'Different figure')
    const later = createBlock('e', 'caption', 'Later caption', ['images/figure.png'])
    const groups = [
      ...groupBlocks([image, createBlock('b', 'paragraph'), related, unrelated, later])
    ]

    expect(groups.map((group) => group.spans.map(({ block }) => block))).toEqual([
      [image, related],
      [unrelated, later]
    ])
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
    ordinal: Number.parseInt(suffix, 16) - 10,
    type,
    ...(text === undefined ? {} : { text, markdown: text }),
    headingPath: [],
    ...(sourceProviderBlockId === undefined ? {} : { sourceProviderBlockId }),
    assetRefs,
    contentHash: 'a'.repeat(64)
  })
}
