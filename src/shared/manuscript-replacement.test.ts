import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { BlockNoteDocument } from './contracts/manuscript'
import {
  applyReplacementOperations,
  classifyReplacementTarget,
  ReplacementPreconditionError
} from './manuscript-replacement'

const textProps = {
  backgroundColor: 'default',
  textColor: 'default',
  textAlignment: 'left' as const
}

describe('manuscript replacement core', () => {
  it('splices a cross-styled match once and keeps untouched styles', () => {
    const document: BlockNoteDocument = [
      {
        id: 'paragraph',
        type: 'paragraph',
        props: textProps,
        content: [
          { type: 'text', text: 'pre ab', styles: { bold: true } },
          { type: 'text', text: 'cd post', styles: { italic: true } }
        ],
        children: []
      }
    ]
    const target = {
      kind: 'block_inline' as const,
      sectionId: 'section',
      revisionId: 'revision',
      blockId: 'paragraph',
      segments: [
        { inlineIndex: 0, range: { from: 4, to: 6 } },
        { inlineIndex: 1, range: { from: 0, to: 2 } }
      ],
      flatRange: { from: 4, to: 8 }
    }
    const next = applyReplacementOperations(
      document,
      [{ target, sourceSliceHash: hash('abcd') }],
      'X'
    )
    expect(next[0]?.content).toEqual([
      { type: 'text', text: 'pre X', styles: { bold: true } },
      { type: 'text', text: ' post', styles: { italic: true } }
    ])
  })

  it('replaces table prose and exact rich-media captions', () => {
    const document: BlockNoteDocument = [
      {
        id: 'table',
        type: 'table',
        props: { textColor: 'default' },
        content: {
          type: 'tableContent',
          columnWidths: [null],
          rows: [{ cells: [[{ type: 'text', text: 'alpha', styles: {} }]] }]
        },
        children: []
      },
      {
        id: 'math',
        type: 'math',
        props: { textAlignment: 'left', source: 'x', caption: 'alpha' },
        children: []
      }
    ]
    const next = applyReplacementOperations(
      document,
      [
        {
          target: {
            kind: 'table_cell',
            sectionId: 'section',
            revisionId: 'revision',
            blockId: 'table',
            rowIndex: 0,
            cellIndex: 0,
            segments: [{ inlineIndex: 0, range: { from: 0, to: 5 } }],
            flatRange: { from: 0, to: 5 }
          },
          sourceSliceHash: hash('alpha')
        },
        {
          target: {
            kind: 'block_caption',
            sectionId: 'section',
            revisionId: 'revision',
            blockId: 'math',
            property: 'caption',
            range: { from: 0, to: 5 }
          },
          sourceSliceHash: hash('alpha')
        }
      ],
      ''
    )
    expect(next[0]?.content).toMatchObject({ rows: [{ cells: [[]] }] })
    expect(next[1]?.props.caption).toBe('')
  })

  it('classifies citation, link, code block, inline code, metadata, and unchanged targets', () => {
    const cases = [
      [
        paragraph('[Source: Paper]'),
        inlineTarget([{ inlineIndex: 0, range: { from: 1, to: 7 } }], 1, 7),
        'readable_citation'
      ],
      [
        paragraphLink('linked'),
        inlineTarget([{ inlineIndex: 0, linkTextIndex: 0, range: { from: 0, to: 6 } }], 0, 6),
        'link_text'
      ],
      [
        { ...paragraph('code'), type: 'codeBlock' as const, props: { language: 'text' } },
        inlineTarget([{ inlineIndex: 0, range: { from: 0, to: 4 } }], 0, 4),
        'code_block'
      ],
      [
        paragraph('code', { code: true }),
        inlineTarget([{ inlineIndex: 0, range: { from: 0, to: 4 } }], 0, 4),
        'inline_code'
      ]
    ] as const
    for (const [block, target, reason] of cases) {
      expect(classifyReplacementTarget([block], target, 'next').skipReason).toBe(reason)
    }
    expect(
      classifyReplacementTarget(
        [paragraph('same')],
        inlineTarget([{ inlineIndex: 0, range: { from: 0, to: 4 } }], 0, 4),
        'same'
      ).skipReason
    ).toBe('unchanged')
    expect(
      classifyReplacementTarget(
        [paragraph('body')],
        { kind: 'section_title', sectionId: 'section', range: { from: 0, to: 4 } },
        'next'
      ).skipReason
    ).toBe('section_metadata')
  })

  it('fails closed when the source slice changed', () => {
    expect(() =>
      applyReplacementOperations(
        [paragraph('changed')],
        [
          {
            target: inlineTarget([{ inlineIndex: 0, range: { from: 0, to: 7 } }], 0, 7),
            sourceSliceHash: hash('original')
          }
        ],
        'next'
      )
    ).toThrow(ReplacementPreconditionError)
  })
})

function paragraph(text: string, styles: Record<string, boolean> = {}): BlockNoteDocument[number] {
  return {
    id: 'paragraph',
    type: 'paragraph',
    props: textProps,
    content: [{ type: 'text', text, styles }],
    children: []
  }
}

function paragraphLink(text: string): BlockNoteDocument[number] {
  return {
    id: 'paragraph',
    type: 'paragraph',
    props: textProps,
    content: [
      { type: 'link', href: 'https://example.com', content: [{ type: 'text', text, styles: {} }] }
    ],
    children: []
  }
}

function inlineTarget(
  segments: Array<{
    inlineIndex: number
    linkTextIndex?: number
    range: { from: number; to: number }
  }>,
  from: number,
  to: number
) {
  return {
    kind: 'block_inline' as const,
    sectionId: 'section',
    revisionId: 'revision',
    blockId: 'paragraph',
    segments,
    flatRange: { from, to }
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
