import { describe, expect, it } from 'vitest'
import type { AgentEditorContext } from '../../shared/contracts/agent'
import type { ManuscriptService } from '../manuscript/manuscript-service'
import { validateQuickActionSelection } from './quick-actions'

const sectionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc610'
const revisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc611'
const nextRevisionId = '019c6a5c-8d34-7a8e-a602-3d37a52dc612'
const content = [
  paragraph('block-1', 'A precise opening sentence.'),
  paragraph('block-2', 'A second paragraph with evidence.')
]

describe('Agent quick action selection validation', () => {
  it('accepts an exact partial selection in ordered canonical blocks', () => {
    expect(validateQuickActionSelection(manuscript(), context('opening sentence'))).toEqual({
      selectedText: 'opening sentence',
      revisionId
    })
    expect(
      validateQuickActionSelection(
        manuscript(),
        context('sentence.\nA second', ['block-1', 'block-2'])
      )
    ).toEqual({ selectedText: 'sentence.\nA second', revisionId })
  })

  it('fails before a run when revision, text, block identity, or order is stale', () => {
    expect(() =>
      validateQuickActionSelection(manuscript(nextRevisionId), context('opening sentence'))
    ).toThrow('changed after capture')
    expect(() => validateQuickActionSelection(manuscript(), context('missing words'))).toThrow(
      'text changed'
    )
    expect(() =>
      validateQuickActionSelection(manuscript(), context('opening', ['missing-block']))
    ).toThrow('block changed')
    expect(() =>
      validateQuickActionSelection(
        manuscript(),
        context('paragraph', ['block-2', 'block-1'], 'block-2')
      )
    ).toThrow('order changed')
  })
})

function context(
  selectedText: string,
  selectedBlockIds = ['block-1'],
  activeBlockId = selectedBlockIds[0] ?? null
): AgentEditorContext {
  return {
    activeSectionId: sectionId,
    activeBlockId,
    selectedBlockIds,
    selectedText,
    capturedAt: 1,
    capturedRevisionId: revisionId
  }
}

function manuscript(currentRevisionId = revisionId): ManuscriptService {
  return {
    getSection: () => ({ sectionId, currentRevisionId }),
    getRevision: () => ({ sectionId, content })
  } as unknown as ManuscriptService
}

function paragraph(id: string, text: string) {
  return {
    id,
    type: 'paragraph',
    props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
    content: [{ type: 'text', text, styles: {} }],
    children: []
  }
}
