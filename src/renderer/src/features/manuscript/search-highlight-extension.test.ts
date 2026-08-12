import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it, vi } from 'vitest'
import { approvedEditorSchema } from './editor-schema'
import { buildReadableCitationDecorations } from './readable-citation-extension'
import {
  buildSearchDecorations,
  manuscriptSearchHighlightExtension
} from './search-highlight-extension'

describe('manuscript search highlight extension', () => {
  it('decorates an exact flat range without changing BlockNote JSON', () => {
    const initialContent = [
      {
        id: 'paragraph-1',
        type: 'paragraph' as const,
        content: [
          { type: 'text' as const, text: 'Split ', styles: { bold: true } },
          { type: 'text' as const, text: 'target text', styles: { italic: true } }
        ]
      }
    ]
    const target = {
      kind: 'block_inline' as const,
      sectionId: 'section-1',
      revisionId: 'revision-1',
      blockId: 'paragraph-1',
      segments: [{ inlineIndex: 1, range: { from: 0, to: 6 } }],
      flatRange: { from: 6, to: 12 }
    }
    const editor = BlockNoteEditor.create({
      schema: approvedEditorSchema,
      initialContent,
      extensions: [
        manuscriptSearchHighlightExtension({ getTarget: () => target, onInvalidated: vi.fn() })
      ]
    })
    const before = JSON.parse(JSON.stringify(editor.document))
    const decorations = buildSearchDecorations(editor._tiptapEditor.state.doc, target).find()
    expect(decorations).toHaveLength(1)
    expect(
      (decorations[0] as unknown as { type: { attrs: Record<string, string> } }).type.attrs
    ).toMatchObject({ class: 'writellm-search-match' })
    expect(JSON.parse(JSON.stringify(editor.document))).toEqual(before)
  })

  it('coexists with readable citation decorations', () => {
    const editor = BlockNoteEditor.create({
      schema: approvedEditorSchema,
      initialContent: [
        { id: 'paragraph-1', type: 'paragraph', content: 'Claim [Source: Evidence.pdf].' }
      ]
    })
    const target = {
      kind: 'block_inline' as const,
      sectionId: 'section-1',
      revisionId: 'revision-1',
      blockId: 'paragraph-1',
      segments: [{ inlineIndex: 0, range: { from: 0, to: 5 } }],
      flatRange: { from: 0, to: 5 }
    }
    expect(buildSearchDecorations(editor._tiptapEditor.state.doc, target).find()).toHaveLength(1)
    expect(buildReadableCitationDecorations(editor._tiptapEditor.state.doc).find()).toHaveLength(1)
  })

  it('resolves the requested table cell instead of merging cell surfaces', () => {
    const editor = BlockNoteEditor.create({
      schema: approvedEditorSchema,
      initialContent: [
        {
          id: 'table-1',
          type: 'table',
          content: { type: 'tableContent', rows: [{ cells: [['first'], ['second target']] }] }
        }
      ]
    })
    const target = {
      kind: 'table_cell' as const,
      sectionId: 'section-1',
      revisionId: 'revision-1',
      blockId: 'table-1',
      rowIndex: 0,
      cellIndex: 1,
      segments: [{ inlineIndex: 0, range: { from: 7, to: 13 } }],
      flatRange: { from: 7, to: 13 }
    }
    const decorations = buildSearchDecorations(editor._tiptapEditor.state.doc, target).find()
    expect(decorations).toHaveLength(1)
  })
})
