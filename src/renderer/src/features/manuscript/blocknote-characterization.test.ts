import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it } from 'vitest'
import { approvedEditorSchema } from './editor-schema'

describe('BlockNote 0.47.2 native JSON characterization', () => {
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
  })
})
