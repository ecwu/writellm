import { describe, expect, it } from 'vitest'
import type { BlockMutationOperation } from '../../shared/contracts/agent-mutations'
import type { BlockNoteDocument } from '../../shared/contracts/manuscript'
import { analyzeSectionProposalRefresh } from './section-proposal-refresh'

const sectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc611'
const baseRevisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc612'
const currentRevisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc613'

describe('section proposal refresh analysis', () => {
  it('replays an edit when another block changed', () => {
    const base = [block('a', 'A'), block('b', 'B')]
    const current = [block('a', 'A changed'), block('b', 'B')]
    const result = analyzeSectionProposalRefresh(
      base,
      current,
      patch([{ type: 'updateBlock', blockId: 'b', update: { content: inline('B changed') } }]),
      currentRevisionId
    )
    expect(result.kind).toBe('refreshable')
    if (result.kind !== 'refreshable') return
    expect(result.mutation.baseRevisionId).toBe(currentRevisionId)
    expect(result.simulation.document).toEqual([block('a', 'A changed'), block('b', 'B changed')])
  })

  it('merges different properties on the same block and conflicts on the same field', () => {
    const base = [block('a', 'A')]
    const current = [
      {
        ...block('a', 'A'),
        props: { ...block('a', 'A').props, textAlignment: 'center' }
      }
    ] as BlockNoteDocument
    expect(
      analyzeSectionProposalRefresh(
        base,
        current,
        patch([
          {
            type: 'updateBlock',
            blockId: 'a',
            update: { props: { backgroundColor: 'red' } }
          }
        ]),
        currentRevisionId
      ).kind
    ).toBe('refreshable')
    const conflict = analyzeSectionProposalRefresh(
      base,
      [block('a', 'Current')],
      patch([{ type: 'updateBlock', blockId: 'a', update: { content: inline('Proposed') } }]),
      currentRevisionId
    )
    expect(conflict).toMatchObject({ kind: 'conflict', code: 'target_changed' })
  })

  it('recognizes an already-present field update without creating work', () => {
    const base = [block('a', 'Before')]
    const result = analyzeSectionProposalRefresh(
      base,
      [block('a', 'After')],
      patch([{ type: 'updateBlock', blockId: 'a', update: { content: inline('After') } }]),
      currentRevisionId
    )
    expect(result).toEqual({ kind: 'satisfied' })
  })

  it('allows unrelated siblings around replace/remove but rejects changed targets', () => {
    const base = [block('a', 'A'), block('b', 'B'), block('c', 'C')]
    const current = [block('x', 'X'), ...base]
    expect(
      analyzeSectionProposalRefresh(
        base,
        current,
        patch([{ type: 'replaceBlocks', blockIds: ['b'], blocks: [block('next', 'Next')] }]),
        currentRevisionId
      ).kind
    ).toBe('refreshable')
    expect(
      analyzeSectionProposalRefresh(
        base,
        [block('a', 'A'), block('b', 'Changed'), block('c', 'C')],
        patch([{ type: 'removeBlocks', blockIds: ['b'] }]),
        currentRevisionId
      )
    ).toMatchObject({ kind: 'conflict', code: 'target_changed' })
    expect(
      analyzeSectionProposalRefresh(
        base,
        [block('a', 'A'), block('b', 'B'), block('x', 'X'), block('c', 'C')],
        patch([{ type: 'removeBlocks', blockIds: ['b', 'c'] }]),
        currentRevisionId
      )
    ).toMatchObject({ kind: 'conflict', code: 'structure_changed' })
  })

  it('handles operation dependencies and rejects insert ID collisions and moved anchors', () => {
    const base = [block('a', 'A'), block('b', 'B')]
    const dependent = analyzeSectionProposalRefresh(
      base,
      [block('x', 'X'), ...base],
      patch([
        {
          type: 'insertBlocks',
          anchorBlockId: 'a',
          placement: 'after',
          blocks: [block('inserted', 'Inserted')]
        },
        {
          type: 'updateBlock',
          blockId: 'inserted',
          update: { content: inline('Updated') }
        }
      ]),
      currentRevisionId
    )
    expect(dependent.kind).toBe('refreshable')

    const collision = analyzeSectionProposalRefresh(
      base,
      [block('a', 'A'), block('b', 'B'), block('inserted', 'Other')],
      patch([
        {
          type: 'insertBlocks',
          anchorBlockId: 'a',
          placement: 'after',
          blocks: [block('inserted', 'Inserted')]
        }
      ]),
      currentRevisionId
    )
    expect(collision).toMatchObject({ kind: 'conflict', code: 'id_collision' })

    const nestedBase = [
      block('parent', 'Parent', [block('anchor', 'Anchor')]),
      block('move', 'Move')
    ]
    const nestedCurrent = [
      block('parent', 'Parent'),
      block('anchor', 'Anchor'),
      block('move', 'Move')
    ]
    const movedAnchor = analyzeSectionProposalRefresh(
      nestedBase,
      nestedCurrent,
      patch([
        { type: 'moveBlocks', blockIds: ['move'], anchorBlockId: 'anchor', placement: 'after' }
      ]),
      currentRevisionId
    )
    expect(movedAnchor).toMatchObject({ kind: 'conflict', code: 'structure_changed' })

    const validMove = analyzeSectionProposalRefresh(
      base,
      [block('x', 'X'), ...base],
      patch([{ type: 'moveBlocks', blockIds: ['b'], anchorBlockId: 'a', placement: 'before' }]),
      currentRevisionId
    )
    expect(validMove.kind).toBe('refreshable')
  })

  it('rejects duplicate IDs and overlapping ancestors conservatively', () => {
    const base = [block('parent', 'Parent', [block('child', 'Child')])]
    expect(
      analyzeSectionProposalRefresh(
        base,
        [block('parent', 'Parent'), block('duplicate', 'One'), block('duplicate', 'Two')],
        patch([{ type: 'updateBlock', blockId: 'parent', update: { content: inline('Next') } }]),
        currentRevisionId
      )
    ).toMatchObject({ kind: 'conflict', code: 'invalid_result' })
    expect(
      analyzeSectionProposalRefresh(
        base,
        base,
        patch([
          {
            type: 'insertBlocks',
            anchorBlockId: null,
            placement: 'end',
            blocks: [block('incoming', 'One'), block('incoming', 'Two')]
          }
        ]),
        currentRevisionId
      )
    ).toMatchObject({ kind: 'conflict', code: 'invalid_result' })
    expect(
      analyzeSectionProposalRefresh(
        base,
        base,
        patch([{ type: 'removeBlocks', blockIds: ['parent', 'child'] }]),
        currentRevisionId
      )
    ).toMatchObject({ kind: 'conflict', code: 'structure_changed' })
  })
})

function patch(operations: BlockMutationOperation[]) {
  return { schemaVersion: 1 as const, sectionId, baseRevisionId, operations, citationIds: [] }
}

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
