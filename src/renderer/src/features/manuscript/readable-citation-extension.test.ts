import { BlockNoteEditor } from '@blocknote/core'
import { describe, expect, it, vi } from 'vitest'
import { approvedEditorSchema } from './editor-schema'
import {
  buildReadableCitationDecorations,
  readableCitationExtension
} from './readable-citation-extension'

describe('readable citation BlockNote extension', () => {
  it('decorates citations across styled text nodes without changing native JSON', () => {
    const initialContent = [
      {
        id: 'citation-block',
        type: 'paragraph' as const,
        content: [
          { type: 'text' as const, text: 'Claim [Source: Split', styles: {} },
          { type: 'text' as const, text: ' source.pdf, p. 2]', styles: { italic: true } },
          { type: 'text' as const, text: ' remains.', styles: {} }
        ]
      }
    ]
    const editor = BlockNoteEditor.create({
      schema: approvedEditorSchema,
      initialContent,
      extensions: [readableCitationExtension({ onActivate: vi.fn() })]
    })
    const before = JSON.parse(JSON.stringify(editor.document))
    const decorations = buildReadableCitationDecorations(editor._tiptapEditor.state.doc)

    expect(decorations.find()).toHaveLength(1)
    const attributes = (
      decorations.find()[0] as unknown as { type: { attrs: Record<string, string> } }
    ).type.attrs
    expect(attributes).toMatchObject({
      class: 'writellm-readable-citation',
      'data-citation-title': 'Split source.pdf',
      'data-citation-page-index': '1',
      role: 'button',
      tabindex: '0'
    })
    expect(JSON.parse(JSON.stringify(editor.document))).toEqual(before)
  })

  it('recomputes decorations after document edits', () => {
    const editor = BlockNoteEditor.create({
      schema: approvedEditorSchema,
      initialContent: [{ id: 'citation-block', type: 'paragraph', content: 'Plain text' }],
      extensions: [readableCitationExtension({ onActivate: vi.fn() })]
    })
    expect(buildReadableCitationDecorations(editor._tiptapEditor.state.doc).find()).toHaveLength(0)

    editor.updateBlock('citation-block', { content: 'Claim 【来源：论文.pdf，第 4 页】' })

    expect(buildReadableCitationDecorations(editor._tiptapEditor.state.doc).find()).toHaveLength(1)
  })
})
