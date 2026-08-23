import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import type { BlockNoteDocument } from '../../../../shared/contracts/manuscript'
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
        content: [{ type: 'text', text: 'Legacy paragraph', styles: { bold: true } }],
        children: [{ id: 'v1-nested', type: 'bulletListItem', content: 'Nested legacy item' }]
      },
      { id: 'v1-heading', type: 'heading', props: { level: 2 }, content: 'Legacy heading' }
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
          name: 'Legacy image',
          caption: 'Legacy caption',
          showPreview: true,
          previewWidth: 480
        }
      },
      {
        id: 'v2-mermaid',
        type: 'mermaid',
        props: { source: 'flowchart LR\nA --> B', caption: 'Flow', previewWidth: 640 }
      },
      {
        id: 'v2-math',
        type: 'math',
        props: { source: 'E = mc^2', caption: 'Energy', previewWidth: 320 }
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
          name: 'Current image',
          caption: 'Current caption',
          figureId: 'figure:stable:v3',
          altText: 'Current alternative',
          showPreview: true,
          previewWidth: 512
        }
      },
      {
        id: 'v3-list',
        type: 'numberedListItem',
        content: 'Current list',
        children: [{ id: 'v3-nested', type: 'paragraph', content: 'Nested current block' }]
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
          id: 'display-math-id',
          type: 'displayMath',
          props: { source: 'x^2', caption: 'Display', previewWidth: 320 }
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
      id: 'display-math-id',
      type: 'math',
      props: { source: 'x^2', caption: 'Display' }
    })
  })

  it.each(representativeDocuments)(
    'round-trips the %s golden without changing block IDs or normalized JSON',
    (_name, document) => {
      const editor = BlockNoteEditor.create({
        schema: approvedEditorSchema,
        initialContent: toApprovedEditorDocument(document as unknown as BlockNoteDocument)
      })
      const firstSave = toCanonicalDocument(editor.document)
      const restored = BlockNoteEditor.create({
        schema: approvedEditorSchema,
        initialContent: toApprovedEditorDocument(firstSave)
      })
      const secondSave = toCanonicalDocument(restored.document)

      expect(blockIds(firstSave)).toEqual(blockIds(document))
      expect(blockIds(secondSave)).toEqual(blockIds(document))
      expect(secondSave).toEqual(firstSave)
    }
  )
})
