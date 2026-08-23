import { describe, expect, it } from 'vitest'
import {
  isStructuredSourceDocumentValid,
  selectionContainsStructuredSource
} from './inline-math-guard'

interface MockNode {
  textContent: string
  type: { name: string }
}

function documentWith(...nodes: MockNode[]) {
  return {
    textContent: nodes.map((node) => node.textContent).join(''),
    type: { name: 'doc' },
    descendants(callback: (node: MockNode) => boolean) {
      for (const node of nodes) if (!callback(node)) break
    },
    nodesBetween(_from: number, _to: number, callback: (node: MockNode) => boolean) {
      for (const node of nodes) if (!callback(node)) break
    }
  }
}

describe('structured source editor guard', () => {
  it('accepts bounded single-line source and rejects character, byte, line, and NUL violations', () => {
    expect(
      isStructuredSourceDocumentValid(
        documentWith({ type: { name: 'math' }, textContent: 'E=mc^2' })
      )
    ).toBe(true)
    expect(
      isStructuredSourceDocumentValid(
        documentWith({ type: { name: 'math' }, textContent: 'x'.repeat(8_193) })
      )
    ).toBe(false)
    expect(
      isStructuredSourceDocumentValid(
        documentWith({ type: { name: 'math' }, textContent: '界'.repeat(2_731) })
      )
    ).toBe(false)
    expect(
      isStructuredSourceDocumentValid(documentWith({ type: { name: 'math' }, textContent: 'x\ny' }))
    ).toBe(false)
    expect(
      isStructuredSourceDocumentValid(documentWith({ type: { name: 'math' }, textContent: 'x\0y' }))
    ).toBe(false)
    expect(
      isStructuredSourceDocumentValid(
        documentWith({ type: { name: 'mathBlock' }, textContent: String.raw`\href{x}{y}` })
      )
    ).toBe(false)
    expect(
      isStructuredSourceDocumentValid(
        documentWith({ type: { name: 'diagram' }, textContent: '界'.repeat(22_000) })
      )
    ).toBe(false)
  })

  it('detects atomic formulas in an exact quick-action selection', () => {
    expect(
      selectionContainsStructuredSource(
        documentWith(
          { type: { name: 'text' }, textContent: 'alpha' },
          { type: { name: 'math' }, textContent: 'x' }
        ),
        1,
        2
      )
    ).toBe(true)
    expect(
      selectionContainsStructuredSource(
        documentWith({ type: { name: 'text' }, textContent: 'alpha' }),
        1,
        2
      )
    ).toBe(false)
    expect(
      selectionContainsStructuredSource(
        documentWith({ type: { name: 'diagram' }, textContent: 'graph TD' }),
        1,
        2
      )
    ).toBe(true)
  })
})
