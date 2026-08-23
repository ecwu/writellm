import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { projectLegacyBlockNoteDocument } from '../../../../shared/contracts/manuscript'
import {
  approvedEditorSchema,
  toApprovedEditorDocument,
  toCanonicalDocument
} from './editor-schema'

const representativeDocuments = [
  [
    'schema v1 text and nesting',
    [
      {
        id: 'v1-paragraph',
        type: 'paragraph',
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text: 'Legacy paragraph', styles: { bold: true } }],
        children: [
          {
            id: 'v1-nested',
            type: 'bulletListItem',
            props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
            content: [{ type: 'text', text: 'Nested legacy item', styles: {} }],
            children: []
          }
        ]
      },
      {
        id: 'v1-heading',
        type: 'heading',
        props: {
          level: 2,
          backgroundColor: 'default',
          textColor: 'default',
          textAlignment: 'left'
        },
        content: [{ type: 'text', text: 'Legacy heading', styles: {} }],
        children: []
      }
    ]
  ],
  [
    'schema v2 rich media',
    [
      {
        id: 'v2-image',
        type: 'image',
        props: {
          url: 'writellm-asset:019d0000-0000-4000-8000-000000000452',
          backgroundColor: 'default',
          textAlignment: 'center',
          name: 'Legacy image',
          caption: 'Legacy caption',
          showPreview: true,
          previewWidth: 480
        },
        children: []
      },
      {
        id: 'v2-mermaid',
        type: 'mermaid',
        props: {
          source: 'flowchart LR\nA --> B',
          caption: 'Flow',
          textAlignment: 'center',
          previewWidth: 640
        },
        children: []
      },
      {
        id: 'v2-math',
        type: 'math',
        props: {
          source: 'E = mc^2',
          caption: 'Energy',
          textAlignment: 'center',
          previewWidth: 320
        },
        children: []
      }
    ]
  ],
  [
    'schema v3 figure metadata',
    [
      {
        id: 'v3-figure',
        type: 'image',
        props: {
          url: 'writellm-asset:019d0000-0000-4000-8000-000000000453',
          backgroundColor: 'default',
          textAlignment: 'center',
          name: 'Current image',
          caption: 'Current caption',
          figureId: 'figure:stable:v3',
          altText: 'Current alternative',
          showPreview: true,
          previewWidth: 512
        },
        children: []
      },
      {
        id: 'v3-list',
        type: 'numberedListItem',
        props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
        content: [{ type: 'text', text: 'Current list', styles: {} }],
        children: [
          {
            id: 'v3-nested',
            type: 'paragraph',
            props: { backgroundColor: 'default', textColor: 'default', textAlignment: 'left' },
            content: [{ type: 'text', text: 'Nested current block', styles: {} }],
            children: []
          }
        ]
      }
    ]
  ]
] as const

function blockIds(blocks: readonly unknown[]): string[] {
  const ids: string[] = []
  const visit = (candidates: readonly unknown[]): void => {
    for (const candidate of candidates) {
      if (candidate === null || typeof candidate !== 'object') continue
      const block = candidate as { id?: unknown; children?: unknown }
      if (typeof block.id === 'string') ids.push(block.id)
      if (Array.isArray(block.children)) visit(block.children)
    }
  }
  visit(blocks)
  return ids
}

describe('BlockNote 0.54.0 native JSON characterization', () => {
  it('rejects the checkpoint 9 empty document as initialContent', () => {
    expect(() =>
      BlockNoteEditor.create({ schema: approvedEditorSchema, initialContent: [] })
    ).toThrow('Error creating document from blocks passed as `initialContent`')
  })

  it('materializes default shapes and round-trips IDs, props, styles, links, children, and tables', () => {
    const editor = BlockNoteEditor.create({
      schema: approvedEditorSchema,
      initialContent: [
        {
          id: 'paragraph-id',
          type: 'paragraph',
          content: [
            { type: 'text', text: '你好', styles: { bold: true } },
            { type: 'math', content: 'E = mc^2' },
            {
              type: 'link',
              href: 'https://example.com',
              content: [{ type: 'text', text: 'link', styles: { italic: true } }]
            }
          ],
          children: [{ id: 'nested-id', type: 'bulletListItem', content: 'child' }]
        },
        { id: 'heading-id', type: 'heading', props: { level: 2 }, content: 'Heading' },
        { id: 'number-id', type: 'numberedListItem', content: 'One' },
        { id: 'check-id', type: 'checkListItem', props: { checked: true }, content: 'Done' },
        { id: 'quote-id', type: 'quote', content: 'Quote' },
        { id: 'code-id', type: 'codeBlock', content: 'const x = 1' },
        {
          id: 'table-id',
          type: 'table',
          content: { type: 'tableContent', rows: [{ cells: [['A'], ['B']] }] }
        },
        {
          id: 'figure-id',
          type: 'image',
          props: {
            url: 'writellm-asset:019d0000-0000-4000-8000-000000000451',
            caption: 'A caption',
            figureId: 'figure:stable',
            altText: 'An alternative'
          }
        },
        {
          id: 'block-math-id',
          type: 'mathBlock',
          props: {},
          content: 'x^2'
        },
        {
          id: 'diagram-id',
          type: 'diagram',
          props: { engine: 'mermaid', caption: 'Flow', altText: 'A flows to B' },
          content: 'graph TD; A-->B'
        }
      ]
    })
    const saved = JSON.parse(JSON.stringify(editor.document))
    const restored = BlockNoteEditor.create({ schema: approvedEditorSchema, initialContent: saved })
    expect(JSON.parse(JSON.stringify(restored.document))).toEqual(saved)
    expect(saved[6].content.columnWidths).toEqual([null, null])
    expect(saved[6].content.rows[0].cells[0]).toMatchObject({
      type: 'tableCell',
      props: { colspan: 1, rowspan: 1, textAlignment: 'left' }
    })
    expect(saved[7].props).toMatchObject({
      figureId: 'figure:stable',
      altText: 'An alternative',
      caption: 'A caption'
    })
    const canonical = toCanonicalDocument(editor.document)
    expect((canonical[0].content as unknown[])[1]).toEqual({
      type: 'math',
      content: 'E = mc^2'
    })
    expect(canonical[8]).toMatchObject({
      id: 'block-math-id',
      type: 'mathBlock',
      props: {},
      content: [{ type: 'text', text: 'x^2', styles: {} }]
    })
    expect(canonical[9]).toMatchObject({
      id: 'diagram-id',
      type: 'diagram',
      props: { engine: 'mermaid', caption: 'Flow', altText: 'A flows to B' }
    })
  })

  it.each(representativeDocuments)(
    'round-trips the %s golden without changing block IDs or normalized JSON',
    (_name, document) => {
      const projected = projectLegacyBlockNoteDocument(document)
      const editor = BlockNoteEditor.create({
        schema: approvedEditorSchema,
        initialContent: toApprovedEditorDocument(projected)
      })
      const firstSave = toCanonicalDocument(editor.document)
      const restored = BlockNoteEditor.create({
        schema: approvedEditorSchema,
        initialContent: toApprovedEditorDocument(firstSave)
      })
      const secondSave = toCanonicalDocument(restored.document)

      expect(blockIds(firstSave)).toEqual(blockIds(projected))
      expect(blockIds(secondSave)).toEqual(blockIds(projected))
      expect(secondSave).toEqual(firstSave)
    }
  )
})
