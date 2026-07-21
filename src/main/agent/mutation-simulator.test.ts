import { describe, expect, it } from 'vitest'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { MutationSimulationError, simulateSectionPatch } from './mutation-simulator'

const sectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc601'
const revisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc602'

describe('section mutation simulator', () => {
  it('applies typed insert, update, replace, move, and remove operations without mutating input', () => {
    const source = [
      block('a', 'A', [block('a-child', 'A child')]),
      block('b', 'B'),
      block('c', 'C')
    ]
    const before = JSON.stringify(source)
    const result = simulateSectionPatch(source, {
      schemaVersion: 1,
      sectionId,
      baseRevisionId: revisionId,
      citationIds: [],
      operations: [
        {
          type: 'insertBlocks',
          anchorBlockId: 'b',
          placement: 'before',
          blocks: [block('inserted', 'Inserted')]
        },
        {
          type: 'updateBlock',
          blockId: 'b',
          update: { content: inline('B updated') }
        },
        {
          type: 'replaceBlocks',
          blockIds: ['inserted', 'b'],
          blocks: [block('replacement', 'Replacement')]
        },
        {
          type: 'moveBlocks',
          blockIds: ['c'],
          anchorBlockId: 'a',
          placement: 'before'
        },
        { type: 'removeBlocks', blockIds: ['a-child'] }
      ]
    })

    expect(JSON.stringify(source)).toBe(before)
    expect(result.document.map((item) => item.id)).toEqual(['c', 'a', 'replacement'])
    expect(result.document[1]?.children).toEqual([])
    expect(result.afterText).toContain('Replacement')
    expect(result.affectedBlockIds).toEqual(
      expect.arrayContaining(['inserted', 'b', 'replacement', 'c', 'a', 'a-child'])
    )
  })

  it('fails atomically for missing targets, duplicate IDs, overlapping trees, and invalid moves', () => {
    const source = [block('a', 'A', [block('child', 'Child')]), block('b', 'B')]
    const before = JSON.stringify(source)
    const cases = [
      [{ type: 'removeBlocks' as const, blockIds: ['missing'] }],
      [
        {
          type: 'insertBlocks' as const,
          anchorBlockId: null,
          placement: 'end' as const,
          blocks: [block('a', 'Collision')]
        }
      ],
      [{ type: 'removeBlocks' as const, blockIds: ['a', 'child'] }],
      [
        {
          type: 'moveBlocks' as const,
          blockIds: ['a'],
          anchorBlockId: 'child',
          placement: 'after' as const
        }
      ],
      [
        {
          type: 'updateBlock' as const,
          blockId: 'a',
          update: { content: inline('Changed') }
        },
        { type: 'removeBlocks' as const, blockIds: ['missing'] }
      ]
    ]

    for (const operations of cases) {
      expect(() =>
        simulateSectionPatch(source, {
          schemaVersion: 1,
          sectionId,
          baseRevisionId: revisionId,
          citationIds: [],
          operations
        })
      ).toThrow()
      expect(JSON.stringify(source)).toBe(before)
    }
  })

  it('requires contiguous siblings for replace and move and rejects no-op updates', () => {
    const source = [block('a', 'A'), block('b', 'B'), block('c', 'C')]
    expect(() =>
      simulateSectionPatch(source, {
        schemaVersion: 1,
        sectionId,
        baseRevisionId: revisionId,
        citationIds: [],
        operations: [{ type: 'replaceBlocks', blockIds: ['a', 'c'], blocks: [] }]
      })
    ).toThrow(MutationSimulationError)
    expect(() =>
      simulateSectionPatch(source, {
        schemaVersion: 1,
        sectionId,
        baseRevisionId: revisionId,
        citationIds: [],
        operations: [{ type: 'updateBlock', blockId: 'a', update: { content: inline('A') } }]
      })
    ).toThrowError('Section patch does not change the document')
  })

  it('rejects an inserted block tree deeper than the authoritative BlockNote limit', () => {
    let nested = block('depth-17', 'deep')
    for (let depth = 16; depth >= 1; depth -= 1) {
      nested = block(`depth-${depth}`, `depth ${depth}`, [nested])
    }
    expect(() =>
      simulateSectionPatch([], {
        schemaVersion: 1,
        sectionId,
        baseRevisionId: revisionId,
        citationIds: [],
        operations: [
          {
            type: 'insertBlocks',
            anchorBlockId: null,
            placement: 'end',
            blocks: [nested]
          }
        ]
      })
    ).toThrow(MutationSimulationError)
  })
})

function inline(text: string) {
  return [{ type: 'text' as const, text, styles: {} }]
}

function block(
  id: string,
  text: string,
  children: BlockNoteDocument = []
): BlockNoteDocument[number] {
  return {
    id,
    type: 'paragraph',
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: inline(text),
    children
  }
}
